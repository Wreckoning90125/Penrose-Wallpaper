#include "graph/graph.h"

#include "log.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <sstream>
#include <string_view>
#include <unordered_map>
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
    { NodeKind::OpSmoothstep,    "Smoothstep",          "Operator" },
    { NodeKind::OpMix,           "Mix (lerp)",          "Operator" },
    { NodeKind::OpAbs,           "Abs",                 "Operator" },
    { NodeKind::OpInvert,        "1 - x",               "Operator" },
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
};
static_assert(sizeof(kDescriptors) / sizeof(kDescriptors[0])
                  == static_cast<size_t>(NodeKind::Count_),
              "NodeKind / kDescriptors out of sync");

inline float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }

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
// which Targets the user has wired in. Iterates the contiguous Target
// block in NodeKind (OutRippleAmount .. OutHypBoostY).
inline float widestTargetLabelWidth() {
    float w = 0.0f;
    const int first = static_cast<int>(NodeKind::OutRippleAmount);
    const int last  = static_cast<int>(NodeKind::OutHypBoostY);
    for (int i = first; i <= last; ++i) {
        w = std::max(w, ImGui::CalcTextSize(
            descriptor(static_cast<NodeKind>(i)).label).x);
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
        addOUT<float>("out")->behaviour([this] { return sample(); });
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
            case NodeKind::SrcBeat:       return c.beat;
            case NodeKind::SrcRms:        return c.rms;
            case NodeKind::SrcSpectralFlux: return c.spectralFlux;
            case NodeKind::SrcOnsetStrength: return c.onsetStrength;
            case NodeKind::SrcCwtTransient: return c.cwtTransient;
            case NodeKind::SrcCrestFactor: return c.crestFactor;
            case NodeKind::SrcBeatConfidence: return c.beatConfidence;
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
        auto filt = ImFlow::ConnectionFilter::SameType();
        switch (k) {
            case NodeKind::OpAdd:
            case NodeKind::OpMultiply:
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                break;
            case NodeKind::OpMix:
                addIN<float>("a", 0.0f, filt);
                addIN<float>("b", 0.0f, filt);
                addIN<float>("t", 0.0f, filt);
                break;
            case NodeKind::OpClamp:
            case NodeKind::OpSmoothstep:
                p0 = 0.0f; p1 = 1.0f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpScaleBias:
                p0 = 1.0f; p1 = 0.0f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpThresholdCompare:
                p0 = 0.5f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpLag:
                p0 = 0.25f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpAbs:
            case NodeKind::OpInvert:
                addIN<float>("x", 0.0f, filt);
                break;
            default: break;
        }
        addOUT<float>("out")->behaviour([this] { return compute(); });
    }

    // Inline sliders for kinds that carry tunable scalars (p0 / p1).
    // OpAdd / OpMultiply / OpMix / OpAbs / OpInvert have no scalars so
    // their bodies stay empty. Width sized so the slider fits beside
    // input/output pin sockets without clipping.
    void draw() override {
        switch (kind_) {
            case NodeKind::OpClamp:
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##lo", &p0, -2.0f, 2.0f, "lo %.2f");
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##hi", &p1, -2.0f, 2.0f, "hi %.2f");
                break;
            case NodeKind::OpSmoothstep:
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##e0", &p0, -2.0f, 2.0f, "edge0 %.2f");
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##e1", &p1, -2.0f, 2.0f, "edge1 %.2f");
                break;
            case NodeKind::OpScaleBias:
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##gain", &p0, -3.0f, 3.0f, "gain %.2f");
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##bias", &p1, -1.0f, 1.0f, "bias %.2f");
                break;
            case NodeKind::OpThresholdCompare:
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##threshold", &p0, 0.0f, 1.0f, "threshold %.2f");
                break;
            case NodeKind::OpLag:
                ImGui::SetNextItemWidth(150.0f);
                ImGui::SliderFloat("##time", &p0, 0.0f, 2.0f, "time %.2fs");
                break;
            default: break;
        }
    }

private:
    float compute() {
        switch (kind_) {
            case NodeKind::OpAdd:
                return getInVal<float>("a") + getInVal<float>("b");
            case NodeKind::OpMultiply:
                return getInVal<float>("a") * getInVal<float>("b");
            case NodeKind::OpClamp:
                return std::max(p0, std::min(p1, getInVal<float>("x")));
            case NodeKind::OpSmoothstep: {
                const float x = getInVal<float>("x");
                if (p1 - p0 < 1e-6f) return 0.0f;
                const float t = clamp01((x - p0) / (p1 - p0));
                return t * t * (3.0f - 2.0f * t);
            }
            case NodeKind::OpMix: {
                const float a = getInVal<float>("a");
                const float b = getInVal<float>("b");
                const float t = clamp01(getInVal<float>("t"));
                return a * (1.0f - t) + b * t;
            }
            case NodeKind::OpAbs:       return std::fabs(getInVal<float>("x"));
            case NodeKind::OpInvert:    return 1.0f - getInVal<float>("x");
            case NodeKind::OpScaleBias: return getInVal<float>("x") * p0 + p1;
            case NodeKind::OpThresholdCompare:
                return getInVal<float>("x") >= p0 ? 1.0f : 0.0f;
            case NodeKind::OpLag: {
                const float x = getInVal<float>("x");
                const float dt = std::max(0.0f, graph_->context().dtSeconds);
                const float alpha = p0 <= 0.0f ? 1.0f : std::clamp(1.0f - std::exp(-dt / p0), 0.0f, 1.0f);
                lagState_ += (x - lagState_) * alpha;
                return lagState_;
            }
            default:                    return 0.0f;
        }
    }

    float lagState_ = 0.0f;
};

class TargetNode : public FlowNode {
public:
    TargetNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        addIN<float>("in", 0.0f, ImFlow::ConnectionFilter::SameType());
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
    // default_zoom once, when the ContainedContext is constructed — which
    // happens before this ctor body runs. Raising default_zoom here does
    // NOT change the editor scale; ContainedContext::begin() never re-reads
    // it. default_zoom only retargets the reset-zoom key, which a
    // touchscreen never presses. The editor therefore runs at scale 1.0;
    // node legibility is the layout's job (graph_ui.cpp arrangeNodes plus
    // the per-node sizing in this file), not a canvas zoom. Kept explicit
    // and equal to the real scale so a stray reset-zoom can't desync it.
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
    constexpr float kColXOut   = 620.0f;   // target column
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
    // Beat / Time on a 5th row below the bands, mirroring the column split.
    const float beatRowY = kRowY0 + 4 * kRowStep;
    spawn(handler_, NodeKind::SrcBeat, ImVec2(kColX0, beatRowY), this);
    spawn(handler_, NodeKind::SrcTime, ImVec2(kColX1, beatRowY), this);

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

// The contiguous Target block, OutRippleAmount .. OutHypBoostY inclusive.
constexpr int kTargetCount = static_cast<int>(NodeKind::OutHypBoostY)
                           - static_cast<int>(NodeKind::OutRippleAmount) + 1;

void Graph::evaluate(const EvalContext& ctx, EvalResult& out) {
    ctx_ = ctx;
    // OutPin::val() memoizes per-frame by adding a marker to this list
    // and short-circuiting on subsequent reads. Reset before each pull
    // so frame N+1 actually recomputes instead of replaying frame N.
    handler_.get_recursion_blacklist().clear();

    // Accumulate every connected Target by kind index within the block.
    float add[kTargetCount]  = {};
    bool  seen[kTargetCount] = {};
    const int firstTarget = static_cast<int>(NodeKind::OutRippleAmount);
    for (auto& [uid, node] : handler_.getNodes()) {
        // Skip nodes the user deleted this frame — destroy() only marks
        // them; handler_.update() sweeps them afterwards. Evaluating one
        // would feed a stale target for the frame between the two.
        if (!node || node->toDestroy()) continue;
        auto* fn = dynamic_cast<FlowNode*>(node.get());
        if (!fn) continue;
        const int ti = static_cast<int>(fn->kind()) - firstTarget;
        if (ti < 0 || ti >= kTargetCount) continue;  // not a Target
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
    };
    // Hyperbolic boost clamped to |b| <= 0.92 component-wise so a runaway
    // graph can't drive the τ_b transform near the disk boundary where it
    // becomes numerically singular.
    const float lo[kTargetCount] = {
        0.0f, 0.1f, 0.0f, 0.0f,  0.05f, 0.0f, 0.0f, 0.0f,  -1.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
        -0.92f, -0.92f,
    };
    const float hi[kTargetCount] = {
        1.0f, 3.0f, 2.0f, 1.0f,  1.0f,  1.0f, 2.0f, 1.0f,   1.0f, 1.0f, 2.0f, 2.0f,
        360.0f, 90.0f, 2.0f, 1.0f, 1.0f,
        0.92f, 0.92f,
    };
    for (int i = 0; i < kTargetCount; ++i)
        if (seen[i]) *slot[i] = std::clamp(*slot[i] + add[i], lo[i], hi[i]);
}

// -----------------------------------------------------------------------------
// JSON persistence — hand-rolled, fixed-schema. Schema:
//   { "nodes":[{"uid":N,"kind":K,"x":X,"y":Y,"p0":P0,"p1":P1,"p2":P2},...],
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

    while (!R.peek('}') && !R.atEnd()) {
        std::string key;
        if (!R.readString(key)) return fail();
        if (!R.match(':')) return fail();

        if (key == "nodes") {
            if (!R.match('[')) return fail();
            while (!R.peek(']') && !R.atEnd()) {
                if (!R.match('{')) return fail();
                double savedUid = 0, kind = 0, x = 0, y = 0;
                double p0 = 0, p1 = 0, p2 = 0;
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
                    if      (k == "uid")  savedUid = v;
                    else if (k == "kind") kind     = v;
                    else if (k == "x")    x        = v;
                    else if (k == "y")    y        = v;
                    else if (k == "p0")   p0       = v;
                    else if (k == "p1")   p1       = v;
                    else if (k == "p2")   p2       = v;
                }
                R.match('}');
                const int ki = static_cast<int>(kind);
                if (ki < 0 || ki >= descriptorCount()) continue;
                const auto k    = static_cast<NodeKind>(ki);
                const auto newU = spawn(handler_, k,
                                        ImVec2(static_cast<float>(x),
                                               static_cast<float>(y)),
                                        this);
                if (!newU) continue;
                auto it = handler_.getNodes().find(newU);
                if (it != handler_.getNodes().end()) {
                    auto* fn = dynamic_cast<FlowNode*>(it->second.get());
                    if (!fn) continue;
                    fn->p0 = static_cast<float>(p0);
                    fn->p1 = static_cast<float>(p1);
                    fn->p2 = static_cast<float>(p2);
                }
                remap[static_cast<uint64_t>(savedUid)] = newU;
            }
            R.match(']');
        } else if (key == "links") {
            if (!R.match('[')) return fail();
            while (!R.peek(']') && !R.atEnd()) {
                if (!R.match('{')) return fail();
                PendingLink l{};
                while (!R.peek('}') && !R.atEnd()) {
                    std::string k;
                    if (!R.readString(k)) return fail();
                    if (!R.match(':')) return fail();
                    if (k == "src" || k == "dst") {
                        double v;
                        if (!R.readDouble(v)) return fail();
                        if (k == "src") l.src = static_cast<uint64_t>(v);
                        else            l.dst = static_cast<uint64_t>(v);
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
                pending.push_back(std::move(l));
            }
            R.match(']');
        } else {
            if (!R.skipValue()) return fail();
        }
    }
    R.match('}');

    for (const auto& l : pending) {
        const auto sit = remap.find(l.src);
        const auto dit = remap.find(l.dst);
        if (sit == remap.end() || dit == remap.end()) continue;
        auto& nodes = handler_.getNodes();
        auto sn = nodes.find(sit->second);
        auto dn = nodes.find(dit->second);
        if (sn == nodes.end() || dn == nodes.end()) continue;
        ImFlow::Pin* op = findPinByName(sn->second->getOuts(), l.srcPin);
        ImFlow::Pin* ip = findPinByName(dn->second->getIns(),  l.dstPin);
        if (op && ip) ip->createLink(op);
    }
    // A graph loaded from disk carries the user's own saved node
    // positions — the editor must not re-arrange it on top of them.
    defaultLayout_ = false;
    return true;
}

} // namespace penrose::graph
