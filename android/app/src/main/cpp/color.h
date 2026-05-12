#pragma once

#include "penrose.h"

#include <array>
#include <cstdint>
#include <vector>

namespace penrose {

// =============================================================================
// Color types
// =============================================================================
// All colors live in OKLCH (Björn Ottosson, 2020) and are converted to sRGB at
// the boundary before being uploaded to the UBO. OKLCH gives us perceptually
// uniform interpolation, which is what makes evenStops(...) read as a smooth
// gradient instead of muddy in the middle.

struct Oklch { float L, C, H; };
struct LinearRGB { float r, g, b, a; }; // linear-light, pre-multiplied alpha = 1
struct SrgbRGBA { float r, g, b, a; };  // gamma-encoded sRGB, what the GPU wants

// Convert OKLCH to gamma-encoded sRGB (clamped to [0, 1]).
SrgbRGBA oklchToSrgb(Oklch c, float alpha = 1.0f);

// =============================================================================
// Palette presets
// =============================================================================
// Each preset returns up to kMaxColors OKLCH triples for a given K.
// The renderer reads the first state.colorCount entries.

constexpr int kMaxColors = 10;

enum class Preset : int {
    BW = 0,
    Greys,
    Prism,
    Paper,
    Gold,
    Rust,
    Plum,
    Cobalt,
    Sage,
    Spectra,
    Girih,
    Count_
};

constexpr int kPresetCount = static_cast<int>(Preset::Count_);

struct PresetResult {
    std::array<Oklch, kMaxColors> colors;
    Oklch bg;
};

PresetResult buildPreset(Preset p, int k);

// =============================================================================
// Color modes — assign each tile a bucket index, then map to a palette slot.
// =============================================================================

enum class ColorMode : int {
    Type = 0,    // L/S for Penrose, orient 0..3 for chair
    Orient = 1,  // 10 bins for Penrose (base direction), orient 0..3 for chair
    Ring = 2,    // K bins by distance from origin
};

// Returns, for each tile in `tiles`, the bucket index in [0, numBuckets).
// numBuckets is 10 for Penrose orient mode, K for ring mode, family-natural
// for type mode (2 for Penrose, 4 for chair).
struct Classification {
    std::vector<uint8_t> bucket; // one byte per tile
    int numBuckets;
};

Classification classify(const std::vector<Tile>& tiles,
                        Family family,
                        ColorMode mode,
                        int colorCount);

// Maps a tile's bucket index to a palette index, using the same contiguous-
// grouping rule the HTML reference uses: when buckets > k, group neighbouring
// buckets into k chunks; otherwise bucket % k.
inline int bucketToPaletteIdx(int bucket, int numBuckets, int k) {
    if (k <= 1) return 0;
    if (numBuckets > k) {
        const float groupBy = static_cast<float>(numBuckets) / static_cast<float>(k);
        int idx = static_cast<int>(static_cast<float>(bucket) / groupBy);
        if (idx >= k) idx = k - 1;
        if (idx < 0) idx = 0;
        return idx;
    }
    return bucket % k;
}

} // namespace penrose
