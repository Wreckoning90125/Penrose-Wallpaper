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

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace penrose {

// Per-vertex layout of the fill mesh. Mirrors fill.vert:
//   location 0: vec2  inPos
//   location 1: float inColorSlot
//   location 2: vec2  inCenter  (tile center; Spectre uses its key-frame center)
//   location 3: vec2  inBulge   (parallax-bulge normal-tilt direction)
//   location 4: vec3  inBary    (edge-distance basis — see buildGeometry)
//   location 5: vec4  inTileMat (per-tile material identity — see buildGeometry)
//   location 6: vec4  inTopology
//   location 7: vec3  inEdgeDist (metric scales for the barycentric edge basis)
//
// inBulge is the model-space height gradient used by the material normal.
// Most families emit a constant triangle-local parallax-depth gradient.
// Curved Spectre tiles instead emit a sampled curved-edge rolloff gradient
// so higher fill subdivision improves the raised-plate surface without a
// shader-side radial bucket or a new vertex-buffer slot.
//
// inBary is retained as a per-triangle barycentric basis for geometry/debug
// checks. inEdgeDist is the material-facing metric scale for each barycentric
// edge coordinate, normalized by tile scale, so triangulation diagonals and
// centroid spokes cannot create false seams.
//
// inTileMat carries per-tile identity, constant across the tile's vertices:
//   x — type, normalised to [0,1] over the family's distinct tile kinds
//   y,z — orientation, the unit (cos,sin) of the family's classifier edge
//   w — approximate tile scale, used by analytic tile-local ornament masks
// topology.xy stores real shared-edge adjacency degree and motif hash scalars.
// The fragment shader keys physical channels off these: metalness off type,
// anisotropy off orientation, ornament coordinates off orientation + scale.
struct FillVertex {
    float    x, y;
    float    colorSlot;
    float    cx, cy;
    float    bgx, bgy;
    float    bx, by, bz;
    float    mtype, mox, moy, mring;
    float    tdegree, tmotif, topology2, topology3;
    float    edgeDistX, edgeDistY, edgeDistZ;
};
static_assert(sizeof(FillVertex) == 84, "FillVertex layout drift");
static_assert(offsetof(FillVertex, x) == 0, "FillVertex position offset drift");
static_assert(offsetof(FillVertex, colorSlot) == 8, "FillVertex color slot offset drift");
static_assert(offsetof(FillVertex, cx) == 12, "FillVertex center offset drift");
static_assert(offsetof(FillVertex, bgx) == 20, "FillVertex bulge offset drift");
static_assert(offsetof(FillVertex, bx) == 28, "FillVertex bary offset drift");
static_assert(offsetof(FillVertex, mtype) == 40, "FillVertex material offset drift");
static_assert(offsetof(FillVertex, tdegree) == 56, "FillVertex topology offset drift");
static_assert(offsetof(FillVertex, edgeDistX) == 72, "FillVertex edge distance offset drift");

// Baked border-ring mesh. Location 0 stores the geometry-space border position:
// Euclidean source coordinates in Euclidean mode, projected disk coordinates in
// Poincare mode. Location 1 stores the source/model coordinate corresponding to
// that vertex; the border shader samples the ripple field there so wave
// displacement stays in the same coordinate system as fill.vert.
struct BorderVertex {
    float x, y;
    float sx, sy;
    float role;
};
static_assert(sizeof(BorderVertex) == 20, "BorderVertex layout drift");
static_assert(offsetof(BorderVertex, x) == 0, "BorderVertex position offset drift");
static_assert(offsetof(BorderVertex, sx) == 8, "BorderVertex source offset drift");
static_assert(offsetof(BorderVertex, role) == 16, "BorderVertex role offset drift");

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
    float    borderGeom[4];   // edge-profile width/glow; border width is baked into BorderVertex positions
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
    float    ornament[4];     // style, amount, width, phase
    float    ornamentExtra[4]; // coverage, axis-swap, legacy-zero, family
    float    contour[4];      // amount, source, spacing, width
    float    contourColor[4]; // phase, lineColor.rgb
    float    sourceMarkA[4];  // rgb, alpha
    float    sourceMarkB[4];  // rgb, alpha
    float    sourceMarkC[4];  // rgb, alpha
    float    edgeProfileColor[4]; // rgb, --
};
static_assert(sizeof(PaletteUbo) == 736, "PaletteUbo std140 row layout drift");
static_assert(offsetof(PaletteUbo, palette) == 0, "PaletteUbo palette offset drift");
static_assert(offsetof(PaletteUbo, borderColor) == 288, "PaletteUbo borderColor offset drift");
static_assert(offsetof(PaletteUbo, anim) == 336, "PaletteUbo anim offset drift");
static_assert(offsetof(PaletteUbo, matNormal) == 432, "PaletteUbo material offset drift");
static_assert(offsetof(PaletteUbo, ambient) == 592, "PaletteUbo ambient offset drift");
static_assert(offsetof(PaletteUbo, ornament) == 608, "PaletteUbo ornament offset drift");
static_assert(offsetof(PaletteUbo, ornamentExtra) == 624, "PaletteUbo ornamentExtra offset drift");
static_assert(offsetof(PaletteUbo, contour) == 640, "PaletteUbo contour offset drift");
static_assert(offsetof(PaletteUbo, contourColor) == 656, "PaletteUbo contourColor offset drift");
static_assert(offsetof(PaletteUbo, sourceMarkA) == 672, "PaletteUbo sourceMarkA offset drift");
static_assert(offsetof(PaletteUbo, sourceMarkB) == 688, "PaletteUbo sourceMarkB offset drift");
static_assert(offsetof(PaletteUbo, sourceMarkC) == 704, "PaletteUbo sourceMarkC offset drift");
static_assert(offsetof(PaletteUbo, edgeProfileColor) == 720, "PaletteUbo edgeProfileColor offset drift");

inline float sourceOverlayAlpha(float style, float amount, float density) {
    const bool active = style >= 3.5f;
    if (!active) return 0.0f;
    return std::clamp(amount * density * 0.82f, 0.0f, 0.92f);
}

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

// Waveform shaping for the choreography clock (parity with the web Clock
// node's clock_waveform). Input/output normalized 0..1; saw is the identity.
inline float shapeClockPhase(float phase01, int waveform) {
    const float kTau = 6.28318530718f;
    switch (waveform) {
        case 1: return 0.5f - 0.5f * std::cos(kTau * phase01);  // sine
        case 2: return 1.0f - std::fabs(2.0f * phase01 - 1.0f); // triangle
        case 3: return phase01 < 0.5f ? 0.0f : 1.0f;            // square, 50% duty
        default: return phase01;                                // saw
    }
}

inline void applyLightChoreography(MaterialParams& m, float angleDeg, float elevDeg,
                                   float intensity, float warmth, float ambient,
                                   float amount, float speed, float source,
                                   float timeSec, float pageOffset, float beat,
                                   float beatPhase, float transient, int waveform = 0) {
    const float kPi = 3.14159265358979f;
    const float kTau = 2.0f * kPi;
    const float clampedAmount = std::clamp(amount, 0.0f, 1.0f);
    const float clampedSpeed = std::clamp(speed, 0.0f, 2.0f);
    const int mode = std::clamp(static_cast<int>(source + 0.5f), 0, 3);
    // Qualitative parity with the web clock (rate-gated + shaped at source).
    // Saw keeps the raw unbounded ramp — bit-identical to the pre-waveform
    // behaviour, and folding it would break drift continuity (drift scales the
    // phase by 0.73 before the cosine, so dropping whole cycles shifts it).
    const float clockRamp = timeSec * clampedSpeed * 0.085f;
    const float clockPhase = waveform == 0
        ? clockRamp
        : shapeClockPhase(clockRamp - std::floor(clockRamp), waveform);
    const float panPhase = (pageOffset - 0.5f) * 1.35f;
    const float beatPulse = std::clamp(std::max(beat, transient), 0.0f, 1.0f);
    const float clockPulse = 0.5f - 0.5f * std::cos(clockPhase * kTau);
    const float panPulse = 0.5f + 0.5f * std::sin(panPhase * kTau);
    float phase = clockPhase;
    float pulse = clockPulse;
    if (mode == 1) {
        phase = panPhase;
        pulse = panPulse;
    } else if (mode == 2) {
        phase = beatPhase;
        pulse = beatPulse;
    } else if (mode == 3) {
        phase = clockPhase * 0.62f + panPhase * 0.38f + beatPhase * 0.5f;
        pulse = std::max(clockPulse * 0.35f + panPulse * 0.25f, beatPulse);
    }
    const float orbit = std::sin(phase * kTau);
    const float drift = std::cos((phase * 0.73f + 0.19f) * kTau);
    const float nextAngle = angleDeg + clampedAmount * orbit * 41.0f
                          + clampedAmount * panPhase * 23.0f;
    const float nextElevation = std::clamp(elevDeg + clampedAmount * drift * 13.5f, 3.0f, 86.0f);
    const float nextIntensity = intensity * (1.0f + clampedAmount * pulse * 0.32f);
    const float nextWarmth = std::clamp(warmth + clampedAmount * (pulse - 0.5f) * 0.34f, 0.0f, 1.0f);
    const float nextAmbient = std::clamp(ambient + clampedAmount * (0.5f - pulse) * 0.14f, 0.0f, 1.0f);
    applyLightControls(m, nextAngle, nextElevation, nextIntensity, nextWarmth, nextAmbient);
    const float fillAz = (nextAngle + 180.0f + clampedAmount * drift * 15.0f) * kPi / 180.0f;
    const float fillEl = std::max(3.0f, nextElevation * (0.48f + clampedAmount * 0.16f)) * kPi / 180.0f;
    const float fillCe = std::cos(fillEl);
    m.fillDir[0] = fillCe * std::cos(fillAz);
    m.fillDir[1] = fillCe * std::sin(fillAz);
    m.fillDir[2] = std::sin(fillEl);
    m.fillIntensity = nextIntensity * (0.27f + clampedAmount * 0.10f);
}

} // namespace penrose
