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

#include <atomic>

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
    // Currently a no-op — ImFlow seeds each node's position from setPos
    // at spawn time and persists it internally afterwards. Keeps a
    // hook in place in case future work adds editor-side state that
    // needs invalidating on reload.
    void onGraphReloaded() {}

    // System-bar insets in surface pixels. The host forwards these
    // from WindowInsets so the editor's top app bar can sit below
    // the status bar / cutout instead of being drawn under it. Set
    // from the JNI thread; read on the render thread each frame —
    // plain floats with sloppy ordering are fine for a layout hint.
    void setSystemInsets(int topPx, int bottomPx, int leftPx, int rightPx) {
        insetTopPx_    = static_cast<float>(topPx    > 0 ? topPx    : 0);
        insetBottomPx_ = static_cast<float>(bottomPx > 0 ? bottomPx : 0);
        insetLeftPx_   = static_cast<float>(leftPx   > 0 ? leftPx   : 0);
        insetRightPx_  = static_cast<float>(rightPx  > 0 ? rightPx  : 0);
    }

private:
    void drawToolbar(Graph& graph);
    void drawSpawnPopup(Graph& graph);

    bool              initialized_    = false;
    std::atomic<bool> visible_        = false;
    float             densityScale_   = 1.0f;
    bool              openSpawnPopup_ = false;
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
