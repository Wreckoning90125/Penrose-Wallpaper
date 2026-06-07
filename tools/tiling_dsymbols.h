#pragma once

#include "tiling/penrose.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <map>
#include <unordered_map>
#include <vector>

namespace penrose::analysis {

struct DelaneyPatchSummary {
    int chambers = 0;
    int faceOrbits = 0;
    int edgeOrbits = 0;
    int interiorVertexOrbits = 0;
    int boundaryVertexOrbits = 0;
    int vertexConfigurations = 0;
    int boundaryEdges = 0;
    int overfullEdges = 0;
    int badInvolutions = 0;
    int badCommutators = 0;
    int badInteriorVertexAngles = 0;

    [[nodiscard]] bool valid() const {
        return overfullEdges == 0
            && badInvolutions == 0
            && badCommutators == 0
            && badInteriorVertexAngles == 0;
    }
};

struct DelaneyPatchOrbit {
    int opA = 0;
    int opB = 0;
    std::vector<int> elements;
    bool isChain = false;

    [[nodiscard]] int r() const {
        return isChain
            ? static_cast<int>(elements.size())
            : (static_cast<int>(elements.size()) + 1) / 2;
    }
};

struct FiniteDelaneyPatch {
    std::array<std::vector<int>, 3> op;
    std::vector<int> chamberTile;
    std::vector<int> chamberCorner;
    std::vector<double> chamberAngle;
    std::vector<int> chamberSides;
    std::vector<int> chamberType;
    std::vector<DelaneyPatchOrbit> faceOrbits;
    std::vector<DelaneyPatchOrbit> edgeOrbits;
    std::vector<DelaneyPatchOrbit> vertexOrbits;
    std::vector<std::vector<int>> vertexConfigurationCodes;
    DelaneyPatchSummary summary;
};

namespace detail {

constexpr double kPi = 3.141592653589793238462643383279502884;

struct QuantPoint {
    long long x;
    long long y;
};

inline bool operator==(const QuantPoint& a, const QuantPoint& b) {
    return a.x == b.x && a.y == b.y;
}

inline bool operator<(const QuantPoint& a, const QuantPoint& b) {
    return a.x == b.x ? a.y < b.y : a.x < b.x;
}

struct EdgeKey {
    QuantPoint a;
    QuantPoint b;
};

inline bool operator==(const EdgeKey& a, const EdgeKey& b) {
    return a.a == b.a && a.b == b.b;
}

inline std::size_t hashLongLong(long long value) {
    return std::hash<long long>{}(value);
}

struct EdgeKeyHash {
    std::size_t operator()(const EdgeKey& key) const {
        std::size_t h = hashLongLong(key.a.x);
        h ^= hashLongLong(key.a.y) + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
        h ^= hashLongLong(key.b.x) + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
        h ^= hashLongLong(key.b.y) + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
        return h;
    }
};

inline QuantPoint quantPoint(double x, double y) {
    constexpr double scale = 100000.0;
    return {
        static_cast<long long>(std::llround(x * scale)),
        static_cast<long long>(std::llround(y * scale)),
    };
}

inline EdgeKey edgeKey(QuantPoint a, QuantPoint b) {
    if (b < a) std::swap(a, b);
    return { a, b };
}

inline double orient2(double ax, double ay, double bx, double by, double cx, double cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

inline double interiorAngleAt(const Tile& tile, int corner) {
    const int prev = (corner + tile.vcount - 1) % tile.vcount;
    const int next = (corner + 1) % tile.vcount;
    const double ax = static_cast<double>(tile.x[prev]) - tile.x[corner];
    const double ay = static_cast<double>(tile.y[prev]) - tile.y[corner];
    const double bx = static_cast<double>(tile.x[next]) - tile.x[corner];
    const double by = static_cast<double>(tile.y[next]) - tile.y[corner];
    const double al = std::hypot(ax, ay);
    const double bl = std::hypot(bx, by);
    if (al <= 1e-14 || bl <= 1e-14) return 0.0;
    const double dot = std::clamp((ax * bx + ay * by) / (al * bl), -1.0, 1.0);
    double angle = std::acos(dot);
    const double turn = orient2(
        tile.x[prev], tile.y[prev],
        tile.x[corner], tile.y[corner],
        tile.x[next], tile.y[next]);
    const double area = tileSignedArea(tile);
    if ((area >= 0.0 && turn < 0.0) || (area < 0.0 && turn > 0.0)) {
        angle = 2.0 * kPi - angle;
    }
    return angle;
}

struct ChamberEdge {
    QuantPoint v0;
    QuantPoint v1;
    int chamber0;
    int chamber1;
    int mate = -1;
};

inline int chamberId(const std::vector<int>& tileBase, int tile, int edge, int endpoint) {
    return tileBase[tile] + edge * 2 + endpoint;
}

inline DelaneyPatchOrbit collectAlternatingOrbit(
    const std::array<std::vector<int>, 3>& op,
    int a,
    int b,
    int start,
    std::vector<uint8_t>& seen
) {
    DelaneyPatchOrbit orbit{};
    orbit.opA = a;
    orbit.opB = b;
    int chamber = start;
    int currentOp = a;
    seen[chamber] = 1;
    orbit.elements.push_back(chamber);
    while (true) {
        const int next = op[currentOp][chamber];
        orbit.isChain = orbit.isChain || next == chamber;
        chamber = next;
        currentOp = a + b - currentOp;
        if (!seen[chamber]) {
            seen[chamber] = 1;
            orbit.elements.push_back(chamber);
        }
        if (chamber == start && currentOp == a) break;
    }
    return orbit;
}

inline std::vector<DelaneyPatchOrbit> collectOrbits(
    const std::array<std::vector<int>, 3>& op,
    int a,
    int b
) {
    std::vector<uint8_t> seen(op[0].size(), 0);
    std::vector<DelaneyPatchOrbit> orbits;
    for (int d = 0; d < static_cast<int>(seen.size()); ++d) {
        if (!seen[d]) {
            orbits.push_back(collectAlternatingOrbit(op, a, b, d, seen));
        }
    }
    return orbits;
}

inline std::vector<int> canonicalCycleCode(std::vector<std::array<int, 3>> tokens) {
    const auto flatten = [](const std::vector<std::array<int, 3>>& source, int start) {
        std::vector<int> out;
        out.reserve(source.size() * 3);
        for (int i = 0; i < static_cast<int>(source.size()); ++i) {
            const auto& token = source[(start + i) % source.size()];
            out.push_back(token[0]);
            out.push_back(token[1]);
            out.push_back(token[2]);
        }
        return out;
    };

    std::vector<int> best;
    const auto consider = [&](const std::vector<std::array<int, 3>>& source) {
        for (int start = 0; start < static_cast<int>(source.size()); ++start) {
            std::vector<int> candidate = flatten(source, start);
            if (best.empty() || std::lexicographical_compare(
                    candidate.begin(), candidate.end(),
                    best.begin(), best.end())) {
                best = std::move(candidate);
            }
        }
    };
    consider(tokens);
    std::reverse(tokens.begin(), tokens.end());
    consider(tokens);
    return best;
}

inline bool containsInt(const std::vector<int>& values, int needle) {
    return std::find(values.begin(), values.end(), needle) != values.end();
}

} // namespace detail

inline FiniteDelaneyPatch extractFiniteDelaneyPatch(const std::vector<Tile>& tiles) {
    FiniteDelaneyPatch patch{};
    std::vector<int> tileBase(tiles.size(), 0);
    for (int t = 0; t < static_cast<int>(tiles.size()); ++t) {
        tileBase[t] = patch.summary.chambers;
        patch.summary.chambers += static_cast<int>(tiles[t].vcount) * 2;
    }

    patch.op = {
        std::vector<int>(patch.summary.chambers, -1),
        std::vector<int>(patch.summary.chambers, -1),
        std::vector<int>(patch.summary.chambers, -1),
    };
    patch.chamberTile.assign(patch.summary.chambers, -1);
    patch.chamberCorner.assign(patch.summary.chambers, -1);
    patch.chamberAngle.assign(patch.summary.chambers, 0.0);
    patch.chamberSides.assign(patch.summary.chambers, 0);
    patch.chamberType.assign(patch.summary.chambers, 0);

    std::vector<detail::ChamberEdge> edges;
    edges.reserve(patch.summary.chambers / 2);
    std::unordered_map<detail::EdgeKey, int, detail::EdgeKeyHash> firstEdge;

    for (int t = 0; t < static_cast<int>(tiles.size()); ++t) {
        const Tile& tile = tiles[t];
        for (int e = 0; e < tile.vcount; ++e) {
            const int next = (e + 1) % tile.vcount;
            const int prev = (e + tile.vcount - 1) % tile.vcount;
            const int c0 = detail::chamberId(tileBase, t, e, 0);
            const int c1 = detail::chamberId(tileBase, t, e, 1);
            patch.op[0][c0] = c1;
            patch.op[0][c1] = c0;
            patch.op[1][c0] = detail::chamberId(tileBase, t, prev, 1);
            patch.op[1][c1] = detail::chamberId(tileBase, t, next, 0);

            const int corner0 = e;
            const int corner1 = next;
            patch.chamberTile[c0] = patch.chamberTile[c1] = t;
            patch.chamberCorner[c0] = corner0;
            patch.chamberCorner[c1] = corner1;
            patch.chamberAngle[c0] = detail::interiorAngleAt(tile, corner0);
            patch.chamberAngle[c1] = detail::interiorAngleAt(tile, corner1);
            patch.chamberSides[c0] = patch.chamberSides[c1] = tile.vcount;
            patch.chamberType[c0] = patch.chamberType[c1] = tile.type;

            const detail::QuantPoint q0 = detail::quantPoint(tile.x[e], tile.y[e]);
            const detail::QuantPoint q1 = detail::quantPoint(tile.x[next], tile.y[next]);
            const int edgeIndex = static_cast<int>(edges.size());
            edges.push_back({ q0, q1, c0, c1 });
            const detail::EdgeKey key = detail::edgeKey(q0, q1);
            const auto found = firstEdge.find(key);
            if (found == firstEdge.end()) {
                firstEdge.emplace(key, edgeIndex);
            } else if (edges[found->second].mate == -1) {
                edges[found->second].mate = edgeIndex;
                edges[edgeIndex].mate = found->second;
            } else {
                patch.summary.overfullEdges += 1;
            }
        }
    }

    for (int edgeIndex = 0; edgeIndex < static_cast<int>(edges.size()); ++edgeIndex) {
        const detail::ChamberEdge& edge = edges[edgeIndex];
        if (edge.mate < 0) {
            patch.op[2][edge.chamber0] = edge.chamber0;
            patch.op[2][edge.chamber1] = edge.chamber1;
            patch.summary.boundaryEdges += 1;
            continue;
        }
        const detail::ChamberEdge& mate = edges[edge.mate];
        patch.op[2][edge.chamber0] = (edge.v0 == mate.v0) ? mate.chamber0 : mate.chamber1;
        patch.op[2][edge.chamber1] = (edge.v1 == mate.v0) ? mate.chamber0 : mate.chamber1;
    }

    for (int i = 0; i < 3; ++i) {
        for (int d = 0; d < patch.summary.chambers; ++d) {
            const int e = patch.op[i][d];
            if (e < 0 || e >= patch.summary.chambers || patch.op[i][e] != d) {
                patch.summary.badInvolutions += 1;
            }
        }
    }
    for (int d = 0; d < patch.summary.chambers; ++d) {
        if (patch.op[0][patch.op[2][d]] != patch.op[2][patch.op[0][d]]) {
            patch.summary.badCommutators += 1;
        }
    }

    patch.faceOrbits = detail::collectOrbits(patch.op, 0, 1);
    patch.edgeOrbits = detail::collectOrbits(patch.op, 0, 2);
    patch.vertexOrbits = detail::collectOrbits(patch.op, 1, 2);
    patch.summary.faceOrbits = static_cast<int>(patch.faceOrbits.size());
    patch.summary.edgeOrbits = static_cast<int>(patch.edgeOrbits.size());

    std::map<std::vector<int>, int> configs;
    for (const DelaneyPatchOrbit& orbit : patch.vertexOrbits) {
        bool boundary = orbit.isChain;
        for (int d : orbit.elements) {
            boundary = boundary || patch.op[2][d] == d;
        }
        if (boundary) {
            patch.summary.boundaryVertexOrbits += 1;
            continue;
        }

        patch.summary.interiorVertexOrbits += 1;
        std::vector<int> cornerKeys;
        cornerKeys.reserve(orbit.elements.size());
        for (int d : orbit.elements) {
            const int key = patch.chamberTile[d] * kMaxTileVerts + patch.chamberCorner[d];
            if (!detail::containsInt(cornerKeys, key)) cornerKeys.push_back(key);
        }

        double angleSum = 0.0;
        std::vector<std::array<int, 3>> tokens;
        tokens.reserve(cornerKeys.size());
        for (int cornerKey : cornerKeys) {
            const int tile = cornerKey / kMaxTileVerts;
            const int corner = cornerKey % kMaxTileVerts;
            const int d = detail::chamberId(tileBase, tile, corner, 0);
            angleSum += patch.chamberAngle[d];
            tokens.push_back({
                static_cast<int>(std::llround(patch.chamberAngle[d] * 10000.0)),
                patch.chamberSides[d],
                patch.chamberType[d],
            });
        }
        if (std::fabs(angleSum - 2.0 * detail::kPi) > 1e-3) {
            patch.summary.badInteriorVertexAngles += 1;
        }
        const std::vector<int> code = detail::canonicalCycleCode(tokens);
        const auto added = configs.emplace(code, 1);
        if (added.second) {
            patch.vertexConfigurationCodes.push_back(code);
        } else {
            added.first->second += 1;
        }
    }

    patch.summary.vertexConfigurations = static_cast<int>(patch.vertexConfigurationCodes.size());
    return patch;
}

inline DelaneyPatchSummary summarizeFiniteDelaneyPatch(const std::vector<Tile>& tiles) {
    return extractFiniteDelaneyPatch(tiles).summary;
}

} // namespace penrose::analysis
