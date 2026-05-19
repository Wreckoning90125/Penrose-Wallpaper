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

inline bool hideSeam(Family fam, EdgeKind k1, EdgeKind k2) {
    switch (fam) {
        case Family::P3:    return k1 == EdgeKind::Base && k2 == EdgeKind::Base;
        case Family::P2:    return k1 == EdgeKind::Leg  && k2 == EdgeKind::Leg;
        case Family::Chair: return false;
    }
    return false;
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

    float minX =  1e9f, minY =  1e9f;
    float maxX = -1e9f, maxY = -1e9f;

    for (size_t i = 0; i < tiles.size(); ++i) {
        const Tile& t = tiles[i];
        const uint32_t paletteIdx = static_cast<uint32_t>(
            bucketToPaletteIdx(cls.bucket[i], cls.numBuckets, settings_.colorCount));
        const int vc = t.vcount;
        float sx = 0.0f, sy = 0.0f;
        for (int v = 0; v < vc; ++v) { sx += t.x[v]; sy += t.y[v]; }
        const float cx = sx / static_cast<float>(vc);
        const float cy = sy / static_cast<float>(vc);
        if (vc == 3) {
            // Per-vertex parallax depth. Penrose triangle vert 1 is the
            // rhombus's long-axis apex; L (type 0) bulges (+1), S (type
            // 1) recedes (-1). Legs sit at midline (0).
            const float apexDepth = (t.type == 0) ? +1.0f : -1.0f;
            const float depths[3] = { 0.0f, apexDepth, 0.0f };
            for (int v = 0; v < 3; ++v) {
                fills.push_back(FillVertex{ t.x[v], t.y[v], paletteIdx, cx, cy, depths[v] });
                minX = std::min(minX, t.x[v]); maxX = std::max(maxX, t.x[v]);
                minY = std::min(minY, t.y[v]); maxY = std::max(maxY, t.y[v]);
            }
        } else {
            // Chair L-trominoes have no natural depth axis — leave flat.
            for (int v = 1; v + 1 < vc; ++v) {
                fills.push_back(FillVertex{ t.x[0],     t.y[0],     paletteIdx, cx, cy, 0.0f });
                fills.push_back(FillVertex{ t.x[v],     t.y[v],     paletteIdx, cx, cy, 0.0f });
                fills.push_back(FillVertex{ t.x[v + 1], t.y[v + 1], paletteIdx, cx, cy, 0.0f });
            }
            for (int v = 0; v < vc; ++v) {
                minX = std::min(minX, t.x[v]); maxX = std::max(maxX, t.x[v]);
                minY = std::min(minY, t.y[v]); maxY = std::max(maxY, t.y[v]);
            }
        }
    }
    fillVertexCount_ = static_cast<uint32_t>(fills.size());
    geomMinX_ = minX; geomMaxX_ = maxX;
    geomMinY_ = minY; geomMaxY_ = maxY;

    // -------- Border geometry: indexed triangle quads -----------------------
    // For each unique edge (dedup via midpoint hash, honouring hideSeam) we
    // emit 4 verts + 6 indices. The vertex shader expands each quad by
    // ± borderHalfWidth along the edge normal, so the slider yields a real
    // world-space thickness.
    std::vector<BorderVertex> borders;
    std::vector<uint32_t>     borderIndices;
    if (settings_.borderOn) {
        std::vector<Edge> edges;
        edges.reserve(tiles.size() * (settings_.family == Family::Chair ? 6 : 3));
        for (const Tile& t : tiles) {
            if (t.vcount == 3) edgesPenrose(t, edges);
            else               edgesChair(t, edges);
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
        borders.reserve(edgeMap.size() * 4);
        borderIndices.reserve(edgeMap.size() * 6);
        for (const auto& kv : edgeMap) {
            const EdgeRec& r = kv.second;
            if (r.secondSet && r.t1 == r.t2 && hideSeam(settings_.family, r.k1, r.k2)) continue;
            const float dx = r.p2x - r.p1x;
            const float dy = r.p2y - r.p1y;
            const float len = std::sqrt(dx * dx + dy * dy);
            if (len < 1e-6f) continue;
            const float inv = 1.0f / len;
            // Edge tangent (dx,dy)/len; outward normal = perp = (-dy, dx)/len.
            const float nx = -dy * inv;
            const float ny =  dx * inv;
            const uint32_t base = static_cast<uint32_t>(borders.size());
            borders.push_back({ r.p1x, r.p1y, -1.0f, nx, ny });
            borders.push_back({ r.p1x, r.p1y,  1.0f, nx, ny });
            borders.push_back({ r.p2x, r.p2y, -1.0f, nx, ny });
            borders.push_back({ r.p2x, r.p2y,  1.0f, nx, ny });
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
    ubo.anim[2] = static_cast<float>(static_cast<int>(settings_.family));
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

    std::memcpy(paletteUboMapped_, &ubo, sizeof(ubo));
}

} // namespace penrose
