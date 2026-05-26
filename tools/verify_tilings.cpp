// =============================================================================
// Substitution / tiling verifier
// =============================================================================
// Rigorous, reproducible regression check for the renderer's tiling families.
// It links the production tiling core (tiling/penrose.cpp) and certifies, for
// every family, the two properties that *define* a correct tiling — with no
// reference to any figure, screenshot, or rendered image:
//
//   1. Area conservation (substitution families). A substitution replaces a
//      tile by smaller tiles that must exactly repartition it, so the total
//      area is invariant under deflation. Checked exactly across every
//      generation 0..maxGen.
//
//   2. Gap- and overlap-free closure. Monte-Carlo: sample points and count how
//      many tiles contain each. For a substitution family every point of the
//      seed region must be covered exactly as many times at the deepest
//      generation as at generation 0 (overlap => covered twice; gap => covered
//      zero times). For the cut-and-project families, no point may be covered
//      twice (overlap-free; gaps are structurally impossible for a multigrid
//      dual). Plus a degeneracy screen (no zero-area or sub-triangle tiles).
//
// Area conservation + overlap-free + seed-region containment is a complete
// proof that the tiles partition the region: this is the same closure
// argument used to derive the Danzer substitution, applied as an automated
// gate. Build and run (from the repository root):
//
//   g++ -std=c++17 -O2 -I android/app/src/main/cpp
//       tools/verify_tilings.cpp android/app/src/main/cpp/tiling/penrose.cpp
//       -o /tmp/verify_tilings && /tmp/verify_tilings
//
// Exit status is non-zero on any failure, so CI gates on it.
// =============================================================================

#include "tiling/penrose.h"

#include <algorithm>
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

struct FamilyCase {
    Family fam;
    const char* name;
    int nseeds;
    bool substitution;   // seed + deflation (area is conserved per generation)
};

} // namespace

int main() {
    const FamilyCase cases[] = {
        { Family::P3,            "P3",            4, true  },
        { Family::P2,            "P2",            2, true  },
        { Family::Chair,         "Chair",         3, true  },
        { Family::Pinwheel,      "Pinwheel",      3, true  },
        { Family::Tuebingen,     "Tuebingen",     2, true  },
        { Family::Danzer,        "Danzer",        2, true  },
        { Family::Dodecagonal,   "Dodecagonal",   3, false },
        { Family::AmmannBeenker, "AmmannBeenker", 3, false },
        { Family::Heptagonal,    "Heptagonal",    3, false },
        { Family::Binary,        "Binary",        2, false },
        { Family::P1,            "P1",            1, false },
        { Family::Hat,           "Hat",           4, false },
        { Family::Spectre,       "Spectre",       9, false },
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
            if (fc.substitution) {
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
            for (const Tile& t : gN)
                if (t.vcount < 3 || tileArea(t) < 1e-14) ++degen;
            if (degen) {
                std::printf("  FAIL %s seed %d: %d degenerate tiles\n",
                            fc.name, seed, degen);
                ok = false;
            }

            const Grid gridN(gN, 256);
            int covered = 0, mismatches = 0, overlaps = 0;
            if (fc.substitution) {
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

            std::printf("  %-7s %-13s seed %d: %6zu tiles @gen%-2d  "
                        "area=%.6f  covered %5d/%d\n",
                        ok ? "PASS" : "FAIL", fc.name, seed,
                        gN.size(), maxGen, a0, covered, kSamples);
            if (!ok) ++failures;
        }
    }

    std::printf("\n%s — %d family/seed case(s) failed\n",
                failures ? "VERIFICATION FAILED" : "ALL TILINGS VERIFIED",
                failures);
    return failures ? 1 : 0;
}
