#include "tiling/penrose.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <utility>

namespace penrose {

namespace {

constexpr double kPi    = 3.14159265358979323846;
constexpr double kPhi   = 1.6180339887498949;
constexpr double kPsi   = 1.0 / kPhi;
constexpr double kPsi2  = kPsi * kPsi;
constexpr double kHalfSqrt3 = 0.8660254037844386;

struct Pt {
    double x;
    double y;
};

struct Xf {
    double a, b, c, d, e, f;
};

constexpr Xf kIdent{1.0, 0.0, 0.0, 0.0, 1.0, 0.0};

inline Pt pt(double x, double y) { return {x, y}; }
inline Pt padd(Pt p, Pt q) { return {p.x + q.x, p.y + q.y}; }
inline Pt psub(Pt p, Pt q) { return {p.x - q.x, p.y - q.y}; }

inline Pt hexPt(double x, double y) {
    return {x + 0.5 * y, kHalfSqrt3 * y};
}

inline Xf mul(Xf A, Xf B) {
    return {
        A.a * B.a + A.b * B.d,
        A.a * B.b + A.b * B.e,
        A.a * B.c + A.b * B.f + A.c,
        A.d * B.a + A.e * B.d,
        A.d * B.b + A.e * B.e,
        A.d * B.c + A.e * B.f + A.f,
    };
}

inline Xf inv(Xf T) {
    const double det = T.a * T.e - T.b * T.d;
    return {
        T.e / det,
        -T.b / det,
        (T.b * T.f - T.c * T.e) / det,
        -T.d / det,
        T.a / det,
        (T.c * T.d - T.a * T.f) / det,
    };
}

inline Xf trot(double ang) {
    const double c = std::cos(ang);
    const double s = std::sin(ang);
    return {c, -s, 0.0, s, c, 0.0};
}

inline Xf ttrans(double tx, double ty) {
    return {1.0, 0.0, tx, 0.0, 1.0, ty};
}

inline Pt transPt(Xf M, Pt P) {
    return {M.a * P.x + M.b * P.y + M.c,
            M.d * P.x + M.e * P.y + M.f};
}

inline Xf rotAbout(Pt p, double ang) {
    return mul(ttrans(p.x, p.y), mul(trot(ang), ttrans(-p.x, -p.y)));
}

inline Xf transTo(Pt p, Pt q) {
    return ttrans(q.x - p.x, q.y - p.y);
}

inline Xf matchSeg(Pt p, Pt q) {
    return {q.x - p.x, p.y - q.y, p.x,
            q.y - p.y, q.x - p.x, p.y};
}

inline Xf matchTwo(Pt p1, Pt q1, Pt p2, Pt q2) {
    return mul(matchSeg(p2, q2), inv(matchSeg(p1, q1)));
}

inline Pt intersect(Pt p1, Pt q1, Pt p2, Pt q2) {
    const double d = (q2.y - p2.y) * (q1.x - p1.x)
                   - (q2.x - p2.x) * (q1.y - p1.y);
    const double uA = ((q2.x - p2.x) * (p1.y - p2.y)
                    - (q2.y - p2.y) * (p1.x - p2.x)) / d;
    return {p1.x + uA * (q1.x - p1.x),
            p1.y + uA * (q1.y - p1.y)};
}

inline Tile polygonTile(const std::vector<Pt>& poly, Xf T, uint8_t type) {
    Tile tile{};
    const int n = static_cast<int>(std::min(poly.size(), static_cast<size_t>(kMaxTileVerts)));
    tile.vcount = static_cast<uint8_t>(n);
    tile.type = type;
    for (int i = 0; i < n; ++i) {
        const Pt p = transPt(T, poly[i]);
        tile.x[i] = static_cast<float>(p.x);
        tile.y[i] = static_cast<float>(p.y);
    }
    return tile;
}

inline void normalizeTiles(std::vector<Tile>& tiles) {
    double maxR2 = 0.0;
    double cx = 0.0;
    double cy = 0.0;
    int count = 0;
    for (const Tile& t : tiles) {
        for (int i = 0; i < t.vcount; ++i) {
            cx += t.x[i];
            cy += t.y[i];
            ++count;
        }
    }
    if (count > 0) {
        cx /= static_cast<double>(count);
        cy /= static_cast<double>(count);
    }
    for (const Tile& t : tiles) {
        for (int i = 0; i < t.vcount; ++i) {
            const double x = static_cast<double>(t.x[i]) - cx;
            const double y = static_cast<double>(t.y[i]) - cy;
            maxR2 = std::max(maxR2, x * x + y * y);
        }
    }
    const double scale = maxR2 > 1e-12 ? 1.0 / std::sqrt(maxR2) : 1.0;
    for (Tile& t : tiles) {
        for (int i = 0; i < t.vcount; ++i) {
            t.x[i] = static_cast<float>((static_cast<double>(t.x[i]) - cx) * scale);
            t.y[i] = static_cast<float>((static_cast<double>(t.y[i]) - cy) * scale);
        }
    }
}

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

struct HatGeom;
using HatPtr = std::shared_ptr<HatGeom>;

struct HatChild {
    Xf T;
    HatPtr geom;
};

struct HatGeom {
    std::vector<Pt> shape;
    std::vector<HatChild> children;
    uint8_t type = 0;
    bool leaf = false;
    double width = 1.0;
};

const std::vector<Pt>& hatOutline() {
    static const std::vector<Pt> outline = {
        hexPt(0, 0),  hexPt(-1,-1), hexPt(0,-2), hexPt(2,-2),
        hexPt(2,-1), hexPt(4,-2),  hexPt(5,-1), hexPt(4, 0),
        hexPt(3, 0), hexPt(2, 2),  hexPt(0, 3), hexPt(0, 2),
        hexPt(-1, 2),
    };
    return outline;
}

HatPtr makeHatLeaf(uint8_t type) {
    auto g = std::make_shared<HatGeom>();
    g->shape = hatOutline();
    g->type = type;
    g->leaf = true;
    return g;
}

HatPtr makeHatMeta(std::vector<Pt> shape, double width) {
    auto g = std::make_shared<HatGeom>();
    g->shape = std::move(shape);
    g->width = width;
    return g;
}

inline void addHatChild(const HatPtr& parent, Xf T, const HatPtr& child) {
    parent->children.push_back({T, child});
}

Pt evalHatChild(const HatPtr& meta, int child, int vertex) {
    const HatChild& ch = meta->children[child];
    return transPt(ch.T, ch.geom->shape[vertex]);
}

void recenterHat(const HatPtr& meta) {
    double cx = 0.0;
    double cy = 0.0;
    for (Pt p : meta->shape) { cx += p.x; cy += p.y; }
    if (!meta->shape.empty()) {
        cx /= static_cast<double>(meta->shape.size());
        cy /= static_cast<double>(meta->shape.size());
    }
    const Xf M = ttrans(-cx, -cy);
    for (Pt& p : meta->shape) {
        p.x -= cx;
        p.y -= cy;
    }
    for (HatChild& ch : meta->children) ch.T = mul(M, ch.T);
}

std::array<HatPtr, 4> initialHatMetatiles() {
    const HatPtr H1_hat = makeHatLeaf(1);
    const HatPtr H_hat  = makeHatLeaf(0);
    const HatPtr T_hat  = makeHatLeaf(2);
    const HatPtr P_hat  = makeHatLeaf(3);
    const HatPtr F_hat  = makeHatLeaf(4);
    const auto& ho = hatOutline();

    const std::vector<Pt> H_outline = {
        pt(0, 0), pt(4, 0), pt(4.5, kHalfSqrt3),
        pt(2.5, 5 * kHalfSqrt3), pt(1.5, 5 * kHalfSqrt3),
        pt(-0.5, kHalfSqrt3),
    };
    HatPtr H = makeHatMeta(H_outline, 2.0);
    addHatChild(H, matchTwo(ho[5], ho[7], H_outline[5], H_outline[0]), H_hat);
    addHatChild(H, matchTwo(ho[9], ho[11], H_outline[1], H_outline[2]), H_hat);
    addHatChild(H, matchTwo(ho[5], ho[7], H_outline[3], H_outline[4]), H_hat);
    addHatChild(H,
        mul(ttrans(2.5, kHalfSqrt3),
            mul(Xf{-0.5, -kHalfSqrt3, 0.0, kHalfSqrt3, -0.5, 0.0},
                Xf{0.5, 0.0, 0.0, 0.0, -0.5, 0.0})),
        H1_hat);

    const std::vector<Pt> T_outline = {
        pt(0, 0), pt(3, 0), pt(1.5, 3 * kHalfSqrt3),
    };
    HatPtr T = makeHatMeta(T_outline, 2.0);
    addHatChild(T, Xf{0.5, 0.0, 0.5, 0.0, 0.5, kHalfSqrt3}, T_hat);

    const std::vector<Pt> P_outline = {
        pt(0, 0), pt(4, 0), pt(3, 2 * kHalfSqrt3), pt(-1, 2 * kHalfSqrt3),
    };
    HatPtr P = makeHatMeta(P_outline, 2.0);
    addHatChild(P, Xf{0.5, 0.0, 1.5, 0.0, 0.5, kHalfSqrt3}, P_hat);
    addHatChild(P,
        mul(ttrans(0.0, 2 * kHalfSqrt3),
            mul(Xf{0.5, kHalfSqrt3, 0.0, -kHalfSqrt3, 0.5, 0.0},
                Xf{0.5, 0.0, 0.0, 0.0, 0.5, 0.0})),
        P_hat);

    const std::vector<Pt> F_outline = {
        pt(0, 0), pt(3, 0), pt(3.5, kHalfSqrt3),
        pt(3, 2 * kHalfSqrt3), pt(-1, 2 * kHalfSqrt3),
    };
    HatPtr F = makeHatMeta(F_outline, 2.0);
    addHatChild(F, Xf{0.5, 0.0, 1.5, 0.0, 0.5, kHalfSqrt3}, F_hat);
    addHatChild(F,
        mul(ttrans(0.0, 2 * kHalfSqrt3),
            mul(Xf{0.5, kHalfSqrt3, 0.0, -kHalfSqrt3, 0.5, 0.0},
                Xf{0.5, 0.0, 0.0, 0.0, 0.5, 0.0})),
        F_hat);

    return {H, T, P, F};
}

struct HatRule {
    uint8_t kind;
    int a, b, c, d;
    uint8_t label;
    int edge;
};

HatPtr constructHatPatch(const std::array<HatPtr, 4>& metatiles) {
    static constexpr uint8_t H = 0, T = 1, P = 2, F = 3;
    static const HatRule rules[] = {
        {1, 0, 0, 0, 0, H, 0},
        {4, 0, 0, 0, 0, P, 2}, {4, 1, 0, 0, 0, H, 2},
        {4, 2, 0, 0, 0, P, 2}, {4, 3, 0, 0, 0, H, 2},
        {4, 4, 4, 0, 0, P, 2}, {4, 0, 4, 0, 0, F, 3},
        {4, 2, 4, 0, 0, F, 3}, {6, 4, 1, 3, 2, F, 0},
        {4, 8, 3, 0, 0, H, 0}, {4, 9, 2, 0, 0, P, 0},
        {4,10, 2, 0, 0, H, 0}, {4,11, 4, 0, 0, P, 2},
        {4,12, 0, 0, 0, H, 2}, {4,13, 0, 0, 0, F, 3},
        {4,14, 2, 0, 0, F, 1}, {4,15, 3, 0, 0, H, 4},
        {4, 8, 2, 0, 0, F, 1}, {4,17, 3, 0, 0, H, 0},
        {4,18, 2, 0, 0, P, 0}, {4,19, 2, 0, 0, H, 2},
        {4,20, 4, 0, 0, F, 3}, {4,20, 0, 0, 0, P, 2},
        {4,22, 0, 0, 0, H, 2}, {4,23, 4, 0, 0, F, 3},
        {4,23, 0, 0, 0, F, 3}, {4,16, 0, 0, 0, P, 2},
        {6, 9, 4, 0, 2, T, 2}, {4, 4, 0, 0, 0, F, 3},
    };

    HatPtr ret = makeHatMeta({}, metatiles[0]->width);
    for (const HatRule& r : rules) {
        if (r.kind == 1) {
            addHatChild(ret, kIdent, metatiles[r.label]);
        } else if (r.kind == 4) {
            const HatChild& ch = ret->children[r.a];
            const auto& poly = ch.geom->shape;
            const Pt p = transPt(ch.T, poly[(r.b + 1) % poly.size()]);
            const Pt q = transPt(ch.T, poly[r.b]);
            const HatPtr& next = metatiles[r.label];
            const auto& npoly = next->shape;
            addHatChild(ret,
                matchTwo(npoly[r.edge], npoly[(r.edge + 1) % npoly.size()], p, q),
                next);
        } else {
            const HatChild& chP = ret->children[r.a];
            const HatChild& chQ = ret->children[r.c];
            const Pt p = transPt(chQ.T, chQ.geom->shape[r.d]);
            const Pt q = transPt(chP.T, chP.geom->shape[r.b]);
            const HatPtr& next = metatiles[r.label];
            const auto& npoly = next->shape;
            addHatChild(ret,
                matchTwo(npoly[r.edge], npoly[(r.edge + 1) % npoly.size()], p, q),
                next);
        }
    }
    return ret;
}

std::array<HatPtr, 4> constructHatMetatiles(const HatPtr& patch) {
    const Pt bps1 = evalHatChild(patch, 8, 2);
    const Pt bps2 = evalHatChild(patch, 21, 2);
    const Pt rbps = transPt(rotAbout(bps1, -2.0 * kPi / 3.0), bps2);
    const Pt p72 = evalHatChild(patch, 7, 2);
    const Pt p252 = evalHatChild(patch, 25, 2);
    const Pt llc = intersect(bps1, rbps, evalHatChild(patch, 6, 2), p72);

    Pt w = psub(evalHatChild(patch, 6, 2), llc);
    std::vector<Pt> H_outline = {llc, bps1};
    w = transPt(trot(-kPi / 3.0), w);
    H_outline.push_back(padd(H_outline[1], w));
    H_outline.push_back(evalHatChild(patch, 14, 2));
    w = transPt(trot(-kPi / 3.0), w);
    H_outline.push_back(psub(H_outline[3], w));
    H_outline.push_back(evalHatChild(patch, 6, 2));
    HatPtr H = makeHatMeta(H_outline, patch->width * 2.0);
    for (int ch : {0, 9, 16, 27, 26, 6, 1, 8, 10, 15})
        addHatChild(H, patch->children[ch].T, patch->children[ch].geom);

    std::vector<Pt> P_outline = {p72, padd(p72, psub(bps1, llc)), bps1, llc};
    HatPtr P = makeHatMeta(P_outline, patch->width * 2.0);
    for (int ch : {7, 2, 3, 4, 28})
        addHatChild(P, patch->children[ch].T, patch->children[ch].geom);

    std::vector<Pt> F_outline = {
        bps2, evalHatChild(patch, 24, 2), evalHatChild(patch, 25, 0),
        p252, padd(p252, psub(llc, bps1)),
    };
    HatPtr F = makeHatMeta(F_outline, patch->width * 2.0);
    for (int ch : {21, 20, 22, 23, 24, 25})
        addHatChild(F, patch->children[ch].T, patch->children[ch].geom);

    const Pt AAA = H_outline[2];
    const Pt BBB = padd(H_outline[1], psub(H_outline[4], H_outline[5]));
    const Pt CCC = transPt(rotAbout(BBB, -kPi / 3.0), AAA);
    HatPtr T = makeHatMeta({BBB, CCC, AAA}, patch->width * 2.0);
    addHatChild(T, patch->children[11].T, patch->children[11].geom);

    recenterHat(H);
    recenterHat(P);
    recenterHat(F);
    recenterHat(T);
    return {H, T, P, F};
}

void emitHatLeaves(const HatPtr& geom, Xf T, std::vector<Tile>& out) {
    if (geom->leaf) {
        out.push_back(polygonTile(geom->shape, T, geom->type));
        return;
    }
    for (const HatChild& ch : geom->children)
        emitHatLeaves(ch.geom, mul(T, ch.T), out);
}

struct SpecGeom;
using SpecPtr = std::shared_ptr<SpecGeom>;

struct SpecChild {
    Xf T;
    SpecPtr geom;
};

struct SpecGeom {
    std::vector<Pt> shape;
    std::array<Pt, 4> quad{};
    std::vector<SpecChild> children;
    uint8_t type = 0;
    bool leaf = false;
};

SpecPtr makeSpecLeaf(const std::vector<Pt>& shape,
                     const std::array<Pt, 4>& quad,
                     uint8_t type) {
    auto g = std::make_shared<SpecGeom>();
    g->shape = shape;
    g->quad = quad;
    g->type = type;
    g->leaf = true;
    return g;
}

SpecPtr makeSpecMeta(const std::array<Pt, 4>& quad) {
    auto g = std::make_shared<SpecGeom>();
    g->quad = quad;
    return g;
}

inline void addSpecChild(const SpecPtr& parent, const SpecPtr& child, Xf T) {
    parent->children.push_back({T, child});
}

std::array<SpecPtr, 9> buildSpectreBase() {
    const std::vector<Pt> spectre = {
        pt(0.0, 0.0), pt(1.0, 0.0), pt(1.5, -kHalfSqrt3),
        pt(2.366025403784439, -0.36602540378443865),
        pt(2.366025403784439, 0.6339745962155614),
        pt(3.366025403784439, 0.6339745962155614),
        pt(3.866025403784439, 1.5), pt(3.0, 2.0),
        pt(2.133974596215561, 1.5),
        pt(1.6339745962155614, 2.3660254037844393),
        pt(0.6339745962155614, 2.3660254037844393),
        pt(-0.3660254037844386, 2.3660254037844393),
        pt(-0.866025403784439, 1.5), pt(0.0, 1.0),
    };
    const std::array<Pt, 4> quad = {spectre[3], spectre[5], spectre[7], spectre[11]};

    std::array<SpecPtr, 9> sys{};
    for (int i = 1; i < 9; ++i)
        sys[i] = makeSpecLeaf(spectre, quad, static_cast<uint8_t>(i + 1));

    SpecPtr gamma = makeSpecMeta(quad);
    addSpecChild(gamma, makeSpecLeaf(spectre, quad, 0), kIdent);
    addSpecChild(gamma, makeSpecLeaf(spectre, quad, 1),
                 mul(ttrans(spectre[8].x, spectre[8].y), trot(kPi / 6.0)));
    sys[0] = gamma;
    return sys;
}

std::array<SpecPtr, 9> buildSpectreSupertiles(const std::array<SpecPtr, 9>& sys) {
    const std::array<Pt, 4> quad = sys[1]->quad;
    const Xf R{-1.0, 0.0, 0.0, 0.0, 1.0, 0.0};
    const int tRules[7][3] = {
        { 60, 3, 1 }, { 0, 2, 0 }, { 60, 3, 1 }, { 60, 3, 1 },
        { 0, 2, 0 }, { 60, 3, 1 }, { -120, 3, 3 },
    };

    std::vector<Xf> Ts = {kIdent};
    int totalAng = 0;
    Xf rot = kIdent;
    std::array<Pt, 4> tquad = quad;
    for (const auto& rule : tRules) {
        totalAng += rule[0];
        if (rule[0] != 0) {
            rot = trot(static_cast<double>(totalAng) * kPi / 180.0);
            for (int i = 0; i < 4; ++i) tquad[i] = transPt(rot, quad[i]);
        }
        const Xf ttt = transTo(tquad[rule[2]], transPt(Ts.back(), quad[rule[1]]));
        Ts.push_back(mul(ttt, rot));
    }
    for (Xf& T : Ts) T = mul(R, T);

    static const int superRules[9][8] = {
        {5, 1, -1, 2, 6, 4, 7, 0},
        {4, 1,  4, 7, 6, 5, 7, 0},
        {8, 1,  5, 7, 6, 5, 7, 0},
        {8, 1,  4, 7, 6, 5, 7, 0},
        {8, 1,  5, 7, 6, 8, 7, 0},
        {8, 1,  4, 7, 6, 8, 7, 0},
        {4, 1,  4, 7, 6, 5, 3, 0},
        {8, 1,  8, 7, 6, 5, 7, 0},
        {8, 1,  8, 7, 6, 8, 7, 0},
    };
    const std::array<Pt, 4> superQuad = {
        transPt(Ts[6], quad[2]),
        transPt(Ts[5], quad[1]),
        transPt(Ts[3], quad[2]),
        transPt(Ts[0], quad[1]),
    };

    std::array<SpecPtr, 9> ret{};
    for (int lab = 0; lab < 9; ++lab) {
        SpecPtr sup = makeSpecMeta(superQuad);
        for (int idx = 0; idx < 8; ++idx) {
            const int sub = superRules[lab][idx];
            if (sub >= 0) addSpecChild(sup, sys[sub], Ts[idx]);
        }
        ret[lab] = sup;
    }
    return ret;
}

void emitSpecLeaves(const SpecPtr& geom, Xf T, std::vector<Tile>& out) {
    if (geom->leaf) {
        out.push_back(polygonTile(geom->shape, T, geom->type));
        return;
    }
    for (const SpecChild& ch : geom->children)
        emitSpecLeaves(ch.geom, mul(T, ch.T), out);
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

// Tübingen triangle deflation. The two Robinson triangles, stored verts
// [apex, b1, b2], type 0 = obtuse (108-36-36), 1 = acute (36-72-72). Inflation
// φ; per Baake-Kramer-Schlottmann-Lück 1990 Fig. 4.6:
//   obtuse → 1 obtuse + 1 acute  (a cevian from the apex to the long base)
//   acute  → 2 acute  + 1 obtuse (top acute at the apex, the rest split by a
//                                 diagonal into an acute and an obtuse)
// Each child is written in barycentric (s,d) coordinates of the parent frame
// V + s·(b1-V) + d·(b2-V), so the parent's affine map carries the chiral rule
// onto reflected tiles automatically — the vertex winding is the handedness.
std::vector<Tile> subdivideTuebingen(const std::vector<Tile>& in) {
    std::vector<Tile> out;
    out.reserve(in.size() * 3);
    for (const Tile& t : in) {
        const float x0 = t.x[0], y0 = t.y[0];
        const float ux = t.x[1] - x0, uy = t.y[1] - y0;   // b1 - apex
        const float wx = t.x[2] - x0, wy = t.y[2] - y0;   // b2 - apex
        auto P = [&](double s, double d, float& ox, float& oy) {
            ox = static_cast<float>(x0 + s * ux + d * wx);
            oy = static_cast<float>(y0 + s * uy + d * wy);
        };
        if (t.type == 1) {            // acute → 2 acute + 1 obtuse
            float Dx, Dy, Ex, Ey;
            P(kPsi, 0.0,  Dx, Dy);    // D on apex→b1 leg at 1/φ
            P(0.0,  kPsi, Ex, Ey);    // E on apex→b2 leg at 1/φ
            out.push_back(mkTri(1, x0, y0, Dx, Dy, Ex, Ey));
            out.push_back(mkTri(1, t.x[2], t.y[2], Dx, Dy, t.x[1], t.y[1]));
            out.push_back(mkTri(0, Ex, Ey, Dx, Dy, t.x[2], t.y[2]));
        } else {                      // obtuse → 1 obtuse + 1 acute
            float Px, Py;
            P(kPsi, kPsi2, Px, Py);   // cevian foot on the b1→b2 base
            out.push_back(mkTri(0, Px, Py, x0, y0, t.x[1], t.y[1]));
            out.push_back(mkTri(1, t.x[2], t.y[2], x0, y0, Px, Py));
        }
    }
    return out;
}

// Danzer-type 7-fold triangle substitution. Four triangle prototiles, every
// angle a multiple of pi/7 (edges in units of s1 = sin(pi/7)):
//   T0 = (pi/7,pi/7,5pi/7)    edges {1,1,rho}      v0,v1 base / v2 apex
//   T1 = (pi/7,2pi/7,4pi/7)   edges {1,rho,sigma}  scalene, v0/v1/v2 = pi,2pi,4pi/7
//   T2 = (2pi/7,2pi/7,3pi/7)  edges {rho,rho,sigma} v0,v1 base / v2 apex
//   T3 = (pi/7,3pi/7,3pi/7)   edges {1,sigma,sigma} v0 apex / v1,v2 base
// with rho = 2cos(pi/7) ~ 1.80194, sigma = sin(3pi/7)/sin(pi/7) ~ 2.24698 and
// the identities rho^2 = 1+sigma, rho*sigma = rho+sigma. Inflation factor rho:
// one deflation replaces a tile by 2/3/4 children at 1/rho linear scale. The
// substitution matrix (rows = parent T0..T3, columns = child counts) is
//   [[1,1,0,0],[1,1,1,0],[0,1,2,1],[0,1,1,1]]
// — primitive, Perron eigenvalue rho^2; the prototile areas form its left
// eigenvector, so every deflation conserves area exactly. The dissection of
// each inflated prototile is an exact, gap- and overlap-free triangulation
// into prototiles (a triangulation of the inflated triangle's boundary
// polygon), verified by area closure and edge-ratio shape. Each child is
// expressed in the parent's barycentric frame v0 + s*(v1-v0) + d*(v2-v0), so a
// reflected parent carries the chiral rule onto reflected children with no
// special handling — the vertex winding is the handedness, as for Tuebingen.
namespace {

struct DanzerChild { uint8_t type; double s[3], d[3]; };

} // namespace

std::vector<Tile> subdivideDanzer(const std::vector<Tile>& in) {
    static const double kRho = 2.0 * std::cos(kPi / 7.0);
    static const double kSig = std::sin(3.0 * kPi / 7.0) / std::sin(kPi / 7.0);
    const double A = 1.0 / (kRho * kRho);        // 1/rho^2          ~ 0.30798
    const double B = 1.0 - A;                    // 1 - 1/rho^2      ~ 0.69202
    const double C = kRho / (kRho + kSig);       // rho/(rho+sigma)  ~ 0.44504
    const double E = kSig / (kRho + kSig);       // sigma/(rho+sigma) = 1/rho

    // rule[parentType] — children, each given as {childType, three (s,d)
    // barycentric corners} in the parent's v0/v1/v2 frame.
    const std::vector<DanzerChild> rule[4] = {
        { // T0 -> T0 + T1
            { 0, { 0.0, 0.0, A   }, { 1.0, 0.0, 0.0 } },
            { 1, { 1.0, A,   0.0 }, { 0.0, 0.0, 1.0 } },
        },
        { // T1 -> T1 + T0 + T2
            { 1, { 0.0, 0.0, C   }, { 0.0, B,   0.0 } },
            { 0, { C,   0.0, 0.0 }, { 0.0, 1.0, B   } },
            { 2, { C,   1.0, 0.0 }, { 0.0, 0.0, 1.0 } },
        },
        { // T2 -> T2 + T2 + T1 + T3
            { 2, { 0.0, 0.0, C   }, { B,   0.0, 0.0 } },
            { 2, { B,   0.0, C   }, { A,   B,   0.0 } },
            { 1, { C,   1.0, B   }, { 0.0, 0.0, A   } },
            { 3, { B,   0.0, 0.0 }, { A,   1.0, B   } },
        },
        { // T3 -> T1 + T3 + T2
            { 1, { 0.0, 0.0, C   }, { 0.0, E,   0.0 } },
            { 3, { 1.0, 0.0, C   }, { 0.0, E,   0.0 } },
            { 2, { 0.0, 1.0, 0.0 }, { E,   0.0, 1.0 } },
        },
    };

    std::vector<Tile> out;
    out.reserve(in.size() * 4);
    for (const Tile& t : in) {
        const float ox = t.x[0], oy = t.y[0];
        const float ux = t.x[1] - ox, uy = t.y[1] - oy;
        const float wx = t.x[2] - ox, wy = t.y[2] - oy;
        for (const DanzerChild& c : rule[t.type & 3]) {
            float p[6];
            for (int r = 0; r < 3; ++r) {
                p[2 * r]     = static_cast<float>(ox + c.s[r] * ux + c.d[r] * wx);
                p[2 * r + 1] = static_cast<float>(oy + c.s[r] * uy + c.d[r] * wy);
            }
            out.push_back(mkTri(c.type, p[0], p[1], p[2], p[3], p[4], p[5]));
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
            const float cx = v2x * 0.5f;
            const float cy = v2y * 0.5f;
            out.push_back(mkTri(0, -cx, -cy, v1x - cx, v1y - cy, v2x - cx, v2y - cy));
            out.push_back(mkTri(0, -cx, -cy, v3x - cx, v3y - cy, v2x - cx, v2y - cy));
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

std::vector<Tile> seedTuebingen(SeedTuebingen seed) {
    std::vector<Tile> out;
    if (seed == SeedTuebingen::Tile) {
        // A single acute golden triangle, apex up, unit base.
        const double h = std::sqrt(kPhi * kPhi - 0.25);
        out.push_back(mkTri(1, 0.0f, static_cast<float>(h),
                               -0.5f, 0.0f, 0.5f, 0.0f));
        return out;
    }
    // Sun: ten acute triangles, 36° apex at the origin, fanning a decagon.
    // Alternate triangles take the mirror winding so the rosette carries
    // both handednesses, as the chiral substitution requires.
    out.reserve(10);
    for (int i = 0; i < 10; ++i) {
        const double a1 = 2.0 * kPi * i / 10.0;
        const double a2 = 2.0 * kPi * (i + 1) / 10.0;
        const float p1x = static_cast<float>(std::cos(a1));
        const float p1y = static_cast<float>(std::sin(a1));
        const float p2x = static_cast<float>(std::cos(a2));
        const float p2y = static_cast<float>(std::sin(a2));
        if (i & 1) out.push_back(mkTri(1, 0.0f, 0.0f, p2x, p2y, p1x, p1y));
        else       out.push_back(mkTri(1, 0.0f, 0.0f, p1x, p1y, p2x, p2y));
    }
    return out;
}

std::vector<Tile> seedDanzer(SeedDanzer seed) {
    std::vector<Tile> out;
    if (seed == SeedDanzer::Tile) {
        // A single T2 (2pi/7,2pi/7,3pi/7) triangle, centred on its centroid.
        static const double kSig =
            std::sin(3.0 * kPi / 7.0) / std::sin(kPi / 7.0);
        static const double kRho = 2.0 * std::cos(kPi / 7.0);
        const double h  = std::sqrt(kRho * kRho - kSig * kSig * 0.25);
        const double cx = (kSig + kSig * 0.5) / 3.0;
        const double cy = h / 3.0;
        const double sc = 0.62;
        auto X = [&](double x){ return static_cast<float>((x - cx) * sc); };
        auto Y = [&](double y){ return static_cast<float>((y - cy) * sc); };
        out.push_back(mkTri(2, X(0.0), Y(0.0), X(kSig), Y(0.0),
                               X(kSig * 0.5), Y(h)));
        return out;
    }
    // Sun: fourteen T3 triangles, the pi/7 apex of each at the origin, fanning
    // a full turn (14 * pi/7 = 2pi) on the unit circle. Adjacent tiles share a
    // leg exactly, so the rosette is gap- and overlap-free.
    out.reserve(14);
    for (int i = 0; i < 14; ++i) {
        const double a1 = kPi * i / 7.0;
        const double a2 = kPi * (i + 1) / 7.0;
        out.push_back(mkTri(3, 0.0f, 0.0f,
            static_cast<float>(std::cos(a1)), static_cast<float>(std::sin(a1)),
            static_cast<float>(std::cos(a2)), static_cast<float>(std::sin(a2))));
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
// de Bruijn N-grid dualization (Dodecagonal, Ammann-Beenker, Heptagonal)
// =============================================================================
// The dual of N line grids spaced 180/N degrees apart is a rhombic tiling with
// 2N-fold symmetry. Every rhombus is the dual of one intersection between a
// line of grid family j and a line of family k; its two edge vectors are the
// unit grid normals, so all rhomb edges are unit length and the rhomb shape is
// fixed by |j - k|. gridCount = 4 gives the Ammann-Beenker square + 45 rhomb,
// 6 the dodecagonal 30/60/90 rhombi, 7 the 14-fold heptagonal rhombi. This is
// dualization, not substitution: no seed/subdivide pair; `generations` scales
// the grid range and `seedIdx` (0..2) picks a grid-offset variant.

std::vector<Tile> generateMultigrid(int gridCount, int seedIdx, int generations) {
    const int N = (gridCount < 2) ? 2 : gridCount;
    std::vector<double> dirx(N), diry(N);
    for (int k = 0; k < N; ++k) {
        const double a = kPi * k / N;
        dirx[k] = std::cos(a);
        diry[k] = std::sin(a);
    }

    // Grid offsets. `seedIdx` picks one of three regimes.
    const int si = (seedIdx >= 0 && seedIdx < 3) ? seedIdx : 0;
    std::vector<double> gamma(N);
    {
        if (si == 0) {
            // Seed 0 (Rosette / Star): every offset is the same constant 1/2.
            // Equal offsets make the multigrid invariant under rotation by
            // pi/N, so the de Bruijn dual is exactly 2N-fold symmetric about
            // its centre. It is still non-singular: the only rational
            // concurrences are the {0,2,4,...} / {1,3,5,...} family triples
            // (whose grid directions sum to zero), and those are ruled out
            // because the alternating offset sum is 1/2 — not an integer — so
            // the per-intersection enumeration below stays gap- and
            // overlap-free without any singular-centre special case.
            for (int k = 0; k < N; ++k) gamma[k] = 0.5;
        } else {
            // Seeds 1-2 (Drift, Quasi): an arithmetic progression with an
            // irrational common difference (sqrt(2) - 1). Non-singular for any
            // N and quasiperiodic — no exact rotation centre; the phase term
            // shifts the patch to a different region of the same tiling.
            const double phase[2] = { 0.1701, 0.4327 };
            const double base = 0.5 + phase[si - 1];
            for (int k = 0; k < N; ++k)
                gamma[k] = std::fmod(base + k * 0.4142135623730951, 1.0);
        }
    }

    int gen = generations < 0 ? 0 : generations;
    // The grid line-index half-range grows ~phi per generation, so the
    // normalised tile size shrinks at the same 1/phi rate the renderer's
    // border scaling (deflationRate) assumes for the substitution families.
    int B = static_cast<int>(std::lround(12.0 * std::pow(kPhi, gen - 6)));
    if (B < 2) B = 2;
    // Keep rhombi whose centroid lies inside this raw-units radius. The dual
    // map scales the plane by ~N/2, so 0.5*N*(B-1) keeps the patch hole-free
    // out to that radius (for N = 6 this is the original 3*(B-1)).
    const double keepLin = 0.5 * N * (B - 1);
    const double keepR2 = keepLin * keepLin;

    // Seed 0 is 2N-fold symmetric, but the de Bruijn dual of a constant-offset
    // grid centres that symmetry on P = (-1, -cot(pi/2N)) — not the origin
    // (rotating a dual cell yields R(.) - 2*dir[0], a rotation about P). Shift
    // every rhomb by -P so the rosette sits at the origin and the radial
    // centroid crop below stays symmetric. Seeds 1-2 are quasiperiodic, with
    // no rotation centre, so they take no shift.
    const double shiftx = (si == 0) ? 1.0 : 0.0;
    const double shifty = (si == 0) ? 1.0 / std::tan(kPi / (2.0 * N)) : 0.0;

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
                    const double v0x = basex + (r - 1) * dirx[j]
                                             + (s - 1) * dirx[k] + shiftx;
                    const double v0y = basey + (r - 1) * diry[j]
                                             + (s - 1) * diry[k] + shifty;
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
// Godreche-Lancon binary tiling — non-Pisot 5-fold rhomb substitution
// =============================================================================
// The two Penrose rhombs grown by the recursion of C. Godreche & F. Lancon,
// "A simple example of a non-Pisot tiling with five-fold symmetry", J. Phys. I
// France 2 (1992) 207-220. With e_k = (cos 2pi k/5, sin 2pi k/5), the large
// rhomb L (72/108) is built on e0,e1 and the sharp rhomb S (36/144) on e0,e2.
// Equation (3) grows the corner-anchored tilings L_n, S_n:
//   L_{n+1} = L_n + [r , g^{n+1}(e0)   ]L_n + [r2, g^{n+1}(e0+e1)]L_n
//                 + [r3, g^{n+1}(e1)   ]S_n
//   S_{n+1} = S_n + [r2, g^{n+1}(e0+e2)]S_n + [r4, g^{n+1}(e2)   ]L_n
// with r = rotation 2pi/5, g = rotation -pi/10 then dilation by the inflation
// factor theta = sqrt(2+phi), and [rot,t] meaning "rotate then translate".
// Equation (4) closes the centred patches by dropping every translation, so
// the pieces fan around the origin: Bear B = L + rL + r2L + r3S (3L+1S spans
// 3*72+144 = 360 deg); Dog D = S + r2S + r4L. The substitution matrix is
// [[3,1],[1,2]] (L->3L+1S, S->2S+1L), eigenvalue phi^2. There is no overlap or
// gap: equal grid edges from adjacent rhombs split identically (Godreche &
// Lancon section 2).

namespace {

// A working rhomb: 4 CCW double-precision corners + L/S type. Kept separate
// from Tile so the many-iteration recursion runs without float drift.
struct BinRhomb { double x[4], y[4]; uint8_t type; };

inline void binAppend(std::vector<BinRhomb>& dst, const std::vector<BinRhomb>& src) {
    dst.reserve(dst.size() + src.size());
    for (const BinRhomb& q : src) dst.push_back(q);
}

// Append into `dst` a copy of every rhomb in `src` rotated by `rot` about the
// origin and then translated by (tx,ty).
inline void binEmit(std::vector<BinRhomb>& dst, const std::vector<BinRhomb>& src,
                    double rot, double tx, double ty) {
    const double c = std::cos(rot), s = std::sin(rot);
    for (const BinRhomb& q : src) {
        BinRhomb o; o.type = q.type;
        for (int i = 0; i < 4; ++i) {
            o.x[i] = c * q.x[i] - s * q.y[i] + tx;
            o.y[i] = s * q.x[i] + c * q.y[i] + ty;
        }
        dst.push_back(o);
    }
}

} // namespace

std::vector<Tile> generateBinary(int seedIdx, int generations) {
    const double theta = std::sqrt(2.0 + kPhi);   // inflation factor ~1.902113
    const double r1 = 2.0 * kPi / 5.0;             // r = rotation 2pi/5

    double ex[5], ey[5];
    for (int k = 0; k < 5; ++k) {
        ex[k] = std::cos(2.0 * kPi * k / 5.0);
        ey[k] = std::sin(2.0 * kPi * k / 5.0);
    }

    // L0, S0: a single large / sharp rhomb anchored with one corner at O.
    std::vector<BinRhomb> L, S;
    {
        BinRhomb l{}; l.type = 0;
        l.x[0] = 0.0;                 l.y[0] = 0.0;
        l.x[1] = ex[0];               l.y[1] = ey[0];
        l.x[2] = ex[0] + ex[1];       l.y[2] = ey[0] + ey[1];
        l.x[3] = ex[1];               l.y[3] = ey[1];
        L.push_back(l);
        BinRhomb s{}; s.type = 1;
        s.x[0] = 0.0;                 s.y[0] = 0.0;
        s.x[1] = ex[0];               s.y[1] = ey[0];
        s.x[2] = ex[0] + ex[2];       s.y[2] = ey[0] + ey[2];
        s.x[3] = ex[2];               s.y[3] = ey[2];
        S.push_back(s);
    }

    const int gen = generations < 1 ? 1 : generations;

    // Equation (3): grow L_n, S_n to L_{gen-1}, S_{gen-1}.
    for (int n = 0; n < gen - 1; ++n) {
        const double gm = std::pow(theta, n + 1);          // g^{n+1} scale
        const double ga = -(n + 1) * kPi / 10.0;           // g^{n+1} rotation
        const double gc = std::cos(ga), gs = std::sin(ga);
        auto gvec = [&](double vx, double vy, double& ox, double& oy) {
            ox = gm * (gc * vx - gs * vy);
            oy = gm * (gs * vx + gc * vy);
        };
        std::vector<BinRhomb> Ln, Sn;                     // identity term
        binAppend(Ln, L);
        binAppend(Sn, S);
        double tx, ty;
        gvec(ex[0],          ey[0],          tx, ty); binEmit(Ln, L, r1 * 1, tx, ty);
        gvec(ex[0] + ex[1],  ey[0] + ey[1],  tx, ty); binEmit(Ln, L, r1 * 2, tx, ty);
        gvec(ex[1],          ey[1],          tx, ty); binEmit(Ln, S, r1 * 3, tx, ty);
        gvec(ex[0] + ex[2],  ey[0] + ey[2],  tx, ty); binEmit(Sn, S, r1 * 2, tx, ty);
        gvec(ex[2],          ey[2],          tx, ty); binEmit(Sn, L, r1 * 4, tx, ty);
        L.swap(Ln); S.swap(Sn);
    }

    // Equation (4): close the centred patch — every translation is the null
    // vector, so the rotated copies fan a full turn around the origin.
    std::vector<BinRhomb> out;
    if (seedIdx == 1) {                 // Dog: D = S + r2 S + r4 L
        binAppend(out, S);
        binEmit(out, S, r1 * 2, 0.0, 0.0);
        binEmit(out, L, r1 * 4, 0.0, 0.0);
    } else {                            // Bear: B = L + r L + r2 L + r3 S
        binAppend(out, L);
        binEmit(out, L, r1 * 1, 0.0, 0.0);
        binEmit(out, L, r1 * 2, 0.0, 0.0);
        binEmit(out, S, r1 * 3, 0.0, 0.0);
    }

    // Normalise the centred patch into the unit disk, matching the other
    // families' model-space scale and the ripple shader's spatial frequency.
    double maxR2 = 0.0;
    for (const BinRhomb& q : out)
        for (int i = 0; i < 4; ++i) {
            const double rr = q.x[i] * q.x[i] + q.y[i] * q.y[i];
            if (rr > maxR2) maxR2 = rr;
        }
    const double inv = maxR2 > 1e-12 ? 1.0 / std::sqrt(maxR2) : 1.0;

    std::vector<Tile> tiles;
    tiles.reserve(out.size());
    for (const BinRhomb& q : out) {
        Tile t{};
        t.vcount = 4;
        t.type = q.type;
        for (int i = 0; i < 4; ++i) {
            t.x[i] = static_cast<float>(q.x[i] * inv);
            t.y[i] = static_cast<float>(q.y[i] * inv);
        }
        tiles.push_back(t);
    }
    return tiles;
}

// =============================================================================
// Penrose P1 — pentagon / star / boat / diamond
// =============================================================================
// P1 is built by decorating the P3 Robinson-triangle substitution. The
// substitution is run as a transform recursion: each fat / thin half-rhomb
// expands into scaled, rotated child half-rhombs (golden-ratio scale factors
// 1/phi and 1/phi^2), and every fat-triangle leaf carries three unit
// pentagons at fixed offsets. Pentagons shared between adjacent leaves are
// deduplicated; the un-shared pentagon edges then close into star / boat /
// diamond gaps, recovered as the closed loops of those edges.
// type 0 = pentagon, 1 = star, 2 = boat, 3 = diamond.

namespace {

// 2x3 affine transform: (x,y) -> (a*x + c*y + e, b*x + d*y + f).
struct P1Xf { double a, b, c, d, e, f; };
const P1Xf kXfId{ 1.0, 0.0, 0.0, 1.0, 0.0, 0.0 };

// A applied after B (A∘B) — mirrors the node's `base_matrix @ count_xform`.
inline P1Xf xfMul(const P1Xf& A, const P1Xf& B) {
    return { A.a*B.a + A.c*B.b,        A.b*B.a + A.d*B.b,
             A.a*B.c + A.c*B.d,        A.b*B.c + A.d*B.d,
             A.a*B.e + A.c*B.f + A.e,  A.b*B.e + A.d*B.f + A.f };
}

// Build one child transform. The linear part is applied scale first, then
// rotateZ(rz), then an optional reflection across the x-axis (rx); the
// translation (tx,ty) is applied last:
//   translate(tx,ty) · reflectX(rx) · rotateZ(rz) · scale(sa).
inline P1Xf xfCall(double tx, double ty, double rzDeg, bool rx, double sa) {
    const double r = rzDeg * kPi / 180.0;
    const double C = std::cos(r), S = std::sin(r);
    const double rs = rx ? -1.0 : 1.0;
    return { C*sa, rs*S*sa, -S*sa, rs*C*sa, tx, ty };
}

// Substitution geometry: two child x-offsets and the golden-ratio scale
// factors kS1 = 1/phi and kS2 = 1/phi^2 (since phi^2 = phi + 1).
const double kThinx = std::sqrt(kPhi + 0.75);
const double kFatx  = 0.5 * std::sqrt(3.0 - kPhi);
const double kS1    = 1.0 / kPhi;
const double kS2    = 1.0 / (1.0 + kPhi);

enum { P1_ENTRY, P1_FAT_PAIR, P1_THIN_SUB, P1_FAT_SUB, P1_THIN_LEAF, P1_FAT_LEAF };

void p1EmitPentagon(const P1Xf& m, std::vector<Tile>& out) {
    Tile pe{};
    pe.vcount = 5;
    pe.type = 0;
    for (int k = 0; k < 5; ++k) {
        const double lx = std::cos(2.0 * kPi * k / 5.0);
        const double ly = std::sin(2.0 * kPi * k / 5.0);
        pe.x[k] = static_cast<float>(m.a*lx + m.c*ly + m.e);
        pe.y[k] = static_cast<float>(m.b*lx + m.d*ly + m.f);
    }
    double area = 0.0;
    for (int k = 0; k < 5; ++k) {
        const int j = (k + 1) % 5;
        area += static_cast<double>(pe.x[k])*pe.y[j]
              - static_cast<double>(pe.x[j])*pe.y[k];
    }
    if (area < 0.0) {                                  // force CCW winding
        Tile r = pe;
        for (int k = 0; k < 5; ++k) { r.x[k] = pe.x[4-k]; r.y[k] = pe.y[4-k]; }
        pe = r;
    }
    out.push_back(pe);
}

// Walk the substitution rules, composing each child's transform onto the
// parent's; emit a pentagon at every fat-triangle leaf. A *_sub rule that
// exceeds the depth budget `md` switches to its leaf successor.
void p1Recurse(int rule, const P1Xf& mat, int depth, int md, std::vector<Tile>& out) {
    if ((rule == P1_THIN_SUB || rule == P1_FAT_SUB) && depth > md) {
        p1Recurse(rule == P1_THIN_SUB ? P1_THIN_LEAF : P1_FAT_LEAF, mat, 0, md, out);
        return;
    }
    switch (rule) {
        case P1_ENTRY: {                               // 5 fat_pair, rz 72*n
            P1Xf cx = kXfId;
            const P1Xf step = xfCall(0, 0, 72, false, 1.0);
            for (int n = 0; n < 5; ++n) {
                cx = xfMul(cx, step);
                p1Recurse(P1_FAT_PAIR, xfMul(mat, cx), depth + 1, md, out);
            }
            break;
        }
        case P1_FAT_PAIR:
            p1Recurse(P1_FAT_SUB, xfMul(mat, xfCall(0,0,0,false,1.0)),  depth+1, md, out);
            p1Recurse(P1_FAT_SUB, xfMul(mat, xfCall(0,0,36,true,1.0)),  depth+1, md, out);
            break;
        case P1_THIN_SUB:
            p1Recurse(P1_THIN_SUB, xfMul(mat, xfCall(-kThinx,0.5,108,false,kS1)), depth+1, md, out);
            p1Recurse(P1_FAT_SUB,  xfMul(mat, xfCall(0,0,108,true,1.0)),          depth+1, md, out);
            break;
        case P1_FAT_SUB:
            p1Recurse(P1_THIN_SUB, xfMul(mat, xfCall(0,kPhi-1.0,-144,false,kS2)),    depth+1, md, out);
            p1Recurse(P1_FAT_SUB,  xfMul(mat, xfCall(kFatx,kPhi/2.0,144,false,kS1)), depth+1, md, out);
            p1Recurse(P1_FAT_SUB,  xfMul(mat, xfCall(0,kPhi,0,true,kS1)),            depth+1, md, out);
            break;
        case P1_THIN_LEAF:                             // thin leaves carry no pentagon
            break;
        case P1_FAT_LEAF:
            p1EmitPentagon(xfMul(mat, xfCall(0,kPhi-1.0,18,false,kS2)), out);
            p1EmitPentagon(xfMul(mat, xfCall((kPhi-1.0)*kFatx,kPhi-0.5,-18,false,kS2)), out);
            p1EmitPentagon(xfMul(mat, xfCall(0,0,-18,false,kS2)), out);
            break;
    }
}

inline int64_t p1Key(float x, float y) {
    const int64_t qx = static_cast<int64_t>(std::lround(x * 1.0e5f));
    const int64_t qy = static_cast<int64_t>(std::lround(y * 1.0e5f));
    return (qx << 32) ^ (qy & 0xffffffffLL);
}

inline double p1Area(const float* x, const float* y, int n) {
    double a = 0.0;
    for (int i = 0; i < n; ++i) {
        const int j = (i + 1) % n;
        a += static_cast<double>(x[i])*y[j] - static_cast<double>(x[j])*y[i];
    }
    return a;
}

} // namespace

std::vector<Tile> generateP1(int /*seedIdx*/, int generations) {
    const int md = generations < 1 ? 1 : generations;

    // ---- 1. run the recursion, collecting the decorating pentagons --------
    std::vector<Tile> pent;
    p1Recurse(P1_ENTRY, kXfId, 0, md, pent);

    // ---- 2. deduplicate the shared pentagons ------------------------------
    std::vector<Tile> out;
    out.reserve(pent.size());
    {
        std::unordered_map<int64_t, char> seen;
        seen.reserve(pent.size() * 2);
        for (const Tile& pe : pent) {
            double cx = 0.0, cy = 0.0;
            for (int k = 0; k < 5; ++k) { cx += pe.x[k]; cy += pe.y[k]; }
            if (seen.emplace(p1Key(static_cast<float>(cx*0.2),
                                   static_cast<float>(cy*0.2)), 1).second)
                out.push_back(pe);
        }
    }
    const size_t pentCount = out.size();

    // ---- 3. fill the star / boat / diamond gaps ---------------------------
    struct DEdge { int64_t a, b; float ax, ay, bx, by; };
    std::vector<DEdge> dir;
    dir.reserve(pentCount * 5);
    std::unordered_map<int64_t, int> ecount;
    ecount.reserve(pentCount * 6);
    auto eKey = [](int64_t a, int64_t b) {
        return a < b ? a*1000003LL + b : b*1000003LL + a;
    };
    for (size_t p = 0; p < pentCount; ++p) {
        const Tile& pe = out[p];
        for (int k = 0; k < 5; ++k) {
            const int j = (k + 1) % 5;
            dir.push_back(DEdge{ p1Key(pe.x[k],pe.y[k]), p1Key(pe.x[j],pe.y[j]),
                                 pe.x[k],pe.y[k], pe.x[j],pe.y[j] });
            ecount[eKey(dir.back().a, dir.back().b)]++;
        }
    }
    std::vector<DEdge> gap;                            // un-shared, reversed
    for (const DEdge& e : dir)
        if (ecount[eKey(e.a,e.b)] == 1)
            gap.push_back(DEdge{ e.b,e.a, e.bx,e.by, e.ax,e.ay });
    std::unordered_multimap<int64_t,int> outAt;
    outAt.reserve(gap.size() * 2);
    for (int i = 0; i < static_cast<int>(gap.size()); ++i)
        outAt.emplace(gap[i].a, i);
    std::vector<int> nxt(gap.size(), -1);
    for (int i = 0; i < static_cast<int>(gap.size()); ++i) {
        const double inx = gap[i].bx - gap[i].ax;
        const double iny = gap[i].by - gap[i].ay;
        int best = -1;
        double bestAng = 1e18;
        auto rg = outAt.equal_range(gap[i].b);
        for (auto it = rg.first; it != rg.second; ++it) {
            const int n = it->second;
            if (n == i) continue;
            const double ox = gap[n].bx - gap[n].ax;
            const double oy = gap[n].by - gap[n].ay;
            double ang = std::atan2(inx*oy - iny*ox, -inx*ox - iny*oy);
            if (ang < 0.0) ang += 2.0 * kPi;
            if (ang < bestAng) { bestAng = ang; best = n; }
        }
        nxt[i] = best;
    }
    std::vector<char> used(gap.size(), 0);
    for (int s = 0; s < static_cast<int>(gap.size()); ++s) {
        if (used[s] || nxt[s] < 0) continue;
        std::vector<int> loop;
        int c = s;
        bool ok = true;
        while (!used[c]) {
            used[c] = 1;
            loop.push_back(c);
            c = nxt[c];
            if (c < 0) { ok = false; break; }
            if (loop.size() > 400) { ok = false; break; }
        }
        if (!ok || c != s) continue;
        const int n = static_cast<int>(loop.size());
        if (n < 4 || n > 10) continue;
        float lx[10], ly[10];
        for (int i = 0; i < n; ++i) { lx[i] = gap[loop[i]].ax; ly[i] = gap[loop[i]].ay; }
        if (p1Area(lx, ly, n) <= 0.0) continue;        // CW loop = outer boundary
        Tile g{};
        g.vcount = static_cast<uint8_t>(n);
        g.type = (n == 4) ? 3 : (n == 5) ? 0 : (n == 10) ? 1 : 2;
        for (int i = 0; i < n; ++i) { g.x[i] = lx[i]; g.y[i] = ly[i]; }
        out.push_back(g);
    }

    // ---- 4. normalise the patch into the unit disk ------------------------
    double maxR2 = 0.0;
    for (const Tile& t : out)
        for (int k = 0; k < t.vcount; ++k) {
            const double rr = static_cast<double>(t.x[k])*t.x[k]
                            + static_cast<double>(t.y[k])*t.y[k];
            if (rr > maxR2) maxR2 = rr;
        }
    const double inv = maxR2 > 1e-12 ? 1.0 / std::sqrt(maxR2) : 1.0;
    for (Tile& t : out)
        for (int k = 0; k < t.vcount; ++k) {
            t.x[k] = static_cast<float>(t.x[k] * inv);
            t.y[k] = static_cast<float>(t.y[k] * inv);
        }
    return out;
}

std::vector<Tile> generateHat(int seedIdx, int generations) {
    auto metatiles = initialHatMetatiles();
    for (int g = 0; g < generations; ++g) {
        const HatPtr patch = constructHatPatch(metatiles);
        metatiles = constructHatMetatiles(patch);
    }
    const int seed = (seedIdx < 0 || seedIdx > 3) ? 0 : seedIdx;
    std::vector<Tile> out;
    emitHatLeaves(metatiles[seed], kIdent, out);
    normalizeTiles(out);
    return out;
}

std::vector<Tile> generateSpectre(int seedIdx, int generations) {
    auto sys = buildSpectreBase();
    for (int g = 0; g < generations; ++g) sys = buildSpectreSupertiles(sys);
    const int seed = (seedIdx < 0 || seedIdx > 8) ? 0 : seedIdx;
    std::vector<Tile> out;
    emitSpecLeaves(sys[seed], kIdent, out);
    normalizeTiles(out);
    return out;
}

// =============================================================================
// Per-family descriptor table
// =============================================================================
// One row per Family enumerator, in enum order. The renderer, the colour
// classifier (color.cpp) and the ripple shader all read this table instead of
// branching on the family.

const FamilyInfo kFamilyInfo[kFamilyCount] = {
    // maxGen, deflationRate, waveSym, hideSeam, depthParallax, centroidFan,
    //   depthVertex, cls{ typeBuckets, orientBuckets, orientFromType, angA,
    //   angB, orientHalfTurn, ringChebyshev }
    // The de Bruijn rhomb families bin orientation mod pi (orientHalfTurn) and
    // so need only N orientBuckets, not 2N — a rhomb edge is undirected.
    // Every family but the Chair carries parallax depth shading: triangles
    // bulge at depthVertex, rhombs along their long diagonal, P1 at the
    // centroid. The Chair L-tromino has no natural depth axis and stays flat.
    /* P3            */ { 8, 0.6180339887498949f,  5, 1, true,  false, 1,
                          { 2, 10, false, 0, 2, false, false } },
    /* P2            */ { 8, 0.6180339887498949f,  5, 2, true,  false, 1,
                          { 2, 10, false, 0, 2, false, false } },
    /* Chair         */ { 7, 0.5f,                 4, 0, false, false, 0,
                          { 4,  4, true,  0, 0, false, true  } },
    /* Dodecagonal   */ { 8, 0.6180339887498949f, 12, 0, true,  false, 0,
                          { 3,  6, false, 0, 1, true,  false } },
    /* Pinwheel      */ { 6, 0.4472135954999579f,  0, 0, true,  false, 1,
                          { 2, 10, false, 0, 2, false, false } },
    /* AmmannBeenker */ { 8, 0.6180339887498949f,  8, 0, true,  false, 0,
                          { 2,  4, false, 0, 1, true,  false } },
    /* Heptagonal    */ { 8, 0.6180339887498949f, 14, 0, true,  false, 0,
                          { 3,  7, false, 0, 1, true,  false } },
    /* Binary        */ { 8, 0.5257311121191336f,  5, 0, true,  false, 0,
                          { 2,  5, false, 0, 1, true,  false } },
    /* Tuebingen     */ { 8, 0.6180339887498949f,  5, 0, true,  false, 0,
                          { 2, 10, false, 0, 2, false, false } },
    /* P1            */ { 7, 0.6180339887498949f,  5, 0, true,  true,  0,
                          { 4, 10, false, 0, 1, false, false } },
    /* Danzer        */ { 7, 0.5549581320873713f, 14, 0, true,  false, 2,
                          { 4, 14, false, 0, 2, false, false } },
    /* Hat           */ { 5, 0.3819660112501051f,  0, 0, true,  true,  0,
                          { 5, 12, false, 0, 1, false, false } },
    /* Spectre       */ { 5, 0.3535533905932738f,  0, 0, true,  true,  0,
                          {10, 12, false, 0, 1, false, false } },
};

// =============================================================================
// Family-erased generate()
// =============================================================================

std::vector<Tile> generate(Family family, int seedIdx, int generations) {
    const int cap0 = generations < 0 ? 0 : generations;
    const int maxG = familyInfo(family).maxGen;
    const int cap  = cap0 > maxG ? maxG : cap0;
    switch (family) {
        case Family::P3: {
            int s = (seedIdx < 0 || seedIdx > 3) ? 0 : seedIdx;
            auto tiles = seedP3(static_cast<SeedP3>(s));
            for (int g = 0; g < cap; ++g) tiles = subdivideP3(tiles);
            return tiles;
        }
        case Family::P2: {
            int s = (seedIdx < 0 || seedIdx > 1) ? 0 : seedIdx;
            auto tiles = seedP2(static_cast<SeedP2>(s));
            for (int g = 0; g < cap; ++g) tiles = subdivideP2(tiles);
            return tiles;
        }
        case Family::Chair: {
            int s = (seedIdx < 0 || seedIdx > 2) ? 0 : seedIdx;
            auto tiles = seedChair(static_cast<SeedChair>(s));
            for (int g = 0; g < cap; ++g) tiles = subdivideChair(tiles);
            return tiles;
        }
        case Family::Pinwheel: {
            int s = (seedIdx < 0 || seedIdx > 2) ? 0 : seedIdx;
            auto tiles = seedPinwheel(static_cast<SeedPinwheel>(s));
            for (int g = 0; g < cap; ++g) tiles = subdividePinwheel(tiles);
            return tiles;
        }
        case Family::Dodecagonal:   return generateMultigrid(6, seedIdx, cap);
        case Family::AmmannBeenker: return generateMultigrid(4, seedIdx, cap);
        case Family::Heptagonal:    return generateMultigrid(7, seedIdx, cap);
        case Family::Binary: {
            int s = (seedIdx < 0 || seedIdx > 1) ? 0 : seedIdx;
            return generateBinary(s, cap);
        }
        case Family::Tuebingen: {
            int s = (seedIdx < 0 || seedIdx > 1) ? 0 : seedIdx;
            auto tiles = seedTuebingen(static_cast<SeedTuebingen>(s));
            for (int g = 0; g < cap; ++g) tiles = subdivideTuebingen(tiles);
            return tiles;
        }
        case Family::P1: return generateP1(seedIdx, cap);
        case Family::Danzer: {
            int s = (seedIdx < 0 || seedIdx > 1) ? 0 : seedIdx;
            auto tiles = seedDanzer(static_cast<SeedDanzer>(s));
            for (int g = 0; g < cap; ++g) tiles = subdivideDanzer(tiles);
            return tiles;
        }
        case Family::Hat: {
            int s = (seedIdx < 0 || seedIdx > 3) ? 0 : seedIdx;
            return generateHat(s, cap);
        }
        case Family::Spectre: {
            int s = (seedIdx < 0 || seedIdx > 8) ? 0 : seedIdx;
            return generateSpectre(s, cap);
        }
    }
    return {};
}

} // namespace penrose
