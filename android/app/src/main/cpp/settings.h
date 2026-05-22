#pragma once

#include "color/color.h"
#include "tiling/penrose.h"

#include <cstdint>

namespace penrose {

// =============================================================================
// Settings — single source of truth for everything the renderer asks the
// Kotlin layer about. Touch-driven view state (pan/zoom/rotate) is NOT here;
// it lives directly on the renderer because it changes too often to round-trip
// through JNI.
// =============================================================================

enum class BackgroundMode : int {
    Solid = 0,  // explicit OKLCH (bgColor)
    Match = 1,  // use palette[0]
};

struct Settings {
    Family family       = Family::P3;
    int    seedIdx      = 0;
    int    generation   = 6;

    Preset preset       = Preset::Gold;
    int    colorCount   = 2;
    ColorMode colorMode = ColorMode::Type;

    bool   borderOn     = true;
    float  borderWidth  = 0.8f;
    Oklch  borderColor  { 0.95f, 0.0f, 0.0f };
    float  borderAlpha  = 0.35f;

    BackgroundMode bgMode { BackgroundMode::Solid };
    Oklch  bgColor     { 0.04f, 0.005f, 280.0f };

    // Per-tile plane-wave modulation amplitude (0..1) and source. Mode 0
    // pulses with the Choreographer-driven clock, 1 follows home-screen
    // scroll only, 2 combines both. `rippleKind` picks the output: 0 =
    // color modulation, 1 = vertex-position-sampled wave gradient that
    // physically displaces the tiling, 2 = both. `rippleSpeed` scales the
    // temporal frequency.
    float  rippleAmount = 0.3f;
    int    rippleMode   = 0;
    float  rippleSpeed  = 1.0f;
    int    rippleKind   = 0;

    // View transform persisted across sessions. Updated by pinch zoom +
    // pinch rotate. `panMode` 0 (Locked) keeps panX/panY at 0; mode 1
    // (Generative) lets a single-finger drag grow the tiling outward by
    // bumping the effective generation as the gesture accumulates.
    float  zoom         = 1.0f;
    float  rotation     = 0.0f;
    float  panX         = 0.0f;
    float  panY         = 0.0f;
    int    panMode      = 0;

    // Tile look: master brightness multiplier and per-tile depth/parallax
    // gradient amplitude. Depth follows the tile's geometric apex — fat
    // Penrose rhombi bulge at their long-axis apex, thin ones recede,
    // giving a 3D-cube illusion on P3/P2.
    float  brightness   = 1.0f;
    float  depthAmount  = 0.3f;

    // Physical-material controls — eight user-facing knobs, each a slider
    // base value the modulation graph can drive on top of. They map 1:1
    // onto MaterialParams fields (render_state.h); the non-slider material
    // fields (film thickness, sheen tint, bevel/ripple shaping) keep their
    // MaterialParams defaults. A material preset bundles the sliders below
    // plus the lighting controls; it does not touch the non-slider fields.
    float  matRoughness   = 0.50f;
    float  matMetalness   = 0.40f;
    float  matSheen       = 0.35f;
    float  matClearcoat   = 0.45f;
    float  matAnisotropy  = 0.40f;
    float  matIridescence = 0.45f;
    float  matEmissive    = 0.60f;
    float  matRelief      = 1.05f;

    // Lighting rig controls. The renderer derives the key/fill directions,
    // colours and intensities from these five (see applyLightControls);
    // like the material knobs they are slider bases the graph can drive.
    float  lightAngle     = 230.0f;  // key azimuth, degrees
    float  lightElevation = 55.0f;   // key elevation, degrees
    float  lightIntensity = 1.00f;   // master key+fill scale
    float  lightWarmth    = 0.50f;   // 0 cool .. 0.5 neutral .. 1 warm
    float  lightAmbient   = 0.22f;   // flat ambient level

    // Custom palette — used when `preset == Preset::Custom`. 10 OKLCH
    // triples; only the first `colorCount` are actually consumed.
    Oklch  customOklch[kMaxColors] = {
        { 0.18f, 0.02f, 280.0f },
        { 0.78f, 0.13f,  80.0f },
        { 0.65f, 0.18f,  30.0f },
        { 0.65f, 0.18f, 120.0f },
        { 0.65f, 0.18f, 210.0f },
        { 0.65f, 0.18f, 300.0f },
        { 0.50f, 0.10f,  60.0f },
        { 0.50f, 0.10f, 150.0f },
        { 0.50f, 0.10f, 240.0f },
        { 0.50f, 0.10f, 330.0f },
    };
};

// Returns true if any setting that affects geometry (tile generation) changed.
// Used by the renderer to decide whether to rebuild vertex buffers or just
// re-record draw commands.
inline bool geometryChanged(const Settings& a, const Settings& b) {
    return a.family != b.family
        || a.seedIdx != b.seedIdx
        || a.generation != b.generation;
}

// Returns true if anything that affects per-tile classification changed.
inline bool classificationChanged(const Settings& a, const Settings& b) {
    return a.colorMode != b.colorMode
        || a.colorCount != b.colorCount;
}

} // namespace penrose
