#pragma once

#include "color.h"
#include "penrose.h"

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
    float  borderWidth  = 0.8f;     // model-space, scaled to pixels at draw time
    Oklch  borderColor  { 0.95f, 0.0f, 0.0f };
    float  borderAlpha  = 0.35f;

    BackgroundMode bgMode { BackgroundMode::Solid };
    Oklch  bgColor     { 0.04f, 0.005f, 280.0f };
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
