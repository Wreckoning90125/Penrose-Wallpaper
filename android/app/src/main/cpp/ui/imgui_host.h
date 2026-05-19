#pragma once

// =============================================================================
// ImGui host — owns the ImGui context, the Vulkan backend init/teardown,
// the dedicated descriptor pool, and a lock-free SPSC ring for touch
// events forwarded from the Kotlin layer. The renderer owns one instance
// and asks it to NewFrame / Render / record draws per vsync.
// =============================================================================

#include <vulkan/vulkan.h>

#include <atomic>
#include <cstdint>

struct ImGuiContext;  // forward

namespace penrose::ui {

enum class TouchPhase : uint8_t { Down = 0, Move = 1, Up = 2, Cancel = 3, LongPress = 4 };
struct TouchEvent {
    TouchPhase phase;
    uint8_t pointerIndex;
    float x;
    float y;
};

struct VulkanContext {
    VkInstance       instance;
    VkPhysicalDevice physicalDevice;
    VkDevice         device;
    uint32_t         graphicsQueueFamily;
    VkQueue          graphicsQueue;
    VkFormat         colorAttachmentFormat;
    uint32_t         minImageCount;
    uint32_t         imageCount;
    VkSampleCountFlagBits msaaSamples;
};

class ImGuiHost {
public:
    ImGuiHost();
    ~ImGuiHost();

    ImGuiHost(const ImGuiHost&) = delete;
    ImGuiHost& operator=(const ImGuiHost&) = delete;

    bool initialize(const VulkanContext& ctx, float densityScale);
    void shutdown();
    void onSwapchainChanged(uint32_t newMinImageCount, uint32_t newImageCount);
    void newFrame(int surfaceWidthPx, int surfaceHeightPx, float deltaSeconds);
    void render();
    void recordDrawCommands(VkCommandBuffer cmd);
    void queueTouchEvent(const TouchEvent& ev);

    bool initialized() const { return initialized_.load(std::memory_order_acquire); }
    float densityScale() const { return densityScale_; }

private:
    static constexpr int kQueueCapacity = 256;
    void drainTouchQueue();

    // initialized_ is read from the JNI/UI thread via queueTouchEvent and
    // written from the render thread via initialize()/shutdown(). Atomic
    // with acquire/release so the touch producer sees a coherent flag
    // and any reads of device_/descriptorPool_ guarded by it are not
    // reordered past the store.
    std::atomic<bool> initialized_ = false;
    float densityScale_ = 1.0f;
    VkDevice         device_         = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
    VkQueue          graphicsQueue_  = VK_NULL_HANDLE;

    // CRITICAL: ImGui maintains a single global "current context"
    // pointer. Multiple ImGuiHost instances (live-wallpaper service
    // + in-app preview + full-screen activity) coexist in one process;
    // each owns its own context. Every method that touches ImGui must
    // call ImGui::SetCurrentContext(imguiCtx_) so calls land on this
    // host's context rather than whichever was created last. Without
    // this, a second Renderer's CreateContext silently steals "current"
    // and the first Renderer's render thread starts driving the wrong
    // VkDevice + descriptor pool — instant crash on first draw.
    ImGuiContext* imguiCtx_ = nullptr;

    TouchEvent ring_[kQueueCapacity] = {};
    std::atomic<uint32_t> ringWrite_ {0};
    std::atomic<uint32_t> ringRead_  {0};
    // ImGui's source attribution is per-event; without re-emitting
    // ImGuiMouseSource_TouchScreen each frame while a button is still
    // held, late position updates can be wrongly attributed (e.g., a
    // stylus or mouse "source" inherited from an earlier non-touch path).
    // Tracked between drains.
    bool mouseDown_ = false;
};

} // namespace penrose::ui
