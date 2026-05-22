// Renderer top-level: construction, surface lifecycle, drawFrame, ImGui
// hook, gesture / lifecycle accessors. Heavy lifting lives in:
//   renderer_vulkan.cpp   — instance/device/swapchain/pipeline/descriptor setup
//   renderer_geometry.cpp — buildGeometry + updatePaletteUbo
// Internal shared types are in render_state.h.

#include "renderer/renderer.h"

#include "color/color.h"
#include "log.h"
#include "renderer/render_state.h"
#include "tiling/penrose.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace penrose {

// =============================================================================
// Construction / destruction
// =============================================================================

Renderer::Renderer(AAssetManager* assets) : assets_(assets) {
    if (!initInstance()) {
        LOGE("Renderer: failed to create instance");
        return;
    }
}

Renderer::~Renderer() {
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    onSurfaceDestroyed();

    if (device_ != VK_NULL_HANDLE) {
        if (fillVertBuf_)        vkDestroyBuffer(device_, fillVertBuf_, nullptr);
        if (fillVertMem_)        vkFreeMemory(device_, fillVertMem_, nullptr);
        if (borderVertBuf_)      vkDestroyBuffer(device_, borderVertBuf_, nullptr);
        if (borderVertMem_)      vkFreeMemory(device_, borderVertMem_, nullptr);
        if (borderIdxBuf_)       vkDestroyBuffer(device_, borderIdxBuf_, nullptr);
        if (borderIdxMem_)       vkFreeMemory(device_, borderIdxMem_, nullptr);
        destroyDescriptorObjects();
        destroyPipelines();
        if (commandPool_)        vkDestroyCommandPool(device_, commandPool_, nullptr);
        vkDestroyDevice(device_, nullptr);
        device_ = VK_NULL_HANDLE;
    }
    if (instance_ != VK_NULL_HANDLE) {
        vkDestroyInstance(instance_, nullptr);
        instance_ = VK_NULL_HANDLE;
    }
}

// =============================================================================
// Surface lifecycle
// =============================================================================

bool Renderer::onSurfaceCreated(ANativeWindow* window) {
    if (!window || instance_ == VK_NULL_HANDLE) return false;

    // Defensive teardown of any stale surface state. Some launchers
    // (and the live-wallpaper engine on display-mode changes) deliver
    // surfaceCreated back-to-back without an intervening
    // surfaceDestroyed. Without this, the old VkSurfaceKHR + VkSwapchainKHR
    // + ANativeWindow get overwritten without being destroyed/released,
    // and once an in-flight frame from the previous surface tries to
    // present, the driver dereferences a freed handle and the app
    // hard-crashes. Skip if there's literally nothing to clean up so
    // first-init still hits the fast path.
    if (surface_ != VK_NULL_HANDLE || swapchain_ != VK_NULL_HANDLE || window_ != nullptr) {
        if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
        destroyPerFrameResources();
        destroySwapchain();
        if (surface_ != VK_NULL_HANDLE) {
            vkDestroySurfaceKHR(instance_, surface_, nullptr);
            surface_ = VK_NULL_HANDLE;
        }
        if (window_) {
            ANativeWindow_release(window_);
            window_ = nullptr;
        }
        swapchainReady_ = false;
    }

    ANativeWindow_acquire(window);
    window_ = window;
    if (!createSurface(window)) return false;

    if (!deviceReady_) {
        if (!initDeviceForSurface()) return false;
        if (!createDescriptorObjects()) return false;
        if (!initPipeline()) return false;
        deviceReady_ = true;
    }

    int w = ANativeWindow_getWidth(window);
    int h = ANativeWindow_getHeight(window);
    if (!createSwapchain(w, h)) return false;
    if (!buildPipelines()) return false;
    if (!buildGeometry()) return false;
    updatePaletteUbo();
    if (!createPerFrameResources()) return false;
    swapchainReady_ = true;
    settingsDirty_ = false;
    return true;
}

bool Renderer::onSurfaceChanged(int width, int height) {
    if (!deviceReady_ || width <= 0 || height <= 0) return false;
    if ((uint32_t)width == swapchainExtent_.width &&
        (uint32_t)height == swapchainExtent_.height) return true;
    return rebuildSwapchain();
}

bool Renderer::rebuildSwapchain() {
    if (!deviceReady_ || surface_ == VK_NULL_HANDLE) return false;
    // createSwapchain re-queries VkSurfaceCapabilitiesKHR::currentExtent
    // for the true (post-rotation) surface size; the width/height args
    // are only the fallback for the UINT32_MAX case, which Android does
    // not use — so the last known extent is a safe fallback value.
    const int w = (swapchainExtent_.width  > 0) ? (int)swapchainExtent_.width  : 1;
    const int h = (swapchainExtent_.height > 0) ? (int)swapchainExtent_.height : 1;
    vkDeviceWaitIdle(device_);
    swapchainReady_ = false;
    destroyPerFrameResources();
    destroySwapchain();
    if (!createSwapchain(w, h))       return false;
    if (!buildPipelines())            return false;
    if (!createPerFrameResources())   return false;
    swapchainReady_ = true;
    if (imGuiReady_) {
        const uint32_t imageCount = static_cast<uint32_t>(swapchainImages_.size());
        const uint32_t minImageCount = std::max<uint32_t>(2, imageCount);
        imGuiHost_.onSwapchainChanged(minImageCount, imageCount);
    }
    return true;
}

void Renderer::syncSwapchainToSurface() {
    if (!deviceReady_ || surface_ == VK_NULL_HANDLE) return;
    VkSurfaceCapabilitiesKHR caps{};
    if (vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice_, surface_, &caps)
            != VK_SUCCESS) return;
    const VkExtent2D ce = caps.currentExtent;
    // 0 — the surface is not presentable right now (window minimised /
    // mid-teardown); UINT32_MAX — the surface defers sizing to the
    // swapchain. Either way there is no surface size to match against.
    if (ce.width == 0 || ce.height == 0 || ce.width == UINT32_MAX) return;
    if (ce.width != swapchainExtent_.width || ce.height != swapchainExtent_.height) {
        rebuildSwapchain();
    }
}

void Renderer::onSurfaceDestroyed() {
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    if (imGuiReady_) {
        imGuiHost_.shutdown();
        imGuiReady_ = false;
    }
    destroyPerFrameResources();
    destroySwapchain();
    if (surface_ != VK_NULL_HANDLE) {
        vkDestroySurfaceKHR(instance_, surface_, nullptr);
        surface_ = VK_NULL_HANDLE;
    }
    if (window_) {
        ANativeWindow_release(window_);
        window_ = nullptr;
    }
    swapchainReady_ = false;
}

// =============================================================================
// Settings + ImGui bring-up
// =============================================================================

void Renderer::initImGuiIfNeeded() {
    if (imGuiReady_ || !deviceReady_ || !swapchainReady_) return;
    ui::VulkanContext ctx{};
    ctx.instance              = instance_;
    ctx.physicalDevice        = physicalDevice_;
    ctx.device                = device_;
    ctx.graphicsQueueFamily   = graphicsQueueFamily_;
    ctx.graphicsQueue         = queue_;
    ctx.colorAttachmentFormat = swapchainFormat_;
    ctx.minImageCount         = static_cast<uint32_t>(std::max<size_t>(2, swapchainImages_.size()));
    ctx.imageCount            = static_cast<uint32_t>(swapchainImages_.size());
    ctx.msaaSamples           = VK_SAMPLE_COUNT_1_BIT;
    // densityScale arrives from Kotlin's DisplayMetrics.density via
    // setUiDensity. ImGui style metrics scale against actual px/dp so
    // touch targets sit near the Material 48dp guideline regardless of
    // which physical screen owns the surface.
    if (imGuiHost_.initialize(ctx, uiDensity_)) {
        graphUi_.initialize(uiDensity_);
        imGuiReady_ = true;
    }
}

void Renderer::onSettingsChanged(const Settings& s) {
    const bool needGeom = geometryChanged(settings_, s) || classificationChanged(settings_, s)
                       || s.borderOn != settings_.borderOn;
    const bool genChanged = (s.generation != settings_.generation);
    const bool panModeChanged = (s.panMode != settings_.panMode);
    settings_ = s;
    // Mirror the persisted view into the live state so a fresh launch
    // picks up the saved zoom / rotation / pan.
    view_.zoom = s.zoom;
    view_.rotation = s.rotation;
    view_.panX = s.panX;
    view_.panY = s.panY;
    if (genChanged || panModeChanged) {
        effectiveGeneration_ = settings_.generation;
        panAccumPx_ = 0.0f;
    }
    if (deviceReady_ && swapchainReady_) {
        vkDeviceWaitIdle(device_);
        if (needGeom || genChanged || panModeChanged) buildGeometry();
        updatePaletteUbo();
    } else {
        settingsDirty_ = true;
    }
}

// =============================================================================
// Gestures + live view
// =============================================================================

void Renderer::touchPinch(float scale, float rotDelta) {
    view_.zoom = std::clamp(view_.zoom * scale, 0.25f, 8.0f);
    view_.rotation += rotDelta;
}

void Renderer::touchMove(float dx, float dy) {
    if (settings_.panMode == 1) {
        // Generative mode: accumulate gesture distance and grow the
        // tiling outward when cumulative travel crosses one screen
        // width. The view stays centered; new tiles appear at the
        // perimeter on each deflation pass.
        panAccumPx_ += std::sqrt(dx * dx + dy * dy);
        considerGrowth();
    }
    // Locked mode (panMode == 0): touchMove is intentionally a no-op.
}

void Renderer::resetView() {
    view_ = LiveView{};
    effectiveGeneration_ = settings_.generation;
    panAccumPx_ = 0.0f;
}

void Renderer::readView(float* zoom, float* rotation, float* panX, float* panY) const {
    if (zoom)     *zoom     = view_.zoom;
    if (rotation) *rotation = view_.rotation;
    if (panX)     *panX     = view_.panX;
    if (panY)     *panY     = view_.panY;
}

void Renderer::tick(float tSeconds) {
    time_ = tSeconds;
}

void Renderer::surfaceGeometry(int surfW, int surfH, int screenW, int screenH) {
    surfW_   = surfW;
    surfH_   = surfH;
    screenW_ = screenW;
    screenH_ = screenH;
}

void Renderer::setPageOffset(float xOffset) {
    pageOffset_ = std::clamp(xOffset, 0.0f, 1.0f);
}

void Renderer::setUiDensity(float density) {
    // Honour anything plausible; pathological zero/negative values keep
    // the default 2.5 so ImGui style metrics never collapse.
    if (density > 0.5f && density < 10.0f) uiDensity_ = density;
}

void Renderer::setSystemInsets(int topPx, int bottomPx, int leftPx, int rightPx) {
    graphUi_.setSystemInsets(topPx, bottomPx, leftPx, rightPx);
}

void Renderer::considerGrowth() {
    if (settings_.panMode != 1) return;
    const float threshold = (surfW_ > 0) ? (float)surfW_ : 1080.0f;
    const int maxGen = familyInfo(settings_.family).maxGen;
    while (panAccumPx_ >= threshold && effectiveGeneration_ < maxGen) {
        panAccumPx_ -= threshold;
        effectiveGeneration_ += 1;
        if (deviceReady_ && swapchainReady_) {
            vkDeviceWaitIdle(device_);
            buildGeometry();
        }
    }
    if (effectiveGeneration_ >= maxGen) panAccumPx_ = 0.0f;
}

// =============================================================================
// Frame
// =============================================================================

void Renderer::drawFrame() {
    if (!deviceReady_ || !swapchainReady_) return;

    // A device rotation resizes the surface. If the swapchain no longer
    // matches, rebuild it before drawing so this frame already targets
    // the correct extent — otherwise the compositor stretches the
    // stale-orientation swapchain onto the rotated window and the
    // wallpaper stays distorted until it is re-applied.
    syncSwapchainToSurface();
    if (!swapchainReady_) return;

    if (settingsDirty_) {
        vkDeviceWaitIdle(device_);
        buildGeometry();
        updatePaletteUbo();
        settingsDirty_ = false;
    }

    // Drive audio analysis once per render frame. dt is taken from the
    // monotonic time deltas the Choreographer ticks deliver — when the
    // ripple/gesture/audio loop isn't armed, drawFrame is called sparsely
    // and dt may be large, in which case the analyzer's quiesce path
    // smoothly fades the bands out.
    const float dt = (lastFrameSec_ > 0.0f)
        ? std::clamp(time_ - lastFrameSec_, 1.0f / 240.0f, 1.0f / 15.0f)
        : 1.0f / 60.0f;
    lastFrameSec_ = time_;
    globalAudioAnalyzer().analyzeFrame(dt);

    // Snapshot bands + beat ONCE per frame under analyzeMutex_. Reuse
    // the same buffer for the modulation graph's EvalContext and the
    // UBO audio block below — taking the lock twice in a frame is just
    // contention waiting to happen when a second renderer in the same
    // process is also doing snapshots.
    float audioBands[AudioAnalyzer::kBands];
    float audioBeat = 0.0f;
    globalAudioAnalyzer().snapshot(audioBands, audioBeat);

    // Modulation graph: evaluate against the latest audio + clock. The
    // result lands in the fx* members the UBO patch below uploads —
    // never back into settings_. settings_ stays the pristine user
    // baseline; seeding the graph from it every frame (rather than from
    // last frame's modulated output) is what stops a connected target
    // from accumulating without bound. Graph::evaluate leaves a target
    // untouched when its input pin has no upstream link, so an empty
    // graph reproduces the slider values exactly.
    {
        graph::EvalContext gctx{};
        for (int i = 0; i < 8; ++i) gctx.bands[i] = audioBands[i];
        gctx.beat       = audioBeat;
        gctx.timeSec    = time_;
        gctx.pageScroll = pageOffset_;
        graph::EvalResult gres{};
        gres.rippleAmount   = settings_.rippleAmount;
        gres.rippleSpeed    = settings_.rippleSpeed;
        gres.brightness     = settings_.brightness;
        gres.depthAmount    = settings_.depthAmount;
        gres.matRoughness   = settings_.matRoughness;
        gres.matMetalness   = settings_.matMetalness;
        gres.matSheen       = settings_.matSheen;
        gres.matClearcoat   = settings_.matClearcoat;
        gres.matAnisotropy  = settings_.matAnisotropy;
        gres.matIridescence = settings_.matIridescence;
        gres.matEmissive    = settings_.matEmissive;
        gres.matRelief      = settings_.matRelief;
        gres.lightAngle     = settings_.lightAngle;
        gres.lightElevation = settings_.lightElevation;
        gres.lightIntensity = settings_.lightIntensity;
        gres.lightWarmth    = settings_.lightWarmth;
        gres.lightAmbient   = settings_.lightAmbient;
        graph_.evaluate(gctx, gres);
        fxRippleAmount_ = gres.rippleAmount;
        fxRippleSpeed_  = gres.rippleSpeed;
        fxBrightness_   = gres.brightness;
        fxDepthAmount_  = gres.depthAmount;
        fxMatRoughness_   = gres.matRoughness;
        fxMatMetalness_   = gres.matMetalness;
        fxMatSheen_       = gres.matSheen;
        fxMatClearcoat_   = gres.matClearcoat;
        fxMatAnisotropy_  = gres.matAnisotropy;
        fxMatIridescence_ = gres.matIridescence;
        fxMatEmissive_    = gres.matEmissive;
        fxMatRelief_      = gres.matRelief;
        fxLightAngle_     = gres.lightAngle;
        fxLightElevation_ = gres.lightElevation;
        fxLightIntensity_ = gres.lightIntensity;
        fxLightWarmth_    = gres.lightWarmth;
        fxLightAmbient_   = gres.lightAmbient;
    }

    // Lazily bring ImGui up only when the editor is actually wanted.
    // Two Renderer instances commonly coexist in the same process (the
    // wallpaper service + an in-app Activity), and ImGui keeps a single
    // global "current context" pointer. If both Renderers init their
    // own context, every ImGui:: call from one of them races the other's
    // global write. Gating on graphUi_.visible() means at most one
    // Renderer ever holds an active ImGui context — the wallpaper
    // service and the Settings preview never call this path, so the
    // race window simply doesn't exist. ImGui stays alive once initted
    // so toggling the editor closed doesn't thrash device resources.
    bool imGuiDrewThisFrame = false;
    if (graphUi_.visible() || imGuiReady_) {
        initImGuiIfNeeded();
        if (imGuiReady_) {
            imGuiHost_.newFrame(
                static_cast<int>(swapchainExtent_.width),
                static_cast<int>(swapchainExtent_.height),
                dt);
            graphUi_.render(graph_);
            imGuiHost_.render();
            imGuiDrewThisFrame = true;
        }
    }

    // Per-frame UBO patch for the live block — anim, effects, audio bands,
    // beat envelope. Palette / border / bg slots stay where
    // updatePaletteUbo last wrote them and don't need rewriting every
    // vsync.
    if (paletteUboMapped_) {
        float anim[4] = {
            time_,
            fxRippleAmount_,
            static_cast<float>(familyInfo(settings_.family).waveSymmetry),
            pageOffset_,
        };
        float effects[4] = {
            fxBrightness_,
            fxDepthAmount_,
            fxRippleSpeed_,
            static_cast<float>(settings_.rippleKind),
        };
        // Reuse the same snapshot taken above the graph eval.
        float bandsBlock[8];
        std::memcpy(bandsBlock, audioBands, sizeof(bandsBlock));
        float beatBlock[4] = { audioBeat, 0.0f, 0.0f, 0.0f };

        auto* base = static_cast<uint8_t*>(paletteUboMapped_);
        std::memcpy(base + offsetof(PaletteUbo, anim),       anim,       sizeof(anim));
        std::memcpy(base + offsetof(PaletteUbo, effects),    effects,    sizeof(effects));
        std::memcpy(base + offsetof(PaletteUbo, audioBands), bandsBlock, sizeof(bandsBlock));
        std::memcpy(base + offsetof(PaletteUbo, audioBeat),  beatBlock,  sizeof(beatBlock));

        // Material rows — the eight graph-modulated controls over the
        // static MaterialParams defaults, rewritten every frame so audio /
        // clock / page-scroll modulation reaches the shader.
        MaterialParams fxMat{};
        fxMat.roughBase     = fxMatRoughness_;
        fxMat.metalMod      = fxMatMetalness_;
        fxMat.sheen         = fxMatSheen_;
        fxMat.clearcoat     = fxMatClearcoat_;
        fxMat.anisotropy    = fxMatAnisotropy_;
        fxMat.iridescence   = fxMatIridescence_;
        fxMat.emissive      = fxMatEmissive_;
        fxMat.bevelStrength = fxMatRelief_;
        applyLightControls(fxMat, fxLightAngle_, fxLightElevation_,
                           fxLightIntensity_, fxLightWarmth_, fxLightAmbient_);
        writeMaterialRows(
            reinterpret_cast<float*>(base + offsetof(PaletteUbo, matNormal)),
            fxMat);
    }

    FrameSync& f = frames_[currentFrame_];
    vkWaitForFences(device_, 1, &f.inFlight, VK_TRUE, UINT64_MAX);

    uint32_t imageIndex = 0;
    bool rebuildAfterPresent = false;
    const VkResult acq = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX,
                                               f.imageAvailable, VK_NULL_HANDLE,
                                               &imageIndex);
    if (acq == VK_ERROR_OUT_OF_DATE_KHR) {
        // No image acquired — the swapchain is unusable. Rebuild now
        // (nothing is pending on it) so the next frame draws clean.
        rebuildSwapchain();
        return;
    }
    if (acq == VK_SUBOPTIMAL_KHR) {
        // An image WAS acquired and is drawable; the swapchain just no
        // longer ideally fits the surface. Draw and present this frame
        // normally so the acquire semaphore is consumed, THEN rebuild —
        // tearing the swapchain down here would strand that pending
        // semaphore signal. The syncSwapchainToSurface check at the top
        // of the frame normally catches a rotation before this.
        rebuildAfterPresent = true;
    } else if (acq != VK_SUCCESS) {
        LOGE("vkAcquireNextImageKHR -> %d", (int)acq);
        return;
    }
    vkResetFences(device_, 1, &f.inFlight);
    vkResetCommandBuffer(f.cmd, 0);

    VkCommandBufferBeginInfo cbi{};
    cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(f.cmd, &cbi);

    // Swapchain image: UNDEFINED -> COLOR_ATTACHMENT_OPTIMAL. The load-op
    // clears, so previous contents don't matter.
    VkImageMemoryBarrier2 barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
    barrier.srcStageMask = VK_PIPELINE_STAGE_2_TOP_OF_PIPE_BIT;
    barrier.dstStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
    barrier.dstAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
    barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    barrier.newLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.image = swapchainImages_[imageIndex];
    barrier.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };

    VkDependencyInfo dep{};
    dep.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
    dep.imageMemoryBarrierCount = 1;
    dep.pImageMemoryBarriers = &barrier;
    vkCmdPipelineBarrier2(f.cmd, &dep);

    // Clear uses the same colorspace-aware OKLCH converter as the palette
    // so the load-op clear lands in the same color space as the shader output.
    PresetResult ps = buildPreset(settings_.preset, settings_.colorCount,
                                  settings_.customOklch);
    Oklch bgOk = (settings_.bgMode == BackgroundMode::Match) ? ps.colors[0] : settings_.bgColor;
    ShaderColor bg = oklchToShaderColor(bgOk, 1.0f, wideGamut_, cpuLinearOutput_);

    VkRenderingAttachmentInfo color{};
    color.sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO;
    color.imageView = swapchainViews_[imageIndex];
    color.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.clearValue.color.float32[0] = bg.r;
    color.clearValue.color.float32[1] = bg.g;
    color.clearValue.color.float32[2] = bg.b;
    color.clearValue.color.float32[3] = 1.0f;

    VkRenderingInfo ri{};
    ri.sType = VK_STRUCTURE_TYPE_RENDERING_INFO;
    ri.renderArea.offset = { 0, 0 };
    ri.renderArea.extent = swapchainExtent_;
    ri.layerCount = 1;
    ri.colorAttachmentCount = 1;
    ri.pColorAttachments = &color;
    vkCmdBeginRendering(f.cmd, &ri);

    VkViewport viewport{};
    viewport.x = 0; viewport.y = 0;
    viewport.width = (float)swapchainExtent_.width;
    viewport.height = (float)swapchainExtent_.height;
    viewport.minDepth = 0; viewport.maxDepth = 1;
    vkCmdSetViewport(f.cmd, 0, 1, &viewport);
    VkRect2D scissor{ { 0, 0 }, swapchainExtent_ };
    vkCmdSetScissor(f.cmd, 0, 1, &scissor);

    // Push-constant view matrix. Map model-space [-bbox..+bbox] into clip
    // space [-1, +1] preserving aspect and applying pan/zoom/rotation.
    // Aspect comes from the visible screen window; sX/sY shrink by the
    // surface-to-screen ratio so the visible region (the middle slice of
    // an oversized side-scroll surface) carries the full tiling.
    const float gw = std::max(geomMaxX_ - geomMinX_, 1e-3f);
    const float gh = std::max(geomMaxY_ - geomMinY_, 1e-3f);
    const float surfW = (float)swapchainExtent_.width;
    const float surfH = (float)swapchainExtent_.height;
    const float screenW = (screenW_ > 0) ? (float)screenW_ : surfW;
    const float screenH = (screenH_ > 0) ? (float)screenH_ : surfH;
    const float aspect = screenW / screenH;
    float baseScale = std::min(2.0f / gw, 2.0f / gh) * 0.95f;
    float sX = (aspect >= 1.0f ? baseScale / aspect : baseScale) * view_.zoom;
    float sY = (aspect >= 1.0f ? baseScale          : baseScale * aspect) * view_.zoom;
    sX *= (screenW / surfW);
    sY *= (screenH / surfH);
    const float cosR = std::cos(view_.rotation);
    const float sinR = std::sin(view_.rotation);
    const float tX = (view_.panX / surfW) * 2.0f;
    const float tY = (view_.panY / surfH) * 2.0f;

    // Affine model→clip. Model space is math-convention (y-up); Vulkan
    // clip is y-down. The tilings are symmetric so passing coords
    // through unflipped looks identical either way.
    PushBlock pc{};
    pc.view0x =  cosR * sX; pc.view0y = -sinR * sY; pc.view0z = tX;
    pc.view1x =  sinR * sX; pc.view1y =  cosR * sY; pc.view1z = tY;

    vkCmdBindDescriptorSets(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                            pipelineLayout_, 0, 1, &descSet_, 0, nullptr);

    // ---- Fills ----
    if (fillVertexCount_ > 0) {
        vkCmdBindPipeline(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, fillPipeline_);
        VkDeviceSize off = 0;
        vkCmdBindVertexBuffers(f.cmd, 0, 1, &fillVertBuf_, &off);
        vkCmdPushConstants(f.cmd, pipelineLayout_,
                           VK_SHADER_STAGE_VERTEX_BIT,
                           0, sizeof(pc), &pc);
        vkCmdDraw(f.cmd, fillVertexCount_, 1, 0, 0);
    }

    // ---- Borders ----
    if (settings_.borderOn && borderIndexCount_ > 0 && settings_.borderWidth > 0.0f) {
        vkCmdBindPipeline(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, borderPipeline_);
        VkDeviceSize off = 0;
        vkCmdBindVertexBuffers(f.cmd, 0, 1, &borderVertBuf_, &off);
        vkCmdBindIndexBuffer(f.cmd, borderIdxBuf_, 0, VK_INDEX_TYPE_UINT32);
        vkCmdPushConstants(f.cmd, pipelineLayout_,
                           VK_SHADER_STAGE_VERTEX_BIT,
                           0, sizeof(pc), &pc);
        vkCmdDrawIndexed(f.cmd, borderIndexCount_, 1, 0, 0, 0);
    }

    // ImGui overlays on top of the wallpaper, inside the same dynamic
    // rendering scope (matching colorAttachmentFormat + samples). Only
    // emit draw commands if we actually called NewFrame+Render this
    // frame — otherwise ImGui's draw data is stale or empty and
    // RenderDrawData asserts.
    if (imGuiDrewThisFrame) {
        imGuiHost_.recordDrawCommands(f.cmd);
    }

    vkCmdEndRendering(f.cmd);

    // Layout: COLOR_ATTACHMENT_OPTIMAL -> PRESENT_SRC_KHR for swapchain image.
    VkImageMemoryBarrier2 toPresent{};
    toPresent.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
    toPresent.srcStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
    toPresent.srcAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
    toPresent.dstStageMask = VK_PIPELINE_STAGE_2_BOTTOM_OF_PIPE_BIT;
    toPresent.dstAccessMask = 0;
    toPresent.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    toPresent.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    toPresent.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    toPresent.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    toPresent.image = swapchainImages_[imageIndex];
    toPresent.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    dep.imageMemoryBarrierCount = 1;
    dep.pImageMemoryBarriers = &toPresent;
    vkCmdPipelineBarrier2(f.cmd, &dep);

    vkEndCommandBuffer(f.cmd);

    VkSemaphoreSubmitInfo waitInfo{};
    waitInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
    waitInfo.semaphore = f.imageAvailable;
    waitInfo.stageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;

    VkSemaphoreSubmitInfo signalInfo{};
    signalInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
    signalInfo.semaphore = f.renderFinished;
    signalInfo.stageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;

    VkCommandBufferSubmitInfo cbInfo{};
    cbInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_SUBMIT_INFO;
    cbInfo.commandBuffer = f.cmd;

    VkSubmitInfo2 submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO_2;
    submit.waitSemaphoreInfoCount = 1;
    submit.pWaitSemaphoreInfos = &waitInfo;
    submit.signalSemaphoreInfoCount = 1;
    submit.pSignalSemaphoreInfos = &signalInfo;
    submit.commandBufferInfoCount = 1;
    submit.pCommandBufferInfos = &cbInfo;
    vkQueueSubmit2(queue_, 1, &submit, f.inFlight);

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &f.renderFinished;
    present.swapchainCount = 1;
    present.pSwapchains = &swapchain_;
    present.pImageIndices = &imageIndex;
    VkResult pr = vkQueuePresentKHR(queue_, &present);
    currentFrame_ = (currentFrame_ + 1) % kFramesInFlight;
    if (rebuildAfterPresent ||
        pr == VK_ERROR_OUT_OF_DATE_KHR || pr == VK_SUBOPTIMAL_KHR) {
        // Either the acquire reported the chain suboptimal (deferred to
        // here so the frame's semaphore was consumed first), or the
        // surface changed between acquire and present. Rebuild for the
        // next frame.
        rebuildSwapchain();
    } else if (pr != VK_SUCCESS) {
        LOGE("vkQueuePresentKHR -> %d", (int)pr);
    }
}

} // namespace penrose
