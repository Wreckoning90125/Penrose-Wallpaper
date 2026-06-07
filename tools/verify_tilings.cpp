// =============================================================================
// Substitution / tiling verifier
// =============================================================================
// Reproducible regression check for the renderer's tiling families. It links
// the production tiling core (tiling/penrose.cpp) and checks generated patches
// without consulting any figure, screenshot, or rendered image:
//
//   1. Area conservation (substitution families). A substitution replaces a
//      tile by smaller tiles that must exactly repartition it, so the total
//      area is invariant under deflation. Checked across every generation
//      0..maxGen for families whose generator preserves a seed region.
//
//   2. Coverage regression. Monte-Carlo: sample points and count how many tiles
//      contain each. Seed-region families compare deepest-generation coverage
//      to generation 0. Patch families that do not preserve one fixed seed
//      region run an overlap screen over the generated patch.
//
//   3. Finite chamber topology. Every patch is converted to a Delaney-style
//      finite D-set over chambers. The gate checks involutions, op0/op2
//      commutation, overfull edges, face-orbit count, and interior vertex angle
//      sums, and reports canonical local vertex-star classes.
//
// Build and run (from the repository root):
//
//   g++ -std=c++20 -O2 -I android/app/src/main/cpp
//       tools/verify_tilings.cpp android/app/src/main/cpp/tiling/penrose.cpp
//       -o /tmp/verify_tilings && /tmp/verify_tilings
//
// Exit status is non-zero on any failure, so CI gates on it.
// =============================================================================

#include "tiling/penrose.h"
#include "tiling_dsymbols.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using namespace penrose;

namespace {

double tileArea(const Tile& t) {
    double a = 0.0;
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        a += static_cast<double>(t.x[i]) * t.y[j]
           - static_cast<double>(t.x[j]) * t.y[i];
    }
    return std::fabs(a) * 0.5;
}

double orient2(double ax, double ay, double bx, double by, double cx, double cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

bool pointOnSegment(double ax, double ay, double bx, double by, double px, double py) {
    constexpr double eps = 1e-8;
    if (std::fabs(orient2(ax, ay, bx, by, px, py)) > eps) return false;
    return px >= std::min(ax, bx) - eps && px <= std::max(ax, bx) + eps
        && py >= std::min(ay, by) - eps && py <= std::max(ay, by) + eps;
}

bool segmentsIntersect(
    double ax,
    double ay,
    double bx,
    double by,
    double cx,
    double cy,
    double dx,
    double dy
) {
    constexpr double eps = 1e-8;
    const double o1 = orient2(ax, ay, bx, by, cx, cy);
    const double o2 = orient2(ax, ay, bx, by, dx, dy);
    const double o3 = orient2(cx, cy, dx, dy, ax, ay);
    const double o4 = orient2(cx, cy, dx, dy, bx, by);
    if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
        ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) {
        return true;
    }
    return pointOnSegment(ax, ay, bx, by, cx, cy)
        || pointOnSegment(ax, ay, bx, by, dx, dy)
        || pointOnSegment(cx, cy, dx, dy, ax, ay)
        || pointOnSegment(cx, cy, dx, dy, bx, by);
}

bool simplePolygonOk(const Tile& t) {
    constexpr double eps = 1e-8;
    if (t.vcount < 3) return false;
    if (tileArea(t) <= eps) return false;
    for (int i = 0; i < t.vcount; ++i) {
        if (!std::isfinite(t.x[i]) || !std::isfinite(t.y[i])) return false;
        const int j = (i + 1) % t.vcount;
        const double dx = static_cast<double>(t.x[i]) - t.x[j];
        const double dy = static_cast<double>(t.y[i]) - t.y[j];
        if (dx * dx + dy * dy <= eps * eps) return false;
    }
    for (int i = 0; i < t.vcount; ++i) {
        const int i1 = (i + 1) % t.vcount;
        for (int j = i + 1; j < t.vcount; ++j) {
            const int j1 = (j + 1) % t.vcount;
            if (i == j || i1 == j || j1 == i) continue;
            if (i == 0 && j1 == 0) continue;
            if (segmentsIntersect(t.x[i], t.y[i], t.x[i1], t.y[i1], t.x[j], t.y[j], t.x[j1], t.y[j1])) {
                return false;
            }
        }
    }
    return true;
}

// Even-odd point-in-polygon, valid for the convex and the concave (P1 star /
// boat, Chair L-tromino) tiles alike.
bool inside(const Tile& t, double px, double py) {
    bool in = false;
    const int n = t.vcount;
    for (int i = 0, j = n - 1; i < n; j = i++) {
        const double xi = t.x[i], yi = t.y[i];
        const double xj = t.x[j], yj = t.y[j];
        if (((yi > py) != (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            in = !in;
        }
    }
    return in;
}

// Uniform bucket grid over tile bounding boxes — turns the per-point coverage
// query from O(tiles) into O(tiles in one cell).
struct Grid {
    double minx = 0, miny = 0, cell = 1, span = 1;
    int G = 1;
    std::vector<std::vector<int>> cells;

    int clampi(double v) const {
        const int i = static_cast<int>(std::floor(v));
        return i < 0 ? 0 : (i >= G ? G - 1 : i);
    }

    Grid(const std::vector<Tile>& ts, int g) : G(g), cells(g * g) {
        double maxx = -1e30, maxy = -1e30;
        minx = miny = 1e30;
        for (const Tile& t : ts)
            for (int i = 0; i < t.vcount; ++i) {
                minx = std::min(minx, static_cast<double>(t.x[i]));
                maxx = std::max(maxx, static_cast<double>(t.x[i]));
                miny = std::min(miny, static_cast<double>(t.y[i]));
                maxy = std::max(maxy, static_cast<double>(t.y[i]));
            }
        if (ts.empty()) { minx = miny = 0; maxx = maxy = 1; }
        span = std::max(maxx - minx, maxy - miny) * 1.0001 + 1e-9;
        cell = span / G;
        for (int idx = 0; idx < static_cast<int>(ts.size()); ++idx) {
            const Tile& t = ts[idx];
            double bx0 = 1e30, by0 = 1e30, bx1 = -1e30, by1 = -1e30;
            for (int i = 0; i < t.vcount; ++i) {
                bx0 = std::min(bx0, static_cast<double>(t.x[i]));
                bx1 = std::max(bx1, static_cast<double>(t.x[i]));
                by0 = std::min(by0, static_cast<double>(t.y[i]));
                by1 = std::max(by1, static_cast<double>(t.y[i]));
            }
            const int cx0 = clampi((bx0 - minx) / cell);
            const int cx1 = clampi((bx1 - minx) / cell);
            const int cy0 = clampi((by0 - miny) / cell);
            const int cy1 = clampi((by1 - miny) / cell);
            for (int cy = cy0; cy <= cy1; ++cy)
                for (int cx = cx0; cx <= cx1; ++cx)
                    cells[cy * G + cx].push_back(idx);
        }
    }

    int coverage(const std::vector<Tile>& ts, double px, double py) const {
        const int cx = clampi((px - minx) / cell);
        const int cy = clampi((py - miny) / cell);
        int c = 0;
        for (int idx : cells[cy * G + cx])
            if (inside(ts[idx], px, py)) ++c;
        return c;
    }
};

std::array<double, 3> sortedSides(const Tile& t) {
    std::array<double, 3> sides{};
    for (int i = 0; i < 3; ++i) {
        const int j = (i + 1) % 3;
        const double dx = static_cast<double>(t.x[i]) - t.x[j];
        const double dy = static_cast<double>(t.y[i]) - t.y[j];
        sides[i] = std::hypot(dx, dy);
    }
    std::sort(sides.begin(), sides.end());
    return sides;
}

bool equithirdsShapeOk(const Tile& t) {
    if (t.vcount != 3) return false;
    const auto s = sortedSides(t);
    if (s[0] <= 1e-12) return false;
    // Deep Equithirds generations are stored as float32 vertices; by gen10 the
    // smallest sides are ~0.004, so exact sqrt(3) ratios carry a few ULPs of
    // accumulated roundoff. Keep this tight enough to catch wrong prototiles
    // while not failing valid source-rule subdivisions.
    constexpr double kShapeTol = 5e-5;
    if (t.type == 0) {
        return std::fabs(s[1] / s[0] - 1.0) < kShapeTol
            && std::fabs(s[2] / s[0] - 1.0) < kShapeTol;
    }
    if (t.type == 1) {
        return std::fabs(s[1] / s[0] - 1.0) < kShapeTol
            && std::fabs(s[2] / s[0] - std::sqrt(3.0)) < kShapeTol;
    }
    return false;
}

struct FamilyCase {
    Family fam;
    const char* name;
    int nseeds;
    bool areaConserved;
    bool compareSeedCoverage;
};

} // namespace

int main() {
    const FamilyCase cases[] = {
        { Family::P3,            "P3",            4, true,  true  },
        { Family::P2,            "P2",            2, true,  true  },
        { Family::Chair,         "Chair",         3, true,  true  },
        { Family::Pinwheel,      "Pinwheel",      3, true,  true  },
        { Family::Tuebingen,     "Tuebingen",     2, true,  true  },
        { Family::Equithirds,    "Equithirds",    2, true,  true  },
        { Family::CromwellKRT,   "CromwellKRT",   4, false, false },
        { Family::GailiunasSpiral, "GailiunasSpiral", 52, false, false },
        { Family::Cairo,         "Cairo",          1, false, false },
        { Family::SocolarTaylor, "SocolarTaylor",  2, true,  true  },
        { Family::Danzer,        "Danzer",        2, true,  true  },
        { Family::Dodecagonal,   "Dodecagonal",   3, false, false },
        { Family::AmmannBeenker, "AmmannBeenker", 3, false, false },
        { Family::Heptagonal,    "Heptagonal",    3, false, false },
        { Family::Binary,        "Binary",        2, false, false },
        { Family::P1,            "P1",            1, false, false },
        { Family::Hat,           "Hat",           4, false, false },
        { Family::Spectre,       "Spectre",       9, false, false },
    };

    constexpr int kSamples = 20000;
    int failures = 0;
    std::mt19937_64 rng(0xDA0712ULL);
    auto unit = [&rng]() {
        return static_cast<double>(rng()) /
               static_cast<double>(UINT64_MAX);
    };

    for (const FamilyCase& fc : cases) {
        const int maxGen = familyInfo(fc.fam).maxGen;
        for (int seed = 0; seed < fc.nseeds; ++seed) {
            bool ok = true;

            const std::vector<Tile> g0 = generate(fc.fam, seed, 0);
            double a0 = 0.0;
            for (const Tile& t : g0) a0 += tileArea(t);

            // ---- 1. area conservation across generations -------------------
            if (fc.areaConserved) {
                for (int g = 1; g <= maxGen; ++g) {
                    const std::vector<Tile> tg = generate(fc.fam, seed, g);
                    double a = 0.0;
                    for (const Tile& t : tg) a += tileArea(t);
                    if (std::fabs(a - a0) > 1e-4 * std::max(a0, 1.0)) {
                        std::printf("  FAIL %s seed %d: area gen %d = %.9f "
                                    "!= gen 0 = %.9f\n",
                                    fc.name, seed, g, a, a0);
                        ok = false;
                    }
                }
            }

            // ---- 2. closure at the deepest generation ----------------------
            const std::vector<Tile> gN = generate(fc.fam, seed, maxGen);
            int degen = 0;
            int nonSimple = 0;
            int badShape = 0;
            for (const Tile& t : gN)
                if (t.vcount < 3 || tileArea(t) < 1e-14) ++degen;
            for (const Tile& t : gN)
                if (!simplePolygonOk(t)) ++nonSimple;
            if (fc.fam == Family::Equithirds) {
                for (const Tile& t : gN)
                    if (!equithirdsShapeOk(t)) ++badShape;
            }
            if (fc.fam == Family::CromwellKRT) {
                for (const Tile& t : gN)
                    if (t.vcount != 4 || t.type > 2) ++badShape;
            }
            if (degen) {
                std::printf("  FAIL %s seed %d: %d degenerate tiles\n",
                            fc.name, seed, degen);
                ok = false;
            }
            if (nonSimple) {
                std::printf("  FAIL %s seed %d: %d non-simple polygon tiles\n",
                            fc.name, seed, nonSimple);
                ok = false;
            }
            if (badShape) {
                if (fc.fam == Family::CromwellKRT) {
                    std::printf("  FAIL %s seed %d: %d tiles fail KRT "
                                "quadrilateral/type checks\n",
                                fc.name, seed, badShape);
                } else {
                    std::printf("  FAIL %s seed %d: %d tiles fail equilateral / "
                                "30-30-120 side-ratio checks\n",
                                fc.name, seed, badShape);
                }
                ok = false;
            }

            const Grid gridN(gN, 256);
            int covered = 0, mismatches = 0, overlaps = 0;
            if (fc.compareSeedCoverage) {
                const Grid grid0(g0, 128);
                for (int i = 0; i < kSamples; ++i) {
                    const double px = grid0.minx + unit() * grid0.span;
                    const double py = grid0.miny + unit() * grid0.span;
                    const int c0 = grid0.coverage(g0, px, py);
                    const int cN = gridN.coverage(gN, px, py);
                    if (c0 >= 1) ++covered;
                    if (c0 != cN) ++mismatches;   // gap, overlap, or spill
                }
                if (mismatches) {
                    std::printf("  FAIL %s seed %d: %d/%d sample points where "
                                "gen-0 and gen-%d coverage differ "
                                "(gap/overlap)\n",
                                fc.name, seed, mismatches, kSamples, maxGen);
                    ok = false;
                }
            } else {
                for (int i = 0; i < kSamples; ++i) {
                    const double px = gridN.minx + unit() * gridN.span;
                    const double py = gridN.miny + unit() * gridN.span;
                    const int cN = gridN.coverage(gN, px, py);
                    if (cN >= 1) ++covered;
                    if (cN >= 2) ++overlaps;
                }
                if (overlaps) {
                    std::printf("  FAIL %s seed %d: %d/%d sample points lie in "
                                "2+ tiles (overlap)\n",
                                fc.name, seed, overlaps, kSamples);
                    ok = false;
                }
            }
            if (covered < kSamples / 50) {
                std::printf("  FAIL %s seed %d: coverage sample empty "
                            "(%d/%d) — patch degenerate\n",
                            fc.name, seed, covered, kSamples);
                ok = false;
            }

            const analysis::FiniteDelaneyPatch dset = analysis::extractFiniteDelaneyPatch(gN);
            const analysis::DelaneyPatchSummary& ds = dset.summary;
            if (!ds.valid() || ds.faceOrbits != static_cast<int>(gN.size())) {
                std::printf("  FAIL %s seed %d: invalid finite chamber graph "
                            "(faces=%d tiles=%zu overfull=%d involutions=%d "
                            "commutators=%d vertexAngles=%d)\n",
                            fc.name, seed, ds.faceOrbits, gN.size(),
                            ds.overfullEdges, ds.badInvolutions,
                            ds.badCommutators, ds.badInteriorVertexAngles);
                ok = false;
            }

            std::printf("  %-7s %-13s seed %d: %6zu tiles @gen%-2d  "
                        "area=%.6f  covered %5d/%d  dset F/E/V/C=%d/%d/%d/%d\n",
                        ok ? "PASS" : "FAIL", fc.name, seed,
                        gN.size(), maxGen, a0, covered, kSamples,
                        ds.faceOrbits, ds.edgeOrbits,
                        ds.interiorVertexOrbits, ds.vertexConfigurations);
            if (!ok) ++failures;
        }
    }

    std::printf("\n%s — %d family/seed case(s) failed\n",
                failures ? "TILING CHECKS FAILED" : "ALL TILING CHECKS PASSED",
                failures);
    return failures ? 1 : 0;
}
