#pragma once

#include <android/asset_manager.h>
#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <vector>

namespace penrose {

struct FrameSync {
    VkSemaphore imageAvailable = VK_NULL_HANDLE;
    VkSemaphore renderFinished = VK_NULL_HANDLE;
    VkFence inFlight = VK_NULL_HANDLE;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
};

class Renderer {
public:
    explicit Renderer(AAssetManager* assets);
    ~Renderer();

    Renderer(const Renderer&) = delete;
    Renderer& operator=(const Renderer&) = delete;

    bool onSurfaceCreated(ANativeWindow* window);
    bool onSurfaceChanged(int width, int height);
    void onSurfaceDestroyed();
    void onVisibilityChanged(bool visible);
    void drawFrame();

private:
    // ---- One-time init (instance/device/etc) ---------------------------
    bool initInstance();
    bool initDeviceForSurface();
    bool initPipeline();
    bool buildGeometry();

    // ---- Per-surface init / teardown -----------------------------------
    bool createSurface(ANativeWindow* window);
    bool createSwapchain(int width, int height);
    void destroySwapchain();
    bool createPerFrameResources();
    void destroyPerFrameResources();

    // ---- Helpers -------------------------------------------------------
    bool createBuffer(VkDeviceSize size, VkBufferUsageFlags usage,
                      VkMemoryPropertyFlags props,
                      VkBuffer& buffer, VkDeviceMemory& memory);
    uint32_t findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags props) const;
    bool loadShader(const char* assetPath, VkShaderModule& outModule);

    AAssetManager* assets_ = nullptr;

    // Persistent across surface lifecycles.
    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memProps_{};
    VkDevice device_ = VK_NULL_HANDLE;
    uint32_t graphicsQueueFamily_ = UINT32_MAX;
    VkQueue queue_ = VK_NULL_HANDLE;

    VkCommandPool commandPool_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    VkShaderModule vertShader_ = VK_NULL_HANDLE;
    VkShaderModule fragShader_ = VK_NULL_HANDLE;

    // Tile geometry — uploaded once, reused every frame.
    VkBuffer vertexBuffer_ = VK_NULL_HANDLE;
    VkDeviceMemory vertexMemory_ = VK_NULL_HANDLE;
    VkBuffer indexBuffer_ = VK_NULL_HANDLE;
    VkDeviceMemory indexMemory_ = VK_NULL_HANDLE;
    uint32_t indexCount_ = 0;
    float geomMinX_ = -1.0f, geomMinY_ = -1.0f;
    float geomMaxX_ =  1.0f, geomMaxY_ =  1.0f;

    // Surface-scoped state.
    ANativeWindow* window_ = nullptr;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat swapchainFormat_ = VK_FORMAT_UNDEFINED;
    VkExtent2D swapchainExtent_{0, 0};
    std::vector<VkImage> swapchainImages_;
    std::vector<VkImageView> swapchainViews_;
    std::vector<FrameSync> frames_;
    uint32_t currentFrame_ = 0;

    bool deviceReady_ = false;
    bool swapchainReady_ = false;
    bool visible_ = false;

    static constexpr uint32_t kFramesInFlight = 2;
};

} // namespace penrose
