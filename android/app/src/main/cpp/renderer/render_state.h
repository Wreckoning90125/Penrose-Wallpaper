#pragma once

// =============================================================================
// Renderer-internal shared types.
//
// These structs are split across renderer.cpp (lifecycle + drawFrame),
// renderer_vulkan.cpp (instance/device/swapchain/pipeline setup), and
// renderer_geometry.cpp (mesh building + UBO update). They have no
// callers outside cpp/ so we keep them in this private header rather
// than polluting renderer.h, which is consumed by the JNI bridge.
// =============================================================================

#include "color/color.h"  // kMaxColors lives there

#include <cstdint>

namespace penrose {

// Per-vertex layout of the fill mesh. Mirrors fill.vert:
//   location 0: vec2  inPos
//   location 1: uint  inColorIdx
//   location 2: vec2  inCenter  (tile centroid)
//   location 3: float inDepth   (parallax depth, [-1, +1])
//   location 4: vec3  inBary    (edge-distance basis — see buildGeometry)
//   location 5: vec4  inTileMat (per-tile material identity — see buildGeometry)
//
// inBary is a per-triangle barycentric basis (vertex k → unit component k).
// The fragment shader takes min(bary) as the distance to the nearest tile
// boundary edge and lifts a bevel height field from it. Triangulation
// diagonals that are interior to a tile (fan splits, centroid spokes) are
// neutralised by pinning their component to 1 at every vertex so the bevel
// never creases along a seam that is not a real tile edge.
//
// inTileMat carries per-tile identity, constant across the tile's vertices:
//   x — type, normalised to [0,1] over the family's distinct tile kinds
//   y,z — orientation, the unit (cos,sin) of the family's classifier edge
//   w — centroid distance from the tiling origin (model space)
// The fragment shader keys physical channels off these: metalness off type,
// anisotropy off orientation, iridescence thickness off the radius.
struct FillVertex {
    float    x, y;
    uint32_t colorIdx;
    float    cx, cy;
    float    depth;
    float    bx, by, bz;
    float    mtype, mox, moy, mring;
};

// Vertex-shader-expanded border quad. Each unique edge emits four
// vertices that the shader pushes by ± borderHalfWidth along inNormal.
struct BorderVertex {
    float x, y;
    float side;        // -1 or +1 — which side of the edge midline
    float nx, ny;      // unit edge normal
};

// Vertex push constants. 32-byte affine model→clip view matrix.
struct PushBlock {
    float view0x, view0y, view0z, _pad0;
    float view1x, view1y, view1z, _pad1;
};
static_assert(sizeof(PushBlock) == 32, "PushBlock layout drift");

// Palette UBO laid out as std140 — every member is vec4-aligned.
// Shader uniform block in fill.vert / fill.frag / border.* must match.
struct PaletteUbo {
    float    palette[kMaxColors][4];
    float    borderColor[4];
    float    bgColor[4];
    uint32_t flags[4];
    float    anim[4];         // x=time, y=rippleAmount, z=family, w=pageOffset
    float    borderGeom[4];   // x=borderHalfWidth (world-space)
    float    effects[4];      // x=brightness, y=depth, z=rippleSpeed, w=rippleKind
    float    audioBands[2][4];
    float    audioBeat[4];
};

} // namespace penrose
