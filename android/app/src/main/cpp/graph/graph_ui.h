#pragma once

// =============================================================================
// Node editor UI — renders the modulation Graph inside an ImGui frame using
// ImNodeFlow. The host activity toggles visibility from Kotlin and owns the
// persistence file path. Touch events arrive as mouse events through
// ImGuiHost, so this layer treats the editor as a plain ImGui canvas; the
// only thumb-aware affordance is the top-right toolbar (spawn / delete /
// reset / close) and the bottom parameter sheet for the selected node.
// =============================================================================

#include "graph/graph.h"

#include "ImNodeFlow.h"

#include <atomic>
#include <memory>

namespace penrose::graph {

class GraphUi {
public:
    GraphUi()  = default;
    ~GraphUi() = default;

    GraphUi(const GraphUi&)            = delete;
    GraphUi& operator=(const GraphUi&) = delete;

    // densityScale is the same multiplier ImGuiHost was initialised with.
    bool initialize(float densityScale);
    void shutdown();

    // Renders the editor inside the current ImGui frame. Caller is
    // responsible for ImGui::NewFrame / Render lifecycle.
    void render(Graph& graph);

    // setVisible / visible can be called from the JNI thread (Kotlin
    // toggling the overlay) while the render thread reads `visible_`
    // each frame. Atomic with relaxed memory order: the flag is a hint
    // for "should I draw this frame?", not a guard for resource lifetime.
    void setVisible(bool visible) { visible_.store(visible, std::memory_order_relaxed); }
    bool visible() const          { return visible_.load(std::memory_order_relaxed); }

    // Called when the model is reloaded out-of-band (fromJson, reset).
    // Re-arms the auto-arrange pass so the next frame re-lays the
    // default graph into the canvas (a loaded custom graph keeps its
    // saved positions — arrangeNodes checks Graph::isDefaultLayout).
    // Called on the render thread (graph_jni routes through the
    // render dispatcher), same thread render() runs on.
    void onGraphReloaded() { arrangePending_ = true; }

    // System-bar insets in surface pixels. The host forwards these from
    // WindowInsets through RendererSession, so the values are written and read
    // on the render thread with the rest of the native renderer state.
    void setSystemInsets(int topPx, int bottomPx, int leftPx, int rightPx) {
        insetTopPx_    = static_cast<float>(topPx    > 0 ? topPx    : 0);
        insetBottomPx_ = static_cast<float>(bottomPx > 0 ? bottomPx : 0);
        insetLeftPx_   = static_cast<float>(leftPx   > 0 ? leftPx   : 0);
        insetRightPx_  = static_cast<float>(rightPx  > 0 ? rightPx  : 0);
    }

private:
    // The toolbar takes the selection by parameter so render() can
    // snapshot it BEFORE handler.update() runs — Link::update inside
    // ImNodeFlow deselects every selected link on any left-click event,
    // including a click on our own Delete button, so reading the
    // selection here-and-now would lose it the same frame the user
    // tries to delete a connection.
    void drawToolbar(Graph& graph,
                     FlowNode* selNode,
                     const std::shared_ptr<ImFlow::Link>& selLink);
    void drawParameterSheet(FlowNode* selNode);
    void drawSpawnPopup(Graph& graph);
    // One-shot layout pass: arrange the default graph into a grid
    // fitted to the visible canvas, accounting for each node's
    // intrinsic size. Runs only once node sizes are known.
    void arrangeNodes(Graph& graph);
    // Per-frame guard: pull every node back inside the visible canvas
    // so nothing can be dragged or spawned out of reach.
    void clampNodes(Graph& graph);
    // Visible-canvas size in ImNodeFlow grid units (screen size minus
    // the app bar / system insets, divided by the editor zoom).
    void canvasGridSize(Graph& graph, float& outW, float& outH) const;

    bool              initialized_    = false;
    std::atomic<bool> visible_        = false;
    float             densityScale_   = 1.0f;
    bool              openSpawnPopup_ = false;
    // Set whenever the model is (re)loaded; consumed by arrangeNodes
    // once node sizes are available. Render-thread only.
    bool              arrangePending_ = true;
    // Staircase offset so consecutive spawns don't overlap. Wraps at
    // 8 steps; resetting on graph reset/load isn't worth the bookkeeping.
    int               spawnStagger_   = 0;
    // Surface-pixel insets supplied by the host. Default 0 so the
    // editor renders fine before the first WindowInsets dispatch.
    float             insetTopPx_     = 0.0f;
    float             insetBottomPx_  = 0.0f;
    float             insetLeftPx_    = 0.0f;
    float             insetRightPx_   = 0.0f;
};

} // namespace penrose::graph
