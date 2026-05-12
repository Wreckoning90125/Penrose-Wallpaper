#pragma once

#include <cstdint>
#include <vector>

namespace penrose {

// A Robinson triangle. type 0 = L (obtuse 108-36-36), 1 = S (acute 36-72-72).
// Convention from the JS reference: verts = [A, B, C], B is the apex, A-C the
// base. Used for both P3 and P2; P3 is the only family wired up for now.
struct Tri {
    float ax, ay;
    float bx, by;
    float cx, cy;
    uint8_t type; // 0 = L, 1 = S
};

// One-tenth-of-a-circle Sun seed: 10 S triangles around the origin, apex at
// (0,0). Matches p3Sun() in web/penrose.js.
std::vector<Tri> seedP3Sun();

// One P3 deflation step. Each L produces 2 L + 1 S; each S produces 1 L + 1 S.
// Matches subdivideP3() in web/penrose.js.
std::vector<Tri> subdivideP3(const std::vector<Tri>& in);

// Convenience: seed + N deflations.
inline std::vector<Tri> generateP3Sun(int generations) {
    auto tris = seedP3Sun();
    for (int g = 0; g < generations; ++g) tris = subdivideP3(tris);
    return tris;
}

} // namespace penrose
