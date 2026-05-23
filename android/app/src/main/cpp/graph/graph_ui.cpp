#include "graph/graph_ui.h"

#include "imgui.h"

#include "log.h"

#include <algorithm>
#include <memory>
#include <string_view>
#include <vector>

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

// First selected link, or nullptr. ImNodeFlow selects a link when the
// user taps its curve; the only built-in way to then delete it is the
// hardware Delete key, which a touchscreen has not got — so the toolbar
// Delete button has to cover it. A shared_ptr is returned (not a raw
// Link*) so the link stays alive across the deleteLink() call that
// resets its owning input pin.
std::shared_ptr<ImFlow::Link> selectedLink(Graph& graph) {
    for (const auto& weak : graph.handler().getLinks()) {
        auto link = weak.lock();
        if (link && link->isSelected()) return link;
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

void GraphUi::drawToolbar(Graph& graph,
                          FlowNode* selNode,
                          const std::shared_ptr<ImFlow::Link>& selLink) {
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

    // App-bar text is density-scaled by FontGlobalScale; nudge it a bit
    // larger so Add / Delete / Reset / Close clearly fill their large
    // touch targets rather than just sit in the middle.
    ImGui::SetWindowFontScale(1.3f);

    // Four buttons equally spaced across the bar. Width per slot =
    // (bar usable width) / 4; height = bar height minus inset on both
    // sides so taps near the top/bottom edge still land inside.
    // selNode and selLink are snapshotted by render() before
    // handler.update() runs — see the comment in render() for why.
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
    // Delete removes whatever is selected: a tapped connection (just
    // that link) takes priority over a selected node, so the user can
    // unwire without destroying the node. Deleting a node drops its
    // links too — ImNodeFlow's OutPin destructor severs them.
    if (barButton("Delete", selNode != nullptr || selLink != nullptr, 1)) {
        if (selLink) {
            if (ImFlow::Pin* in = selLink->right()) in->deleteLink();
        } else if (selNode) {
            selNode->destroy();
        }
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
        // BeginMenu opens each submenu in its own window, so the popup's
        // font scale doesn't reach the submenu items — set it on the
        // popup AND inside each submenu so the whole spawn flow reads
        // at the same comfortable size.
        ImGui::SetWindowFontScale(1.3f);
        const char* cats[] = { "Source", "Operator", "Target" };
        for (const char* cat : cats) {
            if (ImGui::BeginMenu(cat)) {
                ImGui::SetWindowFontScale(1.3f);
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

// Visible-canvas size in ImNodeFlow grid units. ImNodeFlow's canvas is a
// BeginChild filling the host window's content region: getGrid().size() is
// that child's pixel size and getGrid().scale() the live zoom, so
// size / scale is the grid-unit extent a node must stay within. Reading
// the live values keeps this correct whether or not the host window has
// been resized.
//
// This must NOT use config().default_zoom: ContainedContext::m_scale is
// latched from default_zoom once, at construction — before Graph's ctor
// raises default_zoom — and afterwards only wheel-zoom or the reset-zoom
// key move it, neither reachable by touch. The live scale is therefore
// 1.0; dividing by default_zoom (1.25) shrank the canvas 20% and the
// right/bottom node clamp stopped that far short of the real edge.
void GraphUi::canvasGridSize(Graph& graph, float& outW, float& outH) const {
    const ImVec2 px = graph.handler().getGrid().size();
    float scale = graph.handler().getGrid().scale();
    if (scale <= 0.0f) scale = 1.0f;
    outW = px.x / scale;
    outH = px.y / scale;
    if (outW < 1.0f) outW = 1.0f;
    if (outH < 1.0f) outH = 1.0f;
}

// Lay the default graph out in three zones: every Source in a left-hand
// column, every Target in a right-hand column flush with the canvas
// edge, and Operators down the centre lane between them. Sources begin a
// chain and Targets end one, so signal flows left to right and the
// middle stays clear for the operators a user wires in. Runs after
// handler_.update() so node sizes are known; bails (leaving
// arrangePending_ set) until every node reports a real size.
void GraphUi::arrangeNodes(Graph& graph) {
    std::vector<FlowNode*> src, ops, tgt;
    float srcW = 0.0f, opW = 0.0f, tgtW = 0.0f, nodeH = 0.0f;
    for (auto& [uid, node] : graph.handler().getNodes()) {
        if (!node || node->toDestroy()) continue;
        const ImVec2 sz = node->getSize();
        // getSize() is (0,0) until ImNodeFlow has drawn the node once.
        if (sz.x <= 1.0f || sz.y <= 1.0f) return;   // retry next frame
        auto* fn = static_cast<FlowNode*>(node.get());
        nodeH = std::max(nodeH, sz.y);
        const std::string_view cat = descriptor(fn->kind()).category;
        if (cat == "Operator")    { ops.push_back(fn); opW  = std::max(opW,  sz.x); }
        else if (cat == "Target") { tgt.push_back(fn); tgtW = std::max(tgtW, sz.x); }
        else                      { src.push_back(fn); srcW = std::max(srcW, sz.x); }
    }
    arrangePending_ = false;
    if (src.empty() && ops.empty() && tgt.empty()) return;

    // Order within a zone: bands ascend by kind, targets follow the enum.
    auto byKind = [](FlowNode* a, FlowNode* b) { return a->kind() < b->kind(); };
    std::sort(src.begin(), src.end(), byKind);
    std::sort(ops.begin(), ops.end(), byKind);
    std::sort(tgt.begin(), tgt.end(), byKind);

    float gridW = 0.0f, gridH = 0.0f;
    canvasGridSize(graph, gridW, gridH);
    const float m    = 24.0f;             // canvas margin
    const float hGap = 46.0f;             // gap between columns
    const float rowH = nodeH + 30.0f;     // stacked-node pitch
    const int   fit  = std::max(1, static_cast<int>((gridH - 2.0f * m) / rowH));

    // Column-major fill: `list` laid top-down from (x0, m), wrapping to a
    // fresh column every `fit` nodes, columns colW + hGap apart.
    auto fill = [&](const std::vector<FlowNode*>& list, float x0, float colW) {
        const int n    = static_cast<int>(list.size());
        const int rows = std::min(fit, std::max(1, n));
        for (int i = 0; i < n; ++i)
            list[i]->setPos(ImVec2(x0 + (i / rows) * (colW + hGap),
                                   m  + (i % rows) * rowH));
    };
    // Columns `list` needs at the current fit.
    auto colsFor = [&](const std::vector<FlowNode*>& list) {
        const int n    = static_cast<int>(list.size());
        const int rows = std::min(fit, std::max(1, n));
        return (n + rows - 1) / rows;
    };

    // Sources hug the left; Targets hug the right; Operators centre in
    // whatever lane is left between the two blocks.
    fill(src, m, srcW);
    if (!tgt.empty()) {
        const float blockW = colsFor(tgt) * (tgtW + hGap) - hGap;
        fill(tgt, std::max(m, gridW - m - blockW), tgtW);
    }
    if (!ops.empty()) {
        const float blockW = colsFor(ops) * (opW + hGap) - hGap;
        fill(ops, std::max(m, (gridW - blockW) * 0.5f), opW);
    }
}

// Pull every node back inside the visible canvas. Runs every frame so a
// node can be neither dragged nor spawned out of reach; a node already
// inside its bounds is left untouched so this never fights a live drag.
void GraphUi::clampNodes(Graph& graph) {
    float gridW = 0.0f, gridH = 0.0f;
    canvasGridSize(graph, gridW, gridH);
    const float m = 6.0f;
    for (auto& [uid, node] : graph.handler().getNodes()) {
        if (!node || node->toDestroy()) continue;
        const ImVec2 sz = node->getSize();
        if (sz.x <= 1.0f || sz.y <= 1.0f) continue;   // not drawn yet
        const ImVec2 p = node->getPos();
        const float cx = std::clamp(p.x, m, std::max(m, gridW - sz.x - m));
        const float cy = std::clamp(p.y, m, std::max(m, gridH - sz.y - m));
        if (cx != p.x || cy != p.y) node->setPos(ImVec2(cx, cy));
    }
}

void GraphUi::render(Graph& graph) {
    if (!initialized_ || !visible_.load(std::memory_order_relaxed)) return;

    // Snapshot the selected node + link BEFORE handler.update() runs.
    // ImNodeFlow's Link::update deselects every selected link on any
    // left-click event ("if (!Ctrl && IsMouseClicked(Left)) m_selected
    // = false"), regardless of where the click landed — so a tap on our
    // toolbar's Delete button deselects the link the same frame the
    // user is trying to delete it. Capturing the selection here, before
    // update(), keeps the link reference alive long enough for the
    // toolbar to act on it; the shared_ptr also pins the Link until the
    // toolbar's deleteLink() call goes through.
    FlowNode* preSelNode = selectedNode(graph);
    std::shared_ptr<ImFlow::Link> preSelLink = selectedLink(graph);

    // The editor previously rode ImNodeFlow's hardcoded viewport-sized
    // wrapper, which (a) painted under the status bar and (b) made the
    // whole viewport into one big resize-target via ImGui's default
    // edge-resizing. We wrap it ourselves now with a host window:
    //   - positioned below the status bar + our top app bar,
    //   - non-movable (panning is the canvas's job, not the window's),
    //   - resizable only at the bottom-right corner (ConfigWindows-
    //     ResizeFromEdges=false), so a drag on the canvas edge can't
    //     be mistaken for a resize gesture mid-pan,
    //   - kept above the gesture-nav region by the bottomSafe margin
    //     below, so the resize grip is reachable on phones where the
    //     navbar inset is small but the system gesture area extends
    //     well above the screen edge.
    // The host window background is semi-transparent so the wallpaper
    // (and the audio/clock-driven tiling) shows through the editor —
    // the user gets feedback on what their graph is driving while they
    // wire it. ImNodeFlow opens its own viewport-sized window inside
    // its separate ImGuiContext during handler.update() — that's
    // harmless, its draw data is merged into our BeginChild rect by
    // AppendDrawData and clipped to fit.
    ImGui::GetIO().ConfigWindowsResizeFromEdges = false;

    const ImGuiIO& io = ImGui::GetIO();
    const float barH       = kAppBarHeightDp * densityScale_;
    const float topY       = insetTopPx_ + barH;
    // ~56dp of clearance above the bottom screen edge so the visible
    // resize grip + ImGui's hit rect both sit above Android's gesture
    // strip. WindowInsets reports the nav-bar inset, but on gesture nav
    // the inset is small (often ~16dp) and the gesture region extends
    // higher — this is the conservative margin.
    const float bottomSafe = 56.0f * densityScale_;

    ImGui::SetNextWindowPos(ImVec2(insetLeftPx_, topY), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(
        ImVec2(io.DisplaySize.x - insetLeftPx_ - insetRightPx_,
               io.DisplaySize.y - topY - insetBottomPx_ - bottomSafe),
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
    ImGui::PushStyleColor(ImGuiCol_WindowBg, IM_COL32(15, 18, 22, 150));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::Begin("##GraphEditorHost", nullptr, kHostFlags);
    graph.handler().update();
    // ImGui still creates this window's bottom-right resize grip, and it
    // still hit-tests (resize grips use ImGuiButtonFlags_FlattenChildren,
    // so a touch lands on the grip even through ImNodeFlow's canvas
    // child) — but that child is opaque and is painted over the grip, so
    // the handle went invisible. Redraw it on the foreground draw list,
    // above the canvas, at the same corner so the affordance is findable.
    // The grip underneath does the actual resize; canvasGridSize reads
    // the live canvas, so the node clamp re-fits a resized window.
    {
        const ImVec2 br = ImGui::GetWindowPos() + ImGui::GetWindowSize();
        const float  s  = 24.0f * densityScale_;
        ImDrawList*  fg = ImGui::GetForegroundDrawList();
        fg->AddTriangleFilled(ImVec2(br.x - s, br.y),
                              ImVec2(br.x, br.y - s), br,
                              IM_COL32(150, 170, 185, 230));
        fg->AddTriangle(ImVec2(br.x - s, br.y),
                        ImVec2(br.x, br.y - s), br,
                        IM_COL32(228, 235, 240, 235), 1.5f);
    }
    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

    // Keep the graph reachable. arrangeNodes lays the default graph
    // into a canvas-fitted grid once (a loaded custom graph keeps its
    // saved positions — only clamped); clampNodes then runs every
    // frame so nothing can be dragged or spawned out of bounds.
    if (arrangePending_) {
        if (graph.isDefaultLayout()) arrangeNodes(graph);
        else                         arrangePending_ = false;
    }
    clampNodes(graph);

    drawToolbar(graph, preSelNode, preSelLink);
    drawSpawnPopup(graph);
}

} // namespace penrose::graph
