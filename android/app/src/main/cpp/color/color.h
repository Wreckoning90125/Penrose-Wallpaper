#pragma once

#include "tiling/penrose.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace penrose {

// =============================================================================
// Color types
// =============================================================================
// Palette colors are authored in OKLCH (Björn Ottosson, 2020) for
// perceptually uniform interpolation and converted to the swapchain's
// working space at upload time. `oklchToShaderColor` selects the conversion
// based on the active swapchain:
//
//   * sRGB swapchain (`VK_FORMAT_*_SRGB`): write linear sRGB; the hardware
//     applies the sRGB encode on store.
//   * DisplayP3 swapchain (`A2B10G10R10_UNORM_PACK32` +
//     `DISPLAY_P3_NONLINEAR_EXT`): matrix-transform linear sRGB into linear
//     DisplayP3 (both D65, no chromatic adaptation) and apply the sRGB
//     piecewise EOTF (which is DisplayP3-nonlinear's transfer curve too).
//
// Colors outside the sRGB triangle but inside P3 survive through to the
// shader on the wide-gamut path.

struct Oklch { float L, C, H; };
struct LinearRGB { float r, g, b; };
struct ShaderColor { float r, g, b, a; }; // value the UBO/shader sees

// OKLCH → linear sRGB (unclipped: returned components may exceed [0,1] when
// the OKLCH point is outside the sRGB gamut).
LinearRGB oklchToLinearSrgb(Oklch c);

// Linear sRGB (D65) → linear DisplayP3 (D65). No chromatic adaptation needed.
LinearRGB linearSrgbToLinearP3(LinearRGB s);

// Choose the right encode for the current swapchain colorspace. `linearOutput`
// is true when the swapchain format applies gamma in hardware (any _SRGB
// format); false when the shader is expected to write already-encoded values
// (the 10-bit P3 _UNORM_PACK32 path).
ShaderColor oklchToShaderColor(Oklch c, float alpha, bool wideGamutP3, bool linearOutput);

// =============================================================================
// Palette presets
// =============================================================================
// Each preset returns up to kMaxColors OKLCH triples for a given K.
// The renderer reads the first state.colorCount entries. 18 slots cover the
// largest Gailiunas arm count while still fitting comfortably in one UBO.

constexpr int kMaxColors = 18;

enum class Preset : int {
    BW = 0,
    Greys,
    Prism,
    Paper,
    Gold,
    Rust,
    Plum,
    Cobalt,
    Sage,
    Spectra,
    Girih,
    Custom,
    Count_
};

constexpr int kPresetCount = static_cast<int>(Preset::Count_);

struct PresetResult {
    std::array<Oklch, kMaxColors> colors;
    Oklch bg;
};

// Build the palette for `p`. When `p == Preset::Custom`, `customSource`
// supplies the user-authored OKLCH slots (kMaxColors entries; only the
// first `k` are read). For every other preset, `customSource` is ignored.
PresetResult buildPreset(Preset p, int k, const Oklch* customSource = nullptr, float spectral = 0.0f);

// =============================================================================
// Color modes — assign each tile a bucket index, then map to a palette slot.
// =============================================================================

enum class ColorMode : int {
    Type = 0,    // family tile kind; Gailiunas uses arm index
    Orient = 1,  // family orientation bins
    Ring = 2,    // K bins by distance from origin
    Phase = 3,   // continuous class + ring/arm phase coordinate
};

// Returns, for each tile in `tiles`, either a bucket index in [0, numBuckets)
// or a continuous coordinate in [0,1] when numBuckets == 0.
struct Classification {
    std::vector<float> bucket;
    int numBuckets;
};

Classification classify(const std::vector<Tile>& tiles,
                        Family family,
                        ColorMode mode,
                        int colorCount);

// Maps a discrete or continuous bucket to a palette slot. Spread controls how
// far classification reaches across the authored palette without changing the
// palette colours themselves.
inline float bucketToPaletteIdx(float bucket, int numBuckets, int k, int spreadPercent = 100) {
    if (k <= 1) return 0.0f;
    const int span = 1 + static_cast<int>(std::round(
        static_cast<float>(k - 1) * std::clamp(spreadPercent, 0, 100) / 100.0f));
    if (span <= 1) return 0.0f;
    if (numBuckets <= 0) return std::clamp(bucket, 0.0f, 1.0f) * static_cast<float>(span - 1);
    if (numBuckets <= 1) return 0.0f;
    if (numBuckets > span) {
        return std::min(static_cast<float>(span - 1),
                        std::floor(bucket / (static_cast<float>(numBuckets) / static_cast<float>(span))));
    }
    return std::clamp(std::round(bucket * static_cast<float>(span - 1) / static_cast<float>(numBuckets - 1)),
                      0.0f,
                      static_cast<float>(span - 1));
}

} // namespace penrose
