#pragma once

#include <cstdint>
#include <vector>

namespace penrose {

// =============================================================================
// Tile data model
// =============================================================================
// A single tile, polymorphic across the families:
//   P3 / P2      — Robinson triangles. verts = [A, B, C] with B = apex,
//                  A-C base. type = 0 (L = obtuse 108-36-36) or
//                  1 (S = acute 36-72-72).
//   Chair        — L-tromino. 6 vertices in CCW order. type = 0..3, the
//                  integer orientation (also used by the "type" color mode).
//   Dodecagonal  — de Bruijn rhombus. 4 vertices in CCW order. type = 0..2,
//                  the rhomb shape (0 = 30 thin, 1 = 60 thick, 2 = 90 square).
//   Pinwheel     — Conway/Radin 1:2:sqrt(5) right triangle. verts = [S, L, M],
//                  the small (~26.57 deg), right (90 deg) and medium-angle
//                  corners. type = 0/1 chirality (mirror image or not).
//   AmmannBeenker / Heptagonal — de Bruijn rhombi, like Dodecagonal: 4
//                  vertices in CCW order, type = the rhomb shape.
// We pack every shape into the same struct so the renderer can iterate
// uniformly. `vcount` is 3 for Penrose / pinwheel, 4 for the de Bruijn
// rhombus families (Dodecagonal, AmmannBeenker, Heptagonal), 6 for Chair.
// =============================================================================

struct Tile {
    float x[6];
    float y[6];
    uint8_t vcount;   // 3 for P3/P2/pinwheel tris, 4 for dodeca rhombs, 6 chair
    uint8_t type;     // 0=L,1=S Penrose; 0..3 chair; 0..2 dodeca; 0/1 pinwheel
};

enum class Family : int {
    P3 = 0, P2 = 1, Chair = 2, Dodecagonal = 3, Pinwheel = 4,
    AmmannBeenker = 5, Heptagonal = 6, Binary = 7,
};

// Number of Family enumerators. The JNI layer validates the incoming family
// index against this; keep it in step with the enum above and with the
// kFamilyInfo[] table in penrose.cpp.
constexpr int kFamilyCount = 8;

// Per-family edge classification used by the border seam-hiding rule.
//   For Penrose: Leg = the two equal-length sides, Base = the third.
//   For Chair / Dodecagonal: ChairEdge — no internal seams to hide.
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
enum class SeedDodeca : int { Rosette = 0, Drift = 1, Quasi = 2 };
enum class SeedPinwheel : int { Square = 0, Triangle = 1, Rectangle = 2 };
enum class SeedBinary : int { Bear = 0, Dog = 1 };

std::vector<Tile> seedP3(SeedP3 seed);
std::vector<Tile> seedP2(SeedP2 seed);
std::vector<Tile> seedChair(SeedChair seed);
std::vector<Tile> seedPinwheel(SeedPinwheel seed);

// =============================================================================
// Substitutions
// =============================================================================

std::vector<Tile> subdivideP3(const std::vector<Tile>& in);
std::vector<Tile> subdivideP2(const std::vector<Tile>& in);
std::vector<Tile> subdivideChair(const std::vector<Tile>& in);

// Pinwheel deflation: each 1:2:sqrt(5) triangle becomes five at 1/sqrt(5)
// scale (Conway / Radin). Reflected tiles arise naturally and are kept.
std::vector<Tile> subdividePinwheel(const std::vector<Tile>& in);

// de Bruijn N-grid dualization: the dual of `gridCount` line grids spaced
// 180/gridCount degrees apart is a rhombic tiling with 2*gridCount-fold
// symmetry. gridCount = 4 -> Ammann-Beenker (square + 45 rhomb), 6 ->
// dodecagonal (3 rhombs), 7 -> the 14-fold heptagonal rhombus tiling. There
// is no seed/subdivide pair; `generations` selects the grid line-index range,
// so a higher value yields a finer patch the way deeper deflation does for
// the substitution families. `seedIdx` (0..2) picks a grid-offset variant.
std::vector<Tile> generateMultigrid(int gridCount, int seedIdx, int generations);

// Godreche-Lancon binary tiling: a non-Pisot 5-fold substitution on the two
// Penrose rhombs (inflation factor sqrt(2+phi), eigenvalue phi^2). Grown by
// the recursion of Godreche & Lancon 1992, then closed into the centred Bear
// (seedIdx 0) or Dog (seedIdx 1) patch. Like generateMultigrid there is no
// seed/subdivide pair; `generations` is the recursion depth.
std::vector<Tile> generateBinary(int seedIdx, int generations);

// =============================================================================
// Edge extraction (one entry per side of every tile)
// =============================================================================

// Pushes the 3 edges of a Penrose triangle: A-B (leg), B-C (leg), A-C (base).
void edgesPenrose(const Tile& t, std::vector<Edge>& out);

// Pushes one edge per side of a closed polygon tile, walking `vcount`
// vertices in order — the 6 sides of a chair L-tromino or the 4 sides of a
// dodecagonal rhombus.
void edgesChair(const Tile& t, std::vector<Edge>& out);

// =============================================================================
// Per-family descriptor table
// =============================================================================
// Everything the renderer and colour pipeline need to know about a family is
// data, not a switch: one FamilyInfo row per Family enumerator. Adding a
// family is adding a row (plus its generator) — no edits to classify(), the
// shaders, or the renderer's family branches.

// Colour-classification metadata. classify() (color.cpp) reads this instead
// of branching on the family; each ColorMode stays a distinct, principled
// notion with no per-family magic numbers.
struct ClassSpec {
    uint8_t typeBuckets;    // ColorMode::Type   — distinct tile kinds
    uint8_t orientBuckets;  // ColorMode::Orient — orientation slot count
    bool    orientFromType; // true: orient slot is the tile `type` field;
                            // false: bin the angle of edge v[angA] -> v[angB]
    uint8_t angA, angB;     // vertex indices for the orientation edge
    bool    orientHalfTurn; // true: the orientation edge is undirected — its
                            // angle only spans [0,pi) (de Bruijn rhomb edges),
                            // so bin mod pi to reach every orientBuckets slot
    bool    ringChebyshev;  // ColorMode::Ring   — true box metric, false radial
};

struct FamilyInfo {
    int       maxGen;        // generation cap (keeps tile count near ~64k)
    float     deflationRate; // linear tile shrink per generation (borders)
    int       waveSymmetry;  // ripple plane-wave fold count; 0 = radial
    uint8_t   hideSeamMode;  // 0 none, 1 P3 (Base+Base), 2 P2 (Leg+Leg)
    bool      depthParallax; // apex depth/parallax on triangle tiles
    ClassSpec cls;
};

// One row per Family, indexed by the enum value. Defined in penrose.cpp.
extern const FamilyInfo kFamilyInfo[kFamilyCount];

inline const FamilyInfo& familyInfo(Family f) {
    return kFamilyInfo[static_cast<int>(f)];
}

// Generate a full tiling: seed + N deflations, or N-grid dualization.
// Family-erased entry point.
std::vector<Tile> generate(Family family, int seedIdx, int generations);

// Linear deflation rate — the renderer scales border width by it per
// generation and skips borders once edges shrink below sub-pixel.
inline float deflationRate(Family f) { return familyInfo(f).deflationRate; }

} // namespace penrose
