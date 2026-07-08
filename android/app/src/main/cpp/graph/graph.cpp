#include "graph/graph.h"

#include "log.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <memory>
#include <sstream>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace penrose::graph {

namespace {

// -----------------------------------------------------------------------------
// NodeKind registry. Adding a node = one row here + one ctor branch below.
// -----------------------------------------------------------------------------

const NodeDescriptor kDescriptors[] = {
    // Labels stay ASCII so we don't depend on Latin-1 / supplemental
    // glyphs in the default ImGui font atlas.
    { NodeKind::SrcBand0,        "Band 1 - sub-bass",   "Source"   },
    { NodeKind::SrcBand1,        "Band 2 - bass",       "Source"   },
    { NodeKind::SrcBand2,        "Band 3 - low-mid",    "Source"   },
    { NodeKind::SrcBand3,        "Band 4 - mid",        "Source"   },
    { NodeKind::SrcBand4,        "Band 5 - high-mid",   "Source"   },
    { NodeKind::SrcBand5,        "Band 6 - presence",   "Source"   },
    { NodeKind::SrcBand6,        "Band 7 - brilliance", "Source"   },
    { NodeKind::SrcBand7,        "Band 8 - air",        "Source"   },
    { NodeKind::SrcBeat,         "Beat envelope",       "Source"   },
    { NodeKind::SrcTime,         "Time (seconds)",      "Source"   },
    { NodeKind::SrcConstant,     "Constant",            "Source"   },
    { NodeKind::OpAdd,           "Add",                 "Operator" },
    { NodeKind::OpMultiply,      "Multiply",            "Operator" },
    { NodeKind::OpClamp,         "Clamp",               "Operator" },
    { NodeKind::OpSmoothstep,    "Smoothstep edge",     "Operator" },
    { NodeKind::OpMix,           "Mix (lerp)",          "Operator" },
    { NodeKind::OpAbs,           "Abs",                 "Operator" },
    { NodeKind::OpInvert,        "Invert pivot",        "Operator" },
    { NodeKind::OpScaleBias,     "Scale + Bias",        "Operator" },
    { NodeKind::OutRippleAmount, "Ripple amplitude",    "Target"   },
    { NodeKind::OutRippleSpeed,  "Ripple speed",        "Target"   },
    { NodeKind::OutBrightness,   "Brightness",          "Target"   },
    { NodeKind::OutDepthAmount,  "Depth",               "Target"   },
    { NodeKind::OutMatRoughness, "Roughness",           "Target"   },
    { NodeKind::OutMatMetalness, "Metalness",           "Target"   },
    { NodeKind::OutMatSheen,     "Sheen",               "Target"   },
    { NodeKind::OutMatClearcoat, "Clearcoat",           "Target"   },
    { NodeKind::OutMatAnisotropy,"Anisotropy",          "Target"   },
    { NodeKind::OutMatIridescence,"Iridescence",        "Target"   },
    { NodeKind::OutMatEmissive,  "Emissive glow",       "Target"   },
    { NodeKind::OutMatRelief,    "Surface relief",      "Target"   },
    { NodeKind::OutLightAngle,     "Light angle",       "Target"   },
    { NodeKind::OutLightElevation, "Light elevation",   "Target"   },
    { NodeKind::OutLightIntensity, "Light intensity",   "Target"   },
    { NodeKind::OutLightWarmth,     "Light warmth",     "Target"   },
    { NodeKind::OutLightAmbient,    "Ambient level",    "Target"   },
    { NodeKind::OutHypBoostX,      "Hyperbolic boost X","Target"   },
    { NodeKind::OutHypBoostY,      "Hyperbolic boost Y","Target"   },
    { NodeKind::OutHypScale,       "Hyperbolic scale",  "Projection" },
    { NodeKind::SrcPageScroll,   "Home-screen scroll",  "Source"   },
    { NodeKind::SrcRms,          "RMS level",           "Source"   },
    { NodeKind::SrcSpectralFlux, "Spectral flux",       "Source"   },
    { NodeKind::SrcOnsetStrength,"Onset strength",      "Source"   },
    { NodeKind::SrcCwtTransient, "CWT transient",       "Source"   },
    { NodeKind::SrcCrestFactor,  "Crest factor",        "Source"   },
    { NodeKind::SrcBeatConfidence,"Beat confidence",    "Source"   },
    { NodeKind::OpThresholdCompare,"Threshold compare", "Operator" },
    { NodeKind::OpLag,           "Lag",                 "Operator" },
    { NodeKind::OpGain,          "Gain",                "Operator" },
    { NodeKind::OpBias,          "Bias",                "Operator" },
    { NodeKind::OpSmooth,        "Smooth",              "Operator" },
    { NodeKind::OpMap,           "Map range",           "Operator" },
    { NodeKind::OpEnvelope,      "Envelope",            "Operator" },
    { NodeKind::OpGate,          "Gate",                "Operator" },
    { NodeKind::OpMath,          "Math",                "Operator" },
    { NodeKind::OpSampleHold,    "Sample + hold",       "Operator" },
    { NodeKind::SrcBass,         "Bass",                "Source"   },
    { NodeKind::SrcMid,          "Mid",                 "Source"   },
    { NodeKind::SrcHigh,         "High",                "Source"   },
    { NodeKind::OutOrnamentAmount, "Ornament amount",   "Target"   },
    { NodeKind::OutOrnamentWidth,  "Ornament width",    "Target"   },
    { NodeKind::OutOrnamentPhase,  "Ornament phase",    "Target"   },
    { NodeKind::OutOrnamentStyle,  "Ornament motif",    "Target"   },
    { NodeKind::OutOrnamentDensity,"Ornament density",  "Target"   },
    { NodeKind::OutOrnamentTwist,  "Ornament twist",    "Target"   },
    { NodeKind::OpAmplitudeMod,    "AM",                "Operator" },
    { NodeKind::OpPhaseMod,        "PM Osc",            "Operator" },
    { NodeKind::OpBeatOsc,         "Beat Osc",          "Operator" },
    { NodeKind::SrcTempo,          "Tempo",             "Source"   },
    { NodeKind::OutSurfaceContourAmount,  "Contour amount",  "Target" },
    { NodeKind::OutSurfaceContourSpacing, "Contour spacing", "Target" },
    { NodeKind::OutSurfaceContourWidth,   "Contour width",   "Target" },
    { NodeKind::OutSurfaceContourPhase,   "Contour phase",   "Target" },
    { NodeKind::OutSurfaceContourSource,  "Contour source",  "Target" },
    { NodeKind::OutMatRoughMod,    "Worn-edge variation", "Target" },
    { NodeKind::OutMatMetalMod,    "Tile metal variation", "Target" },
    { NodeKind::OutLightChoreoAmount, "Light choreography", "Target" },
    { NodeKind::OutLightChoreoSpeed,  "Light choreo speed", "Target" },
    { NodeKind::OutLightChoreoSource, "Light choreo source", "Target" },
    { NodeKind::OutEdgeProfileWidth,  "Inner edge profile", "Target" },
    { NodeKind::OutEdgeProfileGlow,   "Inner edge glow",    "Target" },
    { NodeKind::OutEdgeProfileLight,  "Inner edge light",   "Target" },
    { NodeKind::OutEdgeProfileChroma, "Inner edge color",   "Target" },
    { NodeKind::OutEdgeProfileHue,    "Inner edge hue",     "Target" },
    { NodeKind::OutSurfaceContourLight,  "Contour light",   "Target" },
    { NodeKind::OutSurfaceContourChroma, "Contour color",   "Target" },
    { NodeKind::OutSurfaceContourHue,    "Contour hue",     "Target" },
};
static_assert(sizeof(kDescriptors) / sizeof(kDescriptors[0])
                  == static_cast<size_t>(NodeKind::Count_),
              "NodeKind / kDescriptors out of sync");

inline float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }

inline float boundedSignal(float v) {
    if (!std::isfinite(v)) return 0.0f;
    return std::clamp(v, -4.0f, 4.0f);
}

inline float finiteSignal(float v) {
    return std::isfinite(v) ? v : 0.0f;
}

inline float smoothingAlpha(float seconds, float dtSeconds) {
    if (seconds <= 0.0f) return 1.0f;
    if (dtSeconds <= 0.0f) return 0.0f;
    return std::clamp(1.0f - std::exp(-dtSeconds / seconds), 0.0f, 1.0f);
}

// -----------------------------------------------------------------------------
// FlowNode subclasses. One class per category — the kind enum drives the
// per-instance pin layout + behaviour rather than a class explosion.
// -----------------------------------------------------------------------------

// The eight audio-band sources, ordered sub-bass -> air.
inline bool isBandKind(NodeKind k) {
    return k >= NodeKind::SrcBand0 && k <= NodeKind::SrcBand7;
}

// Header colours for the band nodes, low to high — a spectrum ramp
// (indigo -> teal -> green -> amber -> red) so a glance reads frequency.
const ImU32 kBandHeader[8] = {
    IM_COL32( 63,  68, 156, 255),
    IM_COL32( 54, 108, 178, 255),
    IM_COL32( 48, 152, 168, 255),
    IM_COL32( 56, 158,  96, 255),
    IM_COL32(120, 164,  58, 255),
    IM_COL32(196, 158,  52, 255),
    IM_COL32(202, 110,  46, 255),
    IM_COL32(190,  68,  72, 255),
};

// Pixel width of the widest band label. Each band node pads its body to
// this so the eight render as one uniform-width column.
inline float widestBandLabelWidth() {
    float w = 0.0f;
    for (int b = 0; b < 8; ++b) {
        const auto k = static_cast<NodeKind>(
            static_cast<int>(NodeKind::SrcBand0) + b);
        w = std::max(w, ImGui::CalcTextSize(descriptor(k).label).x);
    }
    return w;
}

// Pixel width of the widest Target label. Used by every TargetNode to
// pad its body so the right-side stack is uniform-width regardless of
// which Targets the user has wired in.
inline float widestTargetLabelWidth() {
    float w = 0.0f;
    for (int i = 0; i < descriptorCount(); ++i) {
        const NodeDescriptor& d = descriptors()[i];
        if (std::string_view(d.category) != "Target") continue;
        w = std::max(w, ImGui::CalcTextSize(d.label).x);
    }
    return w;
}

class SourceNode : public FlowNode {
public:
    SourceNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        if (k == NodeKind::SrcConstant) p0 = 0.5f;
        // Colour-code the band nodes by frequency. Other sources keep the
        // library default (addNode assigns it when the ctor sets none).
        if (isBandKind(k)) {
            const int b = static_cast<int>(k)
                        - static_cast<int>(NodeKind::SrcBand0);
            setStyle(std::make_shared<ImFlow::NodeStyle>(
                kBandHeader[b], ImColor(233, 241, 244, 255), 6.5f));
        }
        addOUT<float>("signal")->behaviour([this] { return sample(); });
    }

    // Band nodes pad their body to a shared width; SrcConstant gets an
    // inline value display + drag-bar + step buttons; the remaining
    // sources (beat / time / page scroll) pull straight from the
    // EvalContext and have nothing to tune.
    void draw() override {
        if (isBandKind(kind_)) {
            ImGui::Dummy(ImVec2(widestBandLabelWidth(), 0.0f));
            return;
        }
        if (kind_ == NodeKind::SrcTempo) {
            ImGui::Text("Tempo  %.1f BPM", static_cast<double>(graph_->context().bpm));
            return;
        }
        if (kind_ != NodeKind::SrcConstant) return;
        // Large, unambiguous value readout so the current setting is
        // legible at a glance — the old slider format string buried
        // the value inside a 12px-tall track and a touchscreen drag on
        // a tile that small was unreliable.
        ImGui::Text("Value  %.3f", static_cast<double>(p0));
        // DragFloat accepts a drag anywhere on the bar (not just the
        // thumb) which is the touch-friendly way to nudge a value. The
        // range goes well past 0..1 so this node is useful with
        // Multiply / ScaleBias for amplifying upstream signals, not
        // just as a 0..1 mixer level.
        ImGui::SetNextItemWidth(180.0f);
        ImGui::DragFloat("##value", &p0, 0.005f, -10.0f, 10.0f, "%.3f");
        // Coarse / fine step buttons — the only way to set a precise
        // value without an OS soft keyboard. Pairs cover ±1 and ±0.1
        // which is enough to land any common value (0, 0.25, 0.5, 1,
        // 2, π/4...) in a few taps.
        const ImVec2 kBtn(32.0f, 28.0f);
        if (ImGui::Button("-1",  kBtn)) p0 -= 1.0f;
        ImGui::SameLine();
        if (ImGui::Button("-.1", kBtn)) p0 -= 0.1f;
        ImGui::SameLine();
        if (ImGui::Button("+.1", kBtn)) p0 += 0.1f;
        ImGui::SameLine();
        if (ImGui::Button("+1",  kBtn)) p0 += 1.0f;
        // Common presets — single tap snaps to a familiar value.
        if (ImGui::Button("0",   kBtn)) p0 = 0.0f;
        ImGui::SameLine();
        if (ImGui::Button("0.5", kBtn)) p0 = 0.5f;
        ImGui::SameLine();
        if (ImGui::Button("1",   kBtn)) p0 = 1.0f;
        ImGui::SameLine();
        if (ImGui::Button("2",   kBtn)) p0 = 2.0f;
        p0 = std::clamp(p0, -10.0f, 10.0f);
    }

private:
    float sample() const {
        const EvalContext& c = graph_->context();
        switch (kind_) {
            case NodeKind::SrcBand0:    return c.bands[0];
            case NodeKind::SrcBand1:    return c.bands[1];
            case NodeKind::SrcBand2:    return c.bands[2];
            case NodeKind::SrcBand3:    return c.bands[3];
            case NodeKind::SrcBand4:    return c.bands[4];
            case NodeKind::SrcBand5:    return c.bands[5];
            case NodeKind::SrcBand6:    return c.bands[6];
            case NodeKind::SrcBand7:    return c.bands[7];
            case NodeKind::SrcBass:       return c.bass;
            case NodeKind::SrcMid:        return c.mid;
            case NodeKind::SrcHigh:       return c.high;
            case NodeKind::SrcBeat:       return c.beat;
            case NodeKind::SrcRms:        return c.rms;
            case NodeKind::SrcSpectralFlux: return c.spectralFlux;
            case NodeKind::SrcOnsetStrength: return c.onsetStrength;
            case NodeKind::SrcCwtTransient: return c.cwtTransient;
            case NodeKind::SrcCrestFactor: return c.crestFactor;
            case NodeKind::SrcBeatConfidence: return c.beatConfidence;
            case NodeKind::SrcTempo:      return std::clamp((c.bpm - 60.0f) / 140.0f, 0.0f, 1.0f);
            case NodeKind::SrcTime:       return c.timeSec;
            case NodeKind::SrcPageScroll: return c.pageScroll;
            case NodeKind::SrcConstant:   return p0;
            default:                    return 0.0f;
        }
    }
};

class OperatorNode : public FlowNode {
public:
    OperatorNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        auto filt = [g](ImFlow::Pin* out, ImFlow::Pin* in) {
            return g && g->canConnect(out, in);
        };
        switch (k) {
            case NodeKind::OpAdd:
                p0 = 0.0f;
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                break;
            case NodeKind::OpMultiply:
                p0 = 1.0f;
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                break;
            case NodeKind::OpMix:
                p0 = 0.5f;
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                addIN<float>("mix", 0.0f, filt);
                break;
            case NodeKind::OpClamp:
            case NodeKind::OpSmoothstep:
                p0 = 0.0f; p1 = 1.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpScaleBias:
                p0 = 1.0f; p1 = 0.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpThresholdCompare:
                p0 = 0.5f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpLag:
                p0 = 0.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpGain:
                p0 = 1.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpBias:
            case NodeKind::OpSmooth:
                p0 = 0.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpMap:
                p0 = 0.0f; p1 = 1.0f; p2 = 0.0f; p3 = 1.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpEnvelope:
                p0 = 0.5f; p1 = 0.0f; p2 = 0.0f;
                addIN<float>("gate", 0.0f, filt);
                break;
            case NodeKind::OpGate:
                p0 = 0.55f; p1 = 0.45f; p2 = 0.08f;
                p3 = 0.03f; p4 = 0.25f; p5 = 0.0f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpMath:
                p0 = 1.0f; p1 = 2.0f;
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                break;
            case NodeKind::OpSampleHold:
                p0 = 0.5f;
                addIN<float>("signal", 0.0f, filt);
                addIN<float>("trigger", 0.0f, filt);
                break;
            case NodeKind::OpAmplitudeMod:
                p0 = 1.0f; p1 = 0.5f;
                addIN<float>("carrier", 0.0f, filt);
                addIN<float>("modulator", 0.5f, filt);
                break;
            case NodeKind::OpPhaseMod:
                p0 = 1.0f; p1 = 1.0f; p2 = 0.0f;
                addIN<float>("phase", 0.0f, filt);
                addIN<float>("modulator", 0.0f, filt);
                break;
            case NodeKind::OpBeatOsc:
                p0 = 4.0f; p1 = 4.25f; p2 = 0.0f;
                addIN<float>("phase", 0.0f, filt);
                break;
            case NodeKind::OpInvert:
                p0 = 0.5f;
                addIN<float>("signal", 0.0f, filt);
                break;
            case NodeKind::OpAbs:
                addIN<float>("signal", 0.0f, filt);
                break;
            default: break;
        }
        const char* primaryOut = k == NodeKind::OpThresholdCompare ? "gate" : "signal";
        addOUT<float>(primaryOut)->behaviour([this] { return computeCached(); });
        if (k == NodeKind::OpGate) {
            addOUT<float>("gate")->behaviour([this] {
                computeCached();
                return flag0 ? 1.0f : 0.0f;
            });
        }
        if (k == NodeKind::OpBeatOsc) {
            addOUT<float>("envelope")->behaviour([this] {
                computeCached();
                return cacheAux_;
            });
        }
    }

    void draw() override {
        ImGui::Dummy(ImVec2(150.0f, 0.0f));
    }

private:
    bool inputConnected(const char* name) {
        return inPin(name)->isConnected();
    }

    float computeCached() {
        const uint64_t serial = graph_->evalSerial();
        if (cacheValid_ && serial == cacheSerial_) return cacheValue_;
        cacheSerial_ = serial;
        cacheValue_ = compute();
        cacheValid_ = true;
        return cacheValue_;
    }

    float compute() {
        switch (kind_) {
            case NodeKind::OpAdd:
                return getInVal<float>("a") + getInVal<float>("b") + p0;
            case NodeKind::OpMultiply:
                return getInVal<float>("a")
                    * (inputConnected("b") ? getInVal<float>("b") : 1.0f)
                    * p0;
            case NodeKind::OpClamp:
                return std::max(p0, std::min(p1, getInVal<float>("signal")));
            case NodeKind::OpSmoothstep: {
                const float x = getInVal<float>("signal");
                if (p1 - p0 < 1e-6f) return 0.0f;
                const float t = clamp01((x - p0) / (p1 - p0));
                return t * t * (3.0f - 2.0f * t);
            }
            case NodeKind::OpMix: {
                const float a = getInVal<float>("a");
                const float b = getInVal<float>("b");
                const float t = clamp01(inputConnected("mix") ? getInVal<float>("mix") : p0);
                return a * (1.0f - t) + b * t;
            }
            case NodeKind::OpAbs:       return std::fabs(getInVal<float>("signal"));
            case NodeKind::OpInvert:    return p0 * 2.0f - getInVal<float>("signal");
            case NodeKind::OpScaleBias: return getInVal<float>("signal") * p0 + p1;
            case NodeKind::OpThresholdCompare:
                return getInVal<float>("signal") >= p0 ? 1.0f : 0.0f;
            case NodeKind::OpLag: {
                const float x = getInVal<float>("signal");
                const float dt = std::max(0.0f, graph_->context().dtSeconds);
                const float alpha = smoothingAlpha(p0, dt);
                state0 += (x - state0) * alpha;
                return state0;
            }
            case NodeKind::OpGain:
                return getInVal<float>("signal") * p0;
            case NodeKind::OpBias:
                return getInVal<float>("signal") + p0;
            case NodeKind::OpSmooth: {
                const float amount = clamp01(p0);
                const float alpha = std::max(0.04f, 1.0f - amount * 0.96f);
                state0 += (getInVal<float>("signal") - state0) * alpha;
                return state0;
            }
            case NodeKind::OpMap: {
                const float denom = p1 - p0;
                const float t = std::fabs(denom) < 1e-6f
                    ? 0.0f
                    : (getInVal<float>("signal") - p0) / denom;
                return p2 + clamp01(t) * (p3 - p2);
            }
            case NodeKind::OpEnvelope: {
                const float gate = getInVal<float>("gate") >= p0 ? 1.0f : 0.0f;
                const float dt = std::max(0.0f, graph_->context().dtSeconds);
                const float alpha = gate > state0
                    ? smoothingAlpha(p1, dt)
                    : smoothingAlpha(p2, dt);
                state0 += (gate - state0) * alpha;
                return state0;
            }
            case NodeKind::OpGate: {
                const float value = getInVal<float>("signal");
                const float now = graph_->context().timeSec;
                if (!flag0 && value >= p0) {
                    flag0 = true;
                    state1 = now;
                }
                if (flag0 && value <= p1) {
                    if (now - state1 >= std::max(0.0f, p2)) {
                        flag0 = false;
                        state1 = now;
                    }
                }
                if (flag0 && value > p1) state1 = now;
                const float target = flag0 ? 1.0f : clamp01(p5);
                const float dt = std::max(0.0f, graph_->context().dtSeconds);
                const float alpha = target > state0
                    ? smoothingAlpha(std::max(0.0f, p3), dt)
                    : smoothingAlpha(std::max(0.0f, p4), dt);
                state0 += (target - state0) * alpha;
                return value * state0;
            }
            case NodeKind::OpMath: {
                const float a = getInVal<float>("a");
                const float b = inputConnected("b") ? getInVal<float>("b") : p0;
                const int op = std::clamp(static_cast<int>(std::round(p1)), 0, 3);
                if (op == 0) return a + b;
                if (op == 1) return a - b;
                if (op == 2) return a * b;
                return std::fabs(b) < 1e-6f ? 0.0f : a / b;
            }
            case NodeKind::OpSampleHold: {
                const float signal = getInVal<float>("signal");
                const bool trigger = getInVal<float>("trigger") >= p0;
                if (trigger && !flag0) {
                    state0 = signal;
                    state1 = 1.0f;
                }
                flag0 = trigger;
                return state1 > 0.5f ? state0 : signal;
            }
            case NodeKind::OpAmplitudeMod: {
                const float carrier = getInVal<float>("carrier");
                const float bias = clamp01(p1);
                const float modulator = inputConnected("modulator")
                    ? getInVal<float>("modulator")
                    : bias;
                const float depth = std::clamp(p0, 0.0f, 2.0f);
                return boundedSignal(carrier * (1.0f + depth * (modulator - bias)));
            }
            case NodeKind::OpPhaseMod: {
                constexpr float kTau = 6.28318530717958647692f;
                const float depth = std::clamp(p0, 0.0f, 4.0f);
                const float cycles = std::clamp(p1, 0.0f, 16.0f);
                const float offset = clamp01(p2);
                const float phase = finiteSignal(getInVal<float>("phase") * cycles
                    + getInVal<float>("modulator") * depth
                    + offset);
                return 0.5f + 0.5f * std::sin(kTau * phase);
            }
            case NodeKind::OpBeatOsc: {
                constexpr float kTau = 6.28318530717958647692f;
                const float cyclesA = std::clamp(p0, 0.0f, 32.0f);
                const float cyclesB = std::clamp(p1, 0.0f, 32.0f);
                const float phase = finiteSignal(getInVal<float>("phase") + clamp01(p2));
                const float a = std::sin(kTau * phase * cyclesA);
                const float b = std::sin(kTau * phase * cyclesB);
                cacheAux_ = clamp01(std::fabs(std::cos(0.5f * kTau * phase * (cyclesA - cyclesB))));
                return clamp01(0.5f + 0.25f * (a + b));
            }
            default:                    return 0.0f;
        }
    }

    uint64_t cacheSerial_ = 0;
    float cacheValue_ = 0.0f;
    float cacheAux_ = 0.0f;
    bool cacheValid_ = false;
};

class TargetNode : public FlowNode {
public:
    TargetNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        addIN<float>("in", 0.0f, [g](ImFlow::Pin* out, ImFlow::Pin* in) {
            return g && g->canConnect(out, in);
        });
    }
    // Pad each Target node body to the widest Target label so the
    // right-side stack reads as one uniform column.
    void draw() override {
        ImGui::Dummy(ImVec2(widestTargetLabelWidth(), 0.0f));
    }
    float pull() { return getInVal<float>("in"); }
};

uint64_t spawn(ImFlow::ImNodeFlow& h, NodeKind k, ImVec2 pos, Graph* g) {
    if (static_cast<int>(k) < 0
        || static_cast<int>(k) >= descriptorCount()) return 0;
    const std::string_view cat = descriptor(k).category;
    if (cat == "Source")   return h.addNode<SourceNode>(pos,   k, g)->getUID();
    if (cat == "Operator") return h.addNode<OperatorNode>(pos, k, g)->getUID();
    if (cat == "Target")   return h.addNode<TargetNode>(pos,   k, g)->getUID();
    return 0;
}

// ImFlow's BaseNode::inPin / outPin assert-then-deref on a missing UID,
// which is fatal in release builds where assert is compiled out. We
// resolve pin lookups against the user-visible name list instead and
// return nullptr on miss, so a hand-edited save file with a renamed
// pin can be ignored rather than dereferencing past end().
ImFlow::Pin* findPinByName(const std::vector<std::shared_ptr<ImFlow::Pin>>& pins,
                           const std::string& name) {
    for (const auto& p : pins) {
        if (p && p->getName() == name) return p.get();
    }
    return nullptr;
}

ImFlow::Pin* findPinByNameOrAlias(const std::vector<std::shared_ptr<ImFlow::Pin>>& pins,
                                  const std::string& name) {
    if (ImFlow::Pin* exact = findPinByName(pins, name)) return exact;
    if (name == "out") {
        if (ImFlow::Pin* signal = findPinByName(pins, "signal")) return signal;
        return findPinByName(pins, "gate");
    }
    if (name == "x") return findPinByName(pins, "signal");
    if (name == "t") return findPinByName(pins, "mix");
    return nullptr;
}

// -----------------------------------------------------------------------------
// Minimal JSON reader. Our schema is fixed and small, so a recursive
// recursive-descent reader handles it in ~100 lines without pulling in a
// JSON dependency. The reader is forgiving of trailing commas and
// whitespace and silently skips unknown keys.
// -----------------------------------------------------------------------------

struct JsonReader {
    const char* p;
    const char* end;
    void skip() {
        while (p < end && (*p==' '||*p=='\t'||*p=='\n'||*p=='\r'||*p==',')) ++p;
    }
    bool match(char c) {
        skip();
        if (p < end && *p == c) { ++p; return true; }
        return false;
    }
    bool peek(char c) {
        skip();
        return p < end && *p == c;
    }
    bool atEnd() { skip(); return p >= end; }
    bool readString(std::string& out) {
        skip();
        if (p >= end || *p != '"') return false;
        ++p;
        out.clear();
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) { out.push_back(p[1]); p += 2; continue; }
            out.push_back(*p++);
        }
        if (p < end && *p == '"') ++p;
        return true;
    }
    bool readDouble(double& out) {
        skip();
        char* endptr = nullptr;
        out = std::strtod(p, &endptr);
        if (endptr == p) return false;
        p = endptr;
        return true;
    }
    bool skipValue() {
        skip();
        if (p >= end) return false;
        if (*p == '"') { std::string s; return readString(s); }
        if (*p == '{' || *p == '[') {
            const char open = *p++;
            const char close = (open == '{') ? '}' : ']';
            int depth = 1;
            while (p < end && depth > 0) {
                if (*p == '"') { std::string s; readString(s); continue; }
                if (*p == open)  ++depth;
                else if (*p == close) --depth;
                ++p;
            }
            return depth == 0;
        }
        double d;
        return readDouble(d);
    }
};

bool isExactPositiveJsonId(double value) {
    constexpr double kMaxExactJsonInteger = 9007199254740991.0; // 2^53 - 1
    return std::isfinite(value)
        && value > 0.0
        && value <= kMaxExactJsonInteger
        && std::floor(value) == value;
}

bool isIntJsonValue(double value, int minValue, int maxValue) {
    return std::isfinite(value)
        && value >= static_cast<double>(minValue)
        && value <= static_cast<double>(maxValue)
        && std::floor(value) == value;
}

bool isFiniteFloatJsonValue(double value) {
    constexpr double kMaxFiniteFloat = static_cast<double>(std::numeric_limits<float>::max());
    return std::isfinite(value) && value >= -kMaxFiniteFloat && value <= kMaxFiniteFloat;
}

} // namespace

// -----------------------------------------------------------------------------
// Public registry accessors
// -----------------------------------------------------------------------------

const NodeDescriptor& descriptor(NodeKind kind) {
    return kDescriptors[static_cast<int>(kind)];
}
const NodeDescriptor* descriptors() { return kDescriptors; }
int descriptorCount() { return static_cast<int>(NodeKind::Count_); }

// -----------------------------------------------------------------------------
// Graph
// -----------------------------------------------------------------------------

Graph::Graph() {
    // Keep ImNodeFlow's default extra_window_wrapper=true — it opens
    // its own viewport-sized "viewport_container" with NoBackground and
    // handles its own child canvas. Forcing it false to wrap manually
    // doubled up the Begin/End nesting around a sub-context-switching
    // BeginChild and was a likely source of the editor crash on first
    // open. Let the library own its window; we just position the
    // toolbar / parameter sheet on top afterwards.
    //
    // ImNodeFlow's live zoom (ContainedContext::m_scale) is latched from
    // default_zoom when the ContainedContext is constructed; afterwards
    // ContainedContext::begin() does not re-read it. default_zoom only
    // retargets the reset-zoom key, which a touchscreen never presses.
    // The editor therefore runs at scale 1.0; node legibility is the
    // layout's job (graph_ui.cpp arrangeNodes plus the per-node sizing in
    // this file), not a canvas zoom. Kept explicit and equal to the real
    // scale so a stray reset-zoom can't desync it.
    auto& cfg = handler_.getGrid().config();
    cfg.default_zoom = 1.0f;
    // ContainedContext fills its BeginChild with this colour as the
    // canvas backing. Drop the alpha so the wallpaper shows through the
    // editor while it is open — the user can see what audio / clock /
    // page-scroll modulation is doing to the tiles in real time while
    // wiring the graph, instead of staring at an opaque slab.
    cfg.color = IM_COL32(28, 34, 40, 130);
    // Leave scroll_button at ImNodeFlow's default (middle mouse). A
    // touchscreen never synthesises a middle button, so the canvas
    // never pans and the scroll offset stays fixed at (0,0). The
    // editor is therefore a fixed board: GraphUi arranges every node
    // into the visible canvas and clamps each one inside it every
    // frame, so panning is neither possible nor needed and no node
    // can drift out of reach — which is exactly what made the old
    // left-drag-to-pan setup unusable (nodes stranded off-screen with
    // no way back).
    cfg.scroll_button = ImGuiMouseButton_Middle;
    resetToDefault();
}

Graph::~Graph() { teardown(); }

void Graph::teardown() {
    // Two-phase clear: sever every link via its input pin first, so each
    // OutPin destructor walks a list of already-expired weak_ptrs and
    // doesn't dereference dangling InPin pointers from sibling nodes
    // that the unordered_map clear() has already destroyed.
    auto& nodes = handler_.getNodes();
    for (auto& [uid, node] : nodes) {
        if (!node) continue;
        for (auto& ip : node->getIns()) {
            if (ip) ip->deleteLink();
        }
    }
    nodes.clear();
    handler_.get_recursion_blacklist().clear();
}

void Graph::resetToDefault() {
    teardown();
    defaultLayout_ = true;
    // Provisional positions only — GraphUi::arrangeNodes re-lays the
    // default graph into a grid fitted to the actual canvas once node
    // sizes are known (the intrinsic sizes are not available until a
    // node has been drawn once). These coordinates just keep the very
    // first frame from being a pile-up before that runs.
    //
    // Layout: two columns of sources on the left (8 bands in a 2×4
    // grid + beat/time on a 5th row), one column of targets on the
    // right. Widths picked so ImNodeFlow's intrinsic node sizing
    // (~200px wide × 80–140px tall) doesn't overlap neighbours.
    constexpr float kColX0     =  40.0f;   // left source column
    constexpr float kColX1     = 280.0f;   // right source column
    constexpr float kColX2     = 520.0f;   // tempo source column
    constexpr float kColXOut   = 720.0f;   // target column
    constexpr float kRowStep   = 110.0f;
    constexpr float kRowY0     =  40.0f;   // top row of bands

    // Bands 0..7 → 2 columns × 4 rows.
    for (int i = 0; i < 8; ++i) {
        const float x = (i < 4) ? kColX0 : kColX1;
        const float y = kRowY0 + (i % 4) * kRowStep;
        spawn(handler_,
              static_cast<NodeKind>(static_cast<int>(NodeKind::SrcBand0) + i),
              ImVec2(x, y),
              this);
    }
    // Beat / Time / Tempo on a 5th row below the bands, mirroring the column split.
    const float beatRowY = kRowY0 + 4 * kRowStep;
    spawn(handler_, NodeKind::SrcBeat, ImVec2(kColX0, beatRowY), this);
    spawn(handler_, NodeKind::SrcTime, ImVec2(kColX1, beatRowY), this);
    spawn(handler_, NodeKind::SrcTempo, ImVec2(kColX2, beatRowY), this);

    // Four targets stacked, vertically centred against the source
    // block. Source block spans y=40..480 (5 rows × 110, plus a row
    // height ≈ 70), so targets occupy y=80..430 — roughly the same
    // band of canvas, just on the right column.
    constexpr float kTargetRowStep = 130.0f;
    constexpr float kTargetY0      =  80.0f;
    spawn(handler_, NodeKind::OutRippleAmount,
          ImVec2(kColXOut, kTargetY0 + 0 * kTargetRowStep), this);
    spawn(handler_, NodeKind::OutRippleSpeed,
          ImVec2(kColXOut, kTargetY0 + 1 * kTargetRowStep), this);
    spawn(handler_, NodeKind::OutBrightness,
          ImVec2(kColXOut, kTargetY0 + 2 * kTargetRowStep), this);
    spawn(handler_, NodeKind::OutDepthAmount,
          ImVec2(kColXOut, kTargetY0 + 3 * kTargetRowStep), this);
}

uint64_t Graph::addNode(NodeKind kind, float x, float y) {
    return spawn(handler_, kind, ImVec2(x, y), this);
}

bool Graph::canConnect(ImFlow::Pin* out, ImFlow::Pin* in) {
    if (!out || !in) return false;
    if (out == in) return false;
    if (out->getType() != ImFlow::PinType_Output || in->getType() != ImFlow::PinType_Input) return false;
    if (out->getDataType() != in->getDataType()) return false;

    ImFlow::BaseNode* src = out->getParent();
    ImFlow::BaseNode* dst = in->getParent();
    if (!src || !dst || src == dst) return false;
    if (src->toDestroy() || dst->toDestroy()) return false;

    std::vector<ImFlow::BaseNode*> stack;
    std::unordered_set<ImFlow::BaseNode*> seen;
    stack.push_back(dst);
    while (!stack.empty()) {
        ImFlow::BaseNode* node = stack.back();
        stack.pop_back();
        if (!node || !seen.insert(node).second) continue;
        if (node == src) return false;
        for (const auto& weak : handler_.getLinks()) {
            const auto link = weak.lock();
            if (!link) continue;
            ImFlow::Pin* left = link->left();
            ImFlow::Pin* right = link->right();
            if (!left || !right) continue;
            if (right == in) continue;
            ImFlow::BaseNode* linkSrc = left->getParent();
            ImFlow::BaseNode* linkDst = right->getParent();
            if (!linkSrc || !linkDst || linkSrc->toDestroy() || linkDst->toDestroy()) continue;
            if (linkSrc == node) stack.push_back(linkDst);
        }
    }
    return true;
}

// Legacy targets are contiguous from OutRippleAmount .. OutHypBoostY.
// New target kinds append at the enum tail for saved-graph compatibility, so
// active target accumulation maps kinds through targetIndexForKind().
constexpr int kLegacyTargetCount = static_cast<int>(NodeKind::OutHypBoostY)
                                 - static_cast<int>(NodeKind::OutRippleAmount) + 1;
constexpr int kTargetCount = kLegacyTargetCount + 24;

int targetIndexForKind(NodeKind kind) {
    const int raw = static_cast<int>(kind);
    const int first = static_cast<int>(NodeKind::OutRippleAmount);
    if (raw >= first && raw <= static_cast<int>(NodeKind::OutHypBoostY)) {
        return raw - first;
    }
    switch (kind) {
        case NodeKind::OutOrnamentAmount: return kLegacyTargetCount + 0;
        case NodeKind::OutOrnamentWidth:  return kLegacyTargetCount + 1;
        case NodeKind::OutOrnamentPhase:  return kLegacyTargetCount + 2;
        case NodeKind::OutOrnamentStyle:  return kLegacyTargetCount + 3;
        case NodeKind::OutOrnamentDensity:return kLegacyTargetCount + 4;
        case NodeKind::OutOrnamentTwist:  return kLegacyTargetCount + 5;
        case NodeKind::OutSurfaceContourAmount:  return kLegacyTargetCount + 6;
        case NodeKind::OutSurfaceContourSpacing: return kLegacyTargetCount + 7;
        case NodeKind::OutSurfaceContourWidth:   return kLegacyTargetCount + 8;
        case NodeKind::OutSurfaceContourPhase:   return kLegacyTargetCount + 9;
        case NodeKind::OutSurfaceContourSource:  return kLegacyTargetCount + 10;
        case NodeKind::OutMatRoughMod:           return kLegacyTargetCount + 11;
        case NodeKind::OutMatMetalMod:           return kLegacyTargetCount + 12;
        case NodeKind::OutLightChoreoAmount:     return kLegacyTargetCount + 13;
        case NodeKind::OutLightChoreoSpeed:      return kLegacyTargetCount + 14;
        case NodeKind::OutLightChoreoSource:     return kLegacyTargetCount + 15;
        case NodeKind::OutEdgeProfileWidth:      return kLegacyTargetCount + 16;
        case NodeKind::OutEdgeProfileGlow:       return kLegacyTargetCount + 17;
        case NodeKind::OutEdgeProfileLight:      return kLegacyTargetCount + 18;
        case NodeKind::OutEdgeProfileChroma:     return kLegacyTargetCount + 19;
        case NodeKind::OutEdgeProfileHue:        return kLegacyTargetCount + 20;
        case NodeKind::OutSurfaceContourLight:   return kLegacyTargetCount + 21;
        case NodeKind::OutSurfaceContourChroma:  return kLegacyTargetCount + 22;
        case NodeKind::OutSurfaceContourHue:     return kLegacyTargetCount + 23;
        default:                          return -1;
    }
}

void Graph::evaluate(const EvalContext& ctx, EvalResult& out) {
    ctx_ = ctx;
    ++evalSerial_;
    // OutPin::val() memoizes per-frame by adding a marker to this list
    // and short-circuiting on subsequent reads. Reset before each pull
    // so frame N+1 actually recomputes instead of replaying frame N.
    handler_.get_recursion_blacklist().clear();

    // Accumulate every connected Target by stable kind index.
    float add[kTargetCount]  = {};
    bool  seen[kTargetCount] = {};
    for (auto& [uid, node] : handler_.getNodes()) {
        // Skip nodes the user deleted this frame — destroy() only marks
        // them; handler_.update() sweeps them afterwards. Evaluating one
        // would feed a stale target for the frame between the two.
        if (!node || node->toDestroy()) continue;
        auto* fn = dynamic_cast<FlowNode*>(node.get());
        if (!fn) continue;
        const int ti = targetIndexForKind(fn->kind());
        if (ti < 0 || ti >= kTargetCount) continue;  // not an active Target
        // Skip Targets whose input pin has no upstream link. An
        // unconnected target should LEAVE the slider baseline alone,
        // not push it to zero — the default graph ships disconnected
        // Target nodes, and zeroing brightness would render black.
        const auto& ins = node->getIns();
        if (ins.empty() || !ins[0] || !ins[0]->isConnected()) continue;
        auto* target = dynamic_cast<TargetNode*>(fn);
        if (!target) continue;
        add[ti]  += target->pull();
        seen[ti]  = true;
    }

    // Additive composition: the slider baseline is what the user chose;
    // the graph ADDS modulation on top. An unconnected (or zero-writing)
    // target leaves the baseline untouched. `slot` and the clamp ranges
    // are in NodeKind target order.
    float* slot[kTargetCount] = {
        &out.rippleAmount, &out.rippleSpeed, &out.brightness, &out.depthAmount,
        &out.matRoughness, &out.matMetalness, &out.matSheen, &out.matClearcoat,
        &out.matAnisotropy, &out.matIridescence, &out.matEmissive, &out.matRelief,
        &out.lightAngle, &out.lightElevation, &out.lightIntensity,
        &out.lightWarmth, &out.lightAmbient,
        &out.hypBoostX, &out.hypBoostY,
        &out.ornamentAmount, &out.ornamentWidth, &out.ornamentPhase, &out.ornamentStyle,
        &out.ornamentDensity, &out.ornamentTwist,
        &out.surfaceContourAmount, &out.surfaceContourSpacing,
        &out.surfaceContourWidth, &out.surfaceContourPhase,
        &out.surfaceContourSource,
        &out.matRoughMod, &out.matMetalMod,
        &out.lightChoreoAmount, &out.lightChoreoSpeed, &out.lightChoreoSource,
        &out.edgeProfileWidth, &out.edgeProfileGlow,
        &out.edgeProfileLight, &out.edgeProfileChroma, &out.edgeProfileHue,
        &out.surfaceContourLight, &out.surfaceContourChroma, &out.surfaceContourHue,
    };
    // Hyperbolic boost clamped to |b| <= 0.92 component-wise so a runaway
    // graph can't drive the τ_b transform near the disk boundary where it
    // becomes numerically singular.
    const float lo[kTargetCount] = {
        0.0f, 0.1f, 0.0f, 0.0f,  0.05f, 0.0f, 0.0f, 0.0f,  -1.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
        -0.92f, -0.92f,
        0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 1.0f, 0.01f, 0.0f,
        0.0f,
        0.0f, 0.0f,
        0.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 0.0f,
    };
    const float hi[kTargetCount] = {
        1.0f, 3.0f, 2.0f, 1.0f,  1.0f,  1.0f, 2.0f, 1.0f,   1.0f, 1.0f, 2.0f, 2.0f,
        360.0f, 90.0f, 2.0f, 1.0f, 1.0f,
        0.92f, 0.92f,
        1.0f, 1.0f, 1.0f, 4.0f, 1.0f, 1.0f,
        1.0f, 64.0f, 0.50f, 1.0f,
        7.0f,
        1.0f, 1.0f,
        1.0f, 2.0f, 3.0f,
        1.0f, 1.0f, 1.0f, 0.37f, 359.0f,
        1.0f, 0.40f, 360.0f,
    };
    for (int i = 0; i < kTargetCount; ++i)
        if (seen[i]) *slot[i] = std::clamp(*slot[i] + add[i], lo[i], hi[i]);
}

bool Graph::needsFrameLoop() {
    auto& nodes = handler_.getNodes();
    auto upstreamForInput = [this](ImFlow::Pin* input) -> FlowNode* {
        if (!input || !input->isConnected()) return nullptr;
        for (const auto& weak : handler_.getLinks()) {
            const auto link = weak.lock();
            if (!link || link->right() != input) continue;
            ImFlow::Pin* out = link->left();
            if (!out || !out->getParent()) return nullptr;
            auto* flowNode = dynamic_cast<FlowNode*>(out->getParent());
            return flowNode && !flowNode->toDestroy() ? flowNode : nullptr;
        }
        return nullptr;
    };
    auto isContinuousOperator = [](NodeKind kind) {
        return kind == NodeKind::OpLag
            || kind == NodeKind::OpSmooth
            || kind == NodeKind::OpEnvelope
            || kind == NodeKind::OpGate
            || kind == NodeKind::OpSampleHold
            || kind == NodeKind::OpBeatOsc
            || kind == NodeKind::OpPhaseMod
            || kind == NodeKind::OpAmplitudeMod;
    };
    std::unordered_set<uint64_t> visiting;
    auto dependsOnContinuousSource = [&](auto&& self, FlowNode* node) -> bool {
        if (!node || node->toDestroy()) return false;
        const uint64_t uid = node->getUID();
        if (!visiting.insert(uid).second) return false;
        const NodeKind kind = node->kind();
        if (kind == NodeKind::SrcTime || isContinuousOperator(kind)) {
            visiting.erase(uid);
            return true;
        }
        for (const auto& input : node->getIns()) {
            if (input && input->isConnected() && self(self, upstreamForInput(input.get()))) {
                visiting.erase(uid);
                return true;
            }
        }
        visiting.erase(uid);
        return false;
    };

    for (auto& [uid, node] : nodes) {
        if (!node || node->toDestroy()) continue;
        auto* flowNode = dynamic_cast<FlowNode*>(node.get());
        if (!flowNode) continue;
        const int targetIndex = targetIndexForKind(flowNode->kind());
        if (targetIndex < 0 || targetIndex >= kTargetCount) continue;
        const auto& inputs = node->getIns();
        if (inputs.empty() || !inputs[0] || !inputs[0]->isConnected()) continue;
        const NodeKind kind = flowNode->kind();
        if (
            kind == NodeKind::OutLightChoreoAmount
            || kind == NodeKind::OutLightChoreoSpeed
            || kind == NodeKind::OutLightChoreoSource
        ) {
            return true;
        }
        visiting.clear();
        if (dependsOnContinuousSource(dependsOnContinuousSource, upstreamForInput(inputs[0].get()))) return true;
    }
    return false;
}

// -----------------------------------------------------------------------------
// JSON persistence — hand-rolled, fixed-schema. Schema:
//   { "nodes":[{"uid":N,"kind":K,"x":X,"y":Y,
//               "p0":P0,"p1":P1,"p2":P2,"p3":P3,"p4":P4,"p5":P5},...],
//     "links":[{"src":SN,"srcPin":"name","dst":DN,"dstPin":"name"},...] }
// Pin names are saved instead of indices so reordering pin layout in
// graph.cpp doesn't silently corrupt saved graphs.
// -----------------------------------------------------------------------------

std::string Graph::toJson() {
    std::ostringstream s;
    s.precision(7);
    s << "{\"nodes\":[";
    bool first = true;
    auto& nodes = handler_.getNodes();
    for (const auto& [uid, base] : nodes) {
        // A node deleted this frame is marked toDestroy() but not yet
        // swept from the map — saving it would resurrect it on reload.
        if (!base || base->toDestroy()) continue;
        const auto* n = dynamic_cast<const FlowNode*>(base.get());
        if (!n) continue;
        if (!first) s << ",";
        first = false;
        const ImVec2& pos = base->getPos();
        s << "{\"uid\":" << uid
          << ",\"kind\":" << static_cast<int>(n->kind())
          << ",\"x\":" << pos.x << ",\"y\":" << pos.y
          << ",\"p0\":" << n->p0 << ",\"p1\":" << n->p1
          << ",\"p2\":" << n->p2
          << ",\"p3\":" << n->p3 << ",\"p4\":" << n->p4
          << ",\"p5\":" << n->p5
          << "}";
    }
    s << "],\"links\":[";
    first = true;
    auto& links = handler_.getLinks();
    for (const auto& wl : links) {
        auto link = wl.lock();
        if (!link) continue;
        ImFlow::Pin* outp = link->left();
        ImFlow::Pin* inp  = link->right();
        if (!outp || !inp || !outp->getParent() || !inp->getParent()) continue;
        // Drop links whose endpoint node was deleted this frame — the
        // node loop above skipped it, so its uid won't be in the saved
        // node set and the link would dangle on reload anyway.
        if (outp->getParent()->toDestroy() || inp->getParent()->toDestroy()) continue;
        if (!first) s << ",";
        first = false;
        s << "{\"src\":" << outp->getParent()->getUID()
          << ",\"srcPin\":\"" << outp->getName() << "\""
          << ",\"dst\":" << inp->getParent()->getUID()
          << ",\"dstPin\":\"" << inp->getName() << "\""
          << "}";
    }
    s << "]}";
    return s.str();
}

bool Graph::fromJson(const std::string& text) {
    teardown();

    // Helper: any early return rolls the model back to its built-in
    // default so a malformed or truncated save file can't leave the
    // editor showing a half-loaded graph.
    auto fail = [this] {
        teardown();
        resetToDefault();
        return false;
    };

    JsonReader R{text.data(), text.data() + text.size()};
    if (!R.match('{')) return fail();

    struct PendingLink {
        uint64_t    src    = 0;
        uint64_t    dst    = 0;
        std::string srcPin;
        std::string dstPin;
    };
    std::vector<PendingLink>            pending;
    // Map saved uid -> handler-assigned uid (handler uses node `this` ptr).
    std::unordered_map<uint64_t, uint64_t> remap;
    int parsedNodeCount = 0;
    int skippedNodeCount = 0;
    int parsedLinkCount = 0;
    int droppedLinkCount = 0;

    while (!R.peek('}') && !R.atEnd()) {
        std::string key;
        if (!R.readString(key)) return fail();
        if (!R.match(':')) return fail();

        if (key == "nodes") {
            if (!R.match('[')) return fail();
            while (!R.peek(']') && !R.atEnd()) {
                if (!R.match('{')) return fail();
                double savedUid = 0, kind = 0, x = 0, y = 0;
                double p[6] = {};
                bool hasUid = false, hasKind = false, hasX = false, hasY = false;
                bool hasP[6] = {};
                while (!R.peek('}') && !R.atEnd()) {
                    std::string k;
                    if (!R.readString(k)) return fail();
                    if (!R.match(':')) return fail();
                    // Unknown / non-numeric fields get skipped via
                    // skipValue so a key the parser doesn't recognise
                    // can't fail the whole load.
                    if (R.peek('"')) {
                        std::string s;
                        if (!R.readString(s)) return fail();
                        continue;
                    }
                    double v;
                    if (!R.readDouble(v)) {
                        if (!R.skipValue()) return fail();
                        continue;
                    }
                    if      (k == "uid")  { savedUid = v; hasUid = true; }
                    else if (k == "kind") { kind     = v; hasKind = true; }
                    else if (k == "x")    { x        = v; hasX = true; }
                    else if (k == "y")    { y        = v; hasY = true; }
                    else if (k.size() == 2 && k[0] == 'p' && k[1] >= '0' && k[1] <= '5') {
                        const int ix = k[1] - '0';
                        p[ix] = v;
                        hasP[ix] = true;
                    }
                }
                R.match('}');
                ++parsedNodeCount;
                if (
                    !hasUid || !hasKind || !hasX || !hasY
                    || !isExactPositiveJsonId(savedUid)
                    || !isIntJsonValue(kind, 0, descriptorCount() - 1)
                    || !isFiniteFloatJsonValue(x)
                    || !isFiniteFloatJsonValue(y)
                ) {
                    ++skippedNodeCount;
                    continue;
                }
                bool invalidParam = false;
                for (int i = 0; i < 6; ++i) {
                    if (hasP[i] && !isFiniteFloatJsonValue(p[i])) invalidParam = true;
                }
                if (invalidParam) {
                    ++skippedNodeCount;
                    continue;
                }
                const auto savedUidInt = static_cast<uint64_t>(savedUid);
                if (remap.find(savedUidInt) != remap.end()) {
                    ++skippedNodeCount;
                    continue;
                }
                const int ki = static_cast<int>(kind);
                const auto k    = static_cast<NodeKind>(ki);
                const auto newU = spawn(handler_, k,
                                        ImVec2(static_cast<float>(x),
                                               static_cast<float>(y)),
                                        this);
                if (!newU) {
                    ++skippedNodeCount;
                    continue;
                }
                auto it = handler_.getNodes().find(newU);
                if (it != handler_.getNodes().end()) {
                    auto* fn = dynamic_cast<FlowNode*>(it->second.get());
                    if (!fn) {
                        ++skippedNodeCount;
                        continue;
                    }
                    if (hasP[0]) fn->p0 = static_cast<float>(p[0]);
                    if (hasP[1]) fn->p1 = static_cast<float>(p[1]);
                    if (hasP[2]) fn->p2 = static_cast<float>(p[2]);
                    if (hasP[3]) fn->p3 = static_cast<float>(p[3]);
                    if (hasP[4]) fn->p4 = static_cast<float>(p[4]);
                    if (hasP[5]) fn->p5 = static_cast<float>(p[5]);
                }
                remap[savedUidInt] = newU;
            }
            R.match(']');
        } else if (key == "links") {
            if (!R.match('[')) return fail();
            while (!R.peek(']') && !R.atEnd()) {
                if (!R.match('{')) return fail();
                PendingLink l{};
                double src = 0.0, dst = 0.0;
                bool hasSrc = false, hasDst = false;
                while (!R.peek('}') && !R.atEnd()) {
                    std::string k;
                    if (!R.readString(k)) return fail();
                    if (!R.match(':')) return fail();
                    if (k == "src" || k == "dst") {
                        double v;
                        if (!R.readDouble(v)) return fail();
                        if (k == "src") { src = v; hasSrc = true; }
                        else            { dst = v; hasDst = true; }
                    } else if (k == "srcPin" || k == "dstPin") {
                        std::string s;
                        if (!R.readString(s)) return fail();
                        if (k == "srcPin") l.srcPin = std::move(s);
                        else               l.dstPin = std::move(s);
                    } else {
                        if (!R.skipValue()) return fail();
                    }
                }
                R.match('}');
                ++parsedLinkCount;
                if (
                    !hasSrc || !hasDst
                    || !isExactPositiveJsonId(src)
                    || !isExactPositiveJsonId(dst)
                ) {
                    ++droppedLinkCount;
                    continue;
                }
                l.src = static_cast<uint64_t>(src);
                l.dst = static_cast<uint64_t>(dst);
                pending.push_back(std::move(l));
            }
            R.match(']');
        } else {
            if (!R.skipValue()) return fail();
        }
    }
    R.match('}');

    if (parsedNodeCount == 0 && parsedLinkCount == 0) {
        resetToDefault();
        return true;
    }
    if (skippedNodeCount > 0) {
        LOGW("graph load rejected: skipped_nodes=%d parsed_nodes=%d",
             skippedNodeCount, parsedNodeCount);
        return fail();
    }

    for (const auto& l : pending) {
        const auto sit = remap.find(l.src);
        const auto dit = remap.find(l.dst);
        if (sit == remap.end() || dit == remap.end()) {
            ++droppedLinkCount;
            continue;
        }
        auto& nodes = handler_.getNodes();
        auto sn = nodes.find(sit->second);
        auto dn = nodes.find(dit->second);
        if (sn == nodes.end() || dn == nodes.end()) {
            ++droppedLinkCount;
            continue;
        }
        ImFlow::Pin* op = findPinByNameOrAlias(sn->second->getOuts(), l.srcPin);
        ImFlow::Pin* ip = findPinByNameOrAlias(dn->second->getIns(),  l.dstPin);
        if (op && ip && !ip->isConnected() && canConnect(op, ip)) {
            ip->createLink(op);
        } else {
            ++droppedLinkCount;
        }
    }
    if (droppedLinkCount > 0) {
        LOGW("graph load rejected: dropped_links=%d parsed_links=%d",
             droppedLinkCount, parsedLinkCount);
        return fail();
    }
    // A graph loaded from disk carries the user's own saved node
    // positions — the editor must not re-arrange it on top of them.
    defaultLayout_ = false;
    return true;
}

} // namespace penrose::graph
