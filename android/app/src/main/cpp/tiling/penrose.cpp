#include "tiling/penrose.h"

#include <cmath>
#include <utility>

namespace penrose {

namespace {

constexpr double kPi    = 3.14159265358979323846;
constexpr double kPhi   = 1.6180339887498949;
constexpr double kPsi   = 1.0 / kPhi;
constexpr double kPsi2  = kPsi * kPsi;

inline Tile mkTri(uint8_t type, float ax, float ay, float bx, float by, float cx, float cy) {
    Tile t{};
    t.vcount = 3;
    t.type = type;
    t.x[0] = ax; t.y[0] = ay;
    t.x[1] = bx; t.y[1] = by;
    t.x[2] = cx; t.y[2] = cy;
    return t;
}

inline void comb(float ax, float ay, double a,
                 float bx, float by, double b,
                 float& ox, float& oy) {
    ox = static_cast<float>(a * ax + b * bx);
    oy = static_cast<float>(a * ay + b * by);
}

// CCW 90° rotation by k * pi/2. Used for the canonical L-tromino vertex math.
inline void rotInt(float px, float py, int k, float& ox, float& oy) {
    k = ((k % 4) + 4) % 4;
    switch (k) {
        case 0: ox = px;  oy = py;  break;
        case 1: ox = -py; oy = px;  break;
        case 2: ox = -px; oy = -py; break;
        default: ox = py; oy = -px; break;
    }
}

// Canonical L-tromino vertices at orient 0, scale 1, CCW from origin.
constexpr float kLCanonX[6] = { 0.0f, 2.0f, 2.0f, 1.0f, 1.0f, 0.0f };
constexpr float kLCanonY[6] = { 0.0f, 0.0f, 1.0f, 1.0f, 2.0f, 2.0f };

struct ChairCtx { float ox, oy; int orient; float scale; };

inline Tile chairTile(const ChairCtx& c) {
    Tile t{};
    t.vcount = 6;
    t.type = static_cast<uint8_t>(c.orient);
    for (int i = 0; i < 6; ++i) {
        float rx, ry;
        rotInt(kLCanonX[i], kLCanonY[i], c.orient, rx, ry);
        t.x[i] = c.ox + c.scale * rx;
        t.y[i] = c.oy + c.scale * ry;
    }
    return t;
}

struct ChairRule { float lox, loy; int oo; };
constexpr ChairRule kChairRules[4] = {
    { 0.0f, 0.0f, 0 },
    { 0.0f, 2.0f, 3 },
    { 0.5f, 0.5f, 0 },
    { 2.0f, 0.0f, 1 },
};

// We need to recover (origin, orient, scale) from a Chair tile when
// subdividing. The canonical layout puts vert 0 at the origin and vert 1 at
// origin + scale * rotInt((2,0), orient). Use that to invert.
inline void recoverChair(const Tile& t, float& ox, float& oy, int& orient, float& scale) {
    ox = t.x[0];
    oy = t.y[0];
    orient = t.type & 3;
    // |vert1 - vert0| / 2 = scale (since canonical vert1 = (2,0)).
    float dx = t.x[1] - t.x[0];
    float dy = t.y[1] - t.y[0];
    scale = std::sqrt(dx * dx + dy * dy) * 0.5f;
}

} // namespace

// =============================================================================
// Substitutions
// =============================================================================

std::vector<Tile> subdivideP3(const std::vector<Tile>& in) {
    std::vector<Tile> out;
    out.reserve(in.size() * 3);
    for (const Tile& t : in) {
        const float A0 = t.x[0], A1 = t.y[0];
        const float B0 = t.x[1], B1 = t.y[1];
        const float C0 = t.x[2], C1 = t.y[2];
        if (t.type == 0) { // L → 2 L + 1 S
            float Dx, Dy, Ex, Ey;
            comb(A0, A1, kPsi2, C0, C1, kPsi, Dx, Dy);
            comb(A0, A1, kPsi2, B0, B1, kPsi, Ex, Ey);
            out.push_back(mkTri(0, Dx, Dy, Ex, Ey, A0, A1));
            out.push_back(mkTri(1, Ex, Ey, Dx, Dy, B0, B1));
            out.push_back(mkTri(0, C0, C1, Dx, Dy, B0, B1));
        } else {           // S → 1 L + 1 S
            float Dx, Dy;
            comb(A0, A1, kPsi, B0, B1, kPsi2, Dx, Dy);
            out.push_back(mkTri(1, Dx, Dy, C0, C1, A0, A1));
            out.push_back(mkTri(0, C0, C1, Dx, Dy, B0, B1));
        }
    }
    return out;
}

std::vector<Tile> subdivideP2(const std::vector<Tile>& in) {
    std::vector<Tile> out;
    out.reserve(in.size() * 3);
    for (const Tile& t : in) {
        const float A0 = t.x[0], A1 = t.y[0];
        const float B0 = t.x[1], B1 = t.y[1];
        const float C0 = t.x[2], C1 = t.y[2];
        if (t.type == 1) { // S → 2 S + 1 L
            float Dx, Dy, Ex, Ey;
            comb(A0, A1, 1.0 - kPsi, B0, B1, kPsi, Dx, Dy);
            comb(B0, B1, 1.0 - kPsi, C0, C1, kPsi, Ex, Ey);
            out.push_back(mkTri(1, Dx, Dy, A0, A1, Ex, Ey));
            out.push_back(mkTri(1, Ex, Ey, A0, A1, C0, C1));
            out.push_back(mkTri(0, B0, B1, Dx, Dy, Ex, Ey));
        } else {           // L → 1 S + 1 L
            float Fx, Fy;
            comb(A0, A1, 1.0 - kPsi, C0, C1, kPsi, Fx, Fy);
            out.push_back(mkTri(1, B0, B1, A0, A1, Fx, Fy));
            out.push_back(mkTri(0, B0, B1, Fx, Fy, C0, C1));
        }
    }
    return out;
}

std::vector<Tile> subdivideChair(const std::vector<Tile>& in) {
    std::vector<Tile> out;
    out.reserve(in.size() * 4);
    for (const Tile& t : in) {
        float ox, oy, ps;
        int po;
        recoverChair(t, ox, oy, po, ps);
        const float cs = ps * 0.5f;
        for (int r = 0; r < 4; ++r) {
            const ChairRule& rule = kChairRules[r];
            float rx, ry;
            rotInt(rule.lox, rule.loy, po, rx, ry);
            const float cox = ox + ps * rx;
            const float coy = oy + ps * ry;
            const int corient = ((rule.oo + po) % 4 + 4) % 4;
            out.push_back(chairTile({cox, coy, corient, cs}));
        }
    }
    return out;
}

// =============================================================================
// Seeds
// =============================================================================

std::vector<Tile> seedP3(SeedP3 seed) {
    std::vector<Tile> out;
    switch (seed) {
        case SeedP3::Sun: {
            out.reserve(10);
            for (int i = 0; i < 10; ++i) {
                double a1 = (2.0 * kPi * i) / 10.0;
                double a2 = (2.0 * kPi * (i + 1)) / 10.0;
                float ax = (float)std::cos(a1), ay = (float)std::sin(a1);
                float cx = (float)std::cos(a2), cy = (float)std::sin(a2);
                if ((i & 1) == 0) { std::swap(ax, cx); std::swap(ay, cy); }
                out.push_back(mkTri(1, ax, ay, 0.0f, 0.0f, cx, cy));
            }
            break;
        }
        case SeedP3::Star: {
            out.reserve(10);
            for (int i = 0; i < 5; ++i) {
                double a1 = (2.0 * kPi * i) / 5.0;
                double a3 = a1 + 72.0 * kPi / 180.0;
                float v1x = (float)std::cos(a1), v1y = (float)std::sin(a1);
                float v3x = (float)std::cos(a3), v3y = (float)std::sin(a3);
                float v2x = v1x + v3x, v2y = v1y + v3y;
                out.push_back(mkTri(0, 0.0f, 0.0f, v1x, v1y, v2x, v2y));
                out.push_back(mkTri(0, 0.0f, 0.0f, v3x, v3y, v2x, v2y));
            }
            break;
        }
        case SeedP3::Cartwheel: {
            out.reserve(10);
            for (int i = 0; i < 10; ++i) {
                double a1 = (2.0 * kPi * i) / 10.0 + kPi / 10.0;
                double a2 = (2.0 * kPi * (i + 1)) / 10.0 + kPi / 10.0;
                float ax = (float)std::cos(a1), ay = (float)std::sin(a1);
                float cx = (float)std::cos(a2), cy = (float)std::sin(a2);
                if ((i & 1) == 1) { std::swap(ax, cx); std::swap(ay, cy); }
                out.push_back(mkTri(1, ax, ay, 0.0f, 0.0f, cx, cy));
            }
            break;
        }
        case SeedP3::Ace: {
            out.reserve(2);
            double a1 = -36.0 * kPi / 180.0;
            double a3 =  36.0 * kPi / 180.0;
            float v1x = (float)std::cos(a1), v1y = (float)std::sin(a1);
            float v3x = (float)std::cos(a3), v3y = (float)std::sin(a3);
            float v2x = v1x + v3x, v2y = v1y + v3y;
            out.push_back(mkTri(0, 0.0f, 0.0f, v1x, v1y, v2x, v2y));
            out.push_back(mkTri(0, 0.0f, 0.0f, v3x, v3y, v2x, v2y));
            break;
        }
    }
    return out;
}

std::vector<Tile> seedP2(SeedP2 seed) {
    std::vector<Tile> out;
    switch (seed) {
        case SeedP2::Sun: {
            out.reserve(10);
            for (int i = 0; i < 10; ++i) {
                double a1 = (2.0 * kPi * i) / 10.0;
                double a2 = (2.0 * kPi * (i + 1)) / 10.0;
                float ax = (float)(kPhi * std::cos(a1));
                float ay = (float)(kPhi * std::sin(a1));
                float cx = (float)(kPhi * std::cos(a2));
                float cy = (float)(kPhi * std::sin(a2));
                if ((i & 1) == 0) { std::swap(ax, cx); std::swap(ay, cy); }
                out.push_back(mkTri(1, ax, ay, 0.0f, 0.0f, cx, cy));
            }
            break;
        }
        case SeedP2::Star: {
            out.reserve(10);
            const double ang36 = kPi / 5.0;
            for (int i = 0; i < 5; ++i) {
                double theta = (2.0 * kPi * i) / 5.0 + kPi / 2.0;
                float Bx = (float)std::cos(theta);
                float By = (float)std::sin(theta);
                float cLx = (float)(kPhi * std::cos(theta + ang36));
                float cLy = (float)(kPhi * std::sin(theta + ang36));
                float cRx = (float)(kPhi * std::cos(theta - ang36));
                float cRy = (float)(kPhi * std::sin(theta - ang36));
                out.push_back(mkTri(0, 0.0f, 0.0f, Bx, By, cLx, cLy));
                out.push_back(mkTri(0, 0.0f, 0.0f, Bx, By, cRx, cRy));
            }
            break;
        }
    }
    return out;
}

std::vector<Tile> seedChair(SeedChair seed) {
    std::vector<Tile> out;
    switch (seed) {
        case SeedChair::Pinwheel: {
            const float s = 0.225f;
            out.reserve(4);
            out.push_back(chairTile({ (0 - 2) * s, (0 - 2) * s, 0, s }));
            out.push_back(chairTile({ (0 - 2) * s, (4 - 2) * s, 3, s }));
            out.push_back(chairTile({ (4 - 2) * s, (0 - 2) * s, 1, s }));
            out.push_back(chairTile({ (4 - 2) * s, (4 - 2) * s, 2, s }));
            break;
        }
        case SeedChair::Small: {
            const float s = 0.45f;
            out.reserve(2);
            out.push_back(chairTile({ -1 * s, -1.5f * s, 0, s }));
            out.push_back(chairTile({  1 * s,  1.5f * s, 2, s }));
            break;
        }
        case SeedChair::Large: {
            const float s = 0.35f;
            out.reserve(4);
            out.push_back(chairTile({ -2 * s, -1.5f * s, 0, s }));
            out.push_back(chairTile({  0 * s,  1.5f * s, 2, s }));
            out.push_back(chairTile({  0 * s, -1.5f * s, 0, s }));
            out.push_back(chairTile({  2 * s,  1.5f * s, 2, s }));
            break;
        }
    }
    return out;
}

// =============================================================================
// Edges
// =============================================================================

void edgesPenrose(const Tile& t, std::vector<Edge>& out) {
    // A-B (leg), B-C (leg), A-C (base).
    Edge e{};
    e.tileType = t.type;
    e.kind = EdgeKind::Leg;
    e.p1x = t.x[0]; e.p1y = t.y[0]; e.p2x = t.x[1]; e.p2y = t.y[1];
    out.push_back(e);
    e.p1x = t.x[1]; e.p1y = t.y[1]; e.p2x = t.x[2]; e.p2y = t.y[2];
    out.push_back(e);
    e.kind = EdgeKind::Base;
    e.p1x = t.x[0]; e.p1y = t.y[0]; e.p2x = t.x[2]; e.p2y = t.y[2];
    out.push_back(e);
}

void edgesChair(const Tile& t, std::vector<Edge>& out) {
    Edge e{};
    e.tileType = t.type;
    e.kind = EdgeKind::ChairEdge;
    const int n = t.vcount;
    for (int i = 0; i < n; ++i) {
        const int j = (i + 1) % n;
        e.p1x = t.x[i]; e.p1y = t.y[i];
        e.p2x = t.x[j]; e.p2y = t.y[j];
        out.push_back(e);
    }
}

// =============================================================================
// Dodecagonal — de Bruijn 6-grid dualization
// =============================================================================
// The dual of six line grids 30 degrees apart is a 12-fold tiling of 30/60/90
// rhombi (thin rhomb / thick rhomb / square). Each rhombus is the dual of one
// intersection between a line of grid family j and a line of family k; its two
// edge vectors are the unit grid normals, so every rhomb has unit edges and
// the three shapes are fixed by |j - k|. This is the documented "de Bruijn
// rhomb-square dodecagonal tiling" — not a substitution, so there is no
// seed/subdivide pair; `generations` simply scales the grid range.

std::vector<Tile> generateDodecagonal(int seedIdx, int generations) {
    constexpr int N = 6;
    double dirx[N], diry[N];
    for (int k = 0; k < N; ++k) {
        const double a = kPi * k / 6.0;
        dirx[k] = std::cos(a);
        diry[k] = std::sin(a);
    }

    // Per-seed grid offsets. Because dir0 - dir2 + dir4 = 0 and
    // dir1 - dir3 + dir5 = 0, the hexagrid is non-singular (no concurrent
    // lines, hence a clean overlap-free dual) only when both
    // (gamma0 - gamma2 + gamma4) and (gamma1 - gamma3 + gamma5) are
    // non-integers — keep any new offset set away from those. A constant 0.5
    // (Rosette) lands those invariants at -0.5, the farthest-from-integer
    // value, and is invariant under the 30-degree family-permuting rotation,
    // so it yields an exactly 12-fold-symmetric tiling; the other seeds
    // perturb the offsets into distinct quasiperiodic patches.
    double gamma[N];
    {
        const double drift[N] = { 0.50, 0.18, 0.74, 0.33, 0.61, 0.05 };
        const double quasi[N] = { 0.10, 0.40, 0.65, 0.20, 0.85, 0.55 };
        for (int k = 0; k < N; ++k) {
            gamma[k] = (seedIdx == 1) ? drift[k]
                     : (seedIdx == 2) ? quasi[k]
                                      : 0.5;
        }
    }

    int gen = generations < 0 ? 0 : (generations > kMaxGenDodeca ? kMaxGenDodeca
                                                                 : generations);
    // The grid line-index half-range grows ~phi per generation, so the
    // normalised tile size shrinks at the same 1/phi rate the renderer's
    // border scaling (deflationRate) assumes for the substitution families.
    int B = static_cast<int>(std::lround(12.0 * std::pow(kPhi, gen - 6)));
    if (B < 2) B = 2;
    // Keep rhombi whose centroid lies inside this raw-units radius. 3*(B-1)
    // guarantees both grid lines of every kept rhomb fall within [-B, B] (the
    // dual map scales the plane by ~3), so the patch has no holes.
    const double keepR2 = (3.0 * (B - 1)) * (3.0 * (B - 1));

    std::vector<Tile> out;
    double maxR2 = 0.0;

    for (int j = 0; j < N; ++j) {
        for (int k = j + 1; k < N; ++k) {
            const double det = dirx[j] * diry[k] - diry[j] * dirx[k];
            const int d = k - j;
            const int shape = (d < N - d) ? d : (N - d);          // 1, 2, 3
            const uint8_t type = static_cast<uint8_t>(shape - 1); // 0, 1, 2
            for (int r = -B; r <= B; ++r) {
                const double a = r + gamma[j];
                for (int s = -B; s <= B; ++s) {
                    const double b = s + gamma[k];
                    // Intersection of line r (family j) and line s (family k).
                    const double px = (a * diry[k] - b * diry[j]) / det;
                    const double py = (b * dirx[j] - a * dirx[k]) / det;
                    // Fixed grid coordinates for the other four families.
                    double basex = 0.0, basey = 0.0;
                    for (int l = 0; l < N; ++l) {
                        if (l == j || l == k) continue;
                        const double t = px * dirx[l] + py * diry[l] - gamma[l];
                        const double Kl = std::floor(t + 1e-9);
                        basex += Kl * dirx[l];
                        basey += Kl * diry[l];
                    }
                    // Rhomb corner v0 takes K_j = r-1, K_k = s-1; the other
                    // three corners step K_j and/or K_k up by one.
                    const double v0x = basex + (r - 1) * dirx[j] + (s - 1) * dirx[k];
                    const double v0y = basey + (r - 1) * diry[j] + (s - 1) * diry[k];
                    const double cx[4] = {
                        v0x, v0x + dirx[j], v0x + dirx[j] + dirx[k], v0x + dirx[k] };
                    const double cy[4] = {
                        v0y, v0y + diry[j], v0y + diry[j] + diry[k], v0y + diry[k] };
                    const double centx = (cx[0] + cx[1] + cx[2] + cx[3]) * 0.25;
                    const double centy = (cy[0] + cy[1] + cy[2] + cy[3]) * 0.25;
                    if (centx * centx + centy * centy > keepR2) continue;
                    Tile tile{};
                    tile.vcount = 4;
                    tile.type = type;
                    for (int c = 0; c < 4; ++c) {
                        tile.x[c] = static_cast<float>(cx[c]);
                        tile.y[c] = static_cast<float>(cy[c]);
                        const double rr = cx[c] * cx[c] + cy[c] * cy[c];
                        if (rr > maxR2) maxR2 = rr;
                    }
                    out.push_back(tile);
                }
            }
        }
    }

    // Normalise the patch into the unit disk so model-space scale — and the
    // ripple shader's fixed spatial frequency — matches the other families.
    if (maxR2 > 1e-12) {
        const float inv = static_cast<float>(1.0 / std::sqrt(maxR2));
        for (Tile& tile : out) {
            for (int c = 0; c < 4; ++c) { tile.x[c] *= inv; tile.y[c] *= inv; }
        }
    }
    return out;
}

// =============================================================================
// Pinwheel — Conway / Radin 1:2:sqrt(5) substitution
// =============================================================================
// Every tile is a 1:2:sqrt(5) right triangle stored as [S, L, M]: the small
// (~26.57 deg), right (90 deg) and medium (~63.43 deg) angled corners, in that
// vertex order. One deflation replaces a tile by five sub-tiles at 1/sqrt(5)
// scale; the substitution turns by atan(1/2) — an irrational multiple of pi —
// so orientations never repeat. The five children are Radin's component
// triangles of the canonical level-1 triangle T1 = [(-2,1),(2,-1),(3,1)], each
// carried onto the parent by the unique affine map T1 -> [S,L,M], which
// reproduces reflected tiles without special handling.

namespace {

// The five components of T1, each as canonical (S, L, M) corners.
struct PinChild { float s[2], l[2], m[2]; };
constexpr PinChild kPinChildren[5] = {
    { { -2.0f, 1.0f }, {  0.0f, 1.0f }, {  0.0f,  0.0f } },  // A
    { {  2.0f, 1.0f }, {  0.0f, 1.0f }, {  0.0f,  0.0f } },  // B
    { {  0.0f, 0.0f }, {  2.0f, 0.0f }, {  2.0f,  1.0f } },  // C
    { {  0.0f, 0.0f }, {  2.0f, 0.0f }, {  2.0f, -1.0f } },  // D
    { {  2.0f,-1.0f }, {  2.0f, 1.0f }, {  3.0f,  1.0f } },  // E
};

// Build a pinwheel tile from its S, L, M corners. type encodes chirality:
// 0 when [S,L,M] winds the same way as the canonical prototile (positive
// cross product), 1 when it is the mirror image.
inline Tile mkPin(float sx, float sy, float lx, float ly, float mx, float my) {
    Tile t{};
    t.vcount = 3;
    const float cross = (lx - sx) * (my - sy) - (ly - sy) * (mx - sx);
    t.type = static_cast<uint8_t>(cross < 0.0f ? 1 : 0);
    t.x[0] = sx; t.y[0] = sy;
    t.x[1] = lx; t.y[1] = ly;
    t.x[2] = mx; t.y[2] = my;
    return t;
}

} // namespace

std::vector<Tile> subdividePinwheel(const std::vector<Tile>& in) {
    std::vector<Tile> out;
    out.reserve(in.size() * 5);
    for (const Tile& t : in) {
        const float sx = t.x[0], sy = t.y[0];   // S = v0
        const float lx = t.x[1], ly = t.y[1];   // L = v1
        const float mx = t.x[2], my = t.y[2];   // M = v2
        // Affine image of canonical T1 = [(-2,1),(2,-1),(3,1)] onto [S,L,M]:
        //   P(px,py) = S + (px+2)*c1 + (py-1)*c2,
        // with c1 = (M-S)/5 and c2 = 2*(M-S)/5 - (L-S)/2. This sends
        // (-2,1)->S, (2,-1)->L, (3,1)->M, so it carries the five canonical
        // children exactly onto the parent triangle.
        const float ux = lx - sx, uy = ly - sy;             // L - S
        const float wx = mx - sx, wy = my - sy;             // M - S
        const float c1x = wx * 0.2f,             c1y = wy * 0.2f;
        const float c2x = wx * 0.4f - ux * 0.5f, c2y = wy * 0.4f - uy * 0.5f;
        for (const PinChild& ch : kPinChildren) {
            const float* corner[3] = { ch.s, ch.l, ch.m };
            float p[6];
            for (int k = 0; k < 3; ++k) {
                const float a = corner[k][0] + 2.0f;
                const float b = corner[k][1] - 1.0f;
                p[2 * k]     = sx + a * c1x + b * c2x;
                p[2 * k + 1] = sy + a * c1y + b * c2y;
            }
            out.push_back(mkPin(p[0], p[1], p[2], p[3], p[4], p[5]));
        }
    }
    return out;
}

std::vector<Tile> seedPinwheel(SeedPinwheel seed) {
    std::vector<Tile> out;
    // A 1:2:sqrt(5) triangle pair fills a w-by-(w/2) rectangle; the two
    // halves are mirror images — exactly the chirality pair the substitution
    // propagates. (lox, loy) is the rectangle's lower-left corner.
    auto rect = [&out](float lox, float loy, float w) {
        const float h = w * 0.5f;
        out.push_back(mkPin(lox,     loy,     lox + w, loy,     lox + w, loy + h));
        out.push_back(mkPin(lox + w, loy + h, lox,     loy + h, lox,     loy));
    };
    switch (seed) {
        case SeedPinwheel::Square:        // 1.6 x 1.6 square — 4 tiles
            rect(-0.8f,  0.0f, 1.6f);
            rect(-0.8f, -0.8f, 1.6f);
            break;
        case SeedPinwheel::Triangle:      // one centred triangle
            out.push_back(mkPin(-0.8f, -0.4f, 0.8f, -0.4f, 0.8f, 0.4f));
            break;
        case SeedPinwheel::Rectangle:     // one 2:1 rectangle — 2 tiles
            rect(-0.8f, -0.4f, 1.6f);
            break;
    }
    return out;
}

// =============================================================================
// Family-erased generate()
// =============================================================================

std::vector<Tile> generate(Family family, int seedIdx, int generations) {
    std::vector<Tile> tiles;
    switch (family) {
        case Family::P3: {
            int s = seedIdx;
            if (s < 0 || s > 3) s = 0;
            tiles = seedP3(static_cast<SeedP3>(s));
            int cap = generations < 0 ? 0 : (generations > kMaxGenP3 ? kMaxGenP3 : generations);
            for (int g = 0; g < cap; ++g) tiles = subdivideP3(tiles);
            break;
        }
        case Family::P2: {
            int s = seedIdx;
            if (s < 0 || s > 1) s = 0;
            tiles = seedP2(static_cast<SeedP2>(s));
            int cap = generations < 0 ? 0 : (generations > kMaxGenP2 ? kMaxGenP2 : generations);
            for (int g = 0; g < cap; ++g) tiles = subdivideP2(tiles);
            break;
        }
        case Family::Chair: {
            int s = seedIdx;
            if (s < 0 || s > 2) s = 0;
            tiles = seedChair(static_cast<SeedChair>(s));
            int cap = generations < 0 ? 0 : (generations > kMaxGenChair ? kMaxGenChair : generations);
            for (int g = 0; g < cap; ++g) tiles = subdivideChair(tiles);
            break;
        }
        case Family::Dodecagonal: {
            tiles = generateDodecagonal(seedIdx, generations);
            break;
        }
        case Family::Pinwheel: {
            int s = seedIdx;
            if (s < 0 || s > 2) s = 0;
            tiles = seedPinwheel(static_cast<SeedPinwheel>(s));
            int cap = generations < 0 ? 0 : (generations > kMaxGenPinwheel ? kMaxGenPinwheel : generations);
            for (int g = 0; g < cap; ++g) tiles = subdividePinwheel(tiles);
            break;
        }
    }
    return tiles;
}

} // namespace penrose
