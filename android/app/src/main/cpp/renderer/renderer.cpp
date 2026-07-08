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
        destroyRetiredBuffersNow();
        destroyBufferNow(fillVertBuf_, fillVertMem_);
        destroyBufferNow(borderVertBuf_, borderVertMem_);
        destroyBufferNow(borderIdxBuf_, borderIdxMem_);
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
        destroySurfaceResources();
    }

    ANativeWindow_acquire(window);
    window_ = window;
    const auto fail = [this]() {
        destroySurfaceResources();
        return false;
    };
    const auto failDeviceInit = [this]() {
        destroySurfaceResources();
        destroyDeviceResources();
        return false;
    };
    if (!createSurface(window)) return fail();

    if (!deviceReady_) {
        if (!initDeviceForSurface()) return failDeviceInit();
        if (!createDescriptorObjects()) return failDeviceInit();
        if (!initPipeline()) return failDeviceInit();
        deviceReady_ = true;
    }

    const int w = ANativeWindow_getWidth(window);
    const int h = ANativeWindow_getHeight(window);
    if (w <= 0 || h <= 0) {
        swapchainReady_ = false;
        return true;
    }
    if (!createSurfaceFrameResources(w, h)) return fail();
    return true;
}

bool Renderer::onSurfaceChanged(int width, int height) {
    if (!deviceReady_ || width <= 0 || height <= 0) return false;
    if (!swapchainReady_) return createSurfaceFrameResources(width, height);
    if ((uint32_t)width == swapchainExtent_.width &&
        (uint32_t)height == swapchainExtent_.height) return true;
    return rebuildSwapchain();
}

bool Renderer::createSurfaceFrameResources(int width, int height) {
    if (!deviceReady_ || surface_ == VK_NULL_HANDLE || width <= 0 || height <= 0) return false;
    const auto fail = [this]() {
        destroyPerFrameResources();
        destroySwapchain();
        swapchainReady_ = false;
        return false;
    };
    if (!createSwapchain(width, height)) return fail();
    if (!buildPipelines()) return fail();
    if (fillVertexCount_ == 0 || settingsDirty_) {
        if (!buildGeometry()) return fail();
        settingsDirty_ = false;
    }
    updatePaletteUbo();
    if (!createPerFrameResources()) return fail();
    swapchainReady_ = true;
    return true;
}

bool Renderer::rebuildSwapchain() {
    if (!deviceReady_ || surface_ == VK_NULL_HANDLE) return false;
    // createSwapchain re-queries VkSurfaceCapabilitiesKHR::currentExtent
    // for the true (post-rotation) surface size; the width/height args
    // are only the default for the UINT32_MAX case, which Android does
    // not use, so the last known extent remains valid.
    const int w = (swapchainExtent_.width  > 0) ? (int)swapchainExtent_.width  : 1;
    const int h = (swapchainExtent_.height > 0) ? (int)swapchainExtent_.height : 1;
    vkDeviceWaitIdle(device_);
    destroyRetiredBuffersNow();
    swapchainReady_ = false;
    destroyPerFrameResources();
    destroySwapchain();
    if (!createSurfaceFrameResources(w, h)) return false;
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
    const VkResult capsResult =
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice_, surface_, &caps);
    if (capsResult == VK_ERROR_SURFACE_LOST_KHR) {
        LOGE("vkGetPhysicalDeviceSurfaceCapabilitiesKHR surface lost");
        destroySurfaceResources();
        return;
    }
    if (capsResult == VK_ERROR_DEVICE_LOST) {
        handleDeviceLost("vkGetPhysicalDeviceSurfaceCapabilitiesKHR");
        return;
    }
    if (capsResult != VK_SUCCESS) {
        handleFatalPresentFailure("vkGetPhysicalDeviceSurfaceCapabilitiesKHR", capsResult);
        return;
    }
    const VkExtent2D ce = caps.currentExtent;
    // 0 — the surface is not presentable right now (window minimised /
    // mid-teardown); UINT32_MAX — the surface leaves sizing to the
    // swapchain. Either way there is no surface size to match against.
    if (ce.width == 0 || ce.height == 0 || ce.width == UINT32_MAX) return;
    if (!swapchainReady_) {
        createSurfaceFrameResources(static_cast<int>(ce.width), static_cast<int>(ce.height));
    } else if (ce.width != swapchainExtent_.width || ce.height != swapchainExtent_.height) {
        rebuildSwapchain();
    }
}

void Renderer::onSurfaceDestroyed() {
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    if (device_ != VK_NULL_HANDLE) destroyRetiredBuffersNow();
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

void Renderer::destroySurfaceResources() {
    if (device_ != VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device_);
        destroyRetiredBuffersNow();
        if (imGuiReady_) {
            imGuiHost_.shutdown();
            imGuiReady_ = false;
        }
        destroyPerFrameResources();
        destroySwapchain();
    }
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

void Renderer::destroyDeviceResources() {
    if (device_ == VK_NULL_HANDLE) {
        physicalDevice_ = VK_NULL_HANDLE;
        graphicsQueueFamily_ = UINT32_MAX;
        queue_ = VK_NULL_HANDLE;
        deviceReady_ = false;
        return;
    }
    if (imGuiReady_) {
        graphUi_.shutdown();
        imGuiHost_.shutdown();
        imGuiReady_ = false;
    }
    destroyRetiredBuffersNow();
    destroyBufferNow(fillVertBuf_, fillVertMem_);
    destroyBufferNow(borderVertBuf_, borderVertMem_);
    destroyBufferNow(borderIdxBuf_, borderIdxMem_);
    destroyDescriptorObjects();
    destroyPipelines();
    if (commandPool_) {
        vkDestroyCommandPool(device_, commandPool_, nullptr);
        commandPool_ = VK_NULL_HANDLE;
    }
    vkDestroyDevice(device_, nullptr);
    device_ = VK_NULL_HANDLE;
    physicalDevice_ = VK_NULL_HANDLE;
    graphicsQueueFamily_ = UINT32_MAX;
    queue_ = VK_NULL_HANDLE;
    deviceReady_ = false;
}

void Renderer::handleDeviceLost(const char* operation) {
    LOGE("%s -> VK_ERROR_DEVICE_LOST", operation);
    destroySurfaceResources();
    destroyDeviceResources();
}

void Renderer::handleFatalPresentFailure(const char* operation, VkResult result) {
    LOGE("%s -> %d", operation, static_cast<int>(result));
    destroySurfaceResources();
    destroyDeviceResources();
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
    const bool needFillGeometry = tileGeometryChanged(settings_, s)
        || classificationChanged(settings_, s)
        || s.panMode != settings_.panMode;
    const bool needBorderGeometry = borderGeometryChanged(settings_, s);
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
    }
    if (deviceReady_ && swapchainReady_) {
        if (needFillGeometry) {
            vkDeviceWaitIdle(device_);
            destroyRetiredBuffersNow();
        }
        bool rebuilt = true;
        if (needFillGeometry) {
            rebuilt = buildGeometry();
        } else if (needBorderGeometry) {
            rebuilt = buildBorderGeometry();
        }
        if (!rebuilt) {
            settingsDirty_ = true;
            return;
        }
        updatePaletteUbo();
    } else {
        settingsDirty_ = true;
    }
}

// =============================================================================
// Gestures + live view
// =============================================================================

void Renderer::touchPinch(float scale, float rotDelta) {
    constexpr float kTwoPi = 6.28318530717958647692f;
    view_.zoom = std::clamp(view_.zoom * scale, 0.25f, 8.0f);
    view_.rotation = std::remainder(view_.rotation + rotDelta, kTwoPi);
}

void Renderer::touchMove(float dx, float dy) {
    if (settings_.panMode == 1) {
        if (dx == 0.0f && dy == 0.0f) return;
        view_.panX += dx;
        view_.panY += dy;
        requestGeometryWindowRebuildForPan();
    }
    // Locked mode (panMode == 0): touchMove is intentionally a no-op.
}

void Renderer::resetView() {
    const bool resetGeneration = effectiveGeneration_ != settings_.generation;
    view_ = LiveView{};
    effectiveGeneration_ = settings_.generation;
    geometryPagePanValid_ = false;
    if (deviceReady_ && swapchainReady_) {
        if (resetGeneration) {
            vkDeviceWaitIdle(device_);
            if (!buildGeometry()) return;
            updatePaletteUbo();
        } else {
            rebuildGeometryForPan();
        }
    }
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

void Renderer::setPageOffset(float xOffset, int xPixelOffset) {
    pageOffset_ = std::clamp(xOffset, 0.0f, 1.0f);
    const float nextPagePanX = static_cast<float>(xPixelOffset);
    if (pagePanX_ == nextPagePanX) return;
    pagePanX_ = nextPagePanX;
    if (settings_.panMode == 2) {
        const float visibleWidth = screenW_ > 0
            ? static_cast<float>(screenW_)
            : (swapchainExtent_.width > 0 ? static_cast<float>(swapchainExtent_.width) : 1080.0f);
        const float rebuildThreshold = std::max(96.0f, visibleWidth * 0.35f);
        if (!geometryPagePanValid_ || std::abs(pagePanX_ - geometryPagePanX_) >= rebuildThreshold) {
            requestGeometryWindowRebuildForPan();
        }
    }
}

void Renderer::setUiDensity(float density) {
    // Honour anything plausible; pathological zero/negative values keep
    // the default 2.5 so ImGui style metrics never collapse.
    if (density > 0.5f && density < 10.0f) uiDensity_ = density;
}

void Renderer::setSystemInsets(int topPx, int bottomPx, int leftPx, int rightPx) {
    graphUi_.setSystemInsets(topPx, bottomPx, leftPx, rightPx);
}

void Renderer::requestGeometryWindowRebuildForPan() {
    const float visibleWidth = screenW_ > 0
        ? static_cast<float>(screenW_)
        : (swapchainExtent_.width > 0 ? static_cast<float>(swapchainExtent_.width) : 1080.0f);
    const float visibleHeight = screenH_ > 0
        ? static_cast<float>(screenH_)
        : (swapchainExtent_.height > 0 ? static_cast<float>(swapchainExtent_.height) : 1920.0f);
    const float thresholdX = std::max(96.0f, visibleWidth * 0.35f);
    const float thresholdY = std::max(96.0f, visibleHeight * 0.35f);
    const bool staleWindow =
        !geometryPagePanValid_
        || std::abs(pagePanX_ - geometryPagePanX_) >= thresholdX
        || std::abs(view_.panX - geometryViewPanX_) >= thresholdX
        || std::abs(view_.panY - geometryViewPanY_) >= thresholdY;
    if (staleWindow) rebuildGeometryForPan();
}

void Renderer::rebuildGeometryForPan() {
    if (!deviceReady_ || !swapchainReady_) return;
    vkDeviceWaitIdle(device_);
    destroyRetiredBuffersNow();
    if (!buildGeometry()) {
        settingsDirty_ = true;
        return;
    }
    updatePaletteUbo();
}

// =============================================================================
// Frame
// =============================================================================

void Renderer::drawFrame() {
    if (!deviceReady_) return;

    // A device rotation resizes the surface. If the swapchain no longer
    // matches, rebuild it before drawing so this frame already targets
    // the correct extent — otherwise the compositor stretches the
    // stale-orientation swapchain onto the rotated window and the
    // wallpaper stays distorted until it is re-applied.
    syncSwapchainToSurface();
    if (!swapchainReady_) return;

    if (settingsDirty_) {
        vkDeviceWaitIdle(device_);
        destroyRetiredBuffersNow();
        if (!buildGeometry()) return;
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

    // Snapshot audio features ONCE per frame under analyzeMutex_. Reuse
    // the same values for the modulation graph's EvalContext and the UBO
    // audio block below — taking the lock twice in a frame is just
    // contention waiting to happen when a second renderer in the same
    // process is also doing snapshots.
    AudioAnalyzer::FeatureSnapshot audio{};
    globalAudioAnalyzer().snapshot(audio);

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
        for (int i = 0; i < 8; ++i) gctx.bands[i] = audio.bands[i];
        gctx.bass = audio.bass;
        gctx.mid = audio.mid;
        gctx.high = audio.high;
        gctx.beat       = audio.beat;
        gctx.rms        = audio.rms;
        gctx.spectralFlux = audio.spectralFlux;
        gctx.onsetStrength = audio.onsetStrength;
        gctx.cwtTransient = audio.cwtTransient;
        gctx.crestFactor = audio.crestFactor;
        gctx.beatConfidence = audio.beatConfidence;
        gctx.bpm = audio.bpm;
        gctx.dtSeconds   = dt;
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
        gres.matRoughMod    = settings_.matRoughMod;
        gres.matMetalMod    = settings_.matMetalMod;
        gres.lightAngle     = settings_.lightAngle;
        gres.lightElevation = settings_.lightElevation;
        gres.lightIntensity = settings_.lightIntensity;
        gres.lightWarmth    = settings_.lightWarmth;
        gres.lightAmbient   = settings_.lightAmbient;
        gres.lightChoreoAmount = settings_.lightChoreoAmount;
        gres.lightChoreoSpeed  = settings_.lightChoreoSpeed;
        gres.lightChoreoSource = settings_.lightChoreoSource;
        gres.ornamentAmount = settings_.ornamentAmount;
        gres.ornamentWidth  = settings_.ornamentWidth;
        gres.ornamentPhase  = settings_.ornamentPhase;
        gres.ornamentStyle  = settings_.ornamentStyle;
        gres.ornamentDensity = settings_.ornamentDensity;
        gres.ornamentTwist  = settings_.ornamentTwist;
        gres.surfaceContourAmount  = settings_.surfaceContourAmount;
        gres.surfaceContourSpacing = settings_.surfaceContourSpacing;
        gres.surfaceContourWidth   = settings_.surfaceContourWidth;
        gres.surfaceContourPhase   = settings_.surfaceContourPhase;
        gres.surfaceContourSource  = settings_.surfaceContourSource;
        gres.surfaceContourLight   = settings_.surfaceContourColor.l;
        gres.surfaceContourChroma  = settings_.surfaceContourColor.c;
        gres.surfaceContourHue     = settings_.surfaceContourColor.h;
        gres.edgeProfileWidth = settings_.edgeProfileWidth;
        gres.edgeProfileGlow = settings_.edgeProfileGlow;
        gres.edgeProfileLight = settings_.edgeProfileColor.l;
        gres.edgeProfileChroma = settings_.edgeProfileColor.c;
        gres.edgeProfileHue = settings_.edgeProfileColor.h;
        gres.hypBoostX      = settings_.hypBoostX;
        gres.hypBoostY      = settings_.hypBoostY;
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
        fxMatRoughMod_    = gres.matRoughMod;
        fxMatMetalMod_    = gres.matMetalMod;
        fxLightAngle_     = gres.lightAngle;
        fxLightElevation_ = gres.lightElevation;
        fxLightIntensity_ = gres.lightIntensity;
        fxLightWarmth_    = gres.lightWarmth;
        fxLightAmbient_   = gres.lightAmbient;
        fxLightChoreoAmount_ = gres.lightChoreoAmount;
        fxLightChoreoSpeed_  = gres.lightChoreoSpeed;
        fxLightChoreoSource_ = gres.lightChoreoSource;
        fxOrnamentAmount_ = gres.ornamentAmount;
        fxOrnamentWidth_  = gres.ornamentWidth;
        fxOrnamentPhase_  = gres.ornamentPhase;
        fxOrnamentStyle_  = gres.ornamentStyle;
        fxOrnamentDensity_ = gres.ornamentDensity;
        fxOrnamentTwist_  = gres.ornamentTwist;
        fxSurfaceContourAmount_  = gres.surfaceContourAmount;
        fxSurfaceContourSpacing_ = gres.surfaceContourSpacing;
        fxSurfaceContourWidth_   = gres.surfaceContourWidth;
        fxSurfaceContourPhase_   = gres.surfaceContourPhase;
        fxSurfaceContourSource_  = gres.surfaceContourSource;
        fxSurfaceContourLight_   = gres.surfaceContourLight;
        fxSurfaceContourChroma_  = gres.surfaceContourChroma;
        fxSurfaceContourHue_     = gres.surfaceContourHue;
        fxEdgeProfileWidth_ = gres.edgeProfileWidth;
        fxEdgeProfileGlow_ = gres.edgeProfileGlow;
        fxEdgeProfileLight_ = gres.edgeProfileLight;
        fxEdgeProfileChroma_ = gres.edgeProfileChroma;
        fxEdgeProfileHue_ = gres.edgeProfileHue;
        fxHypBoostX_      = gres.hypBoostX;
        fxHypBoostY_      = gres.hypBoostY;
        fxHypScale_       = settings_.hypScale;
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

    FrameSync& f = frames_[currentFrame_];
    vkWaitForFences(device_, 1, &f.inFlight, VK_TRUE, UINT64_MAX);
    collectRetiredBuffers();

    // Per-frame UBO patch for the live block — anim, edge-profile geometry,
    // effects, audio bands, and beat/transient features. Palette / border
    // colour / bg slots stay where updatePaletteUbo last wrote them.
    if (paletteUboMapped_[currentFrame_]) {
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
        float borderGeomBlock[4] = {
            fxEdgeProfileWidth_,
            fxEdgeProfileGlow_,
            0.0f,
            0.0f,
        };
        // Reuse the same snapshot taken above the graph eval.
        float bandsBlock[8];
        std::memcpy(bandsBlock, audio.bands, sizeof(bandsBlock));
        float beatBlock[4] = { audio.beat, audio.onsetStrength, audio.cwtTransient, audio.beatConfidence };
        float ornamentBlock[4] = {
            fxOrnamentStyle_,
            fxOrnamentAmount_,
            fxOrnamentWidth_,
            fxOrnamentPhase_,
        };
        float ornamentExtraBlock[4] = {
            fxOrnamentDensity_,
            fxOrnamentTwist_,
            0.0f,
            static_cast<float>(static_cast<int>(settings_.family)),
        };
        float contourBlock[4] = {
            fxSurfaceContourAmount_,
            fxSurfaceContourSource_,
            fxSurfaceContourSpacing_,
            fxSurfaceContourWidth_,
        };
        const Oklch contourOklch{
            fxSurfaceContourLight_,
            fxSurfaceContourChroma_,
            fxSurfaceContourHue_,
        };
        const ShaderColor contourColor = oklchToShaderColor(
            contourOklch, 1.0f, wideGamut_, cpuLinearOutput_);
        float contourColorBlock[4] = {
            fxSurfaceContourPhase_,
            contourColor.r,
            contourColor.g,
            contourColor.b,
        };
        const float markAlpha = sourceOverlayAlpha(fxOrnamentStyle_, fxOrnamentAmount_, fxOrnamentDensity_);
        const ShaderColor sourceMarkA = oklchToShaderColor(
            settings_.sourceMarkA, markAlpha, wideGamut_, cpuLinearOutput_);
        const ShaderColor sourceMarkB = oklchToShaderColor(
            settings_.sourceMarkB, markAlpha, wideGamut_, cpuLinearOutput_);
        const ShaderColor sourceMarkC = oklchToShaderColor(
            settings_.sourceMarkC, markAlpha, wideGamut_, cpuLinearOutput_);
        const Oklch edgeProfileOklch{
            fxEdgeProfileLight_,
            fxEdgeProfileChroma_,
            fxEdgeProfileHue_,
        };
        const ShaderColor edgeProfileColor = oklchToShaderColor(
            edgeProfileOklch, 1.0f, wideGamut_, cpuLinearOutput_);
        float sourceMarkABlock[4] = {
            sourceMarkA.r,
            sourceMarkA.g,
            sourceMarkA.b,
            sourceMarkA.a,
        };
        float sourceMarkBBlock[4] = {
            sourceMarkB.r,
            sourceMarkB.g,
            sourceMarkB.b,
            sourceMarkB.a,
        };
        float sourceMarkCBlock[4] = {
            sourceMarkC.r,
            sourceMarkC.g,
            sourceMarkC.b,
            sourceMarkC.a,
        };
        float edgeProfileColorBlock[4] = {
            edgeProfileColor.r,
            edgeProfileColor.g,
            edgeProfileColor.b,
            0.0f,
        };

        auto* base = static_cast<uint8_t*>(paletteUboMapped_[currentFrame_]);
        std::memcpy(base + offsetof(PaletteUbo, anim),       anim,       sizeof(anim));
        std::memcpy(base + offsetof(PaletteUbo, borderGeom), borderGeomBlock, sizeof(borderGeomBlock));
        std::memcpy(base + offsetof(PaletteUbo, effects),    effects,    sizeof(effects));
        std::memcpy(base + offsetof(PaletteUbo, audioBands), bandsBlock, sizeof(bandsBlock));
        std::memcpy(base + offsetof(PaletteUbo, audioBeat),  beatBlock,  sizeof(beatBlock));
        std::memcpy(base + offsetof(PaletteUbo, ornament),   ornamentBlock, sizeof(ornamentBlock));
        std::memcpy(base + offsetof(PaletteUbo, ornamentExtra), ornamentExtraBlock, sizeof(ornamentExtraBlock));
        std::memcpy(base + offsetof(PaletteUbo, contour), contourBlock, sizeof(contourBlock));
        std::memcpy(base + offsetof(PaletteUbo, contourColor), contourColorBlock, sizeof(contourColorBlock));
        std::memcpy(base + offsetof(PaletteUbo, sourceMarkA), sourceMarkABlock, sizeof(sourceMarkABlock));
        std::memcpy(base + offsetof(PaletteUbo, sourceMarkB), sourceMarkBBlock, sizeof(sourceMarkBBlock));
        std::memcpy(base + offsetof(PaletteUbo, sourceMarkC), sourceMarkCBlock, sizeof(sourceMarkCBlock));
        std::memcpy(base + offsetof(PaletteUbo, edgeProfileColor), edgeProfileColorBlock, sizeof(edgeProfileColorBlock));

        // Material rows — the eight graph-modulated controls over the
        // static MaterialParams defaults, rewritten every frame so audio /
        // clock / page-scroll modulation reaches the shader.
        MaterialParams fxMat{};
        fxMat.roughBase     = fxMatRoughness_;
        // Metalness slider drives the BASE term (uniform metalness)
        // rather than the per-tile-type MOD it used to — a slider
        // labelled "Metalness" should make the wallpaper metallic, not
        // just create variation between tile kinds. The variation lives
        // on its own settings_.matMetalMod knob now (default 0).
        fxMat.metalBase     = fxMatMetalness_;
        fxMat.sheen         = fxMatSheen_;
        fxMat.clearcoat     = fxMatClearcoat_;
        fxMat.anisotropy    = fxMatAnisotropy_;
        fxMat.iridescence   = fxMatIridescence_;
        fxMat.emissive      = fxMatEmissive_;
        fxMat.bevelStrength = fxMatRelief_;
        // Direct-from-settings: per-preset characteristic colours
        // (sheen tint + iridescent film range). Seam and per-tile
        // variation now come from graph-modulated outputs below.
        fxMat.sheenColor[0] = settings_.matSheenColorR;
        fxMat.sheenColor[1] = settings_.matSheenColorG;
        fxMat.sheenColor[2] = settings_.matSheenColorB;
        fxMat.iridThickMin  = settings_.matIridThickMin;
        fxMat.iridThickMax  = settings_.matIridThickMax;
        fxMat.roughMod      = fxMatRoughMod_;
        fxMat.metalMod      = fxMatMetalMod_;
        applyLightChoreography(fxMat, fxLightAngle_, fxLightElevation_,
                               fxLightIntensity_, fxLightWarmth_, fxLightAmbient_,
                               fxLightChoreoAmount_, fxLightChoreoSpeed_,
                               fxLightChoreoSource_, time_, pageOffset_, audio.beat,
                               audio.beatPhase, audio.cwtTransient,
                               settings_.clockWaveform);
        writeMaterialRows(
            reinterpret_cast<float*>(base + offsetof(PaletteUbo, matNormal)),
            fxMat);
    }

    VkResult result = vkResetCommandBuffer(f.cmd, 0);
    if (result != VK_SUCCESS) {
        LOGE("vkResetCommandBuffer -> %d", static_cast<int>(result));
        return;
    }

    VkCommandBufferBeginInfo cbi{};
    cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    result = vkBeginCommandBuffer(f.cmd, &cbi);
    if (result != VK_SUCCESS) {
        LOGE("vkBeginCommandBuffer -> %d", static_cast<int>(result));
        return;
    }

    uint32_t imageIndex = 0;
    bool rebuildAfterPresent = false;
    const VkResult acq = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX,
                                               f.imageAvailable, VK_NULL_HANDLE,
                                               &imageIndex);
    if (acq == VK_ERROR_DEVICE_LOST) {
        handleDeviceLost("vkAcquireNextImageKHR");
        return;
    }
    if (acq == VK_ERROR_SURFACE_LOST_KHR) {
        LOGE("vkAcquireNextImageKHR surface lost");
        vkResetCommandBuffer(f.cmd, 0);
        destroySurfaceResources();
        return;
    }
    if (acq == VK_ERROR_OUT_OF_DATE_KHR) {
        vkResetCommandBuffer(f.cmd, 0);
        rebuildSwapchain();
        return;
    }
    if (acq == VK_SUBOPTIMAL_KHR) {
        // An image WAS acquired and is drawable; the swapchain just no
        // longer ideally fits the surface. Draw and present this frame
        // normally so the acquire semaphore is consumed, THEN rebuild.
        rebuildAfterPresent = true;
    } else if (acq != VK_SUCCESS) {
        LOGE("vkAcquireNextImageKHR -> %d", static_cast<int>(acq));
        vkResetCommandBuffer(f.cmd, 0);
        return;
    }

    const auto releaseAcquiredImage = [&]() {
        VkCommandBuffer releaseCmd = VK_NULL_HANDLE;
        const auto failRelease = [&](const char* operation, VkResult rr) {
            LOGE("%s -> %d", operation, static_cast<int>(rr));
            if (releaseCmd != VK_NULL_HANDLE) {
                vkFreeCommandBuffers(device_, commandPool_, 1, &releaseCmd);
            }
            if (rr == VK_ERROR_DEVICE_LOST) {
                handleDeviceLost(operation);
            } else {
                handleFatalPresentFailure(operation, rr);
            }
        };

        VkCommandBufferAllocateInfo cbai{};
        cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        cbai.commandPool = commandPool_;
        cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        cbai.commandBufferCount = 1;
        VkResult rr = vkAllocateCommandBuffers(device_, &cbai, &releaseCmd);
        if (rr != VK_SUCCESS) {
            failRelease("vkAllocateCommandBuffers(release acquired image)", rr);
            return;
        }
        const auto freeReleaseCmd = [&]() {
            vkFreeCommandBuffers(device_, commandPool_, 1, &releaseCmd);
        };

        VkCommandBufferBeginInfo releaseBegin{};
        releaseBegin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        releaseBegin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        rr = vkBeginCommandBuffer(releaseCmd, &releaseBegin);
        if (rr != VK_SUCCESS) {
            failRelease("vkBeginCommandBuffer(release acquired image)", rr);
            return;
        }

        VkImageMemoryBarrier2 releaseBarrier{};
        releaseBarrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
        releaseBarrier.srcStageMask = VK_PIPELINE_STAGE_2_TOP_OF_PIPE_BIT;
        releaseBarrier.dstStageMask = VK_PIPELINE_STAGE_2_BOTTOM_OF_PIPE_BIT;
        releaseBarrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        releaseBarrier.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        releaseBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        releaseBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        releaseBarrier.image = swapchainImages_[imageIndex];
        releaseBarrier.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };

        VkDependencyInfo releaseDep{};
        releaseDep.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
        releaseDep.imageMemoryBarrierCount = 1;
        releaseDep.pImageMemoryBarriers = &releaseBarrier;
        vkCmdPipelineBarrier2(releaseCmd, &releaseDep);

        rr = vkEndCommandBuffer(releaseCmd);
        if (rr != VK_SUCCESS) {
            failRelease("vkEndCommandBuffer(release acquired image)", rr);
            return;
        }

        VkSemaphoreSubmitInfo waitInfo{};
        waitInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
        waitInfo.semaphore = f.imageAvailable;
        waitInfo.stageMask = VK_PIPELINE_STAGE_2_ALL_COMMANDS_BIT;

        VkSemaphoreSubmitInfo signalInfo{};
        signalInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
        signalInfo.semaphore = f.renderFinished;
        signalInfo.stageMask = VK_PIPELINE_STAGE_2_BOTTOM_OF_PIPE_BIT;

        VkCommandBufferSubmitInfo cbInfo{};
        cbInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_SUBMIT_INFO;
        cbInfo.commandBuffer = releaseCmd;

        VkSubmitInfo2 submit{};
        submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO_2;
        submit.waitSemaphoreInfoCount = 1;
        submit.pWaitSemaphoreInfos = &waitInfo;
        submit.signalSemaphoreInfoCount = 1;
        submit.pSignalSemaphoreInfos = &signalInfo;
        submit.commandBufferInfoCount = 1;
        submit.pCommandBufferInfos = &cbInfo;

        rr = vkResetFences(device_, 1, &f.inFlight);
        if (rr != VK_SUCCESS) {
            failRelease("vkResetFences(release acquired image)", rr);
            return;
        }
        rr = vkQueueSubmit2(queue_, 1, &submit, f.inFlight);
        if (rr != VK_SUCCESS) {
            failRelease("vkQueueSubmit2(release acquired image)", rr);
            return;
        }

        VkPresentInfoKHR present{};
        present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
        present.waitSemaphoreCount = 1;
        present.pWaitSemaphores = &f.renderFinished;
        present.swapchainCount = 1;
        present.pSwapchains = &swapchain_;
        present.pImageIndices = &imageIndex;
        const VkResult pr = vkQueuePresentKHR(queue_, &present);
        vkWaitForFences(device_, 1, &f.inFlight, VK_TRUE, UINT64_MAX);
        freeReleaseCmd();
        currentFrame_ = (currentFrame_ + 1) % kFramesInFlight;
        if (pr == VK_ERROR_SURFACE_LOST_KHR) {
            LOGE("vkQueuePresentKHR(release acquired image) surface lost");
            destroySurfaceResources();
        } else if (pr == VK_ERROR_DEVICE_LOST) {
            handleDeviceLost("vkQueuePresentKHR(release acquired image)");
        } else if (rebuildAfterPresent ||
            pr == VK_ERROR_OUT_OF_DATE_KHR || pr == VK_SUBOPTIMAL_KHR) {
            rebuildSwapchain();
        } else if (pr != VK_SUCCESS) {
            handleFatalPresentFailure("vkQueuePresentKHR(release acquired image)", pr);
        }
    };

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
                                  settings_.customOklch, settings_.colorSpectral);
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
    //
    // Hyperbolic push-constant values are computed once here and shared
    // between the view-fit step and the PushBlock below. Boost b is
    // clamped to |b| ≤ 0.92 to keep the τ_b denominator bounded; scale
    // ≥ 1e-3 so a runaway graph can't collapse the world via tanh(0).
    const float hypScaleEff = std::max(fxHypScale_, 1e-3f);
    float hypBoostXEff = fxHypBoostX_;
    float hypBoostYEff = fxHypBoostY_;
    float bMag = std::sqrt(hypBoostXEff * hypBoostXEff +
                           hypBoostYEff * hypBoostYEff);
    {
        constexpr float bmClamp = 0.92f;
        if (bMag > bmClamp) {
            const float bsc = bmClamp / bMag;
            hypBoostXEff *= bsc;
            hypBoostYEff *= bsc;
            bMag = bmClamp;
        }
    }

    const float surfW = (float)swapchainExtent_.width;
    const float surfH = (float)swapchainExtent_.height;
    const float screenW = (screenW_ > 0) ? (float)screenW_ : surfW;
    const float screenH = (screenH_ > 0) ? (float)screenH_ : surfH;
    const float aspect = screenW / screenH;
    float baseScale;
    if (settings_.projection == Projection::PoincareDisk) {
        // Auto-fit the projected and boosted tiling to the screen so
        // the slider controls compression, not visibility. The shader
        // projects the world point at distance r_max to disk radius
        // tanh(r_max · hypScale / 2); applying τ_b can push that
        // further out — max |τ_b(z)| over |z| ≤ projR is the Möbius
        // sum (projR + |b|) / (1 + projR·|b|), attained when z is
        // parallel to b. baseScale = 1/postR maps that to clip ±1, so
        // the projected tiling stays on-screen at any boost. r_max is
        // the true farthest |vertex| over the actual emitted geometry
        // (geomRmax_, set in buildGeometry), not the bbox corner.
        const float projR = std::tanh(geomRmax_ * hypScaleEff * 0.5f);
        const float postR = (projR + bMag) / (1.0f + projR * bMag);
        baseScale = 1.0f / std::max(postR, 1e-3f);
    } else {
        const float gw = std::max(geomMaxX_ - geomMinX_, 1e-3f);
        const float gh = std::max(geomMaxY_ - geomMinY_, 1e-3f);
        baseScale = std::min(2.0f / gw, 2.0f / gh) * 0.95f;
    }
    float sX = (aspect >= 1.0f ? baseScale / aspect : baseScale) * view_.zoom;
    float sY = (aspect >= 1.0f ? baseScale          : baseScale * aspect) * view_.zoom;
    sX *= (screenW / surfW);
    sY *= (screenH / surfH);
    const float cosR = std::cos(view_.rotation);
    const float sinR = std::sin(view_.rotation);
    const float pagePanX = (settings_.panMode == 2) ? pagePanX_ : 0.0f;
    const float tX = ((view_.panX + pagePanX) / surfW) * 2.0f;
    const float tY = (view_.panY / surfH) * 2.0f;

    // Affine model→clip. Model space is math-convention (y-up); Vulkan
    // clip is y-down. The tilings are symmetric so passing coords
    // through unflipped looks identical either way.
    //
    // Hyperbolic mode: the shader pre-projects each world point through
    // E² → B² (radial hyperbolic-radius map) and τ_b (the B² boost)
    // before this affine view matrix takes the result to clip space.
    PushBlock pc{};
    pc.view0x =  cosR * sX; pc.view0y = -sinR * sY; pc.view0z = tX;
    pc.view1x =  sinR * sX; pc.view1y =  cosR * sY; pc.view1z = tY;
    pc.hypBoostX  = hypBoostXEff;
    pc.hypBoostY  = hypBoostYEff;
    pc.hypScale   = hypScaleEff;
    pc.projection = (settings_.projection == Projection::PoincareDisk) ? 1.0f : 0.0f;

    VkDescriptorSet frameDescSet = descSets_[currentFrame_];
    vkCmdBindDescriptorSets(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                            pipelineLayout_, 0, 1, &frameDescSet, 0, nullptr);

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
    const bool sourceOverlayOn = sourceOverlayAlpha(fxOrnamentStyle_, fxOrnamentAmount_, fxOrnamentDensity_) > 0.0f
        && fxOrnamentWidth_ > 0.0f
        && (settings_.family == Family::P3
            || settings_.family == Family::P2
            || settings_.family == Family::AmmannBeenker);
    if (((settings_.borderOn && settings_.borderWidth > 0.0f) || sourceOverlayOn) && borderIndexCount_ > 0) {
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

    result = vkEndCommandBuffer(f.cmd);
    if (result != VK_SUCCESS) {
        LOGE("vkEndCommandBuffer -> %d", static_cast<int>(result));
        releaseAcquiredImage();
        return;
    }

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
    result = vkResetFences(device_, 1, &f.inFlight);
    if (result != VK_SUCCESS) {
        LOGE("vkResetFences -> %d", static_cast<int>(result));
        releaseAcquiredImage();
        return;
    }
    result = vkQueueSubmit2(queue_, 1, &submit, f.inFlight);
    if (result != VK_SUCCESS) {
        LOGE("vkQueueSubmit2 -> %d", static_cast<int>(result));
        releaseAcquiredImage();
        return;
    }

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &f.renderFinished;
    present.swapchainCount = 1;
    present.pSwapchains = &swapchain_;
    present.pImageIndices = &imageIndex;
    VkResult pr = vkQueuePresentKHR(queue_, &present);
    currentFrame_ = (currentFrame_ + 1) % kFramesInFlight;
    if (pr == VK_ERROR_SURFACE_LOST_KHR) {
        LOGE("vkQueuePresentKHR surface lost");
        destroySurfaceResources();
    } else if (pr == VK_ERROR_DEVICE_LOST) {
        handleDeviceLost("vkQueuePresentKHR");
    } else if (rebuildAfterPresent ||
        pr == VK_ERROR_OUT_OF_DATE_KHR || pr == VK_SUBOPTIMAL_KHR) {
        // Either the acquire reported the chain suboptimal (handled
        // here so the frame's semaphore was consumed first), or the
        // surface changed between acquire and present. Rebuild for the
        // next frame.
        rebuildSwapchain();
    } else if (pr != VK_SUCCESS) {
        handleFatalPresentFailure("vkQueuePresentKHR", pr);
    }
}

bool Renderer::flushGraphInput() {
    if (!graphUi_.visible()) return true;
    if (!deviceReady_) return false;
    syncSwapchainToSurface();
    if (!swapchainReady_) return false;

    initImGuiIfNeeded();
    bool flushed = false;
    if (imGuiReady_) {
        imGuiHost_.newFrame(
            static_cast<int>(swapchainExtent_.width),
            static_cast<int>(swapchainExtent_.height),
            1.0f / 60.0f);
        graphUi_.render(graph_);
        imGuiHost_.render();
        flushed = true;
    }
    return flushed;
}

} // namespace penrose
