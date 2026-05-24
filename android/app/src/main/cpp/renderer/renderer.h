#pragma once

#include "audio/audio_analyzer.h"
#include "graph/graph.h"
#include "graph/graph_ui.h"
#include "settings.h"
#include "ui/imgui_host.h"

#include <android/asset_manager.h>
#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <memory>
#include <vector>

namespace penrose {

struct FrameSync {
    VkSemaphore imageAvailable = VK_NULL_HANDLE;
    VkSemaphore renderFinished = VK_NULL_HANDLE;
    VkFence inFlight = VK_NULL_HANDLE;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
};

// Live gesture state that updates faster than the SharedPreferences
// round trip. The same fields exist in Settings (zoom, rotation, panX,
// panY) and are written back to SharedPreferences by Kotlin's
// Settings.saveView() at touch-end. During a gesture the Kotlin layer
// pushes deltas straight into these via touchPinch / touchMove for
// sub-frame responsiveness; readView() lets Kotlin pull the latest
// values out when it's time to persist them.
struct LiveView {
    float zoom = 1.0f;
    float rotation = 0.0f;
    float panX = 0.0f;
    float panY = 0.0f;
};

// THREADING CONTRACT
//   Every public method except the constructor and the gesture pushers
//   (touchPinch / touchMove / setPageOffset) must be called on the
//   render thread that owns the Vulkan device. The Kotlin layer
//   guarantees this by posting onto a per-Renderer HandlerThread (see
//   PenroseWallpaperService.renderHandler, SettingsActivity.renderHandler,
//   FullScreenActivity.renderHandler). Calling these from any other
//   thread races vkQueueSubmit against vkDeviceWaitIdle and produces
//   undefined behaviour. The Renderer does not lock.
//
//   The constructor only sets up the VkInstance + spawns the modulation
//   graph's default node set — no surface, no device, no swapchain.
//   Safe to call from any thread that owns the resulting Renderer*.
//
//   The gesture pushers (touchPinch / touchMove / setPageOffset /
//   setUiDensity / pushTouchEvent via imGuiHost()) only update plain
//   data + atomic ring buffers, never touching Vulkan. They are safe
//   from the UI thread and are intentionally NOT posted to the render
//   handler so gestures don't queue behind a slow frame.
class Renderer {
public:
    explicit Renderer(AAssetManager* assets);
    ~Renderer();

    Renderer(const Renderer&) = delete;
    Renderer& operator=(const Renderer&) = delete;

    bool onSurfaceCreated(ANativeWindow* window);
    bool onSurfaceChanged(int width, int height);
    void onSurfaceDestroyed();

    void onSettingsChanged(const Settings& s);

    // Pinch gestures update zoom + rotation immediately; the Kotlin layer
    // calls Settings::saveView on touch-end to commit them. touchMove only
    // accumulates pan in Generative mode and is otherwise a no-op.
    void touchPinch(float scale, float rotDelta);
    void touchMove(float dx, float dy);
    void resetView();

    // Choreographer-driven ripple clock; `tSeconds` is monotonic seconds
    // since the engine's first vsync.
    void tick(float tSeconds);

    // Surface vs. screen-window dimensions for fit-to-screen view-matrix
    // correction when the wallpaper surface is wider than the visible window.
    void surfaceGeometry(int surfW, int surfH, int screenW, int screenH);

    // Home-screen horizontal scroll offset (0..1) — phase-shifts the ripple
    // in modes that include the page-scroll term.
    void setPageOffset(float xOffset);

    // Device px-per-dp, supplied by Kotlin from DisplayMetrics. Used by
    // ImGuiHost to scale touch-target sizes against the actual surface
    // density instead of a hardcoded guess.
    void setUiDensity(float density);

    // System-bar insets in surface pixels (status bar / nav bar /
    // cutouts). Forwarded by the host Activity once WindowInsets
    // arrive. Used by GraphUi to shift its app bar below the status
    // bar so the buttons are tappable on devices without
    // edge-to-edge-off mode.
    void setSystemInsets(int topPx, int bottomPx, int leftPx, int rightPx);

    // Read back the current live view transform so Kotlin can persist it on
    // touch-end. Returns zoom, rotation, panX (clip-space), panY (clip-space).
    void readView(float* zoom, float* rotation, float* panX, float* panY) const;

    // Owned C++ objects exposed for the JNI bridge in graph_jni.cpp.
    graph::Graph&    graph()      { return graph_; }
    graph::GraphUi&  graphUi()    { return graphUi_; }
    ui::ImGuiHost&   imGuiHost()  { return imGuiHost_; }

    void drawFrame();

private:
    bool initInstance();
    bool initDeviceForSurface();
    bool initPipeline();
    bool buildGeometry();
    void updatePaletteUbo();
    void initImGuiIfNeeded();

    bool createSurface(ANativeWindow* window);
    bool createSwapchain(int width, int height);
    void destroySwapchain();
    // Tear down and rebuild the swapchain + pipelines + per-frame
    // resources against the surface's current size. Used both by
    // onSurfaceChanged and by drawFrame when acquire/present reports
    // the swapchain stale (e.g. a device rotation the surface
    // callbacks missed). Returns false if the surface is not presently
    // usable (0-area); the caller should skip the frame.
    bool rebuildSwapchain();
    // Per-frame guard: if the surface's currentExtent no longer matches
    // the swapchain (a device rotation), rebuild before drawing so the
    // frame targets the right size instead of being stretched by the
    // compositor.
    void syncSwapchainToSurface();
    bool createPerFrameResources();
    void destroyPerFrameResources();
    bool createDescriptorObjects();
    void destroyDescriptorObjects();
    bool buildPipelines();
    void destroyPipelines();

    bool createBuffer(VkDeviceSize size, VkBufferUsageFlags usage,
                      VkMemoryPropertyFlags props,
                      VkBuffer& buffer, VkDeviceMemory& memory);
    uint32_t findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags props) const;
    bool loadShader(const char* assetPath, VkShaderModule& outModule);

    // Generative-pan: bump effectiveGeneration_ when the gesture has
    // accumulated enough pixels to warrant another deflation pass, and
    // rebuild geometry. No-op when panMode != Generative or already at the
    // family's generation cap.
    void considerGrowth();

    AAssetManager* assets_ = nullptr;

    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memProps_{};
    VkDevice device_ = VK_NULL_HANDLE;
    uint32_t graphicsQueueFamily_ = UINT32_MAX;
    VkQueue queue_ = VK_NULL_HANDLE;

    VkCommandPool commandPool_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline fillPipeline_ = VK_NULL_HANDLE;
    VkPipeline borderPipeline_ = VK_NULL_HANDLE;
    VkShaderModule fillVert_ = VK_NULL_HANDLE;
    VkShaderModule fillFrag_ = VK_NULL_HANDLE;
    VkShaderModule borderVert_ = VK_NULL_HANDLE;
    VkShaderModule borderFrag_ = VK_NULL_HANDLE;

    // Palette UBO (set 0, binding 0). Layout mirrored in cpp/renderer.cpp's
    // PaletteUbo struct and in all four shader uniform blocks.
    VkDescriptorSetLayout descSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descSet_ = VK_NULL_HANDLE;
    VkBuffer paletteUbo_ = VK_NULL_HANDLE;
    VkDeviceMemory paletteUboMem_ = VK_NULL_HANDLE;
    void* paletteUboMapped_ = nullptr;
    VkDeviceSize paletteUboSize_ = 0;

    // Fills: one triangle per Penrose tri, 4 triangles per Chair L-tromino.
    // Borders: one indexed triangle quad per unique edge, vertex-shader
    // expanded by `borderGeom.x` half-width.
    VkBuffer fillVertBuf_ = VK_NULL_HANDLE;
    VkDeviceMemory fillVertMem_ = VK_NULL_HANDLE;
    uint32_t fillVertexCount_ = 0;
    VkBuffer borderVertBuf_ = VK_NULL_HANDLE;
    VkDeviceMemory borderVertMem_ = VK_NULL_HANDLE;
    VkBuffer borderIdxBuf_ = VK_NULL_HANDLE;
    VkDeviceMemory borderIdxMem_ = VK_NULL_HANDLE;
    uint32_t borderIndexCount_ = 0;

    // Untransformed geometry extent (model space).
    float geomMinX_ = -1.0f, geomMinY_ = -1.0f;
    float geomMaxX_ =  1.0f, geomMaxY_ =  1.0f;

    ANativeWindow* window_ = nullptr;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat swapchainFormat_ = VK_FORMAT_UNDEFINED;
    VkColorSpaceKHR swapchainColorSpace_ = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR;
    // `wideGamut_` is set when the swapchain advertises DisplayP3-NONLINEAR,
    // selecting the OKLCH → linear-P3 → P3-encode upload path.
    // `cpuLinearOutput_` is set when the swapchain format performs sRGB
    // encode in hardware, so the UBO must hold linear values.
    bool wideGamut_ = false;
    bool cpuLinearOutput_ = false;
    VkExtent2D swapchainExtent_{0, 0};
    std::vector<VkImage> swapchainImages_;
    std::vector<VkImageView> swapchainViews_;
    std::vector<FrameSync> frames_;
    uint32_t currentFrame_ = 0;

    Settings settings_{};
    bool settingsDirty_ = true;
    LiveView view_{};

    // Graph-modulated effective values. settings_ holds the pristine
    // user baseline (sliders); the modulation graph reads that baseline
    // each frame and the result lands here, in the values the UBO patch
    // actually uploads. Kept separate from settings_ so the graph never
    // feeds its own previous-frame output back as this frame's input —
    // writing the result into settings_ made every modulated target run
    // away (brightness pinned to white within a second).
    float fxRippleAmount_ = 0.3f;
    float fxRippleSpeed_  = 1.0f;
    float fxBrightness_   = 1.0f;
    float fxDepthAmount_  = 0.3f;
    // Graph-modulated material controls — slider baseline from settings_,
    // result after Graph::evaluate. Written to the UBO per frame.
    float fxMatRoughness_   = 0.50f;
    float fxMatMetalness_   = 0.40f;
    float fxMatSheen_       = 0.35f;
    float fxMatClearcoat_   = 0.45f;
    float fxMatAnisotropy_  = 0.40f;
    float fxMatIridescence_ = 0.45f;
    float fxMatEmissive_    = 0.60f;
    float fxMatRelief_      = 1.05f;
    float fxLightAngle_     = 230.0f;
    float fxLightElevation_ = 55.0f;
    float fxLightIntensity_ = 1.00f;
    float fxLightWarmth_    = 0.50f;
    float fxLightAmbient_   = 0.22f;
    // Hyperbolic-projection targets — slider/setting baseline plus the
    // sum of any connected OutHypBoost{X,Y} / OutHypScale Target nodes.
    // The boost is clamped to |b| <= 0.92 in the graph so the τ_b
    // transform never goes singular near the disk boundary.
    float fxHypBoostX_      = 0.0f;
    float fxHypBoostY_      = 0.0f;
    float fxHypScale_       = 1.5f;

    // Effective generation for the currently-built geometry. Equal to
    // settings_.generation in Locked pan mode; grows past it in Generative
    // mode as the user drags.
    int effectiveGeneration_ = 0;
    // Cumulative pan delta in pixels since the last growth trigger.
    float panAccumPx_ = 0.0f;

    // Ripple state.
    float time_ = 0.0f;
    float pageOffset_ = 0.5f;
    float lastFrameSec_ = 0.0f;

    int surfW_ = 0, surfH_ = 0;
    int screenW_ = 0, screenH_ = 0;

    // ImGui + node editor + modulation graph. The host owns the ImGui
    // context + Vulkan backend; the GraphUi draws the editor inside the
    // ImGui frame; the Graph itself is the data model evaluated every
    // frame to produce the live override floats the shader consumes.
    graph::Graph   graph_;
    graph::GraphUi graphUi_;
    ui::ImGuiHost  imGuiHost_;
    bool  imGuiReady_  = false;
    float uiDensity_   = 2.5f;

    bool deviceReady_ = false;
    bool swapchainReady_ = false;
    bool pipelinesBuilt_ = false;

    static constexpr uint32_t kFramesInFlight = 2;
};

} // namespace penrose
