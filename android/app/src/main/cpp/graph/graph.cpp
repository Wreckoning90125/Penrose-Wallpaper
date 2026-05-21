#include "graph/graph.h"

#include "log.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
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
};
static_assert(sizeof(kDescriptors) / sizeof(kDescriptors[0])
                  == static_cast<size_t>(NodeKind::Count_),
              "NodeKind / kDescriptors out of sync");

inline float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }

// -----------------------------------------------------------------------------
// FlowNode subclasses. One class per category — the kind enum drives the
// per-instance pin layout + behaviour rather than a class explosion.
// -----------------------------------------------------------------------------

class SourceNode : public FlowNode {
public:
    SourceNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        if (k == NodeKind::SrcConstant) p0 = 0.5f;
        addOUT<float>("out")->behaviour([this] { return sample(); });
    }

    // Inline slider for SrcConstant — every other source pulls its
    // value from the EvalContext (audio bands / beat / time) and has
    // nothing to tune.
    void draw() override {
        if (kind_ != NodeKind::SrcConstant) return;
        ImGui::SetNextItemWidth(160.0f);
        ImGui::SliderFloat("##value", &p0, 0.0f, 1.0f, "value %.2f");
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
            case NodeKind::SrcBeat:     return c.beat;
            case NodeKind::SrcTime:     return c.timeSec;
            case NodeKind::SrcConstant: return p0;
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
                p0 = 0.0f; p1 = 1.0f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpSmoothstep:
                p0 = 0.0f; p1 = 1.0f;
                addIN<float>("x", 0.0f, filt);
                break;
            case NodeKind::OpScaleBias:
                p0 = 1.0f; p1 = 0.0f;
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
                return std::clamp(getInVal<float>("x"), p0, p1);
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
            default:                    return 0.0f;
        }
    }
};

class TargetNode : public FlowNode {
public:
    TargetNode(NodeKind k, Graph* g) : FlowNode(k, g) {
        setTitle(descriptor(k).label);
        addIN<float>("in", 0.0f, ImFlow::ConnectionFilter::SameType());
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
    // Bump the initial zoom so the default layout reads at thumb-
    // comfortable size on a phone — at zoom=1 the per-node text and
    // socket targets are small enough that interaction feels fiddly.
    // ImNodeFlow's m_scale latches from config().default_zoom at
    // first ContainedContext::begin(), so setting this BEFORE the
    // first update() call (i.e. here, in the ctor) is correct.
    // Clamped at the library's zoom_max (2.0) by ImNodeFlow itself
    // on pinch; the user can pinch down to zoom_min (0.3) if they
    // want to see more of the canvas at once.
    auto& cfg = handler_.getGrid().config();
    cfg.default_zoom = 1.25f;
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

void Graph::evaluate(const EvalContext& ctx, EvalResult& out) {
    ctx_ = ctx;
    // OutPin::val() memoizes per-frame by adding a marker to this list
    // and short-circuiting on subsequent reads. Reset before each pull
    // so frame N+1 actually recomputes instead of replaying frame N.
    handler_.get_recursion_blacklist().clear();

    float ripA = 0.0f, ripS = 0.0f, bri = 0.0f, dep = 0.0f;
    bool seenA = false, seenS = false, seenB = false, seenD = false;
    for (auto& [uid, node] : handler_.getNodes()) {
        // Skip nodes the user deleted this frame — destroy() only marks
        // them; handler_.update() sweeps them afterwards. Evaluating one
        // would feed a stale target for the frame between the two.
        if (!node || node->toDestroy()) continue;
        auto* fn = static_cast<FlowNode*>(node.get());
        // Targets are the last four kinds in the registry; a single
        // range check is cheaper than a string-compare on category
        // and runs once per node per frame.
        if (fn->kind() < NodeKind::OutRippleAmount) continue;
        // Skip Targets whose input pin has no upstream link. An
        // unconnected target should LEAVE the slider baseline alone,
        // not push it to zero. Without this, the default graph
        // (which ships with disconnected Target nodes for each of
        // ripple/brightness/depth) silences brightness on every
        // frame and the wallpaper renders as black fills under the
        // borders.
        const auto& ins = node->getIns();
        if (ins.empty() || !ins[0] || !ins[0]->isConnected()) continue;
        const float v = static_cast<TargetNode*>(fn)->pull();
        switch (fn->kind()) {
            case NodeKind::OutRippleAmount: ripA += v; seenA = true; break;
            case NodeKind::OutRippleSpeed:  ripS += v; seenS = true; break;
            case NodeKind::OutBrightness:   bri  += v; seenB = true; break;
            case NodeKind::OutDepthAmount:  dep  += v; seenD = true; break;
            default: break;
        }
    }
    // Additive composition: the slider baseline is what the user
    // chose; the graph ADDS modulation on top. Targets writing 0
    // (e.g. silent audio band through ScaleBias) leave the slider
    // value unchanged instead of zeroing the wallpaper out. Clamp
    // ranges are the same final-output limits the shader expects.
    if (seenA) out.rippleAmount = std::clamp(out.rippleAmount + ripA, 0.0f, 1.0f);
    if (seenS) out.rippleSpeed  = std::clamp(out.rippleSpeed  + ripS, 0.1f, 3.0f);
    if (seenB) out.brightness   = std::clamp(out.brightness   + bri,  0.0f, 2.0f);
    if (seenD) out.depthAmount  = std::clamp(out.depthAmount  + dep,  0.0f, 1.0f);
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
        const auto* n = static_cast<const FlowNode*>(base.get());
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
                    auto* fn = static_cast<FlowNode*>(it->second.get());
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
