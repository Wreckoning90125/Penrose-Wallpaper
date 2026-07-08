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

struct Point2 {
    float x;
    float y;
};

Point2 d4Orientation(uint8_t type) {
    switch (type & 7u) {
        case 1: return { 0.0f,  1.0f };
        case 2: return {-1.0f,  0.0f };
        case 3: return { 0.0f, -1.0f };
        case 4: return {-1.0f,  0.0f };
        case 5: return { 1.0f,  0.0f };
        case 6: return { 0.0f,  1.0f };
        case 7: return { 0.0f, -1.0f };
        default: return { 1.0f, 0.0f };
    }
}

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

struct TopologyScalar {
    float degree;
    float motif;
    float relaxed;
    float biharmonic;
};

struct TopologySide {
    size_t tileIndex;
    uint8_t tileType;
    EdgeKind kind;
};

struct TopologyRec {
    std::vector<TopologySide> sides;
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
struct EdgeMetric3 { float v[3]; };

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

struct Bounds2 {
    float minX;
    float minY;
    float maxX;
    float maxY;
    float rSqMax;
};

constexpr int kSpectreLogicalSides = 14;
constexpr int kSpectreFillSamplesPerSide = 6;
constexpr int kSpectreBorderSamplesPerSide = 12;
constexpr float kSpectreCurveBulge = 0.6f;
constexpr float kSpectreEdgeFadeFraction = 0.24f;
constexpr int kSpectreRadialSupportBands = 13;
constexpr size_t kMaxFillVertexCount = 3'200'000u;

struct SpectreMeshDetail {
    int samplesPerSide;
    int radialBands;
};

constexpr SpectreMeshDetail kSpectreMeshDetailCandidates[] = {
    { kSpectreFillSamplesPerSide, kSpectreRadialSupportBands },
    { 5, 13 },
    { 4, 13 },
    { 4, 9 },
    { 3, 9 },
    { 3, 5 },
    { 2, 3 },
    { 2, 2 },
    { 1, 1 },
};

struct BoundarySample {
    float distance;
    float gradX;
    float gradY;
};

float signedArea(const std::vector<Point2>& pts);
inline float cross(Point2 a, Point2 b);
std::vector<TriIdx> triangulatePointPolygonByArea(const std::vector<Point2>& pts);

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

BoundarySample segmentBoundaryDistanceSample(
    float px,
    float py,
    float ax,
    float ay,
    float bx,
    float by,
    bool ccw
) {
    const float dx = bx - ax;
    const float dy = by - ay;
    const float lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-12f) {
        const float vx = px - ax;
        const float vy = py - ay;
        const float dist = std::sqrt(vx * vx + vy * vy);
        return dist > 1e-7f
            ? BoundarySample{ dist, vx / dist, vy / dist }
            : BoundarySample{ 0.0f, 0.0f, 0.0f };
    }
    const float t = std::clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0.0f, 1.0f);
    const float qx = ax + dx * t;
    const float qy = ay + dy * t;
    const float vx = px - qx;
    const float vy = py - qy;
    const float dist = std::sqrt(vx * vx + vy * vy);
    if (dist > 1e-7f) return { dist, vx / dist, vy / dist };
    const float len = std::sqrt(lenSq);
    return ccw
        ? BoundarySample{ 0.0f, -dy / len, dx / len }
        : BoundarySample{ 0.0f, dy / len, -dx / len };
}

BoundarySample nearestBoundaryDistanceSample(const Tile& t, float px, float py) {
    const bool ccw = tileSignedArea(t) >= 0.0;
    BoundarySample best{ 1e30f, 0.0f, 0.0f };
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        const BoundarySample sample = segmentBoundaryDistanceSample(px, py, t.x[i], t.y[i], t.x[j], t.y[j], ccw);
        if (sample.distance < best.distance) best = sample;
    }
    if (best.distance >= 1e29f) return { 0.0f, 0.0f, 0.0f };
    return best;
}

float smootherStepDerivative(float t) {
    return 30.0f * t * t * (t - 1.0f) * (t - 1.0f);
}

float averageSegmentLength(const Tile& t) {
    if (t.vcount <= 0) return 1.0f;
    float total = 0.0f;
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        total += std::sqrt((t.x[j] - t.x[i]) * (t.x[j] - t.x[i]) + (t.y[j] - t.y[i]) * (t.y[j] - t.y[i]));
    }
    return total / static_cast<float>(t.vcount);
}

float spectreReliefReference(const Tile& t, float cx, float cy) {
    if (t.vcount <= 0) return 1.0f;
    float total = 0.0f;
    for (int i = 0; i < t.vcount; ++i) {
        total += std::sqrt((t.x[i] - cx) * (t.x[i] - cx) + (t.y[i] - cy) * (t.y[i] - cy));
    }
    return std::max(total / static_cast<float>(t.vcount), averageSegmentLength(t) * 0.5f);
}

Point2 spectreReliefGradient(const Tile& t, float px, float py, float referenceDistance) {
    const BoundarySample boundary = nearestBoundaryDistanceSample(t, px, py);
    const float edgeBand = std::max(referenceDistance * kSpectreEdgeFadeFraction, 1e-7f);
    const float edgeT = std::clamp(boundary.distance / edgeBand, 0.0f, 1.0f);
    const float edgeDerivative = edgeT > 0.0f && edgeT < 1.0f
        ? smootherStepDerivative(edgeT) / edgeBand
        : 0.0f;
    return { edgeDerivative * boundary.gradX, edgeDerivative * boundary.gradY };
}

float distanceToBoundary(const Tile& t, float px, float py) {
    float best = 1e30f;
    for (int i = 0; i < t.vcount; ++i) {
        const int j = (i + 1) % t.vcount;
        best = std::min(best, distanceToSegment(px, py, t.x[i], t.y[i], t.x[j], t.y[j]));
    }
    return best < 1e29f ? best : 0.0f;
}

float normalizedDistanceToSegment(
    float px,
    float py,
    float ax,
    float ay,
    float bx,
    float by,
    float reference
) {
    return std::clamp(
        distanceToSegment(px, py, ax, ay, bx, by) / std::max(reference, 1e-6f),
        0.0f,
        1.0f);
}

bool baryComponentPinned(const Bary3& bary, int component) {
    return std::fabs(bary.v[0][component] - 1.0f) <= 1e-6f
        && std::fabs(bary.v[1][component] - 1.0f) <= 1e-6f
        && std::fabs(bary.v[2][component] - 1.0f) <= 1e-6f;
}

EdgeMetric3 edgeMetricForTriangle(
    float ax,
    float ay,
    float bx,
    float by,
    float cx,
    float cy,
    const Bary3& bary,
    float reference
) {
    EdgeMetric3 metric{};
    metric.v[0] = baryComponentPinned(bary, 0)
        ? 1.0f
        : normalizedDistanceToSegment(ax, ay, bx, by, cx, cy, reference);
    metric.v[1] = baryComponentPinned(bary, 1)
        ? 1.0f
        : normalizedDistanceToSegment(bx, by, cx, cy, ax, ay, reference);
    metric.v[2] = baryComponentPinned(bary, 2)
        ? 1.0f
        : normalizedDistanceToSegment(cx, cy, ax, ay, bx, by, reference);
    return metric;
}

float tileDepthAt(const Tile& t, float px, float py, float cx, float cy, float apexDepth) {
    if (std::fabs(apexDepth) <= 1e-7f) return 0.0f;
    const float boundary = distanceToBoundary(t, px, py);
    const float centerDist = std::sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    const float denom = boundary + centerDist;
    return denom > 1e-7f ? apexDepth * boundary / denom : 0.0f;
}

bool isSpectreCurveTile(const Tile& tile, Family family);

size_t spectreSourceTrianglesPerTile(const SpectreMeshDetail& detail) {
    const size_t sampleCount = static_cast<size_t>(kSpectreLogicalSides * std::max(1, detail.samplesPerSide));
    constexpr size_t reliefBandCount = 2u;
    const size_t capBandCount = static_cast<size_t>(std::max(1, detail.radialBands));
    return sampleCount * (2u * reliefBandCount + 2u * capBandCount - 1u);
}

SpectreMeshDetail spectreMeshDetailForTiles(const std::vector<Tile>& tiles, Family family) {
    if (family != Family::Spectre) return kSpectreMeshDetailCandidates[0];
    size_t spectreTileCount = 0;
    for (const Tile& tile : tiles) {
        if (isSpectreCurveTile(tile, family)) ++spectreTileCount;
    }
    if (spectreTileCount == 0) return kSpectreMeshDetailCandidates[0];
    const size_t maxSourceTriangles = kMaxFillVertexCount / 3u;
    for (const SpectreMeshDetail& detail : kSpectreMeshDetailCandidates) {
        if (spectreTileCount * spectreSourceTrianglesPerTile(detail) <= maxSourceTriangles) return detail;
    }
    return kSpectreMeshDetailCandidates[sizeof(kSpectreMeshDetailCandidates) / sizeof(kSpectreMeshDetailCandidates[0]) - 1u];
}

int clampQuadraticSubdivision(int requested, size_t sourceTriangleCount, size_t maxVertices) {
    if (sourceTriangleCount == 0) return requested;
    const double maxSub = std::floor(std::sqrt(static_cast<double>(maxVertices) / static_cast<double>(sourceTriangleCount * 3u)));
    return std::max(1, std::min(requested, static_cast<int>(std::max(1.0, maxSub))));
}

Point2 sourcePoint(const Tile& t, int index) {
    return { t.x[index], t.y[index] };
}

Point2 sourceLerp(Point2 a, Point2 b, float u) {
    return { a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u };
}

Point2 sourceEdgeInwardNormal(const Tile& t, int edge, bool ccw) {
    const int next = (edge + 1) % t.vcount;
    const float dx = t.x[next] - t.x[edge];
    const float dy = t.y[next] - t.y[edge];
    const float edgeLen = std::sqrt(dx * dx + dy * dy);
    if (edgeLen <= 1e-7f) return { 0.0f, 0.0f };
    return ccw
        ? Point2{ -dy / edgeLen, dx / edgeLen }
        : Point2{ dy / edgeLen, -dx / edgeLen };
}

Point2 sourceVertexInwardNormal(const Tile& t, int index, bool ccw) {
    const int prev = (index + t.vcount - 1) % t.vcount;
    const Point2 a = sourceEdgeInwardNormal(t, prev, ccw);
    const Point2 b = sourceEdgeInwardNormal(t, index, ccw);
    const float nx = a.x + b.x;
    const float ny = a.y + b.y;
    const float normalLen = std::sqrt(nx * nx + ny * ny);
    if (normalLen > 1e-7f) return { nx / normalLen, ny / normalLen };
    return b;
}

Point2 offsetSpectreRingPoint(const Tile& t, Point2 p, Point2 normal, Point2 center, float distance) {
    const float centerDx = center.x - p.x;
    const float centerDy = center.y - p.y;
    const float centerDistance = std::sqrt(centerDx * centerDx + centerDy * centerDy);
    if (centerDistance <= 1e-7f || distance <= 1e-7f) return p;
    const float normalLen = std::sqrt(normal.x * normal.x + normal.y * normal.y);
    if (normalLen <= 1e-7f) return sourceLerp(p, center, std::min(0.5f, distance / centerDistance));
    float step = std::min(distance, centerDistance * 0.48f);
    for (int attempt = 0; attempt < 4; ++attempt) {
        const Point2 candidate{ p.x + normal.x / normalLen * step, p.y + normal.y / normalLen * step };
        if (pointInPolygon(t, candidate.x, candidate.y)) return candidate;
        step *= 0.5f;
    }
    float u = std::min(0.48f, distance / centerDistance);
    for (int attempt = 0; attempt < 4; ++attempt) {
        const Point2 candidate = sourceLerp(p, center, u);
        if (pointInPolygon(t, candidate.x, candidate.y)) return candidate;
        u *= 0.5f;
    }
    return p;
}

void appendSourceTri(
    std::vector<SourceTri>& out,
    Point2 a,
    Point2 b,
    Point2 c,
    int p0,
    int p1,
    int p2
) {
    if (std::fabs(orient2(a.x, a.y, b.x, b.y, c.x, c.y)) <= 1e-12) return;
    out.push_back({ a.x, a.y, 0.0f, b.x, b.y, 0.0f, c.x, c.y, 0.0f, p0, p1, p2 });
}

double sourceDistanceSquared(Point2 a, Point2 b) {
    const double dx = static_cast<double>(b.x) - static_cast<double>(a.x);
    const double dy = static_cast<double>(b.y) - static_cast<double>(a.y);
    return dx * dx + dy * dy;
}

double sourceTriangleQuality(Point2 a, Point2 b, Point2 c) {
    const double area = std::fabs(orient2(a.x, a.y, b.x, b.y, c.x, c.y));
    if (area <= 1e-12) return -1.0;
    const double ab = sourceDistanceSquared(a, b);
    const double bc = sourceDistanceSquared(b, c);
    const double ca = sourceDistanceSquared(c, a);
    const double longest = std::max(std::max(ab, bc), std::max(ca, 1e-12));
    return area / longest;
}

bool splitSourceQuadOnBD(Point2 a, Point2 b, Point2 c, Point2 d, bool alternateTie) {
    const double acScore = std::min(
        sourceTriangleQuality(a, b, c),
        sourceTriangleQuality(a, c, d));
    const double bdScore = std::min(
        sourceTriangleQuality(a, b, d),
        sourceTriangleQuality(b, c, d));
    if (bdScore > acScore + 1e-12) return true;
    if (acScore > bdScore + 1e-12) return false;
    return alternateTie;
}

void appendSourceQuad(
    std::vector<SourceTri>& out,
    Point2 a,
    Point2 b,
    Point2 c,
    Point2 d,
    int pa,
    int pb,
    int pc,
    int pd,
    bool alternateTie
) {
    if (splitSourceQuadOnBD(a, b, c, d, alternateTie)) {
        appendSourceTri(out, a, b, d, pa, pb, pd);
        appendSourceTri(out, b, c, d, pb, pc, pd);
        return;
    }
    appendSourceTri(out, a, b, c, pa, pb, pc);
    appendSourceTri(out, a, c, d, pa, pc, pd);
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

std::vector<SourceTri> sourceTrianglesForSpectre(
    const Tile& t,
    Point2 center,
    const SpectreMeshDetail& detail
) {
    std::vector<SourceTri> out;
    if (t.vcount < 3) return out;
    const float reference = spectreReliefReference(t, center.x, center.y);
    const float edgeBand = std::max(reference * kSpectreEdgeFadeFraction, 1e-7f);
    const bool ccw = tileSignedArea(t) >= 0.0;
    constexpr float ringFractions[] = { 0.0f, 0.55f, 1.15f };
    std::vector<std::vector<Point2>> rings;
    rings.reserve(sizeof(ringFractions) / sizeof(ringFractions[0]));
    for (const float fraction : ringFractions) {
        std::vector<Point2> ring;
        ring.reserve(t.vcount);
        for (int i = 0; i < t.vcount; ++i) {
            const Point2 p = sourcePoint(t, i);
            if (fraction <= 0.0f) {
                ring.push_back(p);
            } else {
                ring.push_back(offsetSpectreRingPoint(
                    t,
                    p,
                    sourceVertexInwardNormal(t, i, ccw),
                    center,
                    edgeBand * fraction));
            }
        }
        rings.push_back(std::move(ring));
    }

    const int edgeCount = t.vcount;
    out.reserve(spectreSourceTrianglesPerTile(detail));
    for (int ringIndex = 0; ringIndex + 1 < static_cast<int>(rings.size()); ++ringIndex) {
        const std::vector<Point2>& outer = rings[ringIndex];
        const std::vector<Point2>& inner = rings[ringIndex + 1];
        for (int i = 0; i < edgeCount; ++i) {
            const int next = (i + 1) % edgeCount;
            if (ringIndex == 0) {
                appendSourceQuad(out, outer[i], outer[next], inner[next], inner[i], i, next, -1, -1, (ringIndex + i) % 2 == 1);
            } else {
                appendSourceQuad(out, outer[i], outer[next], inner[next], inner[i], -1, -1, -1, -1, (ringIndex + i) % 2 == 1);
            }
        }
    }

    const std::vector<Point2>& inner = rings.back();
    std::vector<std::vector<Point2>> capRings;
    const int capBands = std::max(1, detail.radialBands);
    capRings.reserve(static_cast<size_t>(capBands));
    for (int band = 1; band <= capBands; ++band) {
        const float u = std::sqrt(static_cast<float>(band) / static_cast<float>(capBands));
        std::vector<Point2> ring;
        ring.reserve(edgeCount);
        for (const Point2 p : inner) ring.push_back(sourceLerp(center, p, u));
        capRings.push_back(std::move(ring));
    }
    for (int ringIndex = 0; ringIndex < capBands; ++ringIndex) {
        const std::vector<Point2>& outer = capRings[ringIndex];
        const std::vector<Point2>* innerRing = ringIndex == 0 ? nullptr : &capRings[ringIndex - 1];
        const bool useCentralTriangulation = edgeCount <= kSpectreLogicalSides * 2;
        for (int i = 0; i < edgeCount; ++i) {
            const int next = (i + 1) % edgeCount;
            if (innerRing == nullptr) {
                if (useCentralTriangulation) {
                    const std::vector<TriIdx> central = triangulatePointPolygonByArea(outer);
                    if (!central.empty()) {
                        for (const TriIdx& tri : central) {
                            appendSourceTri(out, outer[tri.a], outer[tri.b], outer[tri.c], -1, -1, -1);
                        }
                        break;
                    }
                }
                appendSourceTri(out, center, outer[i], outer[next], -1, -1, -1);
            } else {
                appendSourceQuad(out, (*innerRing)[i], outer[i], outer[next], (*innerRing)[next], -1, -1, -1, -1, (ringIndex + i) % 2 == 1);
            }
        }
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

struct BorderTileEdge {
    std::vector<Point2> pts;
    bool visible = false;
};

int borderLogicalSideCount(const Tile& tile, Family family) {
    if (family == Family::Spectre
        && tile.vcount >= kSpectreLogicalSides
        && tile.vcount % kSpectreLogicalSides == 0) {
        return kSpectreLogicalSides;
    }
    return tile.vcount;
}

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

bool isSpectreCurveTile(const Tile& tile, Family family) {
    return family == Family::Spectre
        && tile.vcount >= kSpectreLogicalSides
        && tile.vcount % kSpectreLogicalSides == 0;
}

Point2 tilePoint(const Tile& tile, int index) {
    return { tile.x[index], tile.y[index] };
}

Point2 spectreAnchorPoint(const Tile& tile, int side) {
    const int stride = std::max(1, static_cast<int>(tile.vcount) / kSpectreLogicalSides);
    return tilePoint(tile, side * stride);
}

Point2 cubicPoint(Point2 p0, Point2 p1, Point2 p2, Point2 p3, float t) {
    const float u = 1.0f - t;
    const float uu = u * u;
    const float tt = t * t;
    return {
        uu * u * p0.x + 3.0f * uu * t * p1.x + 3.0f * u * tt * p2.x + tt * t * p3.x,
        uu * u * p0.y + 3.0f * uu * t * p1.y + 3.0f * u * tt * p2.y + tt * t * p3.y,
    };
}

Point2 spectreCurvePoint(const Tile& tile, int side, float t) {
    const Point2 start = spectreAnchorPoint(tile, side);
    const Point2 end = spectreAnchorPoint(tile, (side + 1) % kSpectreLogicalSides);
    const Point2 v = sub(end, start);
    const Point2 w{ -v.y, v.x };
    const float bulge = (side % 2 == 0) ? kSpectreCurveBulge : -kSpectreCurveBulge;
    const Point2 c1 = add(start, add(mul(v, 0.33f), mul(w, bulge)));
    const Point2 c2 = add(start, add(mul(v, 0.67f), mul(w, bulge)));
    return cubicPoint(start, c1, c2, end, t);
}

Point2 spectreKeyCenter(const Tile& tile) {
    constexpr int kKeyIndices[4] = { 4, 6, 8, 12 };
    Point2 sum{ 0.0f, 0.0f };
    for (const int index : kKeyIndices) sum = add(sum, spectreAnchorPoint(tile, index));
    return mul(sum, 0.25f);
}

Tile spectreFlattenedTile(const Tile& tile, Family family, int samplesPerSide) {
    if (!isSpectreCurveTile(tile, family)) return tile;
    const int samples = std::max(1, std::min(samplesPerSide, kMaxTileVerts / kSpectreLogicalSides));
    const int targetCount = samples * kSpectreLogicalSides;
    if (tile.vcount == targetCount && samples > 1) return tile;

    Tile out = tile;
    out.vcount = static_cast<uint8_t>(targetCount);
    int cursor = 0;
    for (int side = 0; side < kSpectreLogicalSides; ++side) {
        for (int sample = 0; sample < samples; ++sample) {
            const float t = static_cast<float>(sample) / static_cast<float>(samples);
            const Point2 p = spectreCurvePoint(tile, side, t);
            out.x[cursor] = p.x;
            out.y[cursor] = p.y;
            ++cursor;
        }
    }
    return out;
}

void appendSpectreLogicalEdges(const Tile& tile, std::vector<Edge>& out) {
    for (int side = 0; side < kSpectreLogicalSides; ++side) {
        const Point2 a = spectreAnchorPoint(tile, side);
        const Point2 b = spectreAnchorPoint(tile, (side + 1) % kSpectreLogicalSides);
        out.push_back({ a.x, a.y, b.x, b.y, EdgeKind::ChairEdge, tile.type });
    }
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

bool pointInTriangle(const std::vector<Point2>& pts, int p, int a, int b, int c, bool ccw) {
    const double ab = orient2(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[p].x, pts[p].y);
    const double bc = orient2(pts[b].x, pts[b].y, pts[c].x, pts[c].y, pts[p].x, pts[p].y);
    const double ca = orient2(pts[c].x, pts[c].y, pts[a].x, pts[a].y, pts[p].x, pts[p].y);
    constexpr double kEps = 1e-10;
    return ccw ? (ab >= -kEps && bc >= -kEps && ca >= -kEps)
               : (ab <=  kEps && bc <=  kEps && ca <=  kEps);
}

std::vector<TriIdx> triangulatePointPolygonByArea(const std::vector<Point2>& pts) {
    std::vector<TriIdx> out;
    if (pts.size() < 3) return out;
    if (pts.size() == 3) {
        out.push_back({0, 1, 2});
        return out;
    }
    const float area = signedArea(pts);
    if (std::fabs(area) <= 1e-12f) return out;
    const bool ccw = area > 0.0f;
    std::vector<int> remaining;
    remaining.reserve(pts.size());
    for (int i = 0; i < static_cast<int>(pts.size()); ++i) remaining.push_back(i);

    while (remaining.size() > 3) {
        int earAt = -1;
        double bestScore = 1e300;
        TriIdx best{ -1, -1, -1 };
        for (int i = 0; i < static_cast<int>(remaining.size()); ++i) {
            const int ia = remaining[(i + remaining.size() - 1) % remaining.size()];
            const int ib = remaining[i];
            const int ic = remaining[(i + 1) % remaining.size()];
            const double turn = orient2(pts[ia].x, pts[ia].y, pts[ib].x, pts[ib].y, pts[ic].x, pts[ic].y);
            if (ccw ? turn <= 1e-12 : turn >= -1e-12) continue;
            bool blocked = false;
            for (int idx : remaining) {
                if (idx == ia || idx == ib || idx == ic) continue;
                if (pointInTriangle(pts, idx, ia, ib, ic, ccw)) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
            const double score = std::fabs(turn);
            if (score < bestScore) {
                bestScore = score;
                earAt = i;
                best = { ia, ib, ic };
            }
        }
        if (earAt < 0) return {};
        out.push_back(best);
        remaining.erase(remaining.begin() + earAt);
    }
    out.push_back({remaining[0], remaining[1], remaining[2]});
    return out;
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
    for (const Tile& tile : tiles) {
        edgeCapacity += isSpectreCurveTile(tile, family)
            ? static_cast<size_t>(kSpectreLogicalSides)
            : static_cast<size_t>(tile.vcount);
    }
    edges.reserve(edgeCapacity);
    for (const Tile& tile : tiles) {
        if (isSpectreCurveTile(tile, family)) appendSpectreLogicalEdges(tile, edges);
        else if (tile.vcount == 3)            edgesPenrose(tile, edges);
        else                                  edgesChair(tile, edges);
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

void addTopologySide(
    std::unordered_map<EdgeKey, TopologyRec, EdgeKeyHash>& edgeMap,
    const Tile& tile,
    size_t tileIndex,
    float ax,
    float ay,
    float bx,
    float by,
    EdgeKind kind,
    float keyScale
) {
    const EdgeKey key = canonicalEdgeKey(ax, ay, bx, by, keyScale);
    edgeMap[key].sides.push_back(TopologySide{ tileIndex, tile.type, kind });
}

std::vector<float> relaxScalarField(
    const std::vector<float>& source,
    const std::vector<std::vector<size_t>>& neighbors,
    const std::vector<uint8_t>& boundary,
    int iterations
) {
    std::vector<float> current = source;
    std::vector<float> next(source.size(), 0.0f);
    for (int iteration = 0; iteration < iterations; ++iteration) {
        for (size_t i = 0; i < source.size(); ++i) {
            const std::vector<size_t>& list = neighbors[i];
            if (boundary[i] != 0u || list.empty()) {
                next[i] = source[i];
                continue;
            }
            float sum = 0.0f;
            for (size_t neighbor : list) sum += current[neighbor];
            next[i] = sum / static_cast<float>(list.size());
        }
        current.swap(next);
    }
    return current;
}

std::vector<float> tileTopologyRings(const std::vector<Tile>& tiles, Family family) {
    std::vector<TilePoint> centers(tiles.size(), TilePoint{ 0.0, 0.0 });
    std::vector<float> rings(tiles.size(), 0.0f);
    double maxTopologyX = 0.0;
    double maxTopologyY = 0.0;
    double maxTopologyR = 0.0;
    for (size_t tileIndex = 0; tileIndex < tiles.size(); ++tileIndex) {
        TilePoint center = tileAreaCentroid(tiles[tileIndex]);
        if (!std::isfinite(center.x) || !std::isfinite(center.y)) {
            center = TilePoint{ 0.0, 0.0 };
        }
        centers[tileIndex] = center;
        maxTopologyX = std::max(maxTopologyX, std::fabs(center.x));
        maxTopologyY = std::max(maxTopologyY, std::fabs(center.y));
        maxTopologyR = std::max(maxTopologyR, std::hypot(center.x, center.y));
    }

    const bool ringChebyshev = familyInfo(family).cls.ringChebyshev;
    for (size_t tileIndex = 0; tileIndex < tiles.size(); ++tileIndex) {
        const TilePoint center = centers[tileIndex];
        if (ringChebyshev) {
            const double x = maxTopologyX > 0.0 ? std::fabs(center.x) / maxTopologyX : 0.0;
            const double y = maxTopologyY > 0.0 ? std::fabs(center.y) / maxTopologyY : 0.0;
            rings[tileIndex] = static_cast<float>(std::clamp(std::max(x, y), 0.0, 1.0));
        } else {
            const double r = maxTopologyR > 0.0
                ? std::hypot(center.x, center.y) / maxTopologyR
                : 0.0;
            rings[tileIndex] = static_cast<float>(std::clamp(r, 0.0, 1.0));
        }
    }
    return rings;
}

std::vector<TopologyScalar> tileTopologyScalars(
    const std::vector<Tile>& tiles,
    Family family,
    float keyScale
) {
    std::unordered_map<EdgeKey, TopologyRec, EdgeKeyHash> edgeMap;
    size_t edgeCapacity = 0;
    for (const Tile& tile : tiles) {
        edgeCapacity += isSpectreCurveTile(tile, family)
            ? static_cast<size_t>(kSpectreLogicalSides)
            : static_cast<size_t>(tile.vcount);
    }
    edgeMap.reserve(edgeCapacity / 2 + 16);
    for (size_t tileIndex = 0; tileIndex < tiles.size(); ++tileIndex) {
        const Tile& tile = tiles[tileIndex];
        if (isSpectreCurveTile(tile, family)) {
            for (int side = 0; side < kSpectreLogicalSides; ++side) {
                const Point2 a = spectreAnchorPoint(tile, side);
                const Point2 b = spectreAnchorPoint(tile, (side + 1) % kSpectreLogicalSides);
                addTopologySide(edgeMap, tile, tileIndex, a.x, a.y, b.x, b.y, EdgeKind::ChairEdge, keyScale);
            }
        } else if (tile.vcount == 3) {
            addTopologySide(edgeMap, tile, tileIndex, tile.x[0], tile.y[0], tile.x[1], tile.y[1], EdgeKind::Leg, keyScale);
            addTopologySide(edgeMap, tile, tileIndex, tile.x[1], tile.y[1], tile.x[2], tile.y[2], EdgeKind::Leg, keyScale);
            addTopologySide(edgeMap, tile, tileIndex, tile.x[0], tile.y[0], tile.x[2], tile.y[2], EdgeKind::Base, keyScale);
        } else {
            for (int i = 0; i < tile.vcount; ++i) {
                const int j = (i + 1) % tile.vcount;
                addTopologySide(edgeMap, tile, tileIndex, tile.x[i], tile.y[i], tile.x[j], tile.y[j], EdgeKind::ChairEdge, keyScale);
            }
        }
    }

    std::vector<std::vector<uint8_t>> neighborTypes(tiles.size());
    std::vector<std::vector<size_t>> neighborIndices(tiles.size());
    for (const auto& kv : edgeMap) {
        const TopologyRec& rec = kv.second;
        if (rec.sides.size() < 2) continue;
        const bool hiddenSeam = rec.sides.size() == 2
            && rec.sides[0].tileType == rec.sides[1].tileType
            && hideSeam(family, rec.sides[0].kind, rec.sides[1].kind);
        if (hiddenSeam) continue;
        for (const TopologySide& side : rec.sides) {
            std::vector<uint8_t>& typeList = neighborTypes[side.tileIndex];
            std::vector<size_t>& indexList = neighborIndices[side.tileIndex];
            for (const TopologySide& other : rec.sides) {
                if (other.tileIndex == side.tileIndex) continue;
                bool alreadyNeighbor = false;
                for (size_t existing : indexList) {
                    if (existing == other.tileIndex) {
                        alreadyNeighbor = true;
                        break;
                    }
                }
                if (alreadyNeighbor) continue;
                typeList.push_back(other.tileType);
                indexList.push_back(other.tileIndex);
            }
        }
    }

    std::vector<float> source(tiles.size(), 0.0f);
    const std::vector<float> rings = tileTopologyRings(tiles, family);
    std::vector<uint8_t> boundary(tiles.size(), uint8_t{0});
    std::vector<TopologyScalar> out(tiles.size(), TopologyScalar{ 0.0f, 0.0f, 0.0f, 0.0f });
    for (size_t tileIndex = 0; tileIndex < tiles.size(); ++tileIndex) {
        std::vector<uint8_t>& list = neighborTypes[tileIndex];
        std::sort(list.begin(), list.end());
        const float maxDegree = std::max(1.0f, static_cast<float>(tiles[tileIndex].vcount));
        out[tileIndex].degree = std::clamp(static_cast<float>(list.size()) / maxDegree, 0.0f, 1.0f);
        boundary[tileIndex] = list.size() < static_cast<size_t>(tiles[tileIndex].vcount) ? uint8_t{1} : uint8_t{0};
        uint32_t hash = static_cast<uint32_t>(tiles[tileIndex].type + 1u) * 2166136261u;
        for (uint8_t type : list) {
            hash = (hash ^ static_cast<uint32_t>(type + 31u)) * 16777619u;
        }
        out[tileIndex].motif = static_cast<float>(hash % 997u) / 996.0f;
        source[tileIndex] = std::clamp(rings[tileIndex] * 0.62f + out[tileIndex].motif * 0.38f, 0.0f, 1.0f);
    }
    const std::vector<float> relaxed = relaxScalarField(source, neighborIndices, boundary, 28);
    const std::vector<float> biharmonic = relaxScalarField(relaxed, neighborIndices, boundary, 28);
    for (size_t tileIndex = 0; tileIndex < tiles.size(); ++tileIndex) {
        out[tileIndex].relaxed = relaxed[tileIndex];
        out[tileIndex].biharmonic = biharmonic[tileIndex];
    }
    return out;
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

float tileRadius(const Tile& tile, float cx, float cy) {
    if (tile.vcount <= 0) return 1.0f;
    double sum = 0.0;
    for (int i = 0; i < tile.vcount; ++i) {
        const double dx = static_cast<double>(tile.x[i]) - static_cast<double>(cx);
        const double dy = static_cast<double>(tile.y[i]) - static_cast<double>(cy);
        sum += std::sqrt(dx * dx + dy * dy);
    }
    return std::max(1e-6f, static_cast<float>(sum / static_cast<double>(tile.vcount)));
}

Bounds2 tileBounds(const std::vector<Tile>& tiles) {
    Bounds2 b{ 1e9f, 1e9f, -1e9f, -1e9f, 0.0f };
    for (const Tile& tile : tiles) {
        for (int i = 0; i < tile.vcount; ++i) {
            const float x = static_cast<float>(tile.x[i]);
            const float y = static_cast<float>(tile.y[i]);
            b.minX = std::min(b.minX, x);
            b.maxX = std::max(b.maxX, x);
            b.minY = std::min(b.minY, y);
            b.maxY = std::max(b.maxY, y);
            b.rSqMax = std::max(b.rSqMax, x * x + y * y);
        }
    }
    return b;
}

bool tileIntersectsWindow(const Tile& tile, float centerX, float centerY, float halfX, float halfY) {
    float minX = 1e9f, minY = 1e9f;
    float maxX = -1e9f, maxY = -1e9f;
    for (int i = 0; i < tile.vcount; ++i) {
        const float x = static_cast<float>(tile.x[i]);
        const float y = static_cast<float>(tile.y[i]);
        minX = std::min(minX, x);
        maxX = std::max(maxX, x);
        minY = std::min(minY, y);
        maxY = std::max(maxY, y);
    }
    return maxX >= centerX - halfX
        && minX <= centerX + halfX
        && maxY >= centerY - halfY
        && minY <= centerY + halfY;
}

WindowBounds windowBoundsForView(
    const Bounds2& fullBounds,
    const Settings& settings,
    const LiveView& view,
    float pagePanX,
    uint32_t surfaceWidth,
    uint32_t surfaceHeight,
    int screenWidth,
    int screenHeight,
    float marginRadius
) {
    const float surfW = surfaceWidth > 0 ? static_cast<float>(surfaceWidth) : 1080.0f;
    const float surfH = surfaceHeight > 0 ? static_cast<float>(surfaceHeight) : 1920.0f;
    const float screenW = screenWidth > 0 ? static_cast<float>(screenWidth) : surfW;
    const float screenH = screenHeight > 0 ? static_cast<float>(screenHeight) : surfH;
    const float aspect = screenW / std::max(screenH, 1.0f);
    const float gw = std::max(fullBounds.maxX - fullBounds.minX, 1e-3f);
    const float gh = std::max(fullBounds.maxY - fullBounds.minY, 1e-3f);
    const float baseScale = std::min(2.0f / gw, 2.0f / gh) * 0.95f;
    float sX = (aspect >= 1.0f ? baseScale / aspect : baseScale) * view.zoom;
    float sY = (aspect >= 1.0f ? baseScale          : baseScale * aspect) * view.zoom;
    sX *= screenW / surfW;
    sY *= screenH / surfH;
    sX = std::max(std::abs(sX), 1e-4f);
    sY = std::max(std::abs(sY), 1e-4f);

    const float activePagePanX = settings.panMode == 2 ? pagePanX : 0.0f;
    const float tX = ((view.panX + activePagePanX) / surfW) * 2.0f;
    const float tY = (view.panY / surfH) * 2.0f;
    const float cosR = std::cos(view.rotation);
    const float sinR = std::sin(view.rotation);
    const float centerX = (-tX * cosR - tY * sinR) / sX;
    const float centerY = ( tX * sinR - tY * cosR) / sY;
    const float halfX = (1.0f / sX) * 1.9f + marginRadius * 4.0f;
    const float halfY = (1.0f / sY) * 1.9f + marginRadius * 4.0f;
    return {
        centerX - halfX,
        centerX + halfX,
        centerY - halfY,
        centerY + halfY,
    };
}

std::vector<Tile> windowTilesForView(
    const std::vector<Tile>& fullTiles,
    const Bounds2& fullBounds,
    const Settings& settings,
    const LiveView& view,
    float pagePanX,
    uint32_t surfaceWidth,
    uint32_t surfaceHeight,
    int screenWidth,
    int screenHeight
) {
    if (settings.panMode == 0 || fullTiles.empty()) return fullTiles;
    const float meanRadius = averageTileRadius(fullTiles);
    const WindowBounds window = windowBoundsForView(
        fullBounds,
        settings,
        view,
        pagePanX,
        surfaceWidth,
        surfaceHeight,
        screenWidth,
        screenHeight,
        meanRadius);

    std::vector<Tile> windowed;
    windowed.reserve(fullTiles.size());
    const float centerX = (window.minX + window.maxX) * 0.5f;
    const float centerY = (window.minY + window.maxY) * 0.5f;
    const float halfX = (window.maxX - window.minX) * 0.5f;
    const float halfY = (window.maxY - window.minY) * 0.5f;
    for (const Tile& tile : fullTiles) {
        if (tileIntersectsWindow(tile, centerX, centerY, halfX, halfY)) {
            windowed.push_back(tile);
        }
    }
    return windowed.empty() ? fullTiles : windowed;
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
    borders.push_back({ a.x, a.y, sourceA.x, sourceA.y, 0.0f });
    borders.push_back({ b.x, b.y, sourceB.x, sourceB.y, 0.0f });
    borders.push_back({ c.x, c.y, sourceC.x, sourceC.y, 0.0f });
    indices.push_back(base + 0);
    indices.push_back(base + 1);
    indices.push_back(base + 2);
}

Point2 projectForBorder(Point2 p, const Settings& settings) {
    return settings.projection == Projection::PoincareDisk
        ? radialProject(p, std::max(settings.hypScale, 1e-3f))
        : p;
}

void pushSourceOverlayTri(
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices,
    Point2 a,
    Point2 b,
    Point2 c,
    float role,
    const Settings& settings
) {
    if (std::fabs(cross(sub(b, a), sub(c, a))) <= 1e-12f) return;
    const Point2 ga = projectForBorder(a, settings);
    const Point2 gb = projectForBorder(b, settings);
    const Point2 gc = projectForBorder(c, settings);
    const uint32_t base = static_cast<uint32_t>(borders.size());
    borders.push_back({ ga.x, ga.y, a.x, a.y, role });
    borders.push_back({ gb.x, gb.y, b.x, b.y, role });
    borders.push_back({ gc.x, gc.y, c.x, c.y, role });
    indices.push_back(base + 0);
    indices.push_back(base + 1);
    indices.push_back(base + 2);
}

void pushSourceOverlayStrip(
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices,
    Point2 a,
    Point2 b,
    float halfWidth,
    float role,
    const Settings& settings
) {
    const Point2 d = sub(b, a);
    const float l = len(d);
    if (l <= 1e-9f) return;
    const Point2 n{ -d.y / l * halfWidth, d.x / l * halfWidth };
    const Point2 p0 = add(a, n);
    const Point2 p1 = add(b, n);
    const Point2 p2 = sub(b, n);
    const Point2 p3 = sub(a, n);
    pushSourceOverlayTri(borders, indices, p0, p1, p2, role, settings);
    pushSourceOverlayTri(borders, indices, p0, p2, p3, role, settings);
}

void pushSourceOverlayPolyline(
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices,
    const std::vector<Point2>& points,
    float halfWidth,
    float role,
    const Settings& settings
) {
    for (size_t i = 0; i + 1 < points.size(); ++i) {
        pushSourceOverlayStrip(borders, indices, points[i], points[i + 1], halfWidth, role, settings);
    }
}

Point2 tileCentroidPoint(const Tile& tile) {
    const TilePoint c = tileAreaCentroid(tile);
    return { static_cast<float>(c.x), static_cast<float>(c.y) };
}

Point2 tileVertex(const Tile& tile, int index) {
    const int i = std::max(0, std::min(index, static_cast<int>(tile.vcount) - 1));
    return { tile.x[i], tile.y[i] };
}

constexpr float kOverlayGoldenRatio = 1.6180339887498948482f;

std::pair<float, float> shortAngleSpan(float thetaA, float thetaB) {
    const float lo = std::min(thetaA, thetaB);
    const float hi = std::max(thetaA, thetaB);
    constexpr float kPi = 3.14159265358979323846f;
    return std::fabs(hi - lo) < kPi
        ? std::pair<float, float>{ lo, hi }
        : std::pair<float, float>{ hi, lo + 2.0f * kPi };
}

std::vector<Point2> circleArc(Point2 center, float radius, Point2 startThrough, Point2 endThrough, int steps) {
    std::vector<Point2> points;
    const int n = std::max(2, steps);
    points.reserve(static_cast<size_t>(n + 1));
    const float a0 = std::atan2(startThrough.y - center.y, startThrough.x - center.x);
    const float a1 = std::atan2(endThrough.y - center.y, endThrough.x - center.x);
    const std::pair<float, float> span = shortAngleSpan(a0, a1);
    for (int i = 0; i <= n; ++i) {
        const float t = static_cast<float>(i) / static_cast<float>(n);
        const float a = span.first + (span.second - span.first) * t;
        points.push_back({ center.x + std::cos(a) * radius, center.y + std::sin(a) * radius });
    }
    return points;
}

Point2 tileOrientationForOverlay(const Tile& tile, Family family) {
    if (family == Family::D4Substitution) return d4Orientation(tile.type);
    const TilePoint c = tileAreaCentroid(tile);
    if (tile.vcount <= 0) return { 1.0f, 0.0f };
    Point2 best{ tile.x[0] - static_cast<float>(c.x), tile.y[0] - static_cast<float>(c.y) };
    float bestLen = dot(best, best);
    for (int i = 1; i < tile.vcount; ++i) {
        const Point2 candidate{ tile.x[i] - static_cast<float>(c.x), tile.y[i] - static_cast<float>(c.y) };
        const float candidateLen = dot(candidate, candidate);
        if (candidateLen > bestLen) {
            best = candidate;
            bestLen = candidateLen;
        }
    }
    return unit(best);
}

bool isAmmannBeenkerSquare(const Tile& tile) {
    if (tile.vcount != 4) return false;
    if (tile.type != uint8_t{1}) return false;
    float minLength = 1e30f;
    float maxLength = 0.0f;
    for (int i = 0; i < 4; ++i) {
        const int j = (i + 1) % 4;
        const float edgeLen = len(sub(tileVertex(tile, j), tileVertex(tile, i)));
        minLength = std::min(minLength, edgeLen);
        maxLength = std::max(maxLength, edgeLen);
    }
    return minLength > 1e-7f && maxLength / minLength <= 1.08f;
}

int beattyParity(int n) {
    const int value = static_cast<int>(std::floor(std::sqrt(2.0f) * (static_cast<float>(n) - 0.5f)));
    const int mod = value % 2;
    return mod < 0 ? mod + 2 : mod;
}

void appendRobinsonSourceOverlays(
    const std::vector<Tile>& tiles,
    const Settings& settings,
    float halfWidth,
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices
) {
    const float width = std::max(halfWidth * 0.85f, 1e-5f);
    for (const Tile& tile : tiles) {
        if (tile.vcount != 3) continue;
        const Point2 x = tileVertex(tile, 0);
        const Point2 y = tileVertex(tile, 1);
        const Point2 z = tileVertex(tile, 2);
        const float radius = len(sub(x, z));
        if (radius <= 1e-7f) continue;
        const bool acute = tile.type == uint8_t{1};
        const std::vector<Point2> red = acute
            ? circleArc(x, radius / kOverlayGoldenRatio, z, y, 12)
            : circleArc(y, radius / (kOverlayGoldenRatio * kOverlayGoldenRatio * kOverlayGoldenRatio), z, x, 12);
        const std::vector<Point2> blue = acute
            ? circleArc(y, radius, x, z, 12)
            : circleArc(x, radius / (kOverlayGoldenRatio * kOverlayGoldenRatio), y, z, 12);
        pushSourceOverlayPolyline(borders, indices, red, width, 1.0f, settings);
        pushSourceOverlayPolyline(borders, indices, blue, width, 2.0f, settings);
    }
}

void appendAmmannBeenkerSourceOverlays(
    const std::vector<Tile>& tiles,
    const Settings& settings,
    float halfWidth,
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices
) {
    const float width = std::max(halfWidth * 0.9f, 1e-5f);
    for (const Tile& tile : tiles) {
        if (!isAmmannBeenkerSquare(tile)) continue;
        const Point2 center = tileCentroidPoint(tile);
        Point2 orient = tileOrientationForOverlay(tile, settings.family);
        if (len(orient) <= 1e-7f) orient = { 1.0f, 0.0f };
        const Point2 side{ -orient.y, orient.x };
        float minLength = 1e30f;
        for (int i = 0; i < 4; ++i) {
            const int j = (i + 1) % 4;
            minLength = std::min(minLength, len(sub(tileVertex(tile, j), tileVertex(tile, i))));
        }
        const float step = std::max(minLength, 1e-6f);
        const int gx = static_cast<int>(std::lround(dot(center, orient) / step));
        const int gy = static_cast<int>(std::lround(dot(center, side) / step));
        const bool firstDiagonal = beattyParity(gx) == beattyParity(gy);
        const Point2 a = firstDiagonal ? tileVertex(tile, 0) : tileVertex(tile, 1);
        const Point2 b = firstDiagonal ? tileVertex(tile, 2) : tileVertex(tile, 3);
        pushSourceOverlayStrip(borders, indices, a, b, width, 3.0f, settings);
    }
}

void appendSourceOverlaysForTiles(
    const std::vector<Tile>& tiles,
    const Settings& settings,
    float halfWidth,
    std::vector<BorderVertex>& borders,
    std::vector<uint32_t>& indices
) {
    if (settings.ornamentStyle < 3.5f || settings.ornamentWidth <= 0.0f) return;
    if (settings.family == Family::P3 || settings.family == Family::P2) {
        appendRobinsonSourceOverlays(tiles, settings, halfWidth, borders, indices);
    } else if (settings.family == Family::AmmannBeenker) {
        appendAmmannBeenkerSourceOverlays(tiles, settings, halfWidth, borders, indices);
    }
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
    const int vertexCount = tile.vcount;
    const int k = borderLogicalSideCount(tile, settings.family);
    if (vertexCount < 2 || k < 2) return;
    const int samplesPerSide = vertexCount / k;
    if (samplesPerSide < 1) return;
    const bool spectreCurve = isSpectreCurveTile(visibilityTile, settings.family);

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
        const int first = e * samplesPerSide;
        const int next = ((e + 1) % k) * samplesPerSide;
        const Point2 a{ tile.x[first], tile.y[first] };
        const Point2 b{ tile.x[next], tile.y[next] };
        corners.push_back(a);
        chord.push_back(unit(sub(b, a)));
        BorderTileEdge edge{};
        edge.pts.reserve(static_cast<size_t>(samplesPerSide * subCount) + 1u);
        if (spectreCurve) {
            const Point2 sourceA = spectreAnchorPoint(visibilityTile, e);
            const Point2 sourceB = spectreAnchorPoint(visibilityTile, (e + 1) % kSpectreLogicalSides);
            edge.visible =
                visible.find(canonicalEdgeKey(sourceA.x, sourceA.y, sourceB.x, sourceB.y, keyScale)) != visible.end();
            const int curveSamples = std::max(subCount, kSpectreBorderSamplesPerSide);
            edge.pts.reserve(static_cast<size_t>(curveSamples) + 1u);
            for (int s = 0; s <= curveSamples; ++s) {
                const float t = static_cast<float>(s) / static_cast<float>(curveSamples);
                const Point2 source = spectreCurvePoint(visibilityTile, e, t);
                const Point2 p = settings.projection == Projection::PoincareDisk
                    ? radialProject(source, projectionScale)
                    : source;
                edge.pts.push_back(p);
            }
        } else {
            for (int segment = 0; segment < samplesPerSide; ++segment) {
                const int ia = (first + segment) % vertexCount;
                const int ib = (first + segment + 1) % vertexCount;
                const Point2 sourceA{ visibilityTile.x[ia], visibilityTile.y[ia] };
                const Point2 sourceB{ visibilityTile.x[ib], visibilityTile.y[ib] };
                const bool segmentVisible =
                    visible.find(canonicalEdgeKey(sourceA.x, sourceA.y, sourceB.x, sourceB.y, keyScale)) != visible.end();
                edge.visible = edge.visible || segmentVisible;
                for (int s = 0; s <= subCount; ++s) {
                    if (!edge.pts.empty() && s == 0) continue;
                    const float t = static_cast<float>(s) / static_cast<float>(subCount);
                    const Point2 source = lerp(sourceA, sourceB, t);
                    const Point2 p = settings.projection == Projection::PoincareDisk
                        ? radialProject(source, projectionScale)
                        : source;
                    edge.pts.push_back(p);
                }
            }
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
        const bool curvedSampledSide = spectreCurve || samplesPerSide > 1;
        const auto tangentAt = [&](float t) {
            const float s = std::clamp(
                t * static_cast<float>(last),
                0.0f,
                static_cast<float>(last) - 1.0e-6f);
            const int j = std::max(0, std::min(last - 1, static_cast<int>(std::floor(s))));
            return unit(sub(ep[j + 1], ep[j]));
        };
        const auto offsetAt = [&](float t) {
            const Point2 o = outerAt(t);
            const Point2 d = tangentAt(t);
            const Point2 n = ccw ? Point2{ -d.y, d.x } : Point2{ d.y, -d.x };
            return add(o, mul(n, h));
        };
        const Point2 baseStart = curvedSampledSide ? offsetAt(0.0f) : a0;
        const Point2 baseEnd = curvedSampledSide ? offsetAt(1.0f) : a1;
        const float gapZone = g > 0.0f && edgeLen > 0.0f ? std::min(0.45f, (h * 1.5f) / edgeLen) : 0.0f;
        const auto innerAt = [&](float t) {
            Point2 p = lerp(a0, a1, t);
            if (curvedSampledSide) {
                const Point2 base = offsetAt(t);
                p = add(base,
                        add(mul(sub(a0, baseStart), 1.0f - t),
                            mul(sub(a1, baseEnd), t)));
            }
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
    const bool sourceOverlayOn = settings.ornamentStyle >= 3.5f && settings.ornamentWidth > 0.0f
        && (settings.family == Family::P3 || settings.family == Family::P2 || settings.family == Family::AmmannBeenker);
    if (!settings.borderOn && !sourceOverlayOn) return;

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
    if (settings.borderOn && settings.borderWidth > 0.0f) {
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
    const float overlayHalfWidth = averageTileRadius(tiles)
        * std::clamp(settings.ornamentWidth, 0.0f, 1.0f)
        * 0.018f;
    appendSourceOverlaysForTiles(tiles, settings, overlayHalfWidth, borders, borderIndices);
}

} // namespace

// -----------------------------------------------------------------------------
// buildGeometry — Penrose / Chair tiles → fill verts + border quads.
// -----------------------------------------------------------------------------

bool Renderer::buildGeometry() {
    if (effectiveGeneration_ < settings_.generation) {
        effectiveGeneration_ = settings_.generation;
    }
    std::vector<Tile> fullTiles;
    Bounds2 fullBounds{};
    if (settings_.panMode != 0 && supportsWindowedGeneration(settings_.family)) {
        const std::vector<Tile> seedTiles = generate(settings_.family, settings_.seedIdx, 0);
        if (!seedTiles.empty()) {
            fullBounds = tileBounds(seedTiles);
            const WindowBounds activeWindow = windowBoundsForView(
                fullBounds,
                settings_,
                view_,
                pagePanX_,
                swapchainExtent_.width,
                swapchainExtent_.height,
                screenW_,
                screenH_,
                averageTileRadius(seedTiles));
            fullTiles = generateWindowed(settings_.family, settings_.seedIdx, effectiveGeneration_, activeWindow);
        }
    }
    if (fullTiles.empty()) {
        fullTiles = generate(settings_.family, settings_.seedIdx, effectiveGeneration_);
        if (!fullTiles.empty()) fullBounds = tileBounds(fullTiles);
    }
    if (fullTiles.empty()) { LOGE("buildGeometry: empty tile set"); return false; }
    std::vector<Tile> tiles = windowTilesForView(
        fullTiles,
        fullBounds,
        settings_,
        view_,
        pagePanX_,
        swapchainExtent_.width,
        swapchainExtent_.height,
        screenW_,
        screenH_);
    if (tiles.empty()) { LOGE("buildGeometry: empty tile set"); return false; }

    Classification cls = classify(tiles, settings_.family, settings_.colorMode, settings_.colorCount);
    constexpr float kTopologyKeyScale = 1.0e5f;
    const std::vector<TopologyScalar> topologyScalars = tileTopologyScalars(tiles, settings_.family, kTopologyKeyScale);
    const SpectreMeshDetail spectreDetail = spectreMeshDetailForTiles(tiles, settings_.family);
    const int requestedFillSub = (settings_.projection == Projection::PoincareDisk
                                  || settings_.family == Family::Spectre)
                                 ? settings_.hypFillSubdiv
                                 : 1;
    const size_t spectreSourceTriCount = settings_.family == Family::Spectre
        ? tiles.size() * spectreSourceTrianglesPerTile(spectreDetail)
        : 0u;
    const int fillSub = settings_.family == Family::Spectre
        ? clampQuadraticSubdivision(std::max(1, requestedFillSub), spectreSourceTriCount, kMaxFillVertexCount)
        : requestedFillSub;
    size_t plannedSpectreFillVertices = 0u;
    if (settings_.family == Family::Spectre) {
        const size_t fillSubSq = static_cast<size_t>(fillSub) * static_cast<size_t>(fillSub);
        const size_t verticesPerSource = fillSubSq * 3u;
        if (spectreSourceTriCount == 0u || spectreSourceTriCount > kMaxFillVertexCount / verticesPerSource) {
            const size_t requestedVertices = spectreSourceTriCount * verticesPerSource;
            LOGE("Spectre fill mesh exceeds vertex budget: %zu > %zu",
                 requestedVertices, kMaxFillVertexCount);
            return false;
        }
        plannedSpectreFillVertices = spectreSourceTriCount * verticesPerSource;
    }

    // -------- Fill vertices ---------------------------------------------------
    // Penrose tris -> 3 verts. Chair L -> fan from vert 0 (4 triangles).
    // Each vert also carries the tile centroid so the ripple shader can
    // phase the quasicrystal plane-wave sum per tile.
    std::vector<FillVertex> fills;
    fills.reserve(settings_.family == Family::Spectre ? plannedSpectreFillVertices : tiles.size() * 6);

    // One push site for the fill mesh — keeps the per-branch emit loops from
    // spelling out the full 14-float vertex. (bgx,bgy) is the triangle's
    // bulge-tilt direction; bary3 is the vertex's row of the edge-distance
    // basis; mat4 is the per-tile material identity. The latter two are
    // shared by all of a triangle's vertices.
    auto pushFill = [&fills](float x, float y, float colorSlot, float cx, float cy,
                             float bgx, float bgy, const float* bary3, const float* mat4,
                             const float* topology4, const float* edgeMetric3) {
        fills.push_back(FillVertex{ x, y, colorSlot, cx, cy, bgx, bgy,
                                    bary3[0], bary3[1], bary3[2],
                                    mat4[0], mat4[1], mat4[2], mat4[3],
                                    topology4[0], topology4[1], topology4[2], topology4[3],
                                    edgeMetric3[0], edgeMetric3[1], edgeMetric3[2] });
    };

    // Per-tile subdivision count for fill triangles in hyperbolic mode.
    // Each parent tri is split into N² child tris by a barycentric
    // (i,j,k) grid, with every child-vertex attribute computed by
    // linear interpolation from parent corners. Because bary, edge metric,
    // bulge, centroid and material are all interpolation-safe, the fragment
    // shader's bevel still falls only on parent boundary edges: pinned
    // bary components keep interior subdivision cuts away from zero.
    // Driven by Settings.hypFillSubdiv, separate from the border subdivision
    // because the costs are different shapes (N² vs N) — JNI already clamped
    // to [1, 8].
    auto emitFillTri = [&](float ax, float ay, float bx, float by,
                           float cx_v, float cy_v,
                           float paletteSlot, float ctrX, float ctrY,
                           float bgx, float bgy, const Bary3& bary, const float* mat,
                           const float* topology,
                           float edgeReference,
                           const Tile* spectreTile, float spectreReference) {
        Bary3 emittedBary = bary;
        const EdgeMetric3 edgeMetric = edgeMetricForTriangle(
            ax, ay,
            bx, by,
            cx_v, cy_v,
            bary,
            edgeReference);
        if (orient2(ax, ay, bx, by, cx_v, cy_v) < -1e-12) {
            std::swap(bx, cx_v);
            std::swap(by, cy_v);
            for (int c = 0; c < 3; ++c) std::swap(emittedBary.v[1][c], emittedBary.v[2][c]);
        }
        const auto pushVertex = [&](float vx, float vy, const float* baryRow) {
            float gx = bgx;
            float gy = bgy;
            if (spectreTile != nullptr) {
                const Point2 gradient = spectreReliefGradient(*spectreTile, vx, vy, spectreReference);
                gx = gradient.x;
                gy = gradient.y;
            }
            pushFill(vx, vy, paletteSlot, ctrX, ctrY, gx, gy, baryRow, mat, topology, edgeMetric.v);
        };
        if (fillSub <= 1) {
            pushVertex(ax,   ay,   emittedBary.v[0]);
            pushVertex(bx,   by,   emittedBary.v[1]);
            pushVertex(cx_v, cy_v, emittedBary.v[2]);
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
                vb[c] = fa * emittedBary.v[0][c] + fb * emittedBary.v[1][c] + fc * emittedBary.v[2][c];
            pushVertex(vx, vy, vb);
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

    for (size_t i = 0; i < tiles.size(); ++i) {
        const Tile& sourceTile = tiles[i];
        const Tile fillTile = spectreFlattenedTile(sourceTile, settings_.family, spectreDetail.samplesPerSide);
        const Tile& t = fillTile;
        const float paletteSlot = bucketToPaletteIdx(
            cls.bucket[i], cls.numBuckets, settings_.colorCount, settings_.colorSpread);
        const int vc = t.vcount;
        const bool spectreTile = settings_.family == Family::Spectre;
        const TilePoint areaCenter = tileAreaCentroid(t);
        const Point2 center = spectreTile
            ? spectreKeyCenter(sourceTile)
            : Point2{ static_cast<float>(areaCenter.x), static_cast<float>(areaCenter.y) };
        const float cx = center.x;
        const float cy = center.y;
        // Parallax depth shading. type 0 bulges toward the viewer (+1),
        // every other type recedes (-1); the depthAmount slider scales the
        // effect in the fragment shader. The bulge sits on one vertex for a
        // triangle, along the long diagonal for a rhomb, and at the centre
        // for a P1 tile, so every family but the flat Chair reads as 3-D.
        const FamilyInfo& fi = familyInfo(settings_.family);
        const float dsign = (sourceTile.type == 0) ? +1.0f : -1.0f;

        // Per-tile material identity (location 5, see render_state.h):
        // type normalised over the family's distinct kinds, the unit
        // direction of the classifier edge as orientation, and approximate
        // tile scale. Spectre uses its canonical key-center/frame instead
        // of the flattened curved polygon's area centroid.
        const ClassSpec& cs = fi.cls;
        const int typeBuckets = typeBucketCount(tiles, settings_.family, cs);
        const float typeNorm = (typeBuckets > 1)
            ? static_cast<float>(sourceTile.type) / static_cast<float>(typeBuckets - 1)
            : 0.0f;
        const Point2 d4Orient = settings_.family == Family::D4Substitution
            ? d4Orientation(sourceTile.type)
            : Point2{ 1.0f, 0.0f };
        const Point2 orientA = spectreTile
            ? spectreAnchorPoint(sourceTile, 1)
            : Point2{ sourceTile.x[cs.angA], sourceTile.y[cs.angA] };
        const Point2 orientB = spectreTile
            ? spectreAnchorPoint(sourceTile, 2)
            : Point2{ sourceTile.x[cs.angB], sourceTile.y[cs.angB] };
        const float odx  = orientB.x - orientA.x;
        const float ody  = orientB.y - orientA.y;
        const float olen = std::sqrt(odx * odx + ody * ody);
        const float ocos = settings_.family == Family::D4Substitution
            ? d4Orient.x
            : ((olen > 1e-6f) ? odx / olen : 1.0f);
        const float osin = settings_.family == Family::D4Substitution
            ? d4Orient.y
            : ((olen > 1e-6f) ? ody / olen : 0.0f);
        const float tileScale = std::max(tileRadius(t, cx, cy), 1e-6f);
        const float edgeReference = tileScale;
        const float mat[4] = { typeNorm, ocos, osin, tileScale };
        const TopologyScalar topologyScalar = topologyScalars[i];
        const float topology[4] = {
            topologyScalar.degree,
            topologyScalar.motif,
            topologyScalar.relaxed,
            topologyScalar.biharmonic,
        };

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
                        paletteSlot, cx, cy, bgx, bgy, bary, mat, topology,
                        edgeReference, nullptr, 1.0f);
        } else if (fi.centroidFan) {
            // Center-depth polygons: use the area centroid as the material
            // center and relief apex, but only use a centroid fan when that fan
            // is actually contained in the tile. Concave monotiles/spirals that
            // are not star-shaped are ear-triangulated. Curved Spectres use
            // edge-conforming relief rings plus equal-area radial cap rings,
            // avoiding centroid/ear fan normals while keeping the center cap.
            const float cd = fi.depthParallax ? dsign : 0.0f;
            const std::vector<SourceTri> sources = spectreTile
                ? sourceTrianglesForSpectre(t, center, spectreDetail)
                : sourceTrianglesForCenterDepth(t, cx, cy, cd);
            if (sources.empty()) {
                LOGE("failed to triangulate tile family=%d type=%u vertices=%u",
                     static_cast<int>(settings_.family), static_cast<unsigned>(t.type),
                     static_cast<unsigned>(t.vcount));
                return false;
            }
            const float spectreReference = spectreTile
                ? spectreReliefReference(t, cx, cy)
                : 1.0f;
            for (const SourceTri& tri : sources) {
                const Bary3 bary = computeBary(vc, tri.p0, tri.p1, tri.p2);
                float bgx, bgy;
                if (spectreTile) {
                    bgx = 0.0f;
                    bgy = 0.0f;
                } else {
                    bulgeDir(tri.x0, tri.y0, tri.x1, tri.y1, tri.x2, tri.y2,
                             tri.z0, tri.z1, tri.z2, bgx, bgy);
                }
                emitFillTri(tri.x0, tri.y0, tri.x1, tri.y1, tri.x2, tri.y2,
                            paletteSlot, cx, cy, bgx, bgy, bary, mat, topology,
                            edgeReference, spectreTile ? &t : nullptr, spectreReference);
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
                            paletteSlot, cx, cy, bgx, bgy, bary, mat, topology,
                            edgeReference, nullptr, 1.0f);
            }
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
    geomMinX_ = fullBounds.minX; geomMaxX_ = fullBounds.maxX;
    geomMinY_ = fullBounds.minY; geomMaxY_ = fullBounds.maxY;
    geomRmax_ = std::sqrt(fullBounds.rSqMax);
    geometryViewPanX_ = view_.panX;
    geometryViewPanY_ = view_.panY;
    geometryPagePanX_ = pagePanX_;
    geometryPagePanValid_ = true;

    LOGI("geom: %zu/%zu tiles, %u fillVerts, %u borderIdx, bounds [%.3f,%.3f]-[%.3f,%.3f]",
         currentTiles_.size(), fullTiles.size(), fillVertexCount_, borderIndexCount_,
         geomMinX_, geomMinY_, geomMaxX_, geomMaxY_);
    return true;
}

bool Renderer::buildBorderGeometry() {
    if (currentTiles_.empty()) {
        std::vector<Tile> fullTiles = generate(settings_.family, settings_.seedIdx, effectiveGeneration_);
        if (fullTiles.empty()) { LOGE("buildBorderGeometry: empty tile set"); return false; }
        const Bounds2 fullBounds = tileBounds(fullTiles);
        currentTiles_ = windowTilesForView(
            fullTiles,
            fullBounds,
            settings_,
            view_,
            pagePanX_,
            swapchainExtent_.width,
            swapchainExtent_.height,
            screenW_,
            screenH_);
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
                                  settings_.customOklch, settings_.colorSpectral);
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
    ubo.flags[1] = static_cast<uint32_t>(std::clamp(settings_.colorCount, 1, kMaxColors));
    ubo.flags[2] = 0;
    ubo.flags[3] = 0;

    // Ripple animation. The shader gates trig on `anim.y > 0` so a zero
    // amount short-circuits the wave math for every tile.
    ubo.anim[0] = time_;
    ubo.anim[1] = settings_.rippleAmount;
    ubo.anim[2] = static_cast<float>(familyInfo(settings_.family).waveSymmetry);
    ubo.anim[3] = pageOffset_;

    // Border width stays baked into tile-local ring vertices. Reuse this row
    // for the optional fill-surface edge profile so the mesh border contract
    // and shared UBO layout stay stable.
    ubo.borderGeom[0] = settings_.edgeProfileWidth;
    ubo.borderGeom[1] = settings_.edgeProfileGlow;
    ubo.borderGeom[2] = 0.0f;
    ubo.borderGeom[3] = 0.0f;

    ubo.effects[0] = settings_.brightness;
    ubo.effects[1] = settings_.depthAmount;
    ubo.effects[2] = settings_.rippleSpeed;
    ubo.effects[3] = static_cast<float>(settings_.rippleKind);

    ubo.ornament[0] = settings_.ornamentStyle;
    ubo.ornament[1] = settings_.ornamentAmount;
    ubo.ornament[2] = settings_.ornamentWidth;
    ubo.ornament[3] = settings_.ornamentPhase;
    ubo.ornamentExtra[0] = settings_.ornamentDensity;
    ubo.ornamentExtra[1] = settings_.ornamentTwist;
    ubo.ornamentExtra[2] = 0.0f;
    ubo.ornamentExtra[3] = 0.0f;
    ShaderColor contourColor = enc(settings_.surfaceContourColor, 1.0f);
    ubo.contour[0] = settings_.surfaceContourAmount;
    ubo.contour[1] = settings_.surfaceContourSource;
    ubo.contour[2] = settings_.surfaceContourSpacing;
    ubo.contour[3] = settings_.surfaceContourWidth;
    ubo.contourColor[0] = settings_.surfaceContourPhase;
    ubo.contourColor[1] = contourColor.r;
    ubo.contourColor[2] = contourColor.g;
    ubo.contourColor[3] = contourColor.b;
    const float markAlpha = sourceOverlayAlpha(
        settings_.ornamentStyle, settings_.ornamentAmount, settings_.ornamentDensity);
    const ShaderColor markA = enc(settings_.sourceMarkA, markAlpha);
    const ShaderColor markB = enc(settings_.sourceMarkB, markAlpha);
    const ShaderColor markC = enc(settings_.sourceMarkC, markAlpha);
    const ShaderColor edgeProfile = enc(settings_.edgeProfileColor, 1.0f);
    ubo.sourceMarkA[0] = markA.r; ubo.sourceMarkA[1] = markA.g;
    ubo.sourceMarkA[2] = markA.b; ubo.sourceMarkA[3] = markA.a;
    ubo.sourceMarkB[0] = markB.r; ubo.sourceMarkB[1] = markB.g;
    ubo.sourceMarkB[2] = markB.b; ubo.sourceMarkB[3] = markB.a;
    ubo.sourceMarkC[0] = markC.r; ubo.sourceMarkC[1] = markC.g;
    ubo.sourceMarkC[2] = markC.b; ubo.sourceMarkC[3] = markC.a;
    ubo.edgeProfileColor[0] = edgeProfile.r; ubo.edgeProfileColor[1] = edgeProfile.g;
    ubo.edgeProfileColor[2] = edgeProfile.b; ubo.edgeProfileColor[3] = 0.0f;

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
    applyLightChoreography(m, settings_.lightAngle, settings_.lightElevation,
                           settings_.lightIntensity, settings_.lightWarmth,
                           settings_.lightAmbient, settings_.lightChoreoAmount,
                           settings_.lightChoreoSpeed, settings_.lightChoreoSource,
                           time_, pageOffset_, audio.beat, audio.beatPhase,
                           audio.cwtTransient, settings_.clockWaveform);
    writeMaterialRows(&ubo.matNormal[0], m);

    for (void* mapped : paletteUboMapped_) {
        if (mapped) std::memcpy(mapped, &ubo, sizeof(ubo));
    }
}

} // namespace penrose
