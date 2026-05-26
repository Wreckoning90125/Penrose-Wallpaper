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

#include <cmath>
#include <cstdint>

namespace penrose {

// Per-vertex layout of the fill mesh. Mirrors fill.vert:
//   location 0: vec2  inPos
//   location 1: uint  inColorIdx
//   location 2: vec2  inCenter  (tile centroid)
//   location 3: vec2  inBulge   (parallax-bulge normal-tilt direction)
//   location 4: vec3  inBary    (edge-distance basis — see buildGeometry)
//   location 5: vec4  inTileMat (per-tile material identity — see buildGeometry)
//
// inBulge is the unit model-space gradient direction of the parallax-depth
// field over the triangle — constant per triangle because that field is
// linear. The fragment shader tilts the shading normal along it, so the
// per-tile bulge is real shading relief, not a brightness fake. Zero when
// the triangle has no depth gradient (the flat Chair family).
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
    float    bgx, bgy;
    float    bx, by, bz;
    float    mtype, mox, moy, mring;
};

// Vertex-shader-expanded border quad. Each unique edge emits four
// vertices; the shader extrudes each by halfWidth × miterScale along
// the per-corner mitered direction so adjacent edges meeting at a
// non-90° vertex join flush — no overlapping perpendicular-butt ends,
// no outside-corner gap. The mitered direction is already signed for
// this vertex's world side, so no per-vertex side flag is needed. In
// disk mode the shader projects (mx, my) through the same
// projTangentRadial+boostTangent Jacobian as a tangent vector would
// see — conformality preserves the bisector angle exactly, so the
// joint closes in disk space at the same miterScale.
//
// Stride padded to 32 bytes (8 floats = 2 vec4). The five live
// fields only need 20 bytes, but several mobile Vulkan drivers
// (older Adreno especially) silently misfetch vertex attributes
// when the binding stride isn't a multiple of 16 — perpendicular
// butt-end output regardless of what the source CPU data carries.
// The Vulkan spec doesn't require vec4-multiple stride, but in
// practice every reliable layout I've seen does it. Cost is 12
// extra bytes per vertex × ~4 verts/edge × a few thousand edges =
// <0.5 MB on the wire, invisible.
struct BorderVertex {
    float x, y;
    float mx, my;       // mitered corner direction (already signed for the world side)
    float miterScale;   // halfWidth multiplier — bridges the angular gap
    float _pad0, _pad1, _pad2;  // stride → 32 bytes for vec4-multiple alignment
};

// Vertex push constants.
//
// view0/view1 are the 2x3 affine model→clip view matrix (rotation, zoom,
// pan). When projection mode is Euclidean (projection == 0) the vertex
// shader applies this directly to inPos. When PoincareDisk
// (projection == 1) the shader first projects inPos through the radial
// hyperbolic-radius map E² → B² then the hyperbolic translation τ_b in
// B², and the resulting disk point goes through the view matrix — so
// screen rotation / zoom still work on top of the projected disk.
//   hypBoostX/Y  — b ∈ B² (|b| < 1) for the τ_b boost
//   hypScale     — world-radius → unit-disk-radius scale
//   projection   — 0 = Euclidean passthrough, 1 = PoincareDisk
struct PushBlock {
    float view0x, view0y, view0z, _pad0;
    float view1x, view1y, view1z, _pad1;
    float hypBoostX, hypBoostY, hypScale, projection;
};
static_assert(sizeof(PushBlock) == 48, "PushBlock layout drift");

// Physical-material parameters. Every appearance knob the fill shader once
// hard-coded lives here as a base value, so the look is fully settable
// without audio; the modulation graph layers its sources (audio bands, the
// beat, a clock, home-screen pan) on top of these bases. The defaults below
// are the calibrated look — a flat non-metal plateau still reads as its
// palette colour. updatePaletteUbo() packs this into the UBO rows below.
struct MaterialParams {
    // Normal-shaping height fields.
    float bevelWidth = 0.30f, bevelStrength = 1.05f;
    float waveHeight = 0.12f, bulgeTilt = 0.70f;
    // Surface channels keyed to the tiling's own fields.
    float roughBase = 0.50f, roughMod = 0.35f;
    float metalBase = 0.0f,  metalMod = 0.40f;
    // BRDF lobes.
    float emissive = 0.60f, sheen = 0.35f, sheenRough = 0.30f;
    float clearcoat = 0.45f, coatRough = 0.10f, anisotropy = 0.40f;
    float iridescence = 0.45f, iridIOR = 1.30f;
    float iridThickMin = 280.0f, iridThickMax = 560.0f;
    float sheenColor[3] = { 1.00f, 0.97f, 0.92f };
    // Key + fill + ambient lighting rig.
    float keyDir[3] = { -0.35f, -0.45f, 0.80f };
    float keyIntensity = 0.76f;
    float keyColor[3] = { 1.00f, 0.99f, 0.97f };
    float fillDir[3] = { 0.45f, 0.30f, 0.65f };
    float fillIntensity = 0.27f;
    float fillColor[3] = { 0.82f, 0.88f, 1.00f };
    float ambientColor[3] = { 0.90f, 0.93f, 1.00f };
    float ambient = 0.22f;
};

// Palette UBO laid out as std140 — every member is vec4-aligned. The
// matching shader-side declaration lives once in shaders/uniforms.glsl
// and is #included by every stage, so a row added here only needs to be
// added there — no four-way mirror to keep in sync.
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
    // Physical material — packed from MaterialParams; vec3-valued rows zero-pad.
    float    matNormal[4];    // bevelWidth, bevelStrength, waveHeight, bulgeTilt
    float    matSurface[4];   // roughBase, roughMod, metalBase, metalMod
    float    matLobeA[4];     // emissive, sheen, sheenRough, clearcoat
    float    matLobeB[4];     // coatRough, anisotropy, iridescence, iridIOR
    float    matIrid[4];      // iridThickMin, iridThickMax, --, --
    float    matSheenCol[4];  // sheenColor.rgb, --
    float    keyLight[4];     // keyDir.xyz, keyIntensity
    float    keyColor[4];     // keyColor.rgb, --
    float    fillLight[4];    // fillDir.xyz, fillIntensity
    float    fillColor[4];    // fillColor.rgb, --
    float    ambient[4];      // ambientColor.rgb, ambientAmount
};

// Pack a MaterialParams into the 11 trailing PaletteUbo rows. `d` points at
// PaletteUbo::matNormal[0]; the rows are contiguous, so 44 floats are
// written. Used by both updatePaletteUbo (cold) and the per-frame patch.
inline void writeMaterialRows(float* d, const MaterialParams& m) {
    d[0]  = m.bevelWidth;     d[1]  = m.bevelStrength;
    d[2]  = m.waveHeight;     d[3]  = m.bulgeTilt;
    d[4]  = m.roughBase;      d[5]  = m.roughMod;
    d[6]  = m.metalBase;      d[7]  = m.metalMod;
    d[8]  = m.emissive;       d[9]  = m.sheen;
    d[10] = m.sheenRough;     d[11] = m.clearcoat;
    d[12] = m.coatRough;      d[13] = m.anisotropy;
    d[14] = m.iridescence;    d[15] = m.iridIOR;
    d[16] = m.iridThickMin;   d[17] = m.iridThickMax;
    d[18] = 0.0f;             d[19] = 0.0f;
    d[20] = m.sheenColor[0];  d[21] = m.sheenColor[1];
    d[22] = m.sheenColor[2];  d[23] = 0.0f;
    d[24] = m.keyDir[0];      d[25] = m.keyDir[1];
    d[26] = m.keyDir[2];      d[27] = m.keyIntensity;
    d[28] = m.keyColor[0];    d[29] = m.keyColor[1];
    d[30] = m.keyColor[2];    d[31] = 0.0f;
    d[32] = m.fillDir[0];     d[33] = m.fillDir[1];
    d[34] = m.fillDir[2];     d[35] = m.fillIntensity;
    d[36] = m.fillColor[0];   d[37] = m.fillColor[1];
    d[38] = m.fillColor[2];   d[39] = 0.0f;
    d[40] = m.ambientColor[0]; d[41] = m.ambientColor[1];
    d[42] = m.ambientColor[2]; d[43] = m.ambient;
}

// Derive the key/fill/ambient rig in a MaterialParams from the five
// user-facing lighting controls. Key azimuth+elevation place the key; the
// fill sits opposite at half elevation; warmth (0 cool .. 1 warm) tints the
// key warm and the fill cool around a neutral midpoint.
inline void applyLightControls(MaterialParams& m, float angleDeg, float elevDeg,
                               float intensity, float warmth, float ambient) {
    const float kD2R = 3.14159265358979f / 180.0f;
    const float az = angleDeg * kD2R;
    const float el = elevDeg  * kD2R;
    const float ce = std::cos(el), se = std::sin(el);
    m.keyDir[0] = ce * std::cos(az);
    m.keyDir[1] = ce * std::sin(az);
    m.keyDir[2] = se;
    const float az2 = az + 3.14159265358979f;
    const float el2 = el * 0.5f;
    const float ce2 = std::cos(el2);
    m.fillDir[0] = ce2 * std::cos(az2);
    m.fillDir[1] = ce2 * std::sin(az2);
    m.fillDir[2] = std::sin(el2);
    m.keyIntensity  = intensity * 0.76f;
    m.fillIntensity = intensity * 0.27f;
    const float w = (warmth - 0.5f) * 2.0f;  // -1 cool .. +1 warm
    m.keyColor[0] = 1.0f;
    m.keyColor[1] = 0.98f - 0.05f * w;
    m.keyColor[2] = 0.96f - 0.13f * w;
    m.fillColor[0] = 0.86f - 0.06f * w;
    m.fillColor[1] = 0.91f - 0.01f * w;
    m.fillColor[2] = 1.00f;
    m.ambient = ambient;
}

} // namespace penrose
