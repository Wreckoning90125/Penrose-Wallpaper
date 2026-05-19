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
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        e.p1x = t.x[i]; e.p1y = t.y[i];
        e.p2x = t.x[j]; e.p2y = t.y[j];
        out.push_back(e);
    }
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
    }
    return tiles;
}

} // namespace penrose
