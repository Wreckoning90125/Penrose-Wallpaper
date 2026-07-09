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
    // Material + lighting + hyperbolic-projection targets — must stay
    // contiguous with the four above; the target block runs
    // OutRippleAmount .. OutHypBoostY.
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
    // Hyperbolic-projection targets — drive the τ_b boost coordinates.
    // World-radius scale is a static geometry control on Android because
    // border rings are baked in projected disk space.
    OutHypBoostX,
    OutHypBoostY,
    // Preserved for saved-graph kind stability; no longer an active Target.
    OutHypScale,

    // Appended after the target block so existing saved-graph node indices
    // never shift. A Source by category despite its enum position.
    SrcPageScroll,
    SrcRms,
    SrcSpectralFlux,
    SrcOnsetStrength,
    SrcCwtTransient,
    SrcCrestFactor,
    SrcBeatConfidence,
    OpThresholdCompare,
    OpLag,
    OpGain,
    OpBias,
    OpSmooth,
    OpMap,
    OpEnvelope,
    OpGate,
    OpMath,
    OpSampleHold,
    SrcBass,
    SrcMid,
    SrcHigh,
    // Appended target kinds. Keep them at the tail so saved-graph kind
    // integers for all existing nodes stay stable.
    OutOrnamentAmount,
    OutOrnamentWidth,
    OutOrnamentPhase,
    OutOrnamentStyle,
    OutOrnamentDensity,
    OutOrnamentTwist,
    OpAmplitudeMod,
    OpPhaseMod,
    OpBeatOsc,
    SrcTempo,
    OutSurfaceContourAmount,
    OutSurfaceContourSpacing,
    OutSurfaceContourWidth,
    OutSurfaceContourPhase,
    OutSurfaceContourSource,
    OutMatRoughMod,
    OutMatMetalMod,
    OutLightChoreoAmount,
    OutLightChoreoSpeed,
    OutLightChoreoSource,
    OutEdgeProfileWidth,
    OutEdgeProfileGlow,
    OutEdgeProfileLight,
    OutEdgeProfileChroma,
    OutEdgeProfileHue,
    OutSurfaceContourLight,
    OutSurfaceContourChroma,
    OutSurfaceContourHue,

    Count_,
};

struct NodeDescriptor {
    NodeKind    kind;
    const char* label;
    // Palette category. Graph UI exposes Source / Operator / Target;
    // Projection is reserved for preserved-but-inactive saved node kinds.
    const char* category;
};

const NodeDescriptor& descriptor(NodeKind kind);
const NodeDescriptor* descriptors();
int                   descriptorCount();

struct EvalContext {
    float bands[8]  = {};
    float bass      = 0.0f;
    float mid       = 0.0f;
    float high      = 0.0f;
    float beat      = 0.0f;
    float rms       = 0.0f;
    float spectralFlux = 0.0f;
    float onsetStrength = 0.0f;
    float cwtTransient = 0.0f;
    float crestFactor = 0.0f;
    float beatConfidence = 0.0f;
    float bpm = 120.0f;
    float dtSeconds = 1.0f / 60.0f;
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
    float matRoughMod    = 0.0f;
    float matMetalMod    = 0.0f;
    float lightAngle     = 230.0f;
    float lightElevation = 55.0f;
    float lightIntensity = 1.00f;
    float lightWarmth    = 0.50f;
    float lightAmbient   = 0.22f;
    float lightChoreoAmount = 0.18f;
    float lightChoreoSpeed  = 1.00f;
    float lightChoreoSource = 3.0f;
    float hypBoostX      = 0.0f;
    float hypBoostY      = 0.0f;
    float ornamentAmount = 0.0f;
    float ornamentWidth  = 0.45f;
    float ornamentPhase  = 0.0f;
    float ornamentStyle  = 0.0f;
    float ornamentDensity = 1.0f;
    float ornamentTwist  = 0.5f;
    float surfaceContourAmount = 0.0f;
    float surfaceContourSpacing = 16.0f;
    float surfaceContourWidth = 0.18f;
    float surfaceContourPhase = 0.0f;
    float surfaceContourSource = 0.0f;
    float surfaceContourLight = 0.92f;
    float surfaceContourChroma = 0.06f;
    float surfaceContourHue = 85.0f;
    float edgeProfileWidth = 0.0f;
    float edgeProfileGlow = 0.0f;
    float edgeProfileLight = 1.0f;
    float edgeProfileChroma = 0.0f;
    float edgeProfileHue = 0.0f;
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
    //   OpAdd           p0=offset
    //   OpMultiply      p0=scale
    //   OpMix           p0=blend when mix input is unconnected
    //   OpClamp         p0=lo,  p1=hi
    //   OpSmoothstep    p0=edge0, p1=edge1
    //   OpScaleBias     p0=gain, p1=bias
    //   OpThresholdCompare p0=threshold
    //   OpLag           p0=time_seconds
    //   OpInvert        p0=pivot
    //   OpGain          p0=gain
    //   OpBias          p0=bias
    //   OpSmooth        p0=amount
    //   OpMap           p0=inMin, p1=inMax, p2=outMin, p3=outMax
    //   OpEnvelope      p0=threshold, p1=attack, p2=release
    //   OpGate          p0=open, p1=close, p2=hold, p3=attack, p4=release, p5=floor
    //   OpMath          p0=valB, p1=operation index
    //   OpSampleHold    p0=threshold
    //   OpAmplitudeMod  p0=depth, p1=bias
    //   OpPhaseMod      p0=depth, p1=cycles, p2=offset
    //   OpBeatOsc       p0=cyclesA, p1=cyclesB, p2=offset
    float p0 = 0.0f;
    float p1 = 1.0f;
    float p2 = 0.0f;
    float p3 = 0.0f;
    float p4 = 0.0f;
    float p5 = 0.0f;
    float state0 = 0.0f;
    float state1 = 0.0f;
    bool  flag0 = false;

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
    uint64_t evalSerial() const { return evalSerial_; }

    // Stash ctx, walk Target nodes, sum-then-clamp by kind, fill out.
    void evaluate(const EvalContext& ctx, EvalResult& out);

    // True when the currently wired graph can move visible output without an
    // external draw trigger. Page-scroll-only graphs draw from launcher offset
    // callbacks; audio-only graphs draw while playback is active. Clock-driven
    // and stateful target paths need the wallpaper Choreographer armed.
    bool needsFrameLoop();

    // Spawn a node at the given grid position. Returns the ImFlow node
    // UID, or 0 if the kind is invalid.
    uint64_t addNode(NodeKind kind, float x, float y);

    // Native equivalent of the web graph DAG guard. ImNodeFlow evaluates by
    // recursively pulling upstream pins, so cycles must be rejected at connect
    // and load time rather than handled by its cached-value recursion fallback.
    bool canConnect(ImFlow::Pin* out, ImFlow::Pin* in);

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
    uint64_t           evalSerial_ = 0;
    bool               defaultLayout_ = true;
};

} // namespace penrose::graph
