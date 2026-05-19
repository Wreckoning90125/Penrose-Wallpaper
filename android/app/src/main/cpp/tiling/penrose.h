#pragma once

#include <cstdint>
#include <vector>

namespace penrose {

// =============================================================================
// Tile data model
// =============================================================================
// A single tile, polymorphic across the three families:
//   P3 / P2 — Robinson triangles. verts = [A, B, C] with B = apex, A-C base.
//             type = 0 (L = obtuse 108-36-36) or 1 (S = acute 36-72-72).
//   Chair   — L-tromino. 6 vertices in CCW order. type = 0..3, encoding the
//             integer orientation (also used by the "type" color mode).
// We pack triangles and L-trominoes into the same struct so the renderer can
// iterate uniformly. `vcount` is 3 for Penrose, 6 for Chair.
// =============================================================================

struct Tile {
    float x[6];
    float y[6];
    uint8_t vcount;   // 3 for P3/P2 triangles, 6 for chair L-trominoes
    uint8_t type;     // 0=L, 1=S for Penrose; 0..3 for chair orientation
};

enum class Family : int { P3 = 0, P2 = 1, Chair = 2 };

// Per-family edge classification used by the border seam-hiding rule.
//   For Penrose: Leg = the two equal-length sides, Base = the third.
//   For Chair: ChairEdge — no internal seams to hide.
enum class EdgeKind : uint8_t { Leg = 0, Base = 1, ChairEdge = 2 };

struct Edge {
    float p1x, p1y;
    float p2x, p2y;
    EdgeKind kind;
    uint8_t  tileType; // tile that produced this edge (for hideSeam)
};

// =============================================================================
// Seeds
// =============================================================================

enum class SeedP3 : int { Sun = 0, Star = 1, Cartwheel = 2, Ace = 3 };
enum class SeedP2 : int { Sun = 0, Star = 1 };
enum class SeedChair : int { Pinwheel = 0, Small = 1, Large = 2 };

std::vector<Tile> seedP3(SeedP3 seed);
std::vector<Tile> seedP2(SeedP2 seed);
std::vector<Tile> seedChair(SeedChair seed);

// =============================================================================
// Substitutions
// =============================================================================

std::vector<Tile> subdivideP3(const std::vector<Tile>& in);
std::vector<Tile> subdivideP2(const std::vector<Tile>& in);
std::vector<Tile> subdivideChair(const std::vector<Tile>& in);

// =============================================================================
// Edge extraction (one entry per side of every tile)
// =============================================================================

// Pushes the 3 edges of a Penrose triangle: A-B (leg), B-C (leg), A-C (base).
void edgesPenrose(const Tile& t, std::vector<Edge>& out);

// Pushes the 6 edges of an L-tromino.
void edgesChair(const Tile& t, std::vector<Edge>& out);

// =============================================================================
// Convenience
// =============================================================================

// Per-family hard caps. Chair's 4× growth is much faster than Penrose's phi²;
// keep tile count under ~64k at the cap so on-device generation stays snappy.
constexpr int kMaxGenP3 = 8;
constexpr int kMaxGenP2 = 8;
constexpr int kMaxGenChair = 7;

// Generate a full tiling: seed + N deflations. Family-erased entry point.
std::vector<Tile> generate(Family family, int seedIdx, int generations);

// Family-aware deflation rate, used by the renderer to skip borders when
// edges shrink below sub-pixel.
inline float deflationRate(Family f) {
    return (f == Family::Chair) ? 0.5f : 0.6180339887498949f;  // 1/phi
}

} // namespace penrose
