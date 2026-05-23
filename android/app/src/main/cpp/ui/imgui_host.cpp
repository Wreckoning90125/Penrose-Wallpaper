// ImGuiHost — owns ONE ImGui context + the Vulkan-backend wiring + a
// lock-free SPSC touch ring. There can be several ImGuiHost instances in
// the same process at once (live-wallpaper engine, in-app preview
// Activity, full-screen Activity), each driving its own Vulkan device
// and swapchain.
//
// CRITICAL invariant: ImGui keeps a single global "current context"
// pointer; every ImGui:: / ImGui_ImplVulkan_ call reads it. If you have
// two contexts and never SetCurrentContext, whichever context was
// created last becomes the global current and every subsequent ImGui
// call routes through it — including the OTHER ImGuiHost's render
// thread, which then drives the wrong VkDevice + descriptor pool and
// crashes on the next draw. The fix: cache the ImGuiContext* we got
// from CreateContext and call ImGui::SetCurrentContext(imguiCtx_) at
// the top of every public entry point that touches ImGui state.

#include "ui/imgui_host.h"

#include "imgui.h"
#include "backends/imgui_impl_vulkan.h"

#include "log.h"

#include <cfloat>

namespace penrose::ui {

namespace {

constexpr int kDescriptorPoolSize = 64;

void checkVkResult(VkResult err) {
    if (err != VK_SUCCESS) LOGE("ImGui Vulkan: VkResult=%d", static_cast<int>(err));
}

} // namespace

ImGuiHost::ImGuiHost() = default;
ImGuiHost::~ImGuiHost() { shutdown(); }

bool ImGuiHost::initialize(const VulkanContext& ctx, float densityScale) {
    if (initialized_.load(std::memory_order_acquire)) return true;
    device_        = ctx.device;
    graphicsQueue_ = ctx.graphicsQueue;
    densityScale_  = densityScale > 0.0f ? densityScale : 1.0f;

    VkDescriptorPoolSize poolSize{};
    poolSize.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    poolSize.descriptorCount = kDescriptorPoolSize;

    VkDescriptorPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolInfo.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    poolInfo.maxSets = kDescriptorPoolSize;
    poolInfo.poolSizeCount = 1;
    poolInfo.pPoolSizes = &poolSize;
    if (vkCreateDescriptorPool(device_, &poolInfo, nullptr, &descriptorPool_) != VK_SUCCESS) {
        LOGE("ImGuiHost: descriptor pool creation failed");
        return false;
    }

    IMGUI_CHECKVERSION();
    // Save the context pointer and make it current — see the file-top
    // invariant comment. ImGui::CreateContext also implicitly calls
    // SetCurrentContext(new_ctx) but we never trust the global; we
    // re-Set on every entry below.
    imguiCtx_ = ImGui::CreateContext();
    ImGui::SetCurrentContext(imguiCtx_);
    ImGui::StyleColorsDark();

    ImGuiStyle& style = ImGui::GetStyle();
    // Base values are in dp; ScaleAllSizes(density) converts to pixels.
    // Targets aim for the Material 48dp minimum.
    style.TouchExtraPadding = ImVec2(8.0f, 8.0f);
    style.FramePadding      = ImVec2(14.0f, 14.0f);
    style.ItemSpacing       = ImVec2(10.0f, 10.0f);
    style.ItemInnerSpacing  = ImVec2(8.0f, 6.0f);
    style.GrabMinSize       = 48.0f;
    style.ScrollbarSize     = 28.0f;
    style.WindowPadding     = ImVec2(12.0f, 12.0f);
    style.WindowRounding    = 8.0f;
    style.FrameRounding     = 6.0f;
    style.GrabRounding      = 6.0f;
    style.ScaleAllSizes(densityScale_);

    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.IniFilename = nullptr;
    io.MouseDrawCursor = false;
    io.MouseDragThreshold = 12.0f * densityScale_;
    // Scale glyphs with density too. style.ScaleAllSizes covers padding
    // and item sizes (which is why buttons look big), but the default
    // ImGui font is a fixed 13px bitmap, so on a high-density phone you
    // get fat density-sized buttons with miniscule text inside — the
    // toolbar / popup / node-text "lost in the space" symptom. Density-
    // scaling the font puts glyphs on the same dp footing as the rest
    // of the UI, the same idiom Android apps use for sp/dp units, and
    // adapts naturally across phones, landscape, tablets and foldables
    // since density and DisplaySize are reported per surface.
    io.FontGlobalScale = densityScale_;

    ImGui_ImplVulkan_InitInfo init{};
    init.ApiVersion        = VK_API_VERSION_1_3;
    init.Instance          = ctx.instance;
    init.PhysicalDevice    = ctx.physicalDevice;
    init.Device            = ctx.device;
    init.QueueFamily       = ctx.graphicsQueueFamily;
    init.Queue             = ctx.graphicsQueue;
    init.DescriptorPool    = descriptorPool_;
    init.MinImageCount     = ctx.minImageCount;
    init.ImageCount        = ctx.imageCount;
    init.UseDynamicRendering = true;
    // ImGui v1.92.x retired the top-level MSAASamples + PipelineRenderingCreateInfo
    // fields in favor of the nested PipelineInfoMain block. Use the new
    // path so the wallpaper + ImGui share a pipeline-rendering format.
    VkFormat colorFmt = ctx.colorAttachmentFormat;
    init.PipelineInfoMain.MSAASamples = ctx.msaaSamples;
    init.PipelineInfoMain.PipelineRenderingCreateInfo = {};
    init.PipelineInfoMain.PipelineRenderingCreateInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO;
    init.PipelineInfoMain.PipelineRenderingCreateInfo.colorAttachmentCount    = 1;
    init.PipelineInfoMain.PipelineRenderingCreateInfo.pColorAttachmentFormats = &colorFmt;
    init.PipelineInfoMain.PipelineRenderingCreateInfo.depthAttachmentFormat   = VK_FORMAT_UNDEFINED;
    init.PipelineInfoMain.PipelineRenderingCreateInfo.stencilAttachmentFormat = VK_FORMAT_UNDEFINED;
    init.CheckVkResultFn = checkVkResult;
    if (!ImGui_ImplVulkan_Init(&init)) {
        LOGE("ImGui_ImplVulkan_Init failed");
        ImGui::DestroyContext(imguiCtx_);
        imguiCtx_ = nullptr;
        vkDestroyDescriptorPool(device_, descriptorPool_, nullptr);
        descriptorPool_ = VK_NULL_HANDLE;
        return false;
    }
    // v1.92.8 retired the explicit CreateFontsTexture call; the backend
    // creates the atlas implicitly on the first NewFrame and tracks it
    // through ImTextureData / ImGui_ImplVulkan_UpdateTexture from then on.
    initialized_.store(true, std::memory_order_release);
    LOGI("ImGuiHost initialized (densityScale=%.2f, ctx=%p)",
         densityScale_, static_cast<void*>(imguiCtx_));
    return true;
}

void ImGuiHost::shutdown() {
    if (!initialized_.load(std::memory_order_acquire)) return;
    // Make sure shutdown operates on OUR context — another ImGuiHost
    // may have stolen the global current by now.
    ImGui::SetCurrentContext(imguiCtx_);
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    ImGui_ImplVulkan_Shutdown();
    ImGui::DestroyContext(imguiCtx_);
    imguiCtx_ = nullptr;
    if (descriptorPool_ != VK_NULL_HANDLE) {
        vkDestroyDescriptorPool(device_, descriptorPool_, nullptr);
        descriptorPool_ = VK_NULL_HANDLE;
    }
    device_ = VK_NULL_HANDLE;
    graphicsQueue_ = VK_NULL_HANDLE;
    initialized_.store(false, std::memory_order_release);
}

void ImGuiHost::onSwapchainChanged(uint32_t newMinImageCount, uint32_t /*newImageCount*/) {
    if (!initialized_.load(std::memory_order_acquire)) return;
    ImGui::SetCurrentContext(imguiCtx_);
    if (newMinImageCount >= 2) ImGui_ImplVulkan_SetMinImageCount(newMinImageCount);
}

void ImGuiHost::queueTouchEvent(const TouchEvent& ev) {
    // SPSC ring write only — no ImGui state touched, no SetCurrentContext
    // needed. queueTouchEvent runs on the JNI/UI thread; the render
    // thread drains via drainTouchQueue inside newFrame.
    if (!initialized_.load(std::memory_order_acquire)) return;
    const uint32_t w = ringWrite_.load(std::memory_order_relaxed);
    const uint32_t next = (w + 1) % kQueueCapacity;
    // SPSC contract: the consumer (drainTouchQueue, on the render
    // thread) is the only writer of ringRead_. The producer NEVER
    // touches it. If the ring is full the producer drops the new event
    // rather than racing with the consumer's RMW.
    if (next == ringRead_.load(std::memory_order_acquire)) {
        return;
    }
    ring_[w] = ev;
    ringWrite_.store(next, std::memory_order_release);
}

void ImGuiHost::drainTouchQueue() {
    // Caller (newFrame) already set current context.
    ImGuiIO& io = ImGui::GetIO();
    uint32_t r = ringRead_.load(std::memory_order_relaxed);
    const uint32_t w = ringWrite_.load(std::memory_order_acquire);
    // Always stamp the touch source if a finger is currently down so a
    // frame with zero new events but ongoing drag doesn't lose its
    // touch-source label to a later non-touch input.
    if (mouseDown_) io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
    bool stampedThisFrame = mouseDown_;
    while (r != w) {
        const TouchEvent& ev = ring_[r];
        if (!stampedThisFrame) {
            io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
            stampedThisFrame = true;
        }
        switch (ev.phase) {
            case TouchPhase::Down:
                io.AddMousePosEvent(ev.x, ev.y);
                io.AddMouseButtonEvent(0, true);
                mouseDown_ = true;
                break;
            case TouchPhase::Move:
                io.AddMousePosEvent(ev.x, ev.y);
                break;
            case TouchPhase::Up:
            case TouchPhase::Cancel:
                io.AddMouseButtonEvent(0, false);
                io.AddMousePosEvent(-FLT_MAX, -FLT_MAX);
                mouseDown_ = false;
                break;
            case TouchPhase::LongPress:
                // Synthetic right-click pair at the held position so
                // ImNodeFlow's rightClickPopUpContent (and any other
                // right-mouse-driven editor gestures) fires from a
                // tap-and-hold. We do NOT release the left button —
                // the user's finger is still on screen and may continue
                // dragging.
                io.AddMousePosEvent(ev.x, ev.y);
                io.AddMouseButtonEvent(1, true);
                io.AddMouseButtonEvent(1, false);
                break;
        }
        r = (r + 1) % kQueueCapacity;
    }
    ringRead_.store(r, std::memory_order_release);
}

void ImGuiHost::newFrame(int surfaceWidthPx, int surfaceHeightPx, float deltaSeconds) {
    if (!initialized_.load(std::memory_order_acquire)) return;
    ImGui::SetCurrentContext(imguiCtx_);
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize             = ImVec2(static_cast<float>(surfaceWidthPx),
                                        static_cast<float>(surfaceHeightPx));
    io.DisplayFramebufferScale = ImVec2(1.0f, 1.0f);
    io.DeltaTime               = (deltaSeconds > 0.0f) ? deltaSeconds : (1.0f / 60.0f);
    drainTouchQueue();
    ImGui_ImplVulkan_NewFrame();
    ImGui::NewFrame();
}

void ImGuiHost::render() {
    if (!initialized_.load(std::memory_order_acquire)) return;
    ImGui::SetCurrentContext(imguiCtx_);
    ImGui::Render();
}

void ImGuiHost::recordDrawCommands(VkCommandBuffer cmd) {
    if (!initialized_.load(std::memory_order_acquire)) return;
    ImGui::SetCurrentContext(imguiCtx_);
    ImDrawData* drawData = ImGui::GetDrawData();
    if (drawData) ImGui_ImplVulkan_RenderDrawData(drawData, cmd);
}

} // namespace penrose::ui
