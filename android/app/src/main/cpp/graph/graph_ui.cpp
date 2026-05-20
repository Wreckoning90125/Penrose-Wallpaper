#include "graph/graph_ui.h"

#include "imgui.h"

#include "log.h"

#include <string_view>

namespace penrose::graph {

namespace {

// Editor app bar — a full-width strip flush with the top of the
// viewport, with four equally-spaced buttons across it. Looks and
// behaves like an Android top app bar: anchored to the system layout
// edge so it never floats awkwardly mid-screen, and tall enough
// (60dp) that the buttons are unambiguous touch targets on a phone.
constexpr float kAppBarHeightDp   = 60.0f;
constexpr float kAppBarInsetDp    = 8.0f;

FlowNode* selectedNode(Graph& graph) {
    // Skip destroyed nodes too — Del marks the selected node for removal
    // before the next handler.update() sweeps it, and the parameter
    // sheet should disappear immediately on the click rather than
    // editing values into a node that's about to vanish.
    for (auto& [uid, node] : graph.handler().getNodes()) {
        if (!node || node->toDestroy()) continue;
        if (node->isSelected()) return static_cast<FlowNode*>(node.get());
    }
    return nullptr;
}

} // namespace

bool GraphUi::initialize(float densityScale) {
    if (initialized_) return true;
    densityScale_ = densityScale > 0.0f ? densityScale : 1.0f;
    initialized_  = true;
    LOGI("GraphUi initialised");
    return true;
}

void GraphUi::shutdown() {
    initialized_ = false;
}

void GraphUi::drawToolbar(Graph& graph) {
    const ImGuiIO& io = ImGui::GetIO();
    const float barH  = kAppBarHeightDp * densityScale_;
    const float inset = kAppBarInsetDp  * densityScale_;

    // Full-width strip pinned below the status-bar inset. Without the
    // shift, the bar sits at y=0 of the wallpaper surface — which on
    // an edge-to-edge live wallpaper surface is the area the system
    // status bar paints on top of, so the Add/Delete/Reset/Close
    // buttons end up un-tappable behind the status icons. We use the
    // surface-pixel inset forwarded by the host activity from
    // WindowInsets; it is 0 until the first dispatch arrives, which
    // is acceptable (the editor is hidden until the user explicitly
    // opens it).
    ImGui::SetNextWindowPos(ImVec2(0.0f, insetTopPx_));
    ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x, barH));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, IM_COL32(15, 17, 22, 220));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(inset, inset));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##GraphAppBar", nullptr,
                 ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                 ImGuiWindowFlags_NoMove     | ImGuiWindowFlags_NoCollapse |
                 ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoSavedSettings);

    // Four buttons equally spaced across the bar. Width per slot =
    // (bar usable width) / 4; height = bar height minus inset on both
    // sides so taps near the top/bottom edge still land inside.
    FlowNode* sel = selectedNode(graph);
    const float usableW = io.DisplaySize.x - 2.0f * inset;
    const float slotW   = usableW * 0.25f;
    const float btnW    = slotW - inset;
    const float btnH    = barH - 2.0f * inset;

    auto barButton = [&](const char* label, bool enabled, int slot) {
        if (slot > 0) ImGui::SameLine(inset + slot * slotW);
        ImGui::BeginDisabled(!enabled);
        const bool clicked = ImGui::Button(label, ImVec2(btnW, btnH));
        ImGui::EndDisabled();
        return clicked && enabled;
    };

    if (barButton("Add", true, 0)) {
        openSpawnPopup_ = true;
    }
    if (barButton("Delete", sel != nullptr, 1) && sel) {
        sel->destroy();
    }
    if (barButton("Reset", true, 2)) {
        graph.resetToDefault();
        onGraphReloaded();
    }
    if (barButton("Close", true, 3)) {
        visible_.store(false, std::memory_order_relaxed);
    }

    ImGui::End();
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor();
}

void GraphUi::drawSpawnPopup(Graph& graph) {
    if (openSpawnPopup_) {
        ImGui::OpenPopup("##GraphSpawn");
        openSpawnPopup_ = false;
    }
    if (ImGui::BeginPopup("##GraphSpawn")) {
        const char* cats[] = { "Source", "Operator", "Target" };
        for (const char* cat : cats) {
            if (ImGui::BeginMenu(cat)) {
                for (int i = 0; i < descriptorCount(); ++i) {
                    const NodeDescriptor& d = descriptors()[i];
                    if (std::string_view(d.category) != cat) continue;
                    if (ImGui::MenuItem(d.label)) {
                        // Place new nodes at the top-left of the
                        // currently-visible grid region, with a small
                        // staircase stagger so a burst of "Add" taps
                        // doesn't pile everyone onto one spot.
                        //
                        // -scroll IS the grid coordinate at the canvas
                        // top-left (per ImNodeFlow's screen2grid math),
                        // so this works regardless of how far the user
                        // has panned or scrolled. Using screen2grid on
                        // io.DisplaySize/2 worked only when origin was
                        // (0,0) and scale was 1 — anything else (zoom,
                        // window padding, dialog overlay) landed
                        // spawns off-screen and the user never saw
                        // them.
                        const ImVec2 topLeft = ImVec2(0.0f, 0.0f)
                                             - graph.handler().getScroll();
                        const float stagger = (spawnStagger_++ % 8) * 28.0f;
                        graph.addNode(d.kind,
                                      topLeft.x + 80.0f + stagger,
                                      topLeft.y + 80.0f + stagger);
                    }
                }
                ImGui::EndMenu();
            }
        }
        ImGui::EndPopup();
    }
}

// Bottom parameter sheet was removed: tunable nodes (SrcConstant,
// OpClamp, OpSmoothstep, OpScaleBias) now expose their sliders
// directly in their node body via FlowNode::draw() overrides. Two
// reasons: (1) the bottom sheet floated over the canvas and stole
// scrolling/dragging hits, (2) users couldn't tell which nodes had
// parameters without selecting them first. Inline sliders make the
// affordance visible at a glance.

void GraphUi::render(Graph& graph) {
    if (!initialized_ || !visible_.load(std::memory_order_relaxed)) return;

    // The editor previously rode ImNodeFlow's hardcoded viewport-sized
    // wrapper, which (a) painted under the status bar and (b) made the
    // whole viewport into one big resize-target via ImGui's default
    // edge-resizing. We wrap it ourselves now with a host window:
    //   - positioned below the status bar + our top app bar,
    //   - non-movable (panning is the canvas's job, not the window's),
    //   - resizable only at the bottom-right corner (ConfigWindows-
    //     ResizeFromEdges=false), so a drag on the canvas edge can't
    //     be mistaken for a resize gesture mid-pan.
    // ImNodeFlow opens its own viewport-sized window inside its
    // separate ImGuiContext during handler.update() — that's harmless,
    // its draw data is merged into our BeginChild rect by
    // AppendDrawData and clipped to fit.
    ImGui::GetIO().ConfigWindowsResizeFromEdges = false;

    const ImGuiIO& io = ImGui::GetIO();
    const float barH  = kAppBarHeightDp * densityScale_;
    const float topY  = insetTopPx_ + barH;

    ImGui::SetNextWindowPos(ImVec2(insetLeftPx_, topY), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(
        ImVec2(io.DisplaySize.x - insetLeftPx_ - insetRightPx_,
               io.DisplaySize.y - topY - insetBottomPx_),
        ImGuiCond_FirstUseEver);

    constexpr ImGuiWindowFlags kHostFlags =
        ImGuiWindowFlags_NoTitleBar           |
        ImGuiWindowFlags_NoCollapse           |
        ImGuiWindowFlags_NoMove               |  // pan via canvas drag, not window drag
        ImGuiWindowFlags_NoScrollbar          |
        ImGuiWindowFlags_NoScrollWithMouse    |
        // The toolbar must stay on top of the editor host whenever
        // the user taps inside the canvas (which gives the editor
        // focus). Without this flag, ImGui re-orders the focused
        // window to the front, hiding our Add/Delete/Reset/Close
        // buttons behind it.
        ImGuiWindowFlags_NoBringToFrontOnFocus;

    // Zero out window padding so the canvas fills the host window
    // edge-to-edge. ImNodeFlow's BeginChild uses GetContentRegionAvail
    // for its own size, which respects this padding.
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::Begin("##GraphEditorHost", nullptr, kHostFlags);
    graph.handler().update();
    ImGui::End();
    ImGui::PopStyleVar();

    drawToolbar(graph);
    drawSpawnPopup(graph);
}

} // namespace penrose::graph
