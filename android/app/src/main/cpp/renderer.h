#pragma once

#include "settings.h"

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

struct ViewState {
    float panX = 0.0f, panY = 0.0f; // pixels relative to surface center
    float zoom = 1.0f;
    float rotation = 0.0f;          // radians
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

    void onSettingsChanged(const Settings& s);

    // Touch interactions. Coordinates are surface-relative pixels.
    void touchBegin(float x, float y);
    void touchMove(float x, float y, float prevX, float prevY);
    void touchPinch(float midX, float midY, float scale, float rotDelta);
    void touchEnd();
    void resetView();

    void drawFrame();

private:
    bool initInstance();
    bool initDeviceForSurface();
    bool initPipeline();
    bool buildGeometry();
    void updatePaletteUbo();

    bool createSurface(ANativeWindow* window);
    bool createSwapchain(int width, int height);
    void destroySwapchain();
    bool createMsaaTargets();
    void destroyMsaaTargets();
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

    AAssetManager* assets_ = nullptr;

    // Persistent across surface lifecycles.
    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memProps_{};
    VkDevice device_ = VK_NULL_HANDLE;
    uint32_t graphicsQueueFamily_ = UINT32_MAX;
    VkQueue queue_ = VK_NULL_HANDLE;
    VkSampleCountFlagBits msaaSamples_ = VK_SAMPLE_COUNT_1_BIT;

    VkCommandPool commandPool_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline fillPipeline_ = VK_NULL_HANDLE;
    VkPipeline borderPipeline_ = VK_NULL_HANDLE;
    VkShaderModule fillVert_ = VK_NULL_HANDLE;
    VkShaderModule fillFrag_ = VK_NULL_HANDLE;
    VkShaderModule borderVert_ = VK_NULL_HANDLE;
    VkShaderModule borderFrag_ = VK_NULL_HANDLE;

    // Descriptor objects for the palette UBO (set 0, binding 0).
    VkDescriptorSetLayout descSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descSet_ = VK_NULL_HANDLE;
    VkBuffer paletteUbo_ = VK_NULL_HANDLE;
    VkDeviceMemory paletteUboMem_ = VK_NULL_HANDLE;
    void* paletteUboMapped_ = nullptr;
    VkDeviceSize paletteUboSize_ = 0;

    // Tile geometry — fills (one triangle per Penrose tri, 4 triangles per
    // chair L-tromino) and borders (one VK_PRIMITIVE_TOPOLOGY_LINE_LIST entry
    // per non-hidden edge).
    VkBuffer fillVertBuf_ = VK_NULL_HANDLE;
    VkDeviceMemory fillVertMem_ = VK_NULL_HANDLE;
    uint32_t fillVertexCount_ = 0;
    VkBuffer borderVertBuf_ = VK_NULL_HANDLE;
    VkDeviceMemory borderVertMem_ = VK_NULL_HANDLE;
    uint32_t borderVertexCount_ = 0;

    // Bounding box of the un-transformed geometry (in model space). Used by
    // the view fit-to-screen calculation.
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
    VkImage msaaImage_ = VK_NULL_HANDLE;
    VkDeviceMemory msaaMemory_ = VK_NULL_HANDLE;
    VkImageView msaaView_ = VK_NULL_HANDLE;
    std::vector<FrameSync> frames_;
    uint32_t currentFrame_ = 0;

    Settings settings_{};
    bool settingsDirty_ = true;
    ViewState view_{};

    bool deviceReady_ = false;
    bool swapchainReady_ = false;
    bool visible_ = false;
    bool pipelinesBuilt_ = false;

    static constexpr uint32_t kFramesInFlight = 2;
};

} // namespace penrose
