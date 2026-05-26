// Renderer geometry pipeline: build the fill triangles and the
// vertex-shader-expanded border-edge quads from the current Settings,
// upload them to GPU buffers, and refresh the palette UBO.
//
// Owns the file-internal edge-deduplication structs and the world-space
// border-width constant. Everything else (Vulkan resource handles,
// Settings, view state) lives on the Renderer struct in renderer.h.

#include "renderer/renderer.h"

#include "color/color.h"
#include "log.h"
#include "renderer/render_state.h"
#include "tiling/penrose.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace penrose {

namespace {

// World-space half-width per unit of slider value. The slider stores
// 0..600 and Kotlin maps it to 0..6; multiplied here, that yields
// half-widths in roughly the 0..0.030 world-unit range at the gen-6
// reference scale. updatePaletteUbo applies the per-generation
// deflation factor on top.
constexpr float kBorderWidthScale = 0.005f;

// Edge-dedup map record. Each unique edge midpoint is hit by up to two
// tiles; we record both kinds so hideSeam can decide whether the seam
// is internal-to-rhombus (drop) or perimeter (keep).
struct EdgeRec {
    float    p1x, p1y, p2x, p2y;
    uint8_t  t1, t2;
    EdgeKind k1, k2;
    bool     secondSet;
};

struct EdgeKey {
    int32_t mx, my;
    bool operator==(const EdgeKey& o) const { return mx == o.mx && my == o.my; }
};

struct EdgeKeyHash {
    size_t operator()(const EdgeKey& k) const noexcept {
        const uint64_t a = static_cast<uint32_t>(k.mx);
        const uint64_t b = static_cast<uint32_t>(k.my);
        return std::hash<uint64_t>{}(a * 0x9E3779B97F4A7C15ULL + b);
    }
};

// Edge-distance barycentric basis for one emitted triangle. p0/p1/p2 are
// the tile-polygon vertex indices of the triangle's three corners, or -1
// for the centroid of a centroid-fan. A triangle edge is a real tile
// boundary only when both its endpoints are polygon vertices adjacent on
// the tile perimeter; interior fan / centroid-spoke edges get their
// barycentric component pinned to 1 at every vertex so the fragment
// shader's min(bary) never dips to 0 along a seam that is not a tile edge.
struct Bary3 { float v[3][3]; };

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

inline bool hideSeam(Family fam, EdgeKind k1, EdgeKind k2) {
    switch (familyInfo(fam).hideSeamMode) {
        case 1:  return k1 == EdgeKind::Base && k2 == EdgeKind::Base;  // P3
        case 2:  return k1 == EdgeKind::Leg  && k2 == EdgeKind::Leg;   // P2
        default: return false;
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
    auto tiles = generate(settings_.family, settings_.seedIdx, effectiveGeneration_);
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
        float sx = 0.0f, sy = 0.0f;
        for (int v = 0; v < vc; ++v) { sx += t.x[v]; sy += t.y[v]; }
        const float cx = sx / static_cast<float>(vc);
        const float cy = sy / static_cast<float>(vc);
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
        const float typeNorm = (cs.typeBuckets > 1)
            ? static_cast<float>(t.type) / static_cast<float>(cs.typeBuckets - 1)
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
            // Concave polygons (P1 star / boat) — fan from the centroid so
            // the triangulation stays inside a star-shaped tile. The
            // centroid carries the bulge, so each tile reads as a shallow
            // dome (type 0 = pentagon) or dimple.
            const float cd = fi.depthParallax ? dsign : 0.0f;
            for (int v = 0; v < vc; ++v) {
                const int w = (v + 1) % vc;
                // Corners: centroid (-1), polygon vertex v, polygon vertex w.
                const Bary3 bary = computeBary(vc, -1, v, w);
                float bgx, bgy;
                bulgeDir(cx, cy, t.x[v], t.y[v], t.x[w], t.y[w],
                         cd, 0.0f, 0.0f, bgx, bgy);
                emitFillTri(cx, cy, t.x[v], t.y[v], t.x[w], t.y[w],
                            paletteIdx, cx, cy, bgx, bgy, bary, mat);
            }
        } else {
            // Convex polygons fanned from vertex 0. A rhomb (the de Bruijn
            // and binary families) carries the bulge along its long
            // diagonal — the ridge of the Penrose rhombus generalised. The
            // Chair L-tromino has no depth axis and stays flat.
            float depth[12] = { 0.0f };
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
    fillVertexCount_ = static_cast<uint32_t>(fills.size());
    geomMinX_ = minX; geomMaxX_ = maxX;
    geomMinY_ = minY; geomMaxY_ = maxY;
    geomRmax_ = std::sqrt(rSqMax);

    // -------- Border geometry: indexed triangle quads -----------------------
    // For each unique edge (dedup via midpoint hash, honouring hideSeam) we
    // emit 4 verts + 6 indices. The vertex shader expands each quad by
    // ± borderHalfWidth along the edge normal, so the slider yields a real
    // world-space thickness.
    std::vector<BorderVertex> borders;
    std::vector<uint32_t>     borderIndices;
    if (settings_.borderOn) {
        std::vector<Edge> edges;
        const Family fam = settings_.family;
        const int edgesPerTile =
            (fam == Family::Chair || fam == Family::P1) ? 6 :
            (fam == Family::Dodecagonal  ||
             fam == Family::AmmannBeenker ||
             fam == Family::Heptagonal    ||
             fam == Family::Binary)         ? 4 : 3;
        edges.reserve(tiles.size() * edgesPerTile);
        for (const Tile& t : tiles) {
            if (t.vcount == 3) edgesPenrose(t, edges);
            else               edgesChair(t, edges);
        }

        // In Poincaré-disk projection, straight world-space edges map to
        // straight clip-space chords (the shader projects per-vertex,
        // clip-space interpolation is linear). Splitting each edge into
        // hypBorderSubdiv sub-segments before the dedup map sees them
        // gives a polyline that approximates the true hyperbolic
        // geodesic arc; the dedup map keeps a sub-segment's two
        // endpoints shared with the adjacent tile's matching
        // sub-segment, so the border still draws once per shared edge.
        const int sub = (settings_.projection == Projection::PoincareDisk)
                        ? settings_.hypBorderSubdiv : 1;
        if (sub > 1) {
            std::vector<Edge> tess;
            tess.reserve(edges.size() * sub);
            for (const Edge& e : edges) {
                const float dx = e.p2x - e.p1x;
                const float dy = e.p2y - e.p1y;
                float prevX = e.p1x, prevY = e.p1y;
                for (int k = 1; k <= sub; ++k) {
                    const float t = static_cast<float>(k) / static_cast<float>(sub);
                    const float curX = e.p1x + dx * t;
                    const float curY = e.p1y + dy * t;
                    tess.push_back(Edge{ prevX, prevY, curX, curY, e.kind, e.tileType });
                    prevX = curX; prevY = curY;
                }
            }
            edges = std::move(tess);
        }

        std::unordered_map<EdgeKey, EdgeRec, EdgeKeyHash> edgeMap;
        edgeMap.reserve(edges.size() / 2 + 16);
        constexpr float kKeyScale = 1.0e5f;
        for (const Edge& e : edges) {
            const float mx = (e.p1x + e.p2x) * 0.5f;
            const float my = (e.p1y + e.p2y) * 0.5f;
            EdgeKey key{ static_cast<int32_t>(std::lround(mx * kKeyScale)),
                         static_cast<int32_t>(std::lround(my * kKeyScale)) };
            auto it = edgeMap.find(key);
            if (it == edgeMap.end()) {
                EdgeRec r{ e.p1x, e.p1y, e.p2x, e.p2y,
                           e.tileType, uint8_t{0},
                           e.kind, EdgeKind::Leg, false };
                edgeMap.emplace(key, r);
            } else {
                it->second.t2 = e.tileType;
                it->second.k2 = e.kind;
                it->second.secondSet = true;
            }
        }
        // -------- Miter joinery pre-pass ---------------------------------
        // The naive emit (two endpoints sharing the edge's perpendicular
        // normal) gives perpendicular butt ends that overlap on one side
        // and gap on the other wherever a vertex's interior angle isn't
        // 90° — visible cog-pattern on every Penrose star vertex.
        //
        // The fix is the same carpentry trick the Canonical-Surface rib
        // renderer uses: at each shared endpoint find the angularly-
        // adjacent edges, compute the bisector of their per-edge normals,
        // extrude along the bisector at length halfWidth / |cos(θ/2)| so
        // adjacent ribbons meet flush on both sides. Clamp the miter
        // length at kMiterLimit × halfWidth so a near-degenerate acute
        // joint can't fire a spike off into space.
        //
        // Planar-graph subtlety: a Penrose vertex may have 2..7 edges
        // meeting at it (sun, star, ace, ...). We sort the incident edges
        // by tangent angle around the vertex and, for each edge end,
        // miter the +1 side with the CCW-adjacent neighbour and the -1
        // side with the CW-adjacent neighbour. Two collinear sub-segments
        // of the same parent edge (the disk-mode subdivision case) give
        // a near-180° joint where the bisector matches the edge normal
        // and miterScale ≈ 1 — i.e. no change vs. butt, which is correct.
        //
        // The same midpoint hash used for edge dedup is too coarse here
        // (it keys on midpoint, not endpoint); we build a separate
        // endpoint hash over the kept edges.
        std::vector<const EdgeRec*> keptEdges;
        keptEdges.reserve(edgeMap.size());
        for (const auto& kv : edgeMap) {
            const EdgeRec& r = kv.second;
            if (r.secondSet && r.t1 == r.t2 && hideSeam(settings_.family, r.k1, r.k2)) continue;
            const float dx = r.p2x - r.p1x;
            const float dy = r.p2y - r.p1y;
            if ((dx * dx + dy * dy) < 1e-12f) continue;
            keptEdges.push_back(&r);
        }
        // Per-edge cached tangent — computed once, reused twice (once
        // per endpoint when computing each end's miter).
        struct EdgeGeom { float tx, ty; };
        std::vector<EdgeGeom> egeom(keptEdges.size());
        for (size_t i = 0; i < keptEdges.size(); ++i) {
            const EdgeRec& r = *keptEdges[i];
            const float dx = r.p2x - r.p1x;
            const float dy = r.p2y - r.p1y;
            const float inv = 1.0f / std::sqrt(dx * dx + dy * dy);
            egeom[i].tx = dx * inv;
            egeom[i].ty = dy * inv;
        }
        // Endpoint hash. For each shared endpoint we collect (edge_idx,
        // end (0=p1, 1=p2), outward-tangent-angle) entries; we'll sort
        // by angle to find each entry's CCW + CW neighbours.
        struct EndRef {
            uint32_t edgeIdx;
            uint8_t  end;     // 0 = p1, 1 = p2
            float    angle;   // atan2 of outward tangent at this endpoint
        };
        // Precision note: each kept edge's endpoint coords come from
        // whichever tile contributed that edge first in the midpoint
        // dedup above. Two tiles sharing a vertex compute it through
        // independent substitution chains; at the default gen 6 on a
        // ±20-world-unit patch, FP drift between the two tiles'
        // computations of the SAME vertex accumulates to ~1e-5 world
        // units — right at the rounding threshold of the dedup's
        // kKeyScale=1e5. The midpoint dedup tolerated this because
        // averaging halves the per-tile error; the endpoint hash gets
        // the raw per-tile coords and would put "same" vertices into
        // DIFFERENT buckets at 1e-5 precision. findNeighbour then
        // returns nullptr for everyone and the miter falls back to
        // butt at every joint — silently regressing the entire fix.
        //
        // A coarser endpoint scale (1e3 = 0.001 world units) is 100×
        // the worst-case FP drift and well below the smallest tile
        // edge length at any reasonable generation (~0.05 world units
        // at gen 6, shrinking by phi per gen so still ~0.005 at gen
        // 10). Safe clustering for shared vertices, no false-merge of
        // truly distinct vertices.
        constexpr float kEndpointKeyScale = 1.0e3f;
        std::unordered_map<EdgeKey, std::vector<EndRef>, EdgeKeyHash> endHash;
        endHash.reserve(keptEdges.size());
        auto endpointKey = [&](float x, float y) {
            return EdgeKey{ static_cast<int32_t>(std::lround(x * kEndpointKeyScale)),
                            static_cast<int32_t>(std::lround(y * kEndpointKeyScale)) };
        };
        for (uint32_t i = 0; i < keptEdges.size(); ++i) {
            const EdgeRec& r = *keptEdges[i];
            const EdgeGeom& g = egeom[i];
            // Outward tangent at p1 points TOWARD p2 → (+tx,+ty).
            // Outward tangent at p2 points TOWARD p1 → (-tx,-ty).
            endHash[endpointKey(r.p1x, r.p1y)].push_back(
                EndRef{ i, 0, std::atan2( g.ty,  g.tx) });
            endHash[endpointKey(r.p2x, r.p2y)].push_back(
                EndRef{ i, 1, std::atan2(-g.ty, -g.tx) });
        }
        // Sort each endpoint's incident list by angle once so the
        // per-corner CCW / CW neighbour lookup is O(log n) (and n ≤ 7
        // in practice, so this is functionally O(1)).
        for (auto& kv : endHash) {
            auto& v = kv.second;
            std::sort(v.begin(), v.end(),
                      [](const EndRef& a, const EndRef& b) { return a.angle < b.angle; });
        }
        // Miter computation for one corner. `tSelf` is the OUTWARD
        // tangent of THIS edge at this endpoint (away from the vertex);
        // `tNbr` is the OUTWARD tangent of the angular neighbour at the
        // same endpoint. `sideSign` picks which angular wedge to bisect.
        // Returns the EXTRUSION DIRECTION (already signed for the
        // chosen wedge) and the half-width multiplier.
        constexpr float kMiterLimit = 4.0f;
        auto computeMiter = [](float tSelfX, float tSelfY,
                               float tNbrX,  float tNbrY,
                               float sideSign) -> std::array<float, 3> {
            // Polyline-style bisector: treat the neighbour as feeding
            // INTO the vertex (incoming direction = -tNbr) and our edge
            // as leaving the vertex (outgoing direction = tSelf). The
            // perpendiculars (90°-CCW = "polyline-left") sum to the
            // bisector; by symmetry both edges sharing this corner
            // compute the same point and join flush.
            const float n0x =  tNbrY;     // perp(-tNbr) = ( tNbr.y, -tNbr.x)
            const float n0y = -tNbrX;
            const float n1x = -tSelfY;    // perp( tSelf) = (-tSelf.y, tSelf.x)
            const float n1y =  tSelfX;
            // sideSign flips the bisector into the wedge we want.
            const float n0Sx = n0x * sideSign;
            const float n0Sy = n0y * sideSign;
            const float n1Sx = n1x * sideSign;
            const float n1Sy = n1y * sideSign;
            float mx = n0Sx + n1Sx;
            float my = n0Sy + n1Sy;
            const float mLen = std::sqrt(mx * mx + my * my);
            if (mLen < 1e-4f) {
                // Near-anti-parallel pair (~180° interior angle): the
                // bisector cancels. Use the local perpendicular at scale 1.
                return { n1Sx, n1Sy, 1.0f };
            }
            mx /= mLen;
            my /= mLen;
            const float dot = std::fabs(mx * n1Sx + my * n1Sy);
            float scale = (dot > 1e-3f) ? (1.0f / dot) : kMiterLimit;
            if (scale > kMiterLimit) scale = kMiterLimit;
            if (scale < 1.0f)        scale = 1.0f;
            return { mx, my, scale };
        };
        // Look up the angular neighbour of (edgeIdx, end) on the given
        // angular side. Returns nullptr when the vertex has only this
        // one edge (boundary case → butt end, no miter).
        auto findNeighbour = [&endHash](EdgeKey key, uint32_t edgeIdx,
                                        uint8_t end, int angularOffset)
                              -> const EndRef* {
            auto it = endHash.find(key);
            if (it == endHash.end()) return nullptr;
            const auto& list = it->second;
            if (list.size() < 2) return nullptr;
            int selfIdx = -1;
            for (int j = 0; j < static_cast<int>(list.size()); ++j) {
                if (list[j].edgeIdx == edgeIdx && list[j].end == end) {
                    selfIdx = j;
                    break;
                }
            }
            if (selfIdx < 0) return nullptr;
            const int n = static_cast<int>(list.size());
            const int nbr = ((selfIdx + angularOffset) % n + n) % n;
            return &list[nbr];
        };
        // -------- Emit border quads with per-corner miter ----------------
        // We compute a "world side" miter at each of the 4 corners of an
        // edge quad. The canonical world-+1 direction = perp(canonical
        // tangent T_us). At p1 the outward tangent IS T_us, so world-+1
        // matches the local-CCW direction (angularOffset = +1). At p2
        // the outward tangent is -T_us, which inverts the world-side ↔
        // local-side mapping (world-+1 is now on the local-CW side, so
        // we step angularOffset = -1 to find the right neighbour). The
        // shader receives the extrusion direction already on the
        // correct world side, so it doesn't need to know about local
        // sign conventions any more.
        borders.reserve(keptEdges.size() * 4);
        borderIndices.reserve(keptEdges.size() * 6);
        for (uint32_t i = 0; i < keptEdges.size(); ++i) {
            const EdgeRec& r = *keptEdges[i];
            const EdgeGeom& g = egeom[i];
            const EdgeKey k1 = endpointKey(r.p1x, r.p1y);
            const EdgeKey k2 = endpointKey(r.p2x, r.p2y);
            // Compute the world-side miter at this corner.
            auto worldCornerMiter = [&](const EdgeKey& vkey, uint8_t end,
                                        float worldSide) -> std::array<float, 3> {
                // Outward tangent at this endpoint.
                const float outX = (end == 0) ?  g.tx : -g.tx;
                const float outY = (end == 0) ?  g.ty : -g.ty;
                // World side → local side. At p1 the outward IS the
                // canonical tangent, so world/local agree. At p2 the
                // outward is reversed, so world-+1 = local--1 and vice
                // versa.
                const float localSide = (end == 0) ? worldSide : -worldSide;
                const int   angOff    = (localSide > 0.0f) ? +1 : -1;
                const EndRef* nbr = findNeighbour(vkey, i, end, angOff);
                if (!nbr) {
                    // Boundary / single-incident-edge — extrude along
                    // the canonical world normal, scale 1 (butt).
                    return { -g.ty * worldSide,  g.tx * worldSide, 1.0f };
                }
                const EdgeGeom& gn = egeom[nbr->edgeIdx];
                float tNbrX, tNbrY;
                if (nbr->end == 0) { tNbrX =  gn.tx; tNbrY =  gn.ty; }
                else               { tNbrX = -gn.tx; tNbrY = -gn.ty; }
                return computeMiter(outX, outY, tNbrX, tNbrY, localSide);
            };
            // World -1 side / world +1 side at each endpoint.
            const auto p1n = worldCornerMiter(k1, 0, -1.0f);
            const auto p1m = worldCornerMiter(k1, 0,  1.0f);
            const auto p2n = worldCornerMiter(k2, 1, -1.0f);
            const auto p2m = worldCornerMiter(k2, 1,  1.0f);
            const uint32_t base = static_cast<uint32_t>(borders.size());
            // Each vertex carries its own EXTRUSION DIRECTION in
            // (mx, my) — already signed for the world side it belongs
            // to. The shader extrudes by halfWidth · miterScale along
            // (mx, my) in Euclidean mode and projects it through the
            // Jacobian in disk mode (no separate tangent needed: the
            // projection acts the same on any world-tangent-shaped
            // vector, miter direction included).
            borders.push_back({ r.p1x, r.p1y, p1n[0], p1n[1], p1n[2] });
            borders.push_back({ r.p1x, r.p1y, p1m[0], p1m[1], p1m[2] });
            borders.push_back({ r.p2x, r.p2y, p2n[0], p2n[1], p2n[2] });
            borders.push_back({ r.p2x, r.p2y, p2m[0], p2m[1], p2m[2] });
            borderIndices.push_back(base + 0);
            borderIndices.push_back(base + 1);
            borderIndices.push_back(base + 2);
            borderIndices.push_back(base + 1);
            borderIndices.push_back(base + 3);
            borderIndices.push_back(base + 2);
        }
    }
    borderIndexCount_ = static_cast<uint32_t>(borderIndices.size());

    // -------- Upload to GPU --------------------------------------------------
    // Geometry rebuild is cold-path (settings change), not per-frame, so
    // always free+reallocate rather than tracking size deltas.
    auto reallocBuffer = [&](VkBuffer& buf, VkDeviceMemory& mem, VkDeviceSize size,
                             VkBufferUsageFlags usage) {
        if (buf) { vkDestroyBuffer(device_, buf, nullptr); buf = VK_NULL_HANDLE; }
        if (mem) { vkFreeMemory(device_, mem, nullptr); mem = VK_NULL_HANDLE; }
        if (size == 0) return true;
        return createBuffer(size, usage,
                            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                            buf, mem);
    };

    const VkDeviceSize fillSize      = sizeof(FillVertex)   * fills.size();
    const VkDeviceSize borderSize    = sizeof(BorderVertex) * borders.size();
    const VkDeviceSize borderIdxSize = sizeof(uint32_t)     * borderIndices.size();
    if (!reallocBuffer(fillVertBuf_,   fillVertMem_,   fillSize,      VK_BUFFER_USAGE_VERTEX_BUFFER_BIT)) return false;
    if (!reallocBuffer(borderVertBuf_, borderVertMem_, borderSize,    VK_BUFFER_USAGE_VERTEX_BUFFER_BIT)) return false;
    if (!reallocBuffer(borderIdxBuf_,  borderIdxMem_,  borderIdxSize, VK_BUFFER_USAGE_INDEX_BUFFER_BIT))  return false;

    if (fillSize > 0) {
        void* mapped = nullptr;
        VK_CHECK(vkMapMemory(device_, fillVertMem_, 0, fillSize, 0, &mapped));
        std::memcpy(mapped, fills.data(), fillSize);
        vkUnmapMemory(device_, fillVertMem_);
    }
    if (borderSize > 0) {
        void* mapped = nullptr;
        VK_CHECK(vkMapMemory(device_, borderVertMem_, 0, borderSize, 0, &mapped));
        std::memcpy(mapped, borders.data(), borderSize);
        vkUnmapMemory(device_, borderVertMem_);
    }
    if (borderIdxSize > 0) {
        void* mapped = nullptr;
        VK_CHECK(vkMapMemory(device_, borderIdxMem_, 0, borderIdxSize, 0, &mapped));
        std::memcpy(mapped, borderIndices.data(), borderIdxSize);
        vkUnmapMemory(device_, borderIdxMem_);
    }

    LOGI("geom: %zu tiles, %u fillVerts, %u borderIdx, bounds [%.3f,%.3f]-[%.3f,%.3f]",
         tiles.size(), fillVertexCount_, borderIndexCount_,
         geomMinX_, geomMinY_, geomMaxX_, geomMaxY_);
    return true;
}

// -----------------------------------------------------------------------------
// updatePaletteUbo — pack palette + border + bg + animation + audio.
// -----------------------------------------------------------------------------

void Renderer::updatePaletteUbo() {
    if (!paletteUboMapped_) return;
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

    // Border half-width in world space, scaled by the family's deflation
    // rate per generation past 6 so the border tracks tile size: at gen 6
    // the multiplier is 1; gen 7 shrinks by phi^-1 (Penrose) or 1/2
    // (Chair). Without this, increasing generation while leaving the
    // slider alone floods the image with border.
    const float rate = deflationRate(settings_.family);
    float genScale = 1.0f;
    for (int g = 6; g < effectiveGeneration_; ++g) genScale *= rate;
    for (int g = effectiveGeneration_; g < 6; ++g) genScale /= rate;
    ubo.borderGeom[0] = settings_.borderWidth * kBorderWidthScale * genScale;
    ubo.borderGeom[1] = 0.0f;
    ubo.borderGeom[2] = 0.0f;
    ubo.borderGeom[3] = 0.0f;

    ubo.effects[0] = settings_.brightness;
    ubo.effects[1] = settings_.depthAmount;
    ubo.effects[2] = settings_.rippleSpeed;
    ubo.effects[3] = static_cast<float>(settings_.rippleKind);

    float bands[AudioAnalyzer::kBands];
    float beat = 0.0f;
    globalAudioAnalyzer().snapshot(bands, beat);
    for (int i = 0; i < 8; ++i) {
        ubo.audioBands[i >> 2][i & 3] = bands[i];
    }
    ubo.audioBeat[0] = beat;
    ubo.audioBeat[1] = 0.0f;
    ubo.audioBeat[2] = 0.0f;
    ubo.audioBeat[3] = 0.0f;

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

    std::memcpy(paletteUboMapped_, &ubo, sizeof(ubo));
}

} // namespace penrose
