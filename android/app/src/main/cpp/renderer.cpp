#include "renderer.h"

#include "log.h"
#include "penrose.h"

#include <android/asset_manager.h>
#include <vulkan/vulkan.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

namespace penrose {

// -----------------------------------------------------------------------------
// Vertex layout for the tile pipeline. Each tile triangle contributes 3 verts;
// per-vertex color index is replicated, so the fragment shader can do a tiny
// uniform-buffer lookup without any descriptor management beyond push consts.
// -----------------------------------------------------------------------------
namespace {

struct Vertex {
    float x, y;
    uint32_t colorIdx;
};

// 16 bytes of push constants — model-view-projection + palette pointer.
// Stays well under the 128-byte guaranteed minimum.
struct PushBlock {
    float scaleX, scaleY;   // model→clip-space scale (uniform scale split per-axis for aspect fit)
    float offsetX, offsetY; // model→clip-space translation
    float palette[2][4];    // RGBA per tile type (L, S). Alpha unused.
};

constexpr uint32_t kGenerations = 6;
constexpr VkFormat kPreferredFormats[] = {
    VK_FORMAT_R8G8B8A8_SRGB,
    VK_FORMAT_B8G8R8A8_SRGB,
    VK_FORMAT_R8G8B8A8_UNORM,
    VK_FORMAT_B8G8R8A8_UNORM,
};

// Hardcoded 2-color palette — gold L, dusk-purple S. Matches the spirit of
// the HTML reference's default 2-color "type" mode. OKLCH → sRGB precomputed.
constexpr float kColorL[4] = { 0.85f, 0.67f, 0.34f, 1.0f };
constexpr float kColorS[4] = { 0.36f, 0.31f, 0.45f, 1.0f };
constexpr float kClearColor[4] = { 0.043f, 0.043f, 0.063f, 1.0f }; // #0b0b10

} // namespace

// =============================================================================
// Lifecycle
// =============================================================================

Renderer::Renderer(AAssetManager* assets) : assets_(assets) {
    if (!initInstance()) {
        LOGE("Renderer: failed to create instance");
        return;
    }
    // Physical device, logical device, pipeline are deferred until we have a
    // surface — we need surface support for queue family selection.
}

Renderer::~Renderer() {
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    onSurfaceDestroyed();

    if (device_ != VK_NULL_HANDLE) {
        if (vertexBuffer_)      vkDestroyBuffer(device_, vertexBuffer_, nullptr);
        if (vertexMemory_)      vkFreeMemory(device_, vertexMemory_, nullptr);
        if (indexBuffer_)       vkDestroyBuffer(device_, indexBuffer_, nullptr);
        if (indexMemory_)       vkFreeMemory(device_, indexMemory_, nullptr);
        if (pipeline_)          vkDestroyPipeline(device_, pipeline_, nullptr);
        if (pipelineLayout_)    vkDestroyPipelineLayout(device_, pipelineLayout_, nullptr);
        if (vertShader_)        vkDestroyShaderModule(device_, vertShader_, nullptr);
        if (fragShader_)        vkDestroyShaderModule(device_, fragShader_, nullptr);
        if (commandPool_)       vkDestroyCommandPool(device_, commandPool_, nullptr);
        vkDestroyDevice(device_, nullptr);
        device_ = VK_NULL_HANDLE;
    }
    if (instance_ != VK_NULL_HANDLE) {
        vkDestroyInstance(instance_, nullptr);
        instance_ = VK_NULL_HANDLE;
    }
}

// =============================================================================
// Instance
// =============================================================================

bool Renderer::initInstance() {
    VkApplicationInfo app{};
    app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app.pApplicationName = "Penrose";
    app.applicationVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    app.pEngineName = "Penrose";
    app.engineVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    app.apiVersion = VK_API_VERSION_1_4;

    const char* kInstanceExts[] = {
        VK_KHR_SURFACE_EXTENSION_NAME,
        VK_KHR_ANDROID_SURFACE_EXTENSION_NAME,
    };

    VkInstanceCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    ci.pApplicationInfo = &app;
    ci.enabledExtensionCount = sizeof(kInstanceExts) / sizeof(kInstanceExts[0]);
    ci.ppEnabledExtensionNames = kInstanceExts;

    VK_CHECK(vkCreateInstance(&ci, nullptr, &instance_));
    return true;
}

// =============================================================================
// Per-surface init
// =============================================================================

bool Renderer::onSurfaceCreated(ANativeWindow* window) {
    if (!window) return false;
    if (instance_ == VK_NULL_HANDLE) return false;

    ANativeWindow_acquire(window);
    window_ = window;

    if (!createSurface(window)) return false;

    if (!deviceReady_) {
        if (!initDeviceForSurface()) return false;
        if (!initPipeline()) return false;
        if (!buildGeometry()) return false;
        deviceReady_ = true;
    }

    int width = ANativeWindow_getWidth(window);
    int height = ANativeWindow_getHeight(window);
    if (!createSwapchain(width, height)) return false;
    if (!createPerFrameResources()) return false;
    swapchainReady_ = true;
    return true;
}

bool Renderer::createSurface(ANativeWindow* window) {
    VkAndroidSurfaceCreateInfoKHR ci{};
    ci.sType = VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR;
    ci.window = window;
    VK_CHECK(vkCreateAndroidSurfaceKHR(instance_, &ci, nullptr, &surface_));
    return true;
}

bool Renderer::initDeviceForSurface() {
    uint32_t count = 0;
    VK_CHECK(vkEnumeratePhysicalDevices(instance_, &count, nullptr));
    if (count == 0) { LOGE("no Vulkan physical devices"); return false; }
    std::vector<VkPhysicalDevice> devices(count);
    VK_CHECK(vkEnumeratePhysicalDevices(instance_, &count, devices.data()));

    // Pick the first device that has a queue family supporting both graphics
    // and presentation to our surface. On Android there's always exactly one.
    for (VkPhysicalDevice pd : devices) {
        uint32_t qCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(pd, &qCount, nullptr);
        std::vector<VkQueueFamilyProperties> qprops(qCount);
        vkGetPhysicalDeviceQueueFamilyProperties(pd, &qCount, qprops.data());
        for (uint32_t i = 0; i < qCount; ++i) {
            if (!(qprops[i].queueFlags & VK_QUEUE_GRAPHICS_BIT)) continue;
            VkBool32 present = VK_FALSE;
            vkGetPhysicalDeviceSurfaceSupportKHR(pd, i, surface_, &present);
            if (present) {
                physicalDevice_ = pd;
                graphicsQueueFamily_ = i;
                break;
            }
        }
        if (physicalDevice_ != VK_NULL_HANDLE) break;
    }
    if (physicalDevice_ == VK_NULL_HANDLE) {
        LOGE("no suitable physical device / queue family");
        return false;
    }

    vkGetPhysicalDeviceMemoryProperties(physicalDevice_, &memProps_);

    // Vulkan 1.4 ships dynamic rendering + sync2 as core; we still must
    // enable them in the feature struct chain.
    VkPhysicalDeviceVulkan13Features v13{};
    v13.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES;
    v13.dynamicRendering = VK_TRUE;
    v13.synchronization2 = VK_TRUE;

    VkPhysicalDeviceFeatures2 feats{};
    feats.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2;
    feats.pNext = &v13;

    float prio = 1.0f;
    VkDeviceQueueCreateInfo qci{};
    qci.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    qci.queueFamilyIndex = graphicsQueueFamily_;
    qci.queueCount = 1;
    qci.pQueuePriorities = &prio;

    const char* kDeviceExts[] = { VK_KHR_SWAPCHAIN_EXTENSION_NAME };

    VkDeviceCreateInfo dci{};
    dci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    dci.pNext = &feats;
    dci.queueCreateInfoCount = 1;
    dci.pQueueCreateInfos = &qci;
    dci.enabledExtensionCount = 1;
    dci.ppEnabledExtensionNames = kDeviceExts;

    VK_CHECK(vkCreateDevice(physicalDevice_, &dci, nullptr, &device_));
    vkGetDeviceQueue(device_, graphicsQueueFamily_, 0, &queue_);

    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pci.queueFamilyIndex = graphicsQueueFamily_;
    VK_CHECK(vkCreateCommandPool(device_, &pci, nullptr, &commandPool_));

    return true;
}

// =============================================================================
// Pipeline
// =============================================================================

bool Renderer::loadShader(const char* assetPath, VkShaderModule& outModule) {
    AAsset* asset = AAssetManager_open(assets_, assetPath, AASSET_MODE_BUFFER);
    if (!asset) { LOGE("missing shader asset: %s", assetPath); return false; }
    size_t size = AAsset_getLength(asset);
    if (size == 0 || (size & 3) != 0) {
        LOGE("invalid SPIR-V size for %s (%zu bytes)", assetPath, size);
        AAsset_close(asset);
        return false;
    }
    std::vector<uint32_t> code(size / 4);
    std::memcpy(code.data(), AAsset_getBuffer(asset), size);
    AAsset_close(asset);

    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = size;
    ci.pCode = code.data();
    VK_CHECK(vkCreateShaderModule(device_, &ci, nullptr, &outModule));
    return true;
}

bool Renderer::initPipeline() {
    if (!loadShader("shaders/tile.vert.spv", vertShader_)) return false;
    if (!loadShader("shaders/tile.frag.spv", fragShader_)) return false;

    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    pcRange.offset = 0;
    pcRange.size = sizeof(PushBlock);

    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcRange;
    VK_CHECK(vkCreatePipelineLayout(device_, &plci, nullptr, &pipelineLayout_));

    // The pipeline's color attachment format must match the swapchain. We
    // don't know it yet, so defer building the pipeline until createSwapchain
    // has run. initPipeline only owns shader + layout.
    return true;
}

bool Renderer::buildGeometry() {
    // Generate P3 tiles and pack them into a vertex + index buffer.
    auto tris = generateP3Sun(kGenerations);

    std::vector<Vertex> verts;
    std::vector<uint32_t> indices;
    verts.reserve(tris.size() * 3);
    indices.reserve(tris.size() * 3);

    float minX = 1e9f, minY = 1e9f, maxX = -1e9f, maxY = -1e9f;
    uint32_t base = 0;
    for (const Tri& t : tris) {
        const uint32_t cidx = t.type;
        const float xs[3] = { t.ax, t.bx, t.cx };
        const float ys[3] = { t.ay, t.by, t.cy };
        for (int i = 0; i < 3; ++i) {
            verts.push_back(Vertex{ xs[i], ys[i], cidx });
            minX = std::min(minX, xs[i]); maxX = std::max(maxX, xs[i]);
            minY = std::min(minY, ys[i]); maxY = std::max(maxY, ys[i]);
        }
        indices.push_back(base + 0);
        indices.push_back(base + 1);
        indices.push_back(base + 2);
        base += 3;
    }
    indexCount_ = static_cast<uint32_t>(indices.size());
    geomMinX_ = minX; geomMaxX_ = maxX;
    geomMinY_ = minY; geomMaxY_ = maxY;
    LOGI("generated %zu tris (%u verts) gen=%u bounds [%.3f,%.3f]-[%.3f,%.3f]",
         tris.size(), (unsigned)verts.size(), kGenerations, minX, minY, maxX, maxY);

    const VkDeviceSize vbSize = sizeof(Vertex) * verts.size();
    const VkDeviceSize ibSize = sizeof(uint32_t) * indices.size();

    // Host-visible coherent buffers. The geometry is tiny (a few MB at most)
    // and built once; not worth the staging-buffer dance.
    if (!createBuffer(vbSize, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                      VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      vertexBuffer_, vertexMemory_)) return false;
    if (!createBuffer(ibSize, VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                      VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      indexBuffer_, indexMemory_)) return false;

    void* mapped = nullptr;
    VK_CHECK(vkMapMemory(device_, vertexMemory_, 0, vbSize, 0, &mapped));
    std::memcpy(mapped, verts.data(), vbSize);
    vkUnmapMemory(device_, vertexMemory_);

    VK_CHECK(vkMapMemory(device_, indexMemory_, 0, ibSize, 0, &mapped));
    std::memcpy(mapped, indices.data(), ibSize);
    vkUnmapMemory(device_, indexMemory_);

    return true;
}

// =============================================================================
// Swapchain
// =============================================================================

bool Renderer::createSwapchain(int width, int height) {
    VkSurfaceCapabilitiesKHR caps{};
    VK_CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice_, surface_, &caps));

    // Surface extent. currentExtent == 0xFFFFFFFF means we choose freely.
    VkExtent2D extent = caps.currentExtent;
    if (extent.width == UINT32_MAX) {
        extent.width  = std::clamp((uint32_t)width,  caps.minImageExtent.width,  caps.maxImageExtent.width);
        extent.height = std::clamp((uint32_t)height, caps.minImageExtent.height, caps.maxImageExtent.height);
    }
    if (extent.width == 0 || extent.height == 0) {
        LOGW("createSwapchain: zero extent, deferring");
        return false;
    }

    // Surface format.
    uint32_t fmtCount = 0;
    VK_CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &fmtCount, nullptr));
    std::vector<VkSurfaceFormatKHR> formats(fmtCount);
    VK_CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &fmtCount, formats.data()));

    VkSurfaceFormatKHR chosen = formats[0];
    for (VkFormat pref : kPreferredFormats) {
        bool found = false;
        for (const auto& f : formats) {
            if (f.format == pref && f.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
                chosen = f;
                found = true;
                break;
            }
        }
        if (found) break;
    }
    swapchainFormat_ = chosen.format;
    swapchainExtent_ = extent;

    // Present mode. FIFO is always available and matches the wallpaper's
    // render-on-demand pattern (we only submit when the framework asks).
    VkPresentModeKHR presentMode = VK_PRESENT_MODE_FIFO_KHR;

    uint32_t desiredImages = std::max(caps.minImageCount, 2u);
    if (caps.maxImageCount > 0) desiredImages = std::min(desiredImages, caps.maxImageCount);

    VkSwapchainCreateInfoKHR sci{};
    sci.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    sci.surface = surface_;
    sci.minImageCount = desiredImages;
    sci.imageFormat = chosen.format;
    sci.imageColorSpace = chosen.colorSpace;
    sci.imageExtent = extent;
    sci.imageArrayLayers = 1;
    sci.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    sci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    sci.preTransform = (caps.supportedTransforms & VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR)
        ? VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR : caps.currentTransform;
    sci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    sci.presentMode = presentMode;
    sci.clipped = VK_TRUE;
    sci.oldSwapchain = VK_NULL_HANDLE;
    VK_CHECK(vkCreateSwapchainKHR(device_, &sci, nullptr, &swapchain_));

    uint32_t imageCount = 0;
    VK_CHECK(vkGetSwapchainImagesKHR(device_, swapchain_, &imageCount, nullptr));
    swapchainImages_.resize(imageCount);
    VK_CHECK(vkGetSwapchainImagesKHR(device_, swapchain_, &imageCount, swapchainImages_.data()));

    swapchainViews_.resize(imageCount);
    for (uint32_t i = 0; i < imageCount; ++i) {
        VkImageViewCreateInfo vci{};
        vci.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        vci.image = swapchainImages_[i];
        vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
        vci.format = chosen.format;
        vci.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
        VK_CHECK(vkCreateImageView(device_, &vci, nullptr, &swapchainViews_[i]));
    }

    // Build the graphics pipeline now that we know the swapchain format.
    if (pipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(device_, pipeline_, nullptr);
        pipeline_ = VK_NULL_HANDLE;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vertShader_;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fragShader_;
    stages[1].pName = "main";

    VkVertexInputBindingDescription binding{};
    binding.binding = 0;
    binding.stride = sizeof(Vertex);
    binding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

    VkVertexInputAttributeDescription attrs[2]{};
    attrs[0].location = 0; attrs[0].binding = 0;
    attrs[0].format = VK_FORMAT_R32G32_SFLOAT;
    attrs[0].offset = offsetof(Vertex, x);
    attrs[1].location = 1; attrs[1].binding = 0;
    attrs[1].format = VK_FORMAT_R32_UINT;
    attrs[1].offset = offsetof(Vertex, colorIdx);

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount = 1;
    vi.pVertexBindingDescriptions = &binding;
    vi.vertexAttributeDescriptionCount = 2;
    vi.pVertexAttributeDescriptions = attrs;

    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount = 1;

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_FALSE;

    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    VkDynamicState dynStates[] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR };
    VkPipelineDynamicStateCreateInfo dyn{};
    dyn.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dyn.dynamicStateCount = 2;
    dyn.pDynamicStates = dynStates;

    VkPipelineRenderingCreateInfo rendering{};
    rendering.sType = VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO;
    rendering.colorAttachmentCount = 1;
    rendering.pColorAttachmentFormats = &swapchainFormat_;

    VkGraphicsPipelineCreateInfo gpi{};
    gpi.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    gpi.pNext = &rendering;
    gpi.stageCount = 2;
    gpi.pStages = stages;
    gpi.pVertexInputState = &vi;
    gpi.pInputAssemblyState = &ia;
    gpi.pViewportState = &vp;
    gpi.pRasterizationState = &rs;
    gpi.pMultisampleState = &ms;
    gpi.pColorBlendState = &cb;
    gpi.pDynamicState = &dyn;
    gpi.layout = pipelineLayout_;
    gpi.renderPass = VK_NULL_HANDLE;
    gpi.subpass = 0;

    VK_CHECK(vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &gpi, nullptr, &pipeline_));
    return true;
}

bool Renderer::createPerFrameResources() {
    frames_.resize(kFramesInFlight);

    VkCommandBufferAllocateInfo cbai{};
    cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    cbai.commandPool = commandPool_;
    cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    cbai.commandBufferCount = kFramesInFlight;

    std::array<VkCommandBuffer, kFramesInFlight> bufs{};
    VK_CHECK(vkAllocateCommandBuffers(device_, &cbai, bufs.data()));

    for (uint32_t i = 0; i < kFramesInFlight; ++i) {
        frames_[i].cmd = bufs[i];

        VkSemaphoreCreateInfo sci{};
        sci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
        VK_CHECK(vkCreateSemaphore(device_, &sci, nullptr, &frames_[i].imageAvailable));
        VK_CHECK(vkCreateSemaphore(device_, &sci, nullptr, &frames_[i].renderFinished));

        VkFenceCreateInfo fci{};
        fci.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        fci.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        VK_CHECK(vkCreateFence(device_, &fci, nullptr, &frames_[i].inFlight));
    }
    currentFrame_ = 0;
    return true;
}

void Renderer::destroyPerFrameResources() {
    for (auto& f : frames_) {
        if (f.imageAvailable) vkDestroySemaphore(device_, f.imageAvailable, nullptr);
        if (f.renderFinished) vkDestroySemaphore(device_, f.renderFinished, nullptr);
        if (f.inFlight)       vkDestroyFence(device_, f.inFlight, nullptr);
    }
    if (commandPool_ != VK_NULL_HANDLE && !frames_.empty()) {
        std::vector<VkCommandBuffer> bufs;
        bufs.reserve(frames_.size());
        for (auto& f : frames_) bufs.push_back(f.cmd);
        vkFreeCommandBuffers(device_, commandPool_, (uint32_t)bufs.size(), bufs.data());
    }
    frames_.clear();
}

void Renderer::destroySwapchain() {
    for (VkImageView v : swapchainViews_) {
        if (v) vkDestroyImageView(device_, v, nullptr);
    }
    swapchainViews_.clear();
    swapchainImages_.clear();
    if (swapchain_) {
        vkDestroySwapchainKHR(device_, swapchain_, nullptr);
        swapchain_ = VK_NULL_HANDLE;
    }
    swapchainExtent_ = { 0, 0 };
}

// =============================================================================
// Surface lifecycle hooks
// =============================================================================

bool Renderer::onSurfaceChanged(int width, int height) {
    if (!deviceReady_) return false;
    if (width <= 0 || height <= 0) return false;
    if ((uint32_t)width == swapchainExtent_.width && (uint32_t)height == swapchainExtent_.height) {
        return true;
    }
    vkDeviceWaitIdle(device_);
    destroyPerFrameResources();
    destroySwapchain();
    if (!createSwapchain(width, height)) return false;
    if (!createPerFrameResources()) return false;
    swapchainReady_ = true;
    return true;
}

void Renderer::onSurfaceDestroyed() {
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

void Renderer::onVisibilityChanged(bool visible) {
    visible_ = visible;
}

// =============================================================================
// Frame
// =============================================================================

void Renderer::drawFrame() {
    if (!deviceReady_ || !swapchainReady_) return;
    if (!visible_) return;

    FrameSync& f = frames_[currentFrame_];

    vkWaitForFences(device_, 1, &f.inFlight, VK_TRUE, UINT64_MAX);

    uint32_t imageIndex = 0;
    VkResult acq = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX,
                                         f.imageAvailable, VK_NULL_HANDLE, &imageIndex);
    if (acq == VK_ERROR_OUT_OF_DATE_KHR) {
        // Recreate on next surfaceChanged; nothing useful to draw now.
        return;
    }
    if (acq != VK_SUCCESS && acq != VK_SUBOPTIMAL_KHR) {
        LOGE("vkAcquireNextImageKHR -> %d", (int)acq);
        return;
    }
    vkResetFences(device_, 1, &f.inFlight);
    vkResetCommandBuffer(f.cmd, 0);

    VkCommandBufferBeginInfo cbi{};
    cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(f.cmd, &cbi);

    // Transition swapchain image UNDEFINED → COLOR_ATTACHMENT_OPTIMAL.
    VkImageMemoryBarrier2 toColor{};
    toColor.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
    toColor.srcStageMask = VK_PIPELINE_STAGE_2_TOP_OF_PIPE_BIT;
    toColor.srcAccessMask = 0;
    toColor.dstStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
    toColor.dstAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
    toColor.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    toColor.newLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    toColor.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    toColor.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    toColor.image = swapchainImages_[imageIndex];
    toColor.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };

    VkDependencyInfo dep{};
    dep.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
    dep.imageMemoryBarrierCount = 1;
    dep.pImageMemoryBarriers = &toColor;
    vkCmdPipelineBarrier2(f.cmd, &dep);

    // Begin dynamic rendering.
    VkRenderingAttachmentInfo color{};
    color.sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO;
    color.imageView = swapchainViews_[imageIndex];
    color.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    std::memcpy(color.clearValue.color.float32, kClearColor, sizeof(kClearColor));

    VkRenderingInfo ri{};
    ri.sType = VK_STRUCTURE_TYPE_RENDERING_INFO;
    ri.renderArea.offset = { 0, 0 };
    ri.renderArea.extent = swapchainExtent_;
    ri.layerCount = 1;
    ri.colorAttachmentCount = 1;
    ri.pColorAttachments = &color;
    vkCmdBeginRendering(f.cmd, &ri);

    VkViewport viewport{};
    viewport.x = 0.0f;
    viewport.y = 0.0f;
    viewport.width = (float)swapchainExtent_.width;
    viewport.height = (float)swapchainExtent_.height;
    viewport.minDepth = 0.0f;
    viewport.maxDepth = 1.0f;
    vkCmdSetViewport(f.cmd, 0, 1, &viewport);

    VkRect2D scissor{ { 0, 0 }, swapchainExtent_ };
    vkCmdSetScissor(f.cmd, 0, 1, &scissor);

    vkCmdBindPipeline(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    VkDeviceSize vbOffset = 0;
    vkCmdBindVertexBuffers(f.cmd, 0, 1, &vertexBuffer_, &vbOffset);
    vkCmdBindIndexBuffer(f.cmd, indexBuffer_, 0, VK_INDEX_TYPE_UINT32);

    // Fit-to-screen: scale geometry's bounding box to [-1, 1] in clip space
    // while preserving aspect. Geometry is centered around (0,0) so we just
    // pick the smaller axis fit and zero translation.
    PushBlock pc{};
    const float gw = geomMaxX_ - geomMinX_;
    const float gh = geomMaxY_ - geomMinY_;
    const float aspect = (float)swapchainExtent_.width / (float)swapchainExtent_.height;
    // Map [-gw/2, gw/2] → [-s, s] in NDC. Use the smaller of (2/gw, 2/gh)
    // adjusted by aspect so the tiling never crops.
    float s = std::min(2.0f / gw, 2.0f / gh) * 0.95f;
    if (aspect >= 1.0f) {
        pc.scaleX = s / aspect;
        pc.scaleY = s;
    } else {
        pc.scaleX = s;
        pc.scaleY = s * aspect;
    }
    pc.offsetX = 0.0f;
    pc.offsetY = 0.0f;
    std::memcpy(pc.palette[0], kColorL, sizeof(kColorL));
    std::memcpy(pc.palette[1], kColorS, sizeof(kColorS));

    vkCmdPushConstants(f.cmd, pipelineLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(pc), &pc);
    vkCmdDrawIndexed(f.cmd, indexCount_, 1, 0, 0, 0);

    vkCmdEndRendering(f.cmd);

    // Transition COLOR_ATTACHMENT_OPTIMAL → PRESENT_SRC_KHR.
    VkImageMemoryBarrier2 toPresent = toColor;
    toPresent.srcStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
    toPresent.srcAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
    toPresent.dstStageMask = VK_PIPELINE_STAGE_2_BOTTOM_OF_PIPE_BIT;
    toPresent.dstAccessMask = 0;
    toPresent.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    toPresent.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    dep.pImageMemoryBarriers = &toPresent;
    vkCmdPipelineBarrier2(f.cmd, &dep);

    vkEndCommandBuffer(f.cmd);

    // Submit with sync2.
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
    if (pr == VK_ERROR_OUT_OF_DATE_KHR || pr == VK_SUBOPTIMAL_KHR) {
        // Will be picked up by next surfaceChanged.
    } else if (pr != VK_SUCCESS) {
        LOGE("vkQueuePresentKHR -> %d", (int)pr);
    }

    currentFrame_ = (currentFrame_ + 1) % kFramesInFlight;
}

// =============================================================================
// Buffer helpers
// =============================================================================

uint32_t Renderer::findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags props) const {
    for (uint32_t i = 0; i < memProps_.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) &&
            (memProps_.memoryTypes[i].propertyFlags & props) == props) {
            return i;
        }
    }
    return UINT32_MAX;
}

bool Renderer::createBuffer(VkDeviceSize size, VkBufferUsageFlags usage,
                            VkMemoryPropertyFlags props,
                            VkBuffer& buffer, VkDeviceMemory& memory) {
    VkBufferCreateInfo bci{};
    bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bci.size = size;
    bci.usage = usage;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_CHECK(vkCreateBuffer(device_, &bci, nullptr, &buffer));

    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(device_, buffer, &req);

    uint32_t typeIdx = findMemoryType(req.memoryTypeBits, props);
    if (typeIdx == UINT32_MAX) {
        LOGE("no memory type for props=0x%x typeBits=0x%x", props, req.memoryTypeBits);
        return false;
    }

    VkMemoryAllocateInfo mai{};
    mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    mai.allocationSize = req.size;
    mai.memoryTypeIndex = typeIdx;
    VK_CHECK(vkAllocateMemory(device_, &mai, nullptr, &memory));
    VK_CHECK(vkBindBufferMemory(device_, buffer, memory, 0));
    return true;
}

} // namespace penrose
