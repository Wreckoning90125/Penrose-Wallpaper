// Renderer geometry pipeline: build fill triangles and tile-local border-ring
// triangles from the current Settings, upload them to GPU buffers, and refresh
// the palette UBO.
//
// Owns the file-internal edge-visibility structs and geometry helpers.
// Everything else (Vulkan resource handles, Settings, view state) lives on the
// Renderer struct in renderer.h.

#include "renderer/renderer.h"

#include "color/color.h"
#include "log.h"
#include "renderer/render_state.h"
#include "tiling/penrose.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace penrose {

namespace {

int typeBucketCount(const std::vector<Tile>& tiles, Family family, const ClassSpec& cs) {
    if (family != Family::GailiunasSpiral) return cs.typeBuckets > 0 ? cs.typeBuckets : 1;
    uint8_t maxType = 0;
    for (const Tile& tile : tiles) maxType = std::max(maxType, tile.type);
    return static_cast<int>(maxType) + 1;
}

// Edge-visibility map record. Each unique edge midpoint is hit by up to two
// tiles; we record both kinds so hideSeam can decide whether the seam is
// internal-to-rhombus (drop) or part of the visible tile boundary (keep).
struct EdgeRec {
    float    p1x, p1y, p2x, p2y;
    uint8_t  t1, t2;
    EdgeKind k1, k2;
    uint8_t  ownerCount;
    bool     secondSet;
};

struct EdgeKey {
    int32_t ax, ay;
    int32_t bx, by;
    bool operator==(const EdgeKey& o) const {
        return ax == o.ax && ay == o.ay && bx == o.bx && by == o.by;
    }
};

struct EdgeKeyHash {
    size_t operator()(const EdgeKey& k) const noexcept {
        uint64_t h = 1469598103934665603ULL;
        const auto mix = [&h](int32_t value) {
            h ^= static_cast<uint32_t>(value);
            h *= 1099511628211ULL;
        };
        mix(k.ax);
        mix(k.ay);
        mix(k.bx);
        mix(k.by);
        return std::hash<uint64_t>{}(h);
    }
};

inline int32_t quantizeCoord(float value, float scale) {
    return static_cast<int32_t>(std::lround(value * scale));
}

inline EdgeKey canonicalEdgeKey(const Edge& e, float scale) {
    int32_t ax = quantizeCoord(e.p1x, scale);
    int32_t ay = quantizeCoord(e.p1y, scale);
    int32_t bx = quantizeCoord(e.p2x, scale);
    int32_t by = quantizeCoord(e.p2y, scale);
    if (bx < ax || (bx == ax && by < ay)) {
        std::swap(ax, bx);
        std::swap(ay, by);
    }
    return EdgeKey{ax, ay, bx, by};
}

// Edge-distance barycentric basis for one emitted triangle. p0/p1/p2 are
// the tile-polygon vertex indices of the triangle's three corners, or -1
// for the centroid of a centroid-fan. A triangle edge is a real tile
// boundary only when both its endpoints are polygon vertices adjacent on
// the tile perimeter; interior fan / centroid-spoke edges get their
// barycentric component pinned to 1 at every vertex so the fragment
// shader's min(bary) never dips to 0 along a seam that is not a tile edge.
struct Bary3 { float v[3][3]; };

struct TriIdx { int a, b, c; };

struct SourceTri {
    float x0, y0, z0;
    float x1, y1, z1;
    float x2, y2, z2;
    int   p0, p1, p2;
};

inline Bary3 computeBary(int vcount, int p0, int p1, int p2) {
    Bary3 b;
    for (int v = 0; v < 3; ++v)
        for (int c = 0; c < 3; ++c)
            b.v[v][c] = (v == c) ? 1.0f : 0.0f;
    const int p[3] = { p0, p1, p2 };
    for (int k = 0; k < 3; ++k) {
        // The edge opposite vertex k joins the other two corners.
        const int a = p[(k + 1) % 3];
        const int c = p[(k + 2) % 3];
        bool boundary = false;
        if (a >= 0 && c >= 0) {
            int d = a - c;
            if (d < 0) d = -d;
            boundary = (d == 1 || d == vcount - 1);
        }
        if (!boundary)
            for (int v = 0; v < 3; ++v) b.v[v][k] = 1.0f;
    }
    return b;
}

// Unit model-space gradient direction of the parallax-depth field over the
// triangle (p0,p1,p2) with per-vertex depths d0,d1,d2 — the direction the
// tile's bulge/pit normal tilts. The depth field is linear over the
// triangle, so the gradient is the exact constant solving the 2x2 system
// [e1;e2]·grad = (d1-d0, d2-d0). Returns (0,0) for a degenerate triangle or
// a depth-flat tile (the Chair family).
inline void bulgeDir(float p0x, float p0y, float p1x, float p1y,
                     float p2x, float p2y, float d0, float d1, float d2,
                     float& gx, float& gy) {
    gx = 0.0f; gy = 0.0f;
    const float e1x = p1x - p0x, e1y = p1y - p0y;
    const float e2x = p2x - p0x, e2y = p2y - p0y;
    const float det = e1x * e2y - e1y * e2x;
    if (std::fabs(det) < 1e-12f) return;
    const float inv = 1.0f / det;
    const float a = d1 - d0, b = d2 - d0;
    const float rx = ( e2y * a - e1y * b) * inv;
    const float ry = (-e2x * a + e1x * b) * inv;
    const float rl = std::sqrt(rx * rx + ry * ry);
    if (rl > 1e-9f) { gx = rx / rl; gy = ry / rl; }
}

inline double orient2(double ax, double ay, double bx, double by, double cx, double cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

inline bool pointOnSegment(double ax, double ay, double bx, double by, double px, double py) {
    constexpr double kEps = 1e-10;
    return std::fabs(orient2(ax, ay, bx, by, px, py)) <= kEps
        && px >= std::min(ax, bx) - kEps && px <= std::max(ax, bx) + kEps
        && py >= std::min(ay, by) - kEps && py <= std::max(ay, by) + kEps;
}

inline bool segmentsIntersect(double ax, double ay, double bx, double by,
                              double cx, double cy, double dx, double dy) {
    constexpr double kEps = 1e-10;
    if (std::max(ax, bx) + kEps < std::min(cx, dx)
        || std::max(cx, dx) + kEps < std::min(ax, bx)
        || std::max(ay, by) + kEps < std::min(cy, dy)
        || std::max(cy, dy) + kEps < std::min(ay, by)) return false;
    const double o1 = orient2(ax, ay, bx, by, cx, cy);
    const double o2 = orient2(ax, ay, bx, by, dx, dy);
    const double o3 = orient2(cx, cy, dx, dy, ax, ay);
    const double o4 = orient2(cx, cy, dx, dy, bx, by);
    if (std::fabs(o1) <= kEps && pointOnSegment(ax, ay, bx, by, cx, cy)) return true;
    if (std::fabs(o2) <= kEps && pointOnSegment(ax, ay, bx, by, dx, dy)) return true;
    if (std::fabs(o3) <= kEps && pointOnSegment(cx, cy, dx, dy, ax, ay)) return true;
    if (std::fabs(o4) <= kEps && pointOnSegment(cx, cy, dx, dy, bx, by)) return true;
    return (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0);
}

bool pointInPolygon(const Tile& t, double px, double py) {
    bool inside = false;
    for (int i = 0, j = t.vcount - 1; i < t.vcount; j = i, ++i) {
        const double ax = t.x[j], ay = t.y[j];
        const double bx = t.x[i], by = t.y[i];
        if (pointOnSegment(ax, ay, bx, by, px, py)) return true;
        const bool crosses = (ay > py) != (by > py);
        if (crosses) {
            const double x = ax + (py - ay) * (bx - ax) / (by - ay);
            if (x > px) inside = !inside;
        }
    }
    return inside;
}

bool segmentCrossesPolygonBoundary(const Tile& t, double sx, double sy, int endIndex) {
    const double ex = t.x[endIndex], ey = t.y[endIndex];
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        if (i == endIndex || j == endIndex) continue;
        if (segmentsIntersect(sx, sy, ex, ey, t.x[i], t.y[i], t.x[j], t.y[j])) return true;
    }
    return false;
}

bool centerFanContained(const Tile& t, double cx, double cy) {
    if (!pointInPolygon(t, cx, cy)) return false;
    for (int i = 0; i < t.vcount; ++i) {
        if (segmentCrossesPolygonBoundary(t, cx, cy, i)) return false;
    }
    return true;
}

bool pointInTriangle(const Tile& t, int p, int a, int b, int c, bool ccw) {
    const double ab = orient2(t.x[a], t.y[a], t.x[b], t.y[b], t.x[p], t.y[p]);
    const double bc = orient2(t.x[b], t.y[b], t.x[c], t.y[c], t.x[p], t.y[p]);
    const double ca = orient2(t.x[c], t.y[c], t.x[a], t.y[a], t.x[p], t.y[p]);
    constexpr double kEps = 1e-10;
    return ccw ? (ab >= -kEps && bc >= -kEps && ca >= -kEps)
               : (ab <=  kEps && bc <=  kEps && ca <=  kEps);
}

std::vector<TriIdx> triangulatePolygon(const Tile& t) {
    std::vector<TriIdx> out;
    if (t.vcount < 3) return out;
    if (t.vcount == 3) {
        out.push_back({0, 1, 2});
        return out;
    }
    const double area = tileSignedArea(t);
    if (std::fabs(area) <= 1e-12) return out;
    const bool ccw = area > 0.0;
    std::vector<int> remaining;
    remaining.reserve(t.vcount);
    for (int i = 0; i < t.vcount; ++i) remaining.push_back(i);

    while (remaining.size() > 3) {
        int earAt = -1;
        for (int i = 0; i < static_cast<int>(remaining.size()); ++i) {
            const int ia = remaining[(i + remaining.size() - 1) % remaining.size()];
            const int ib = remaining[i];
            const int ic = remaining[(i + 1) % remaining.size()];
            const double turn = orient2(t.x[ia], t.y[ia], t.x[ib], t.y[ib], t.x[ic], t.y[ic]);
            if (ccw ? turn <= 1e-12 : turn >= -1e-12) continue;
            bool blocked = false;
            for (int idx : remaining) {
                if (idx == ia || idx == ib || idx == ic) continue;
                if (pointInTriangle(t, idx, ia, ib, ic, ccw)) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                out.push_back({ia, ib, ic});
                earAt = i;
                break;
            }
        }
        if (earAt < 0) return {};
        remaining.erase(remaining.begin() + earAt);
    }
    out.push_back({remaining[0], remaining[1], remaining[2]});
    return out;
}

float distanceToSegment(float px, float py, float ax, float ay, float bx, float by) {
    const float dx = bx - ax;
    const float dy = by - ay;
    const float lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-12f) return std::sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
    const float t = std::clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0.0f, 1.0f);
    const float qx = ax + dx * t;
    const float qy = ay + dy * t;
    return std::sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
}

float distanceToBoundary(const Tile& t, float px, float py) {
    float best = 1e30f;
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        best = std::min(best, distanceToSegment(px, py, t.x[i], t.y[i], t.x[j], t.y[j]));
    }
    return best < 1e29f ? best : 0.0f;
}

float tileDepthAt(const Tile& t, float px, float py, float cx, float cy, float apexDepth) {
    if (std::fabs(apexDepth) <= 1e-7f) return 0.0f;
    const float boundary = distanceToBoundary(t, px, py);
    const float centerDist = std::sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    const float denom = boundary + centerDist;
    return denom > 1e-7f ? apexDepth * boundary / denom : 0.0f;
}

std::vector<SourceTri> sourceTrianglesForCenterDepth(const Tile& t, float cx, float cy, float centerDepth) {
    std::vector<SourceTri> out;
    if (centerFanContained(t, cx, cy)) {
        out.reserve(t.vcount);
        for (int v = 0; v < t.vcount; ++v) {
            const int w = (v + 1) % t.vcount;
            out.push_back({ cx, cy, centerDepth, t.x[v], t.y[v], 0.0f, t.x[w], t.y[w], 0.0f, -1, v, w });
        }
        return out;
    }

    const std::vector<TriIdx> ears = triangulatePolygon(t);
    out.reserve(ears.size() * 3);
    for (const TriIdx& tri : ears) {
        const float hx = (t.x[tri.a] + t.x[tri.b] + t.x[tri.c]) / 3.0f;
        const float hy = (t.y[tri.a] + t.y[tri.b] + t.y[tri.c]) / 3.0f;
        const float hd = tileDepthAt(t, hx, hy, cx, cy, centerDepth);
        const auto add = [&](int first, int second) {
            const int diff = std::abs(first - second);
            const bool boundary = diff == 1 || diff == t.vcount - 1;
            if (boundary) {
                out.push_back({ hx, hy, hd, t.x[first], t.y[first], 0.0f, t.x[second], t.y[second], 0.0f, -1, first, second });
                return;
            }
            const float mx = (t.x[first] + t.x[second]) * 0.5f;
            const float my = (t.y[first] + t.y[second]) * 0.5f;
            const float md = tileDepthAt(t, mx, my, cx, cy, centerDepth);
            out.push_back({ hx, hy, hd, t.x[first], t.y[first], 0.0f, mx, my, md, -1, first, -1 });
            out.push_back({ hx, hy, hd, mx, my, md, t.x[second], t.y[second], 0.0f, -1, -1, second });
        };
        add(tri.a, tri.b);
        add(tri.b, tri.c);
        add(tri.c, tri.a);
    }
    return out;
}

inline bool hideSeam(Family fam, EdgeKind k1, EdgeKind k2) {
    switch (familyInfo(fam).hideSeamMode) {
        case 1:  return k1 == EdgeKind::Base && k2 == EdgeKind::Base;  // P3
        case 2:  return k1 == EdgeKind::Leg  && k2 == EdgeKind::Leg;   // P2
        default: return false;
    }
}

struct Point2 {
    float x;
    float y;
};

struct BorderTileEdge {
    std::vector<Point2> pts;
    bool visible = false;
};

inline Point2 add(Point2 a, Point2 b) { return { a.x + b.x, a.y + b.y }; }
inline Point2 sub(Point2 a, Point2 b) { return { a.x - b.x, a.y - b.y }; }
inline Point2 mul(Point2 a, float s) { return { a.x * s, a.y * s }; }
inline float dot(Point2 a, Point2 b) { return a.x * b.x + a.y * b.y; }
inline float cross(Point2 a, Point2 b) { return a.x * b.y - a.y * b.x; }
inline float len(Point2 a) { return std::sqrt(dot(a, a)); }

Point2 unit(Point2 p) {
    const float l = len(p);
    return l <= 1e-9f ? Point2{1.0f, 0.0f} : Point2{p.x / l, p.y / l};
}

Point2 lerp(Point2 a, Point2 b, float t) {
    return { a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t };
}

float signedArea(const std::vector<Point2>& pts) {
    float twice = 0.0f;
    for (size_t i = 0; i < pts.size(); ++i) {
        const Point2 a = pts[i];
        const Point2 b = pts[(i + 1) % pts.size()];
        twice += cross(a, b);
    }
    return twice * 0.5f;
}

EdgeKey canonicalEdgeKey(float ax, float ay, float bx, float by, float scale) {
    Edge e{ ax, ay, bx, by, EdgeKind::ChairEdge, uint8_t{0} };
    return canonicalEdgeKey(e, scale);
}

std::unordered_set<EdgeKey, EdgeKeyHash> visibleEdgeKeysForTiles(
    const std::vector<Tile>& tiles,
    Family family,
    float keyScale
) {
    std::vector<Edge> edges;
    size_t edgeCapacity = 0;
    for (const Tile& tile : tiles) edgeCapacity += tile.vcount;
    edges.reserve(edgeCapacity);
    for (const Tile& tile : tiles) {
        if (tile.vcount == 3) edgesPenrose(tile, edges);
        else                  edgesChair(tile, edges);
    }

    std::unordered_map<EdgeKey, EdgeRec, EdgeKeyHash> edgeMap;
    edgeMap.reserve(edges.size() / 2 + 16);
    for (const Edge& e : edges) {
        const EdgeKey key = canonicalEdgeKey(e, keyScale);
        auto it = edgeMap.find(key);
        if (it == edgeMap.end()) {
            edgeMap.emplace(key, EdgeRec{ e.p1x, e.p1y, e.p2x, e.p2y,
                                          e.tileType, uint8_t{0},
                                          e.kind, EdgeKind::Leg, uint8_t{1}, false });
        } else {
            if (it->second.ownerCount == 1) {
                it->second.t2 = e.tileType;
                it->second.k2 = e.kind;
                it->second.secondSet = true;
            }
            if (it->second.ownerCount < 255) ++it->second.ownerCount;
        }
    }

    std::unordered_set<EdgeKey, EdgeKeyHash> visible;
    visible.reserve(edgeMap.size());
    for (const auto& kv : edgeMap) {
        const EdgeRec& r = kv.second;
        const bool sameTypeHiddenSeam = r.ownerCount == 2
            && r.secondSet
            && r.t1 == r.t2
            && hideSeam(family, r.k1, r.k2);
        if (!sameTypeHiddenSeam) visible.insert(kv.first);
    }
    return visible;
}

float averageTileRadius(const std::vector<Tile>& tiles) {
    double sum = 0.0;
    int count = 0;
    for (const Tile& tile : tiles) {
        const TilePoint c = tileAreaCentroid(tile);
        for (int i = 0; i < tile.vcount; ++i) {
            const double dx = static_cast<double>(tile.x[i]) - c.x;
            const double dy = static_cast<double>(tile.y[i]) - c.y;
            sum += std::sqrt(dx * dx + dy * dy);
            ++count;
        }
    }
    return count > 0 ? static_cast<float>(sum / count) : 1.0f;
}

Point2 radialUnproject(Point2 p, float scale) {
    const float r = len(p);
    if (r <= 1e-6f) return { 0.0f, 0.0f };
    const float diskR = std::min(r, 0.999999f);
    const float worldR = 2.0f * std::atanh(diskR) / std::max(scale, 1e-6f);
    return mul(p, worldR / r);
}

Point2 radialProject(Point2 p, float scale);

Point2 borderSourceFromGeometry(Point2 p, const Settings& settings) {
    if (settings.projection != Projection::PoincareDisk) return p;
    return radialUnproject(p, std::max(settings.hypScale, 1e-3f));
}

void pushBakedBorderTri(
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices,
    Point2 a,
    Point2 b,
    Point2 c,
    const Settings& settings
) {
    if (std::fabs(cross(sub(b, a), sub(c, a))) <= 1e-12f) return;
    const Point2 sourceA = borderSourceFromGeometry(a, settings);
    const Point2 sourceB = borderSourceFromGeometry(b, settings);
    const Point2 sourceC = borderSourceFromGeometry(c, settings);
    const uint32_t base = static_cast<uint32_t>(borders.size());
    borders.push_back({ a.x, a.y, sourceA.x, sourceA.y });
    borders.push_back({ b.x, b.y, sourceB.x, sourceB.y });
    borders.push_back({ c.x, c.y, sourceC.x, sourceC.y });
    indices.push_back(base + 0);
    indices.push_back(base + 1);
    indices.push_back(base + 2);
}

void emitTileBorderRing(
    const Tile& tile,
    const Tile& visibilityTile,
    const std::unordered_set<EdgeKey, EdgeKeyHash>& visible,
    float keyScale,
    int subdiv,
    float halfWidth,
    int joinStyle,
    float fill,
    float point,
    float gap,
    const Settings& settings,
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices
) {
    const int k = tile.vcount;
    if (k < 2) return;

    const TilePoint centroidD = tileAreaCentroid(tile);
    const Point2 centroid{ static_cast<float>(centroidD.x), static_cast<float>(centroidD.y) };
    std::vector<Point2> corners;
    std::vector<Point2> chord;
    std::vector<BorderTileEdge> edges;
    corners.reserve(k);
    chord.reserve(k);
    edges.reserve(k);

    const int subCount = std::max(1, subdiv);
    const float projectionScale = std::max(settings.hypScale, 1e-3f);
    for (int e = 0; e < k; ++e) {
        const int n = (e + 1) % k;
        const Point2 a{ tile.x[e], tile.y[e] };
        const Point2 b{ tile.x[n], tile.y[n] };
        const Point2 sourceA{ visibilityTile.x[e], visibilityTile.y[e] };
        const Point2 sourceB{ visibilityTile.x[n], visibilityTile.y[n] };
        corners.push_back(a);
        chord.push_back(unit(sub(b, a)));
        BorderTileEdge edge{};
        edge.visible = visible.find(canonicalEdgeKey(sourceA.x, sourceA.y, sourceB.x, sourceB.y, keyScale)) != visible.end();
        edge.pts.reserve(static_cast<size_t>(subCount) + 1);
        for (int s = 0; s <= subCount; ++s) {
            const float t = static_cast<float>(s) / static_cast<float>(subCount);
            const Point2 source = lerp(sourceA, sourceB, t);
            const Point2 p = settings.projection == Projection::PoincareDisk
                ? radialProject(source, projectionScale)
                : source;
            edge.pts.push_back(p);
        }
        edges.push_back(std::move(edge));
    }

    const bool ccw = signedArea(corners) >= 0.0f;
    std::vector<Point2> inward;
    inward.reserve(k);
    for (Point2 d : chord) {
        inward.push_back(ccw ? Point2{ -d.y, d.x } : Point2{ d.y, -d.x });
    }

    std::vector<bool> reflex;
    reflex.reserve(k);
    bool anyReflex = false;
    for (int i = 0; i < k; ++i) {
        const int ip = (i - 1 + k) % k;
        const float turn = cross(chord[ip], chord[i]);
        const bool isReflex = ccw ? turn < -1e-9f : turn > 1e-9f;
        reflex.push_back(isReflex);
        anyReflex = anyReflex || isReflex;
    }

    float centroidClearance = 1e30f;
    float minEdge = 1e30f;
    for (int e = 0; e < k; ++e) {
        const Point2 a = corners[e];
        const Point2 b = corners[(e + 1) % k];
        const float dist = dot(sub(centroid, a), inward[e]);
        if (dist > 0.0f) centroidClearance = std::min(centroidClearance, dist);
        minEdge = std::min(minEdge, len(sub(b, a)));
    }
    const float cap = anyReflex
        ? minEdge * 0.2f
        : std::min(minEdge * 0.42f, centroidClearance < 1e29f ? centroidClearance * 0.92f : minEdge * 0.42f);
    const float h = std::min(halfWidth, cap);
    if (h <= 1e-7f) return;

    const float f = anyReflex ? 0.0f : std::clamp(fill, 0.0f, 1.0f);
    const float g = anyReflex ? 0.0f : std::clamp(gap, 0.0f, 1.0f);

    std::vector<Point2> apex;
    apex.reserve(k);
    for (int i = 0; i < k; ++i) {
        const Point2 c = corners[i];
        if (reflex[i]) {
            apex.push_back(c);
            continue;
        }
        const int ip = (i - 1 + k) % k;
        Point2 bis = unit(add(inward[ip], inward[i]));
        float tMin = 1e30f;
        for (int j = 0; j < k; ++j) {
            const Point2 o = add(corners[j], mul(inward[j], h));
            const Point2 d = chord[j];
            const float denom = cross(bis, d);
            if (std::fabs(denom) < 1e-9f) continue;
            const float t = cross(sub(o, c), d) / denom;
            if (t > 1e-6f && t < tMin) tMin = t;
        }
        if (tMin >= 1e29f) tMin = h;
        const Point2 m = add(c, mul(bis, tMin));
        apex.push_back(add(m, mul(sub(centroid, m), f)));
    }

    const auto pull = [](Point2 from, Point2 toward, float dist) {
        const Point2 d = sub(toward, from);
        const float l = len(d);
        if (l <= 1e-9f) return from;
        const float actual = std::min(dist, l * 0.5f);
        return add(from, mul(d, actual / l));
    };
    const auto foot = [&](int e, int at) {
        return add(corners[at], mul(inward[e], h));
    };

    const float cut = joinStyle == 0 ? 0.0f : (joinStyle == 1 ? 1.8f : 1.2f) * h;
    std::vector<Point2> innerStart;
    std::vector<Point2> innerEnd;
    innerStart.reserve(k);
    innerEnd.reserve(k);
    for (int e = 0; e < k; ++e) {
        const int cs = e;
        const int ce = (e + 1) % k;
        Point2 a0 = reflex[cs] ? foot(e, cs) : apex[cs];
        Point2 a1 = reflex[ce] ? foot(e, ce) : apex[ce];
        if (cut > 0.0f && !reflex[cs]) a0 = pull(a0, reflex[ce] ? foot(e, ce) : apex[ce], cut);
        if (cut > 0.0f && !reflex[ce]) a1 = pull(a1, reflex[cs] ? foot(e, cs) : apex[cs], cut);
        innerStart.push_back(a0);
        innerEnd.push_back(a1);
    }

    const float trim = std::clamp(point, 0.0f, 1.0f) * h * 2.2f;
    for (int e = 0; e < k; ++e) {
        if (!edges[e].visible) continue;
        const std::vector<Point2>& ep = edges[e].pts;
        if (ep.size() < 2) continue;
        const Point2 a0 = innerStart[e];
        const Point2 a1 = innerEnd[e];
        const int last = static_cast<int>(ep.size()) - 1;
        float edgeLen = 0.0f;
        for (int j = 0; j < last; ++j) edgeLen += len(sub(ep[j + 1], ep[j]));
        const auto endShift = [&](int corner) {
            return reflex[corner] || edgeLen <= 0.0f ? 0.0f : std::min(0.45f, trim / edgeLen);
        };
        const float tA = endShift(e);
        const float tB = 1.0f - endShift((e + 1) % k);
        const auto outerAt = [&](float t) {
            const float s = t * static_cast<float>(last);
            const int j = std::max(0, std::min(last - 1, static_cast<int>(std::floor(s))));
            const float frac = s - static_cast<float>(j);
            return lerp(ep[j], ep[j + 1], frac);
        };
        const float gapZone = g > 0.0f && edgeLen > 0.0f ? std::min(0.45f, (h * 1.5f) / edgeLen) : 0.0f;
        const auto innerAt = [&](float t) {
            Point2 p = lerp(a0, a1, t);
            if (gapZone > 1e-6f) {
                if (!reflex[e]) {
                    const float w = g * std::clamp((tA + gapZone - t) / gapZone, 0.0f, 1.0f);
                    if (w > 0.0f) p = add(p, mul(sub(corners[e], p), w));
                }
                const int next = (e + 1) % k;
                if (!reflex[next]) {
                    const float w = g * std::clamp((t - (tB - gapZone)) / gapZone, 0.0f, 1.0f);
                    if (w > 0.0f) p = add(p, mul(sub(corners[next], p), w));
                }
            }
            return p;
        };

        std::vector<float> params{ tA, tB };
        for (int j = 1; j < last; ++j) {
            const float t = static_cast<float>(j) / static_cast<float>(last);
            if (t > tA + 1e-9f && t < tB - 1e-9f) params.push_back(t);
        }
        if (gapZone > 1e-6f) {
            const float knees[2] = { tA + gapZone, tB - gapZone };
            for (float knee : knees) {
                if (knee > tA + 1e-9f && knee < tB - 1e-9f) params.push_back(knee);
            }
        }
        std::sort(params.begin(), params.end());
        params.erase(std::unique(params.begin(), params.end(),
                                 [](float a, float b) { return std::fabs(a - b) <= 1e-7f; }),
                     params.end());
        for (size_t i = 0; i + 1 < params.size(); ++i) {
            const float t0 = params[i];
            const float t1 = params[i + 1];
            if (t1 <= t0 + 1e-9f) continue;
            const Point2 o0 = outerAt(t0);
            const Point2 o1 = outerAt(t1);
            const Point2 i0 = innerAt(t0);
            const Point2 i1 = innerAt(t1);
            pushBakedBorderTri(borders, indices, o0, o1, i1, settings);
            pushBakedBorderTri(borders, indices, o0, i1, i0, settings);
        }
    }

    for (int i = 0; i < k; ++i) {
        const int ip = (i - 1 + k) % k;
        if (!edges[ip].visible || !edges[i].visible) continue;
        const Point2 v = corners[i];
        const Point2 cIn = innerEnd[ip];
        const Point2 cOut = innerStart[i];
        if (!reflex[i] && trim > 1e-9f) {
            continue;
        }
        if (!reflex[i] && cut > 0.0f && joinStyle == 1) {
            const Point2 m = apex[i];
            constexpr int kRoundSegments = 4;
            Point2 prev = cIn;
            for (int s = 1; s <= kRoundSegments; ++s) {
                const float t = static_cast<float>(s) / static_cast<float>(kRoundSegments);
                const float it = 1.0f - t;
                const Point2 p{
                    it * it * cIn.x + 2.0f * it * t * m.x + t * t * cOut.x,
                    it * it * cIn.y + 2.0f * it * t * m.y + t * t * cOut.y,
                };
                pushBakedBorderTri(borders, indices, v, prev, p, settings);
                prev = p;
            }
        } else if (reflex[i] || cut > 0.0f) {
            pushBakedBorderTri(borders, indices, v, cIn, cOut, settings);
        }
    }
}

Point2 radialProject(Point2 p, float scale) {
    const float r = len(p);
    if (r <= 1e-6f) return { 0.0f, 0.0f };
    const float d = std::tanh(r * scale * 0.5f);
    return mul(p, d / r);
}

Tile radialProjectedTile(const Tile& tile, float scale) {
    Tile projected = tile;
    for (int i = 0; i < projected.vcount; ++i) {
        const Point2 p = radialProject({ tile.x[i], tile.y[i] }, scale);
        projected.x[i] = p.x;
        projected.y[i] = p.y;
    }
    return projected;
}

std::vector<Tile> borderGeometryTiles(const std::vector<Tile>& tiles, const Settings& settings) {
    if (settings.projection != Projection::PoincareDisk) return tiles;
    std::vector<Tile> projected;
    projected.reserve(tiles.size());
    const float scale = std::max(settings.hypScale, 1e-3f);
    for (const Tile& tile : tiles) projected.push_back(radialProjectedTile(tile, scale));
    return projected;
}

void buildBorderMeshForTiles(
    const std::vector<Tile>& tiles,
    const Settings& settings,
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& borderIndices
) {
    if (!settings.borderOn) return;

    constexpr float kKeyScale = 1.0e5f;
    const auto visible = visibleEdgeKeysForTiles(tiles, settings.family, kKeyScale);
    const int sub = (settings.projection == Projection::PoincareDisk)
                    ? settings.hypBorderSubdiv : 1;
    const std::vector<Tile> geometryTiles = borderGeometryTiles(tiles, settings);
    const float requestedHalfWidth = averageTileRadius(geometryTiles)
        * std::clamp(settings.borderWidth, 0.0f, 6.0f)
        / 6.0f
        * 0.08f;
    size_t reserveVertices = 0;
    for (const Tile& tile : geometryTiles) {
        reserveVertices += static_cast<size_t>(tile.vcount) * static_cast<size_t>(sub) * 6u;
        reserveVertices += static_cast<size_t>(tile.vcount) * 12u;
    }
    borders.reserve(reserveVertices);
    borderIndices.reserve(reserveVertices);
    for (size_t i = 0; i < tiles.size(); ++i) {
        emitTileBorderRing(
            geometryTiles[i],
            tiles[i],
            visible,
            kKeyScale,
            sub,
            requestedHalfWidth,
            settings.borderJoin,
            settings.borderFill,
            settings.borderPoint,
            settings.borderGap,
            settings,
            borders,
            borderIndices);
    }
}

} // namespace

// -----------------------------------------------------------------------------
// buildGeometry — Penrose / Chair tiles → fill verts + border quads.
// -----------------------------------------------------------------------------

bool Renderer::buildGeometry() {
    if (effectiveGeneration_ < settings_.generation) {
        effectiveGeneration_ = settings_.generation;
    }
    std::vector<Tile> tiles = generate(settings_.family, settings_.seedIdx, effectiveGeneration_);
    if (tiles.empty()) { LOGE("buildGeometry: empty tile set"); return false; }

    Classification cls = classify(tiles, settings_.family, settings_.colorMode, settings_.colorCount);

    // -------- Fill vertices ---------------------------------------------------
    // Penrose tris -> 3 verts. Chair L -> fan from vert 0 (4 triangles).
    // Each vert also carries the tile centroid so the ripple shader can
    // phase the quasicrystal plane-wave sum per tile.
    std::vector<FillVertex> fills;
    fills.reserve(tiles.size() * 6);

    // One push site for the fill mesh — keeps the per-branch emit loops from
    // spelling out the full 14-float vertex. (bgx,bgy) is the triangle's
    // bulge-tilt direction; bary3 is the vertex's row of the edge-distance
    // basis; mat4 is the per-tile material identity. The latter two are
    // shared by all of a triangle's vertices.
    auto pushFill = [&fills](float x, float y, uint32_t idx, float cx, float cy,
                             float bgx, float bgy, const float* bary3, const float* mat4) {
        fills.push_back(FillVertex{ x, y, idx, cx, cy, bgx, bgy,
                                    bary3[0], bary3[1], bary3[2],
                                    mat4[0], mat4[1], mat4[2], mat4[3] });
    };

    // Per-tile subdivision count for fill triangles in hyperbolic mode.
    // Each parent tri is split into N² child tris by a barycentric
    // (i,j,k) grid, with every child-vertex attribute computed by
    // linear interpolation from parent corners. Because bary, bulge,
    // centroid and material are all linear-interpolation-safe, the
    // fragment shader's bevel still falls only on parent edges (the
    // min(bary) is zero only along original edges, never along
    // interior subdivision cuts). Driven by Settings.hypFillSubdiv,
    // separate from the border subdivision because the costs are
    // different shapes (N² vs N) — JNI already clamped to [1, 8].
    const int fillSub = (settings_.projection == Projection::PoincareDisk)
                        ? settings_.hypFillSubdiv : 1;

    auto emitFillTri = [&](float ax, float ay, float bx, float by,
                           float cx_v, float cy_v,
                           uint32_t paletteIdx, float ctrX, float ctrY,
                           float bgx, float bgy, const Bary3& bary, const float* mat) {
        if (fillSub <= 1) {
            pushFill(ax,   ay,   paletteIdx, ctrX, ctrY, bgx, bgy, bary.v[0], mat);
            pushFill(bx,   by,   paletteIdx, ctrX, ctrY, bgx, bgy, bary.v[1], mat);
            pushFill(cx_v, cy_v, paletteIdx, ctrX, ctrY, bgx, bgy, bary.v[2], mat);
            return;
        }
        const float invN = 1.0f / static_cast<float>(fillSub);
        auto pushGrid = [&](int i, int j) {
            // Child vertex at barycentric (i, j, k) on parent (i+j+k=fillSub).
            const int k = fillSub - i - j;
            const float fa = i * invN, fb = j * invN, fc = k * invN;
            const float vx = fa * ax + fb * bx + fc * cx_v;
            const float vy = fa * ay + fb * by + fc * cy_v;
            float vb[3];
            for (int c = 0; c < 3; ++c)
                vb[c] = fa * bary.v[0][c] + fb * bary.v[1][c] + fc * bary.v[2][c];
            pushFill(vx, vy, paletteIdx, ctrX, ctrY, bgx, bgy, vb, mat);
        };
        for (int i = 0; i < fillSub; ++i) {
            for (int j = 0; j < fillSub - i; ++j) {
                // Upright child tri: (i,j) (i+1,j) (i,j+1)
                pushGrid(i,     j);
                pushGrid(i + 1, j);
                pushGrid(i,     j + 1);
                // Inverted child tri (skip the rightmost slot per row).
                if (j < fillSub - i - 1) {
                    pushGrid(i + 1, j);
                    pushGrid(i + 1, j + 1);
                    pushGrid(i,     j + 1);
                }
            }
        }
    };

    float minX =  1e9f, minY =  1e9f;
    float maxX = -1e9f, maxY = -1e9f;
    float rSqMax = 0.0f;

    for (size_t i = 0; i < tiles.size(); ++i) {
        const Tile& t = tiles[i];
        const uint32_t paletteIdx = static_cast<uint32_t>(
            bucketToPaletteIdx(cls.bucket[i], cls.numBuckets, settings_.colorCount));
        const int vc = t.vcount;
        const TilePoint center = tileAreaCentroid(t);
        const float cx = static_cast<float>(center.x);
        const float cy = static_cast<float>(center.y);
        // Parallax depth shading. type 0 bulges toward the viewer (+1),
        // every other type recedes (-1); the depthAmount slider scales the
        // effect in the fragment shader. The bulge sits on one vertex for a
        // triangle, along the long diagonal for a rhomb, and at the centre
        // for a P1 tile, so every family but the flat Chair reads as 3-D.
        const FamilyInfo& fi = familyInfo(settings_.family);
        const float dsign = (t.type == 0) ? +1.0f : -1.0f;

        // Per-tile material identity (location 5, see render_state.h):
        // type normalised over the family's distinct kinds, the unit
        // direction of the classifier edge as orientation, and the
        // centroid radius. Shared by all of this tile's fill vertices.
        const ClassSpec& cs = fi.cls;
        const int typeBuckets = typeBucketCount(tiles, settings_.family, cs);
        const float typeNorm = (typeBuckets > 1)
            ? static_cast<float>(t.type) / static_cast<float>(typeBuckets - 1)
            : 0.0f;
        const float odx  = t.x[cs.angB] - t.x[cs.angA];
        const float ody  = t.y[cs.angB] - t.y[cs.angA];
        const float olen = std::sqrt(odx * odx + ody * ody);
        const float ocos = (olen > 1e-6f) ? odx / olen : 1.0f;
        const float osin = (olen > 1e-6f) ? ody / olen : 0.0f;
        const float mat[4] = { typeNorm, ocos, osin, std::sqrt(cx * cx + cy * cy) };

        if (vc == 3) {
            // Triangle tiles: one vertex carries the bulge, the other two
            // sit at the midline. For the Penrose rhomb halves and the
            // pinwheel that is vertex 1; for the Tübingen triangles it is
            // the apex, vertex 0 — fi.depthVertex selects it.
            float depths[3] = { 0.0f, 0.0f, 0.0f };
            if (fi.depthParallax) depths[fi.depthVertex] = dsign;
            const Bary3 bary = computeBary(3, 0, 1, 2);
            float bgx, bgy;
            bulgeDir(t.x[0], t.y[0], t.x[1], t.y[1], t.x[2], t.y[2],
                     depths[0], depths[1], depths[2], bgx, bgy);
            emitFillTri(t.x[0], t.y[0], t.x[1], t.y[1], t.x[2], t.y[2],
                        paletteIdx, cx, cy, bgx, bgy, bary, mat);
        } else if (fi.centroidFan) {
            // Center-depth polygons: use the area centroid as the material
            // center and relief apex, but only use a centroid fan when that fan
            // is actually contained in the tile. Concave monotiles/spirals that
            // are not star-shaped are ear-triangulated and get local contained
            // depth hubs instead.
            const float cd = fi.depthParallax ? dsign : 0.0f;
            const std::vector<SourceTri> sources = sourceTrianglesForCenterDepth(t, cx, cy, cd);
            if (sources.empty()) {
                LOGE("failed to triangulate tile family=%d type=%u vertices=%u",
                     static_cast<int>(settings_.family), static_cast<unsigned>(t.type),
                     static_cast<unsigned>(t.vcount));
                return false;
            }
            for (const SourceTri& tri : sources) {
                const Bary3 bary = computeBary(vc, tri.p0, tri.p1, tri.p2);
                float bgx, bgy;
                bulgeDir(tri.x0, tri.y0, tri.x1, tri.y1, tri.x2, tri.y2,
                         tri.z0, tri.z1, tri.z2, bgx, bgy);
                emitFillTri(tri.x0, tri.y0, tri.x1, tri.y1, tri.x2, tri.y2,
                            paletteIdx, cx, cy, bgx, bgy, bary, mat);
            }
        } else {
            // Convex polygons fanned from vertex 0. A rhomb (the de Bruijn
            // and binary families) carries the bulge along its long
            // diagonal — the ridge of the Penrose rhombus generalised. The
            // Chair L-tromino has no depth axis and stays flat.
            float depth[kMaxTileVerts] = { 0.0f };
            if (fi.depthParallax && vc == 4) {
                const float dx02 = t.x[2] - t.x[0], dy02 = t.y[2] - t.y[0];
                const float dx13 = t.x[3] - t.x[1], dy13 = t.y[3] - t.y[1];
                if (dx02*dx02 + dy02*dy02 >= dx13*dx13 + dy13*dy13)
                    depth[0] = depth[2] = dsign;
                else
                    depth[1] = depth[3] = dsign;
            }
            for (int v = 1; v + 1 < vc; ++v) {
                // Corners: polygon vertices 0, v, v+1.
                const Bary3 bary = computeBary(vc, 0, v, v + 1);
                float bgx, bgy;
                bulgeDir(t.x[0], t.y[0], t.x[v], t.y[v], t.x[v + 1], t.y[v + 1],
                         depth[0], depth[v], depth[v + 1], bgx, bgy);
                emitFillTri(t.x[0], t.y[0], t.x[v], t.y[v], t.x[v + 1], t.y[v + 1],
                            paletteIdx, cx, cy, bgx, bgy, bary, mat);
            }
        }
        // Per-vertex extents: bbox AND true farthest |vertex| for the
        // hyperbolic auto-fit. Tracked once per tile across all vc
        // vertices (shared by every emit branch above).
        for (int v = 0; v < vc; ++v) {
            const float vx = t.x[v], vy = t.y[v];
            minX = std::min(minX, vx); maxX = std::max(maxX, vx);
            minY = std::min(minY, vy); maxY = std::max(maxY, vy);
            const float rSq = vx * vx + vy * vy;
            if (rSq > rSqMax) rSqMax = rSq;
        }
    }
    // -------- Border geometry: tile-local inset rings -------------------------
    // Mirrors the web borderJoin model: every tile owns a ring inset toward its
    // own interior, with shared-edge visibility determined by the same seam rule
    // as the fill mesh. The generated triangles are real border geometry; the
    // border vertex shader only applies the view/projection/wave transform.
    std::vector<BorderVertex> borders;
    std::vector<uint32_t> borderIndices;
    buildBorderMeshForTiles(tiles, settings_, borders, borderIndices);

    // -------- Upload to GPU --------------------------------------------------
    // Allocate and populate replacements first. Only after every buffer is ready
    // do we destroy the previous renderable geometry, so allocation failures keep
    // the last valid frame intact.
    auto destroyBuffer = [&](VkBuffer& buf, VkDeviceMemory& mem) {
        destroyBufferNow(buf, mem);
    };

    const VkDeviceSize fillSize      = sizeof(FillVertex)   * fills.size();
    const VkDeviceSize borderSize    = sizeof(BorderVertex) * borders.size();
    const VkDeviceSize borderIdxSize = sizeof(uint32_t)     * borderIndices.size();

    VkBuffer nextFillVertBuf = VK_NULL_HANDLE;
    VkDeviceMemory nextFillVertMem = VK_NULL_HANDLE;
    VkBuffer nextBorderVertBuf = VK_NULL_HANDLE;
    VkDeviceMemory nextBorderVertMem = VK_NULL_HANDLE;
    VkBuffer nextBorderIdxBuf = VK_NULL_HANDLE;
    VkDeviceMemory nextBorderIdxMem = VK_NULL_HANDLE;

    const auto fail = [&]() {
        destroyBuffer(nextFillVertBuf, nextFillVertMem);
        destroyBuffer(nextBorderVertBuf, nextBorderVertMem);
        destroyBuffer(nextBorderIdxBuf, nextBorderIdxMem);
        return false;
    };

    const auto uploadBuffer = [&](VkDeviceSize size,
                                  VkBufferUsageFlags usage,
                                  const void* src,
                                  VkBuffer& buf,
                                  VkDeviceMemory& mem) {
        if (size == 0) return true;
        if (!createBuffer(size, usage,
                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                          VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                          buf, mem)) {
            return false;
        }
        void* mapped = nullptr;
        const VkResult result = vkMapMemory(device_, mem, 0, size, 0, &mapped);
        if (result != VK_SUCCESS) {
            LOGE("vkMapMemory(geometry) -> %d", static_cast<int>(result));
            return false;
        }
        std::memcpy(mapped, src, size);
        vkUnmapMemory(device_, mem);
        return true;
    };

    if (!uploadBuffer(fillSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                      fills.data(), nextFillVertBuf, nextFillVertMem)) {
        return fail();
    }
    if (!uploadBuffer(borderSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                      borders.data(), nextBorderVertBuf, nextBorderVertMem)) {
        return fail();
    }
    if (!uploadBuffer(borderIdxSize, VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                      borderIndices.data(), nextBorderIdxBuf, nextBorderIdxMem)) {
        return fail();
    }

    destroyBuffer(fillVertBuf_, fillVertMem_);
    destroyBuffer(borderVertBuf_, borderVertMem_);
    destroyBuffer(borderIdxBuf_, borderIdxMem_);

    fillVertBuf_ = nextFillVertBuf;
    fillVertMem_ = nextFillVertMem;
    borderVertBuf_ = nextBorderVertBuf;
    borderVertMem_ = nextBorderVertMem;
    borderIdxBuf_ = nextBorderIdxBuf;
    borderIdxMem_ = nextBorderIdxMem;
    currentTiles_ = std::move(tiles);
    fillVertexCount_ = static_cast<uint32_t>(fills.size());
    borderIndexCount_ = static_cast<uint32_t>(borderIndices.size());
    geomMinX_ = minX; geomMaxX_ = maxX;
    geomMinY_ = minY; geomMaxY_ = maxY;
    geomRmax_ = std::sqrt(rSqMax);

    LOGI("geom: %zu tiles, %u fillVerts, %u borderIdx, bounds [%.3f,%.3f]-[%.3f,%.3f]",
         currentTiles_.size(), fillVertexCount_, borderIndexCount_,
         geomMinX_, geomMinY_, geomMaxX_, geomMaxY_);
    return true;
}

bool Renderer::buildBorderGeometry() {
    if (currentTiles_.empty()) {
        currentTiles_ = generate(settings_.family, settings_.seedIdx, effectiveGeneration_);
    }
    const std::vector<Tile>& tiles = currentTiles_;
    if (tiles.empty()) { LOGE("buildBorderGeometry: empty tile set"); return false; }

    std::vector<BorderVertex> borders;
    std::vector<uint32_t> borderIndices;
    buildBorderMeshForTiles(tiles, settings_, borders, borderIndices);
    auto destroyBuffer = [&](VkBuffer& buf, VkDeviceMemory& mem) {
        destroyBufferNow(buf, mem);
    };
    const VkDeviceSize borderSize    = sizeof(BorderVertex) * borders.size();
    const VkDeviceSize borderIdxSize = sizeof(uint32_t)     * borderIndices.size();

    VkBuffer nextBorderVertBuf = VK_NULL_HANDLE;
    VkDeviceMemory nextBorderVertMem = VK_NULL_HANDLE;
    VkBuffer nextBorderIdxBuf = VK_NULL_HANDLE;
    VkDeviceMemory nextBorderIdxMem = VK_NULL_HANDLE;

    const auto fail = [&]() {
        destroyBuffer(nextBorderVertBuf, nextBorderVertMem);
        destroyBuffer(nextBorderIdxBuf, nextBorderIdxMem);
        return false;
    };

    if (borderSize > 0
            && !createBuffer(borderSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                             VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                             VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                             nextBorderVertBuf, nextBorderVertMem)) {
        return fail();
    }
    if (borderIdxSize > 0
            && !createBuffer(borderIdxSize, VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                             VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                             VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                             nextBorderIdxBuf, nextBorderIdxMem)) {
        return fail();
    }

    if (borderSize > 0) {
        void* mapped = nullptr;
        const VkResult result = vkMapMemory(device_, nextBorderVertMem, 0, borderSize, 0, &mapped);
        if (result != VK_SUCCESS) {
            LOGE("vkMapMemory(border vertex) -> %d", static_cast<int>(result));
            return fail();
        }
        std::memcpy(mapped, borders.data(), borderSize);
        vkUnmapMemory(device_, nextBorderVertMem);
    }
    if (borderIdxSize > 0) {
        void* mapped = nullptr;
        const VkResult result = vkMapMemory(device_, nextBorderIdxMem, 0, borderIdxSize, 0, &mapped);
        if (result != VK_SUCCESS) {
            LOGE("vkMapMemory(border index) -> %d", static_cast<int>(result));
            return fail();
        }
        std::memcpy(mapped, borderIndices.data(), borderIdxSize);
        vkUnmapMemory(device_, nextBorderIdxMem);
    }

    retireBuffer(borderVertBuf_, borderVertMem_);
    retireBuffer(borderIdxBuf_, borderIdxMem_);
    borderVertBuf_ = nextBorderVertBuf;
    borderVertMem_ = nextBorderVertMem;
    borderIdxBuf_ = nextBorderIdxBuf;
    borderIdxMem_ = nextBorderIdxMem;
    borderIndexCount_ = static_cast<uint32_t>(borderIndices.size());

    LOGI("border geom: %zu tiles, %u borderIdx", tiles.size(), borderIndexCount_);
    return true;
}

// -----------------------------------------------------------------------------
// updatePaletteUbo — pack palette + border + bg + animation + audio.
// -----------------------------------------------------------------------------

void Renderer::updatePaletteUbo() {
    bool anyMapped = false;
    for (void* mapped : paletteUboMapped_) anyMapped = anyMapped || mapped != nullptr;
    if (!anyMapped) return;
    PresetResult ps = buildPreset(settings_.preset, settings_.colorCount,
                                  settings_.customOklch);
    PaletteUbo ubo{};
    auto enc = [&](Oklch c, float alpha) {
        return oklchToShaderColor(c, alpha, wideGamut_, cpuLinearOutput_);
    };
    for (int i = 0; i < kMaxColors; ++i) {
        ShaderColor c = enc(ps.colors[i], 1.0f);
        ubo.palette[i][0] = c.r;
        ubo.palette[i][1] = c.g;
        ubo.palette[i][2] = c.b;
        ubo.palette[i][3] = c.a;
    }
    ShaderColor bc = enc(settings_.borderColor, settings_.borderAlpha);
    ubo.borderColor[0] = bc.r; ubo.borderColor[1] = bc.g;
    ubo.borderColor[2] = bc.b; ubo.borderColor[3] = bc.a;

    Oklch bgOk = (settings_.bgMode == BackgroundMode::Match) ? ps.colors[0] : settings_.bgColor;
    ShaderColor bg = enc(bgOk, 1.0f);
    ubo.bgColor[0] = bg.r; ubo.bgColor[1] = bg.g;
    ubo.bgColor[2] = bg.b; ubo.bgColor[3] = 1.0f;
    ubo.flags[0] = 0;

    // Ripple animation. The shader gates trig on `anim.y > 0` so a zero
    // amount short-circuits the wave math for every tile.
    ubo.anim[0] = time_;
    ubo.anim[1] = settings_.rippleAmount;
    ubo.anim[2] = static_cast<float>(familyInfo(settings_.family).waveSymmetry);
    ubo.anim[3] = pageOffset_;

    // Border width is baked into the tile-local ring vertices so the slider
    // follows the web renderer's average-tile-radius contract. The row stays
    // present to preserve the shared UBO layout.
    ubo.borderGeom[0] = 0.0f;
    ubo.borderGeom[1] = 0.0f;
    ubo.borderGeom[2] = 0.0f;
    ubo.borderGeom[3] = 0.0f;

    ubo.effects[0] = settings_.brightness;
    ubo.effects[1] = settings_.depthAmount;
    ubo.effects[2] = settings_.rippleSpeed;
    ubo.effects[3] = static_cast<float>(settings_.rippleKind);

    AudioAnalyzer::FeatureSnapshot audio{};
    globalAudioAnalyzer().snapshot(audio);
    for (int i = 0; i < 8; ++i) {
        ubo.audioBands[i >> 2][i & 3] = audio.bands[i];
    }
    ubo.audioBeat[0] = audio.beat;
    ubo.audioBeat[1] = audio.onsetStrength;
    ubo.audioBeat[2] = audio.cwtTransient;
    ubo.audioBeat[3] = audio.beatConfidence;

    // Physical material: the eight user-facing controls come from the
    // settings sliders; the rest hold the MaterialParams defaults (a
    // material preset sets those as a bundle). The per-frame UBO patch in
    // drawFrame overwrites these rows with the modulation-graph result, so
    // this is the cold-path seed for the first frame after a settings change.
    MaterialParams m{};
    m.roughBase     = settings_.matRoughness;
    // See renderer.cpp drawFrame — Metalness slider drives the uniform
    // base; variation is its own settings_.matMetalMod knob.
    m.metalBase     = settings_.matMetalness;
    m.sheen         = settings_.matSheen;
    m.clearcoat     = settings_.matClearcoat;
    m.anisotropy    = settings_.matAnisotropy;
    m.iridescence   = settings_.matIridescence;
    m.emissive      = settings_.matEmissive;
    m.bevelStrength = settings_.matRelief;
    m.sheenColor[0] = settings_.matSheenColorR;
    m.sheenColor[1] = settings_.matSheenColorG;
    m.sheenColor[2] = settings_.matSheenColorB;
    m.iridThickMin  = settings_.matIridThickMin;
    m.iridThickMax  = settings_.matIridThickMax;
    m.roughMod      = settings_.matRoughMod;
    m.metalMod      = settings_.matMetalMod;
    applyLightControls(m, settings_.lightAngle, settings_.lightElevation,
                       settings_.lightIntensity, settings_.lightWarmth,
                       settings_.lightAmbient);
    writeMaterialRows(&ubo.matNormal[0], m);

    for (void* mapped : paletteUboMapped_) {
        if (mapped) std::memcpy(mapped, &ubo, sizeof(ubo));
    }
}

} // namespace penrose
