#pragma once

// =============================================================================
// Modulation graph — typed DAG built on ImNodeFlow. Each NodeKind is a
// FlowNode subclass with typed float pins and a pull-based behaviour()
// lambda; there is no separate evaluator pass. The renderer asks the
// graph for an EvalResult per frame, the graph stashes the EvalContext
// onto itself, then walks Target nodes; each Target pulls its input,
// which recursively pulls upstream until a Source captures from the
// stashed context. Sum-then-clamp aggregates multiple Target nodes of
// the same kind. Persistence is hand-rolled JSON — minimal, fixed
// schema, no extra dependency.
// =============================================================================

#include "ImNodeFlow.h"

#include <cstdint>
#include <string>

namespace penrose::graph {

enum class NodeKind : uint16_t {
    SrcBand0 = 0, SrcBand1, SrcBand2, SrcBand3,
    SrcBand4, SrcBand5, SrcBand6, SrcBand7,
    SrcBeat,
    SrcTime,
    SrcConstant,

    OpAdd,
    OpMultiply,
    OpClamp,
    OpSmoothstep,
    OpMix,
    OpAbs,
    OpInvert,
    OpScaleBias,

    OutRippleAmount,
    OutRippleSpeed,
    OutBrightness,
    OutDepthAmount,
    // Material targets — must stay contiguous with the four above; the
    // target block runs OutRippleAmount .. OutMatRelief.
    OutMatRoughness,
    OutMatMetalness,
    OutMatSheen,
    OutMatClearcoat,
    OutMatAnisotropy,
    OutMatIridescence,
    OutMatEmissive,
    OutMatRelief,
    OutLightAngle,
    OutLightElevation,
    OutLightIntensity,
    OutLightWarmth,
    OutLightAmbient,

    // Appended after the target block so existing saved-graph node indices
    // never shift. A Source by category despite its enum position.
    SrcPageScroll,

    Count_,
};

struct NodeDescriptor {
    NodeKind    kind;
    const char* label;
    const char* category;  // "Source" | "Operator" | "Target"
};

const NodeDescriptor& descriptor(NodeKind kind);
const NodeDescriptor* descriptors();
int                   descriptorCount();

struct EvalContext {
    float bands[8]  = {};
    float beat      = 0.0f;
    float timeSec   = 0.0f;
    float pageScroll = 0.0f;  // home-screen horizontal scroll, 0..1
};

struct EvalResult {
    float rippleAmount = 0.3f;
    float rippleSpeed  = 1.0f;
    float brightness   = 1.0f;
    float depthAmount  = 0.3f;
    // Material + lighting targets — order matches the OutMat* / OutLight*
    // NodeKind block.
    float matRoughness   = 0.50f;
    float matMetalness   = 0.40f;
    float matSheen       = 0.35f;
    float matClearcoat   = 0.45f;
    float matAnisotropy  = 0.40f;
    float matIridescence = 0.45f;
    float matEmissive    = 0.60f;
    float matRelief      = 1.05f;
    float lightAngle     = 230.0f;
    float lightElevation = 55.0f;
    float lightIntensity = 1.00f;
    float lightWarmth    = 0.50f;
    float lightAmbient   = 0.22f;
};

// FlowNode is the common base for every modulation node in the editor.
// Concrete subclasses (defined in graph.cpp) override draw() if they
// expose inline body widgets, and wire the per-kind pins in their ctor.
class FlowNode : public ImFlow::BaseNode {
public:
    FlowNode(NodeKind k, class Graph* g) : kind_(k), graph_(g) {}

    NodeKind     kind()  const { return kind_; }
    class Graph* graph() const { return graph_; }

    // Saved scalar parameters used by parameter-bearing kinds:
    //   SrcConstant     p0=value
    //   OpClamp         p0=lo,  p1=hi
    //   OpSmoothstep    p0=edge0, p1=edge1
    //   OpScaleBias     p0=gain, p1=bias
    // p2 is unused today; carried in the save shape because every
    // node serialises three floats regardless of kind.
    float p0 = 0.0f;
    float p1 = 1.0f;
    float p2 = 0.0f;

protected:
    NodeKind     kind_;
    class Graph* graph_;
};

class Graph {
public:
    Graph();
    ~Graph();

    Graph(const Graph&)            = delete;
    Graph& operator=(const Graph&) = delete;

    ImFlow::ImNodeFlow& handler() { return handler_; }

    // Sources read this each frame inside their behaviour() lambdas.
    const EvalContext& context() const { return ctx_; }

    // Stash ctx, walk Target nodes, sum-then-clamp by kind, fill out.
    void evaluate(const EvalContext& ctx, EvalResult& out);

    // Spawn a node at the given grid position. Returns the ImFlow node
    // UID, or 0 if the kind is invalid.
    uint64_t addNode(NodeKind kind, float x, float y);

    // toJson is non-const because ImNodeFlow::getNodes() returns a
    // non-const reference; the call is conceptually read-only but the
    // library's accessor signature is what it is.
    std::string toJson();
    bool        fromJson(const std::string& text);

    void resetToDefault();

    // True while the graph still holds the built-in default node set
    // (set by resetToDefault, cleared once fromJson loads a saved graph).
    // The editor auto-arranges only the default layout; a user-arranged
    // graph that was loaded from disk keeps its saved node positions.
    bool isDefaultLayout() const { return defaultLayout_; }

private:
    void teardown();

    ImFlow::ImNodeFlow handler_;
    EvalContext        ctx_{};
    bool               defaultLayout_ = true;
};

} // namespace penrose::graph
