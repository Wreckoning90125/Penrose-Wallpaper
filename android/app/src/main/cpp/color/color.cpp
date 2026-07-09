#include "color/color.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace penrose {

namespace {

constexpr double kPi = 3.14159265358979323846;

int typeBucketCount(const std::vector<Tile>& tiles, Family family, const ClassSpec& cs) {
    if (family != Family::GailiunasSpiral) return cs.typeBuckets > 0 ? cs.typeBuckets : 1;
    uint8_t maxType = 0;
    for (const Tile& tile : tiles) maxType = std::max(maxType, tile.type);
    return static_cast<int>(maxType) + 1;
}

inline float srgbEncode(float v) {
    if (v <= 0.0f) return 0.0f;
    if (v >= 1.0f) return 1.0f;
    return v <= 0.0031308f ? 12.92f * v
                           : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
}

inline Oklch lerp(Oklch a, Oklch b, float t) {
    return { a.L + (b.L - a.L) * t,
             a.C + (b.C - a.C) * t,
             a.H + (b.H - a.H) * t };
}

Oklch spectralColor(int index, int k) {
    const int denom = std::max(k, 1);
    const int clampedIndex = std::clamp(index, 0, denom - 1);
    return {
        0.70f,
        0.16f,
        std::fmod(static_cast<float>(clampedIndex) * 360.0f / static_cast<float>(denom) + 30.0f, 360.0f),
    };
}

void mixWithSpectra(PresetResult& out, int k, float spectral) {
    const float amount = std::clamp(spectral, 0.0f, 1.0f);
    if (amount <= 0.0f) return;
    const int active = std::clamp(k, 1, kMaxColors);
    for (int i = 0; i < kMaxColors; ++i) {
        out.colors[i] = lerp(out.colors[i], spectralColor(std::min(i, active - 1), active), amount);
    }
}

// Build evenly spaced color stops between two OKLCH endpoints and pad to
// kMaxColors with generated hue-wheel colors so unused slots stay defined.
void fillEvenStops(PresetResult& out, Oklch c0, Oklch c1, int k) {
    int n = std::clamp(k, 1, kMaxColors);
    if (n == 1) {
        out.colors[0] = c0;
    } else {
        for (int i = 0; i < n; ++i) {
            float t = static_cast<float>(i) / static_cast<float>(n - 1);
            out.colors[i] = lerp(c0, c1, t);
        }
    }
    for (int i = n; i < kMaxColors; ++i) {
        out.colors[i] = { 0.65f, 0.14f, std::fmod(static_cast<float>(i * 36 + 20), 360.0f) };
    }
}

std::vector<float> tileRingsForClassification(const std::vector<Tile>& tiles, const ClassSpec& cs) {
    const size_t n = tiles.size();
    std::vector<float> rings(n, 0.0f);
    std::vector<float> cxs(n), cys(n);
    float maxX = 0.0f, maxY = 0.0f, maxR = 0.0f;
    for (size_t i = 0; i < n; ++i) {
        const TilePoint center = tileAreaCentroid(tiles[i]);
        const float cx = static_cast<float>(center.x);
        const float cy = static_cast<float>(center.y);
        cxs[i] = cx;
        cys[i] = cy;
        maxX = std::max(maxX, std::abs(cx));
        maxY = std::max(maxY, std::abs(cy));
        maxR = std::max(maxR, std::sqrt(cx * cx + cy * cy));
    }
    if (cs.ringChebyshev) {
        const float invX = maxX > 0.0f ? 1.0f / maxX : 1.0f;
        const float invY = maxY > 0.0f ? 1.0f / maxY : 1.0f;
        for (size_t i = 0; i < n; ++i) {
            rings[i] = std::clamp(std::max(std::abs(cxs[i]) * invX, std::abs(cys[i]) * invY), 0.0f, 1.0f);
        }
    } else {
        const float inv = maxR > 0.0f ? 1.0f / maxR : 1.0f;
        for (size_t i = 0; i < n; ++i) {
            rings[i] = std::clamp(std::sqrt(cxs[i] * cxs[i] + cys[i] * cys[i]) * inv, 0.0f, 1.0f);
        }
    }
    return rings;
}

} // namespace

// =============================================================================
// OKLCH to linear sRGB. Matches web/src/color/palette.ts (Björn Ottosson,
// 2020). Returned components are unclipped; out-of-gamut OKLCH points may
// produce values outside [0,1].
// =============================================================================

LinearRGB oklchToLinearSrgb(Oklch c) {
    const float hRad = c.H * static_cast<float>(kPi) / 180.0f;
    const float aL = c.C * std::cos(hRad);
    const float bL = c.C * std::sin(hRad);

    const float l_ = c.L + 0.3963377774f * aL + 0.2158037573f * bL;
    const float m_ = c.L - 0.1055613458f * aL - 0.0638541728f * bL;
    const float s_ = c.L - 0.0894841775f * aL - 1.2914855480f * bL;

    const float lc = l_ * l_ * l_;
    const float mc = m_ * m_ * m_;
    const float sc = s_ * s_ * s_;

    const float R =  4.0767416621f * lc - 3.3077115913f * mc + 0.2309699292f * sc;
    const float G = -1.2684380046f * lc + 2.6097574011f * mc - 0.3413193965f * sc;
    const float B = -0.0041960863f * lc - 0.7034186147f * mc + 1.7076147010f * sc;
    return { R, G, B };
}

// =============================================================================
// Linear sRGB → linear DisplayP3. Both colorspaces share the D65 whitepoint,
// so this is a pure 3x3 primaries transform — no chromatic adaptation needed.
// Matrix from the ICC profile derivation (see e.g. Apple's published
// DisplayP3-D65 → linear sRGB-D65 inverse, transposed).
// =============================================================================

LinearRGB linearSrgbToLinearP3(LinearRGB s) {
    return {
        0.8224621f * s.r + 0.1775379f * s.g + 0.0f       * s.b,
        0.0331941f * s.r + 0.9668059f * s.g + 0.0f       * s.b,
        0.0170827f * s.r + 0.0723974f * s.g + 0.9105199f * s.b,
    };
}

// =============================================================================
// Colorspace-aware entry point. See color.h for which path each swapchain
// configuration takes.
// =============================================================================

ShaderColor oklchToShaderColor(Oklch c, float alpha, bool wideGamutP3, bool linearOutput) {
    LinearRGB lin = oklchToLinearSrgb(c);
    if (wideGamutP3) {
        LinearRGB p3 = linearSrgbToLinearP3(lin);
        // P3-NONLINEAR uses the sRGB piecewise EOTF. The 10-bit packed
        // UNORM swapchain has no hardware EOTF, so we encode here.
        return { srgbEncode(p3.r), srgbEncode(p3.g), srgbEncode(p3.b), alpha };
    }
    if (linearOutput) {
        // Hardware sRGB encode happens on store; write linear, clamped to
        // [0,1] because the UNORM target can't represent negatives.
        const float r = std::clamp(lin.r, 0.0f, 1.0f);
        const float g = std::clamp(lin.g, 0.0f, 1.0f);
        const float b = std::clamp(lin.b, 0.0f, 1.0f);
        return { r, g, b, alpha };
    }
    // Pre-encoded sRGB for a _UNORM swapchain (no HW gamma).
    return { srgbEncode(lin.r), srgbEncode(lin.g), srgbEncode(lin.b), alpha };
}

// =============================================================================
// Palette presets mirror web/src/color/palette.ts.
// =============================================================================

PresetResult buildPreset(Preset p, int k, const Oklch* customSource, float spectral) {
    PresetResult out{};
    const int kk = std::clamp(k, 1, kMaxColors);

    switch (p) {
        case Preset::BW: {
            out.bg = { 0.0f, 0.0f, 0.0f };
            for (int i = 0; i < kMaxColors; ++i) {
                out.colors[i] = { (i & 1) == 0 ? 0.0f : 1.0f, 0.0f, 0.0f };
            }
            break;
        }
        case Preset::Greys: {
            out.bg = { 0.0f, 0.0f, 0.0f };
            if (kk <= 2) {
                out.colors[0] = { 0.32f, 0.0f, 0.0f };
                out.colors[1] = { 0.78f, 0.0f, 0.0f };
                for (int i = 2; i < kMaxColors; ++i) {
                    out.colors[i] = { 0.65f, 0.14f, std::fmod(static_cast<float>(i * 36 + 20), 360.0f) };
                }
            } else {
                fillEvenStops(out, { 0.12f, 0.0f, 0.0f }, { 0.92f, 0.0f, 0.0f }, kk);
            }
            break;
        }
        case Preset::Prism: {
            out.bg = { 0.0f, 0.0f, 0.0f };
            if (kk <= 2) {
                out.colors[0] = { 0.65f, 0.27f, 0.0f };
                out.colors[1] = { 0.92f, 0.18f, 95.0f };
                for (int i = 2; i < kMaxColors; ++i) {
                    out.colors[i] = { 0.65f, 0.14f, std::fmod(static_cast<float>(i * 36 + 20), 360.0f) };
                }
            } else {
                out.colors[0] = { 0.0f, 0.0f, 0.0f };
                const int inner = kk - 2;
                for (int i = 0; i < inner; ++i) {
                    float hue = std::fmod(static_cast<float>(i) * 360.0f / static_cast<float>(inner) + 30.0f, 360.0f);
                    out.colors[1 + i] = { 0.65f, 0.18f, hue };
                }
                out.colors[kk - 1] = { 1.0f, 0.0f, 0.0f };
                for (int i = kk; i < kMaxColors; ++i) {
                    out.colors[i] = { 0.65f, 0.14f, std::fmod(static_cast<float>(i * 36 + 20), 360.0f) };
                }
            }
            break;
        }
        case Preset::Paper: {
            out.bg = { 0.96f, 0.005f, 80.0f };
            fillEvenStops(out, { 0.86f, 0.02f, 80.0f }, { 0.16f, 0.02f, 280.0f }, kk);
            break;
        }
        case Preset::Gold: {
            out.bg = { 0.04f, 0.005f, 280.0f };
            fillEvenStops(out, { 0.18f, 0.02f, 280.0f }, { 0.78f, 0.13f, 80.0f }, kk);
            break;
        }
        case Preset::Rust: {
            out.bg = { 0.08f, 0.04f, 30.0f };
            fillEvenStops(out, { 0.20f, 0.06f, 30.0f }, { 0.72f, 0.18f, 35.0f }, kk);
            break;
        }
        case Preset::Plum: {
            out.bg = { 0.06f, 0.02f, 320.0f };
            fillEvenStops(out, { 0.22f, 0.08f, 320.0f }, { 0.72f, 0.16f, 350.0f }, kk);
            break;
        }
        case Preset::Cobalt: {
            out.bg = { 0.06f, 0.02f, 260.0f };
            fillEvenStops(out, { 0.18f, 0.06f, 260.0f }, { 0.72f, 0.16f, 240.0f }, kk);
            break;
        }
        case Preset::Sage: {
            out.bg = { 0.08f, 0.012f, 150.0f };
            fillEvenStops(out, { 0.32f, 0.04f, 150.0f }, { 0.78f, 0.10f, 140.0f }, kk);
            break;
        }
        case Preset::Spectra: {
            out.bg = { 0.04f, 0.005f, 280.0f };
            const int denom = std::max(kk, 1);
            for (int i = 0; i < kMaxColors; ++i) {
                float hue = std::fmod(static_cast<float>(i) * 360.0f / static_cast<float>(denom) + 30.0f, 360.0f);
                out.colors[i] = { 0.65f, 0.18f, hue };
            }
            break;
        }
        case Preset::Girih: {
            out.bg = { 0.12f, 0.018f, 250.0f };
            const Oklch girih[6] = {
                { 0.92f, 0.04f,  85.0f },
                { 0.42f, 0.10f, 220.0f },
                { 0.66f, 0.12f, 200.0f },
                { 0.62f, 0.14f,  60.0f },
                { 0.30f, 0.06f,  20.0f },
                { 0.78f, 0.15f,  90.0f },
            };
            for (int i = 0; i < 6; ++i) out.colors[i] = girih[i];
            for (int i = 6; i < kMaxColors; ++i) {
                out.colors[i] = { 0.65f, 0.14f, std::fmod(static_cast<float>(i * 36 + 20), 360.0f) };
            }
            break;
        }
        case Preset::Custom: {
            // User-authored OKLCH slots come in via `customSource`; the
            // background tracks the first slot so a Custom palette never
            // shows raw black behind it unless the user picks black.
            if (customSource != nullptr) {
                for (int i = 0; i < kMaxColors; ++i) out.colors[i] = customSource[i];
                out.bg = customSource[0];
            } else {
                fillEvenStops(out, { 0.18f, 0.02f, 280.0f }, { 0.78f, 0.13f, 80.0f }, kk);
                out.bg = { 0.04f, 0.005f, 280.0f };
            }
            break;
        }
        case Preset::Count_: break;
    }
    mixWithSpectra(out, kk, spectral);
    return out;
}

// =============================================================================
// Tile classification mirrors classifyTriangles() in web/src/tiling/geometry.ts.
// =============================================================================

Classification classify(const std::vector<Tile>& tiles,
                        Family family,
                        ColorMode mode,
                        int colorCount) {
    Classification c;
    const size_t n = tiles.size();
    c.bucket.resize(n);
    const ClassSpec& cs = familyInfo(family).cls;
    const int k = std::clamp(colorCount, 1, kMaxColors);

    if (mode == ColorMode::Type) {
        // One bucket per distinct tile kind. Gailiunas spirals carry the arm
        // index in `type`, so setting Slots to the seed's arm count maps arm i
        // to palette slot i like the source notebook's "color count = arms".
        const int tb = typeBucketCount(tiles, family, cs);
        c.numBuckets = tb;
        for (size_t i = 0; i < n; ++i)
            c.bucket[i] = static_cast<uint8_t>(tiles[i].type % tb);
    } else if (mode == ColorMode::Orient) {
        const int ob = cs.orientBuckets > 0 ? cs.orientBuckets : 1;
        c.numBuckets = ob;
        if (cs.orientFromType) {
            // Orientation is carried directly by the tile's `type` field.
            for (size_t i = 0; i < n; ++i)
                c.bucket[i] = static_cast<uint8_t>(tiles[i].type % ob);
        } else {
            // Bin the direction of edge v[angA] -> v[angB] into `ob` slots.
            // A de Bruijn rhomb edge is undirected — its angle only spans
            // [0,pi) — so when orientHalfTurn is set, fold mod pi so every
            // slot is reachable instead of just the lower half.
            const double span  = cs.orientHalfTurn ? kPi : 2.0 * kPi;
            const double denom = span / ob;
            for (size_t i = 0; i < n; ++i) {
                const Tile& t = tiles[i];
                const float dx = t.x[cs.angB] - t.x[cs.angA];
                const float dy = t.y[cs.angB] - t.y[cs.angA];
                double ang = std::atan2(static_cast<double>(dy),
                                        static_cast<double>(dx));
                if (ang < 0.0) ang += 2.0 * kPi;
                if (cs.orientHalfTurn && ang >= kPi) ang -= kPi;
                int bin = static_cast<int>(std::floor((ang + denom * 0.5) / denom));
                bin = ((bin % ob) + ob) % ob;
                c.bucket[i] = static_cast<uint8_t>(bin);
            }
        }
    } else if (mode == ColorMode::Ring) {
        c.numBuckets = k;
        const std::vector<float> rings = tileRingsForClassification(tiles, cs);
        for (size_t i = 0; i < n; ++i) {
            int bin = static_cast<int>(std::floor(rings[i] * static_cast<float>(k)));
            if (bin >= k) bin = k - 1;
            if (bin < 0) bin = 0;
            c.bucket[i] = static_cast<float>(bin);
        }
    } else { // Phase
        c.numBuckets = 0;
        const int classCount = std::max(1, typeBucketCount(tiles, family, cs));
        if (family == Family::GailiunasSpiral) {
            std::vector<int> perArm(classCount, 0);
            for (size_t i = 0; i < n; ++i) {
                const int arm = std::clamp(static_cast<int>(tiles[i].type), 0, classCount - 1);
                perArm[arm] += 1;
            }
            std::vector<int> seen(classCount, 0);
            for (size_t i = 0; i < n; ++i) {
                const int arm = std::clamp(static_cast<int>(tiles[i].type), 0, classCount - 1);
                const int count = std::max(1, perArm[arm]);
                const float progress = count > 1 ? static_cast<float>(seen[arm]) / static_cast<float>(count - 1) : 0.0f;
                seen[arm] += 1;
                c.bucket[i] = (static_cast<float>(arm) + progress) / static_cast<float>(classCount);
            }
        } else {
            const std::vector<float> rings = tileRingsForClassification(tiles, cs);
            // Finite sentinels: -ffast-math makes infinity (and isfinite) UB,
            // so an untouched class is detected by min > max instead.
            std::vector<float> minRing(classCount, std::numeric_limits<float>::max());
            std::vector<float> maxRing(classCount, std::numeric_limits<float>::lowest());
            for (size_t i = 0; i < n; ++i) {
                const int cls = std::clamp(static_cast<int>(tiles[i].type), 0, classCount - 1);
                minRing[cls] = std::min(minRing[cls], rings[i]);
                maxRing[cls] = std::max(maxRing[cls], rings[i]);
            }
            for (size_t i = 0; i < n; ++i) {
                const int cls = std::clamp(static_cast<int>(tiles[i].type), 0, classCount - 1);
                const bool touched = minRing[cls] <= maxRing[cls];
                const float lo = touched ? minRing[cls] : 0.0f;
                const float hi = touched ? maxRing[cls] : lo;
                const float progress = std::clamp((rings[i] - lo) / std::max(1e-6f, hi - lo), 0.0f, 1.0f);
                c.bucket[i] = (static_cast<float>(cls) + progress) / static_cast<float>(classCount);
            }
        }
    }
    return c;
}

} // namespace penrose
