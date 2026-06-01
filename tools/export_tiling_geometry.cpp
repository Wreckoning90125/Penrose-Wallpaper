// Writes one generated tiling patch as a compact little-endian binary stream.
// The browser renderer reads this format directly; generation still comes from
// the same C++ tiling core used by the Android renderer.

#include "tiling/penrose.h"

#include <charconv>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <system_error>
#include <vector>

namespace {

bool parseInt(const char* text, int& out) {
    const std::string s(text);
    const char* first = s.data();
    const char* last = first + s.size();
    const auto [ptr, ec] = std::from_chars(first, last, out);
    return ec == std::errc{} && ptr == last;
}

bool pathStartsWith(const std::filesystem::path& path, const std::filesystem::path& root) {
    auto pit = path.begin();
    auto rit = root.begin();
    for (; rit != root.end(); ++rit, ++pit) {
        if (pit == path.end() || *pit != *rit) return false;
    }
    return true;
}

bool resolveOutputPath(const char* text, std::filesystem::path& out) {
    std::filesystem::path requested(text);
    if (requested.empty() || requested.is_absolute() || requested.extension() != ".ptg") {
        return false;
    }
    for (const auto& part : requested) {
        if (part == "." || part == "..") return false;
    }

    std::error_code ec;
    const std::filesystem::path root = std::filesystem::weakly_canonical(
        std::filesystem::current_path(ec),
        ec
    );
    if (ec) return false;
    const std::filesystem::path parent = requested.parent_path().empty()
        ? root
        : std::filesystem::weakly_canonical(root / requested.parent_path(), ec);
    if (ec || !pathStartsWith(parent, root)) return false;

    out = parent / requested.filename();
    return true;
}

void writeU32(std::ofstream& out, uint32_t value) {
    const char bytes[4] = {
        static_cast<char>(value & 0xffu),
        static_cast<char>((value >> 8u) & 0xffu),
        static_cast<char>((value >> 16u) & 0xffu),
        static_cast<char>((value >> 24u) & 0xffu),
    };
    out.write(bytes, sizeof(bytes));
}

void writeF32(std::ofstream& out, float value) {
    uint32_t bits = 0;
    static_assert(sizeof(bits) == sizeof(value));
    std::memcpy(&bits, &value, sizeof(bits));
    writeU32(out, bits);
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 5) {
        std::cerr << "usage: export_tiling_geometry <family> <seed> <generation> <out.ptg>\n";
        return 2;
    }

    int familyId = 0;
    int seed = 0;
    int generation = 0;
    if (!parseInt(argv[1], familyId) ||
        !parseInt(argv[2], seed) ||
        !parseInt(argv[3], generation) ||
        familyId < 0 ||
        familyId >= penrose::kFamilyCount) {
        std::cerr << "bad family/seed/generation\n";
        return 2;
    }

    const auto family = static_cast<penrose::Family>(familyId);
    const std::vector<penrose::Tile> tiles = penrose::generate(family, seed, generation);

    std::filesystem::path outputPath;
    if (!resolveOutputPath(argv[4], outputPath)) {
        std::cerr << "bad output path (must be a relative .ptg path under cwd): " << argv[4] << "\n";
        return 2;
    }

    std::ofstream out(outputPath, std::ios::binary | std::ios::trunc);
    if (!out) {
        std::cerr << "cannot open output: " << outputPath << "\n";
        return 1;
    }

    const char magic[4] = {'P', 'T', 'G', '1'};
    out.write(magic, sizeof(magic));
    const uint32_t familyU32 = static_cast<uint32_t>(familyId);
    const uint32_t seedU32 = static_cast<uint32_t>(seed < 0 ? 0 : seed);
    const uint32_t generationU32 = static_cast<uint32_t>(generation < 0 ? 0 : generation);
    const uint32_t tileCount = static_cast<uint32_t>(tiles.size());
    writeU32(out, familyU32);
    writeU32(out, seedU32);
    writeU32(out, generationU32);
    writeU32(out, tileCount);

    for (const penrose::Tile& tile : tiles) {
        const uint8_t vcount = tile.vcount;
        const uint8_t type = tile.type;
        out.write(reinterpret_cast<const char*>(&vcount), sizeof(vcount));
        out.write(reinterpret_cast<const char*>(&type), sizeof(type));
        for (int i = 0; i < tile.vcount; ++i) {
            writeF32(out, tile.x[i]);
            writeF32(out, tile.y[i]);
        }
    }

    if (!out) {
        std::cerr << "failed while writing: " << outputPath << "\n";
        return 1;
    }
    return 0;
}
