// Renderer Vulkan plumbing: instance + device + swapchain + descriptors +
// pipelines + buffer helpers.
//
// Sequenced loosely from "earliest" to "latest" in the surface lifecycle:
//   initInstance              -- once at Renderer construction
//   createSurface             -- once per ANativeWindow
//   initDeviceForSurface      -- once per surface (device, queue, cmd pool)
//   createDescriptorObjects   -- once per device (palette UBO + descriptors)
//   initPipeline              -- once per device (shaders + pipeline layout)
//   createSwapchain           -- once per surface size
//   buildPipelines            -- once per swapchain format
//   createPerFrameResources   -- frames-in-flight semaphores + fences + cmds
//   destroy* counterparts at the bottom in the same order.

#include "renderer/renderer.h"

#include "log.h"
#include "renderer/render_state.h"

#include <android/asset_manager.h>
#include <android/native_window.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

namespace penrose {

namespace {

// Preferred swapchain (format, colorSpace) tuples, in order of preference.
// The renderer picks the first match the surface advertises. Wide-gamut P3
// wins; sRGB hardware-encoded fallback when only sRGB shows up; bare UNORM
// last because we'd have to encode in software.
struct SwapchainPref {
    VkFormat        format;
    VkColorSpaceKHR colorSpace;
    bool            wideGamutP3;
    bool            linearOutput;  // true when HW does sRGB encode on store
};

constexpr SwapchainPref kSwapchainPrefs[] = {
    { VK_FORMAT_A2B10G10R10_UNORM_PACK32, VK_COLOR_SPACE_DISPLAY_P3_NONLINEAR_EXT, true,  false },
    { VK_FORMAT_R8G8B8A8_SRGB,            VK_COLOR_SPACE_SRGB_NONLINEAR_KHR,       false, true  },
    { VK_FORMAT_B8G8R8A8_SRGB,            VK_COLOR_SPACE_SRGB_NONLINEAR_KHR,       false, true  },
    { VK_FORMAT_R8G8B8A8_UNORM,           VK_COLOR_SPACE_SRGB_NONLINEAR_KHR,       false, false },
    { VK_FORMAT_B8G8R8A8_UNORM,           VK_COLOR_SPACE_SRGB_NONLINEAR_KHR,       false, false },
};

} // namespace

// -----------------------------------------------------------------------------
// Instance / device / surface
// -----------------------------------------------------------------------------

bool Renderer::initInstance() {
    VkApplicationInfo app{};
    app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app.pApplicationName = "Penrose";
    app.applicationVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    app.pEngineName = "Penrose";
    app.engineVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    // NDK 29's vulkan_core.h predates Vulkan 1.4; everything we use
    // (dynamicRendering, sync2) was promoted to 1.3. Bump when NDK 30+
    // lands with current Khronos headers.
    app.apiVersion = VK_API_VERSION_1_3;

    // VK_EXT_swapchain_colorspace unlocks DISPLAY_P3_NONLINEAR_EXT (and
    // the rest of the wide-gamut colorspace enums) in the surface format
    // list. Without it we'd only ever see SRGB_NONLINEAR_KHR even on a
    // P3 panel — required.
    const char* kInstanceExts[] = {
        VK_KHR_SURFACE_EXTENSION_NAME,
        VK_KHR_ANDROID_SURFACE_EXTENSION_NAME,
        VK_EXT_SWAPCHAIN_COLOR_SPACE_EXTENSION_NAME,
    };

    VkInstanceCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    ci.pApplicationInfo = &app;
    ci.enabledExtensionCount = sizeof(kInstanceExts) / sizeof(kInstanceExts[0]);
    ci.ppEnabledExtensionNames = kInstanceExts;

    // Khronos validation layers — debug builds only. NDEBUG is the
    // CMake-defined token that's set for Release / RelWithDebInfo and
    // unset for Debug, so this whole block compiles out of release APKs.
    // The validation layer .so isn't bundled by default; package it
    // by placing libVkLayer_khronos_validation.so under
    //     android/app/src/debug/jniLibs/<abi>/
    // (download from https://github.com/KhronosGroup/Vulkan-ValidationLayers
    //  releases, or copy from $ANDROID_NDK_HOME/sources/third_party/vulkan
    //  if present). At runtime we enumerate available layers and only
    // enable it if the loader actually finds the .so — so missing the
    // file is a warning, not a build failure.
#ifndef NDEBUG
    const char* kValidationLayer = "VK_LAYER_KHRONOS_validation";
    bool enableValidation = false;
    {
        uint32_t layerCount = 0;
        vkEnumerateInstanceLayerProperties(&layerCount, nullptr);
        std::vector<VkLayerProperties> available(layerCount);
        if (layerCount > 0) {
            vkEnumerateInstanceLayerProperties(&layerCount, available.data());
        }
        for (const VkLayerProperties& p : available) {
            if (std::strcmp(p.layerName, kValidationLayer) == 0) {
                enableValidation = true;
                break;
            }
        }
    }
    if (enableValidation) {
        ci.enabledLayerCount   = 1;
        ci.ppEnabledLayerNames = &kValidationLayer;
        LOGI("Vulkan validation layer enabled: %s", kValidationLayer);
    } else {
        LOGI("Vulkan validation layer not available — drop "
             "libVkLayer_khronos_validation.so into src/debug/jniLibs/<abi>/ "
             "to enable spec-conformance checking.");
    }
#endif

    VK_CHECK(vkCreateInstance(&ci, nullptr, &instance_));
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

    // Feature chain. dynamicRendering + sync2 are the two 1.3 features we
    // rely on; no wideLines because borders are triangle-expanded in the
    // vertex shader.
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

// -----------------------------------------------------------------------------
// Descriptors (palette UBO at set 0, binding 0)
// -----------------------------------------------------------------------------

bool Renderer::createDescriptorObjects() {
    paletteUboSize_ = sizeof(PaletteUbo);

    if (!createBuffer(paletteUboSize_, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                      VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      paletteUbo_, paletteUboMem_)) return false;
    VK_CHECK(vkMapMemory(device_, paletteUboMem_, 0, paletteUboSize_, 0, &paletteUboMapped_));

    VkDescriptorSetLayoutBinding b{};
    b.binding = 0;
    b.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    b.descriptorCount = 1;
    b.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutCreateInfo dsl{};
    dsl.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dsl.bindingCount = 1;
    dsl.pBindings = &b;
    VK_CHECK(vkCreateDescriptorSetLayout(device_, &dsl, nullptr, &descSetLayout_));

    VkDescriptorPoolSize ps{ VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1 };
    VkDescriptorPoolCreateInfo dpc{};
    dpc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    dpc.maxSets = 1;
    dpc.poolSizeCount = 1;
    dpc.pPoolSizes = &ps;
    VK_CHECK(vkCreateDescriptorPool(device_, &dpc, nullptr, &descPool_));

    VkDescriptorSetAllocateInfo dsa{};
    dsa.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    dsa.descriptorPool = descPool_;
    dsa.descriptorSetCount = 1;
    dsa.pSetLayouts = &descSetLayout_;
    VK_CHECK(vkAllocateDescriptorSets(device_, &dsa, &descSet_));

    VkDescriptorBufferInfo dbi{ paletteUbo_, 0, paletteUboSize_ };
    VkWriteDescriptorSet wds{};
    wds.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    wds.dstSet = descSet_;
    wds.dstBinding = 0;
    wds.descriptorCount = 1;
    wds.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    wds.pBufferInfo = &dbi;
    vkUpdateDescriptorSets(device_, 1, &wds, 0, nullptr);
    return true;
}

void Renderer::destroyDescriptorObjects() {
    if (paletteUboMapped_) {
        vkUnmapMemory(device_, paletteUboMem_);
        paletteUboMapped_ = nullptr;
    }
    if (paletteUbo_)     { vkDestroyBuffer(device_, paletteUbo_, nullptr);                  paletteUbo_ = VK_NULL_HANDLE; }
    if (paletteUboMem_)  { vkFreeMemory(device_, paletteUboMem_, nullptr);                  paletteUboMem_ = VK_NULL_HANDLE; }
    if (descPool_)       { vkDestroyDescriptorPool(device_, descPool_, nullptr);            descPool_ = VK_NULL_HANDLE; }
    if (descSetLayout_)  { vkDestroyDescriptorSetLayout(device_, descSetLayout_, nullptr);  descSetLayout_ = VK_NULL_HANDLE; }
    descSet_ = VK_NULL_HANDLE;
}

// -----------------------------------------------------------------------------
// Shaders + pipeline layout
// -----------------------------------------------------------------------------

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
    if (!loadShader("shaders/fill.vert.spv",   fillVert_))   return false;
    if (!loadShader("shaders/fill.frag.spv",   fillFrag_))   return false;
    if (!loadShader("shaders/border.vert.spv", borderVert_)) return false;
    if (!loadShader("shaders/border.frag.spv", borderFrag_)) return false;

    // Push constants are read only by the vertex shaders; the fragment
    // shaders pull all per-frame state from the palette UBO. Restrict
    // the range to VERTEX_BIT so validation doesn't flag a mismatch.
    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_VERTEX_BIT;
    pcRange.offset = 0;
    pcRange.size = sizeof(PushBlock);

    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &descSetLayout_;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcRange;
    VK_CHECK(vkCreatePipelineLayout(device_, &plci, nullptr, &pipelineLayout_));
    return true;
}

void Renderer::destroyPipelines() {
    if (fillPipeline_)   { vkDestroyPipeline(device_, fillPipeline_, nullptr);     fillPipeline_ = VK_NULL_HANDLE; }
    if (borderPipeline_) { vkDestroyPipeline(device_, borderPipeline_, nullptr);   borderPipeline_ = VK_NULL_HANDLE; }
    if (pipelineLayout_) { vkDestroyPipelineLayout(device_, pipelineLayout_, nullptr); pipelineLayout_ = VK_NULL_HANDLE; }
    if (fillVert_)       { vkDestroyShaderModule(device_, fillVert_, nullptr);     fillVert_ = VK_NULL_HANDLE; }
    if (fillFrag_)       { vkDestroyShaderModule(device_, fillFrag_, nullptr);     fillFrag_ = VK_NULL_HANDLE; }
    if (borderVert_)     { vkDestroyShaderModule(device_, borderVert_, nullptr);   borderVert_ = VK_NULL_HANDLE; }
    if (borderFrag_)     { vkDestroyShaderModule(device_, borderFrag_, nullptr);   borderFrag_ = VK_NULL_HANDLE; }
    pipelinesBuilt_ = false;
}

// -----------------------------------------------------------------------------
// Graphics pipelines (fill + border)
// -----------------------------------------------------------------------------

bool Renderer::buildPipelines() {
    if (pipelinesBuilt_) {
        if (fillPipeline_)   { vkDestroyPipeline(device_, fillPipeline_, nullptr);   fillPipeline_ = VK_NULL_HANDLE; }
        if (borderPipeline_) { vkDestroyPipeline(device_, borderPipeline_, nullptr); borderPipeline_ = VK_NULL_HANDLE; }
    }

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    // Premultiplied alpha. Border alpha < 1 composites correctly over fills.
    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_TRUE;
    cba.srcColorBlendFactor = VK_BLEND_FACTOR_ONE;
    cba.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    cba.colorBlendOp = VK_BLEND_OP_ADD;
    cba.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    cba.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    cba.alphaBlendOp = VK_BLEND_OP_ADD;

    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount = 1;

    VkDynamicState dynStates[] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR };
    VkPipelineDynamicStateCreateInfo dyn{};
    dyn.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dyn.dynamicStateCount = 2;
    dyn.pDynamicStates = dynStates;

    VkPipelineRenderingCreateInfo rendering{};
    rendering.sType = VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO;
    rendering.colorAttachmentCount = 1;
    rendering.pColorAttachmentFormats = &swapchainFormat_;

    // ---- Fill pipeline ----------------------------------------------------
    VkPipelineShaderStageCreateInfo fillStages[2]{};
    fillStages[0].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    fillStages[0].stage  = VK_SHADER_STAGE_VERTEX_BIT;
    fillStages[0].module = fillVert_;
    fillStages[0].pName  = "main";
    fillStages[1].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    fillStages[1].stage  = VK_SHADER_STAGE_FRAGMENT_BIT;
    fillStages[1].module = fillFrag_;
    fillStages[1].pName  = "main";

    VkVertexInputBindingDescription fillBinding{};
    fillBinding.binding = 0;
    fillBinding.stride = sizeof(FillVertex);
    fillBinding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription fillAttrs[6]{};
    fillAttrs[0].location = 0; fillAttrs[0].binding = 0;
    fillAttrs[0].format   = VK_FORMAT_R32G32_SFLOAT;
    fillAttrs[0].offset   = offsetof(FillVertex, x);
    fillAttrs[1].location = 1; fillAttrs[1].binding = 0;
    fillAttrs[1].format   = VK_FORMAT_R32_UINT;
    fillAttrs[1].offset   = offsetof(FillVertex, colorIdx);
    fillAttrs[2].location = 2; fillAttrs[2].binding = 0;
    fillAttrs[2].format   = VK_FORMAT_R32G32_SFLOAT;
    fillAttrs[2].offset   = offsetof(FillVertex, cx);
    fillAttrs[3].location = 3; fillAttrs[3].binding = 0;
    fillAttrs[3].format   = VK_FORMAT_R32_SFLOAT;
    fillAttrs[3].offset   = offsetof(FillVertex, depth);
    fillAttrs[4].location = 4; fillAttrs[4].binding = 0;
    fillAttrs[4].format   = VK_FORMAT_R32G32B32_SFLOAT;
    fillAttrs[4].offset   = offsetof(FillVertex, bx);
    fillAttrs[5].location = 5; fillAttrs[5].binding = 0;
    fillAttrs[5].format   = VK_FORMAT_R32G32B32A32_SFLOAT;
    fillAttrs[5].offset   = offsetof(FillVertex, mtype);

    VkPipelineVertexInputStateCreateInfo fillVi{};
    fillVi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    fillVi.vertexBindingDescriptionCount = 1;
    fillVi.pVertexBindingDescriptions = &fillBinding;
    fillVi.vertexAttributeDescriptionCount = 6;
    fillVi.pVertexAttributeDescriptions = fillAttrs;

    VkPipelineInputAssemblyStateCreateInfo triIA{};
    triIA.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    triIA.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkGraphicsPipelineCreateInfo fillGpi{};
    fillGpi.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    fillGpi.pNext = &rendering;
    fillGpi.stageCount = 2;
    fillGpi.pStages = fillStages;
    fillGpi.pVertexInputState = &fillVi;
    fillGpi.pInputAssemblyState = &triIA;
    fillGpi.pViewportState = &vp;
    fillGpi.pRasterizationState = &rs;
    fillGpi.pMultisampleState = &ms;
    fillGpi.pColorBlendState = &cb;
    fillGpi.pDynamicState = &dyn;
    fillGpi.layout = pipelineLayout_;
    fillGpi.renderPass = VK_NULL_HANDLE;
    VK_CHECK(vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &fillGpi, nullptr, &fillPipeline_));

    // ---- Border pipeline --------------------------------------------------
    // Triangle-list quads, not line list — mobile GPUs ship wideLines=FALSE
    // with lineWidthRange=[1,1], so the old line topology couldn't render
    // anything thicker than 1 px regardless of the slider. The border
    // vertex shader expands each unique edge into a quad of `borderGeom.x`
    // half-width.
    VkPipelineShaderStageCreateInfo borderStages[2]{};
    borderStages[0].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    borderStages[0].stage  = VK_SHADER_STAGE_VERTEX_BIT;
    borderStages[0].module = borderVert_;
    borderStages[0].pName  = "main";
    borderStages[1].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    borderStages[1].stage  = VK_SHADER_STAGE_FRAGMENT_BIT;
    borderStages[1].module = borderFrag_;
    borderStages[1].pName  = "main";

    VkVertexInputBindingDescription borderBinding{};
    borderBinding.binding = 0;
    borderBinding.stride = sizeof(BorderVertex);
    borderBinding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription borderAttrs[3]{};
    borderAttrs[0].location = 0; borderAttrs[0].binding = 0;
    borderAttrs[0].format   = VK_FORMAT_R32G32_SFLOAT;
    borderAttrs[0].offset   = offsetof(BorderVertex, x);
    borderAttrs[1].location = 1; borderAttrs[1].binding = 0;
    borderAttrs[1].format   = VK_FORMAT_R32_SFLOAT;
    borderAttrs[1].offset   = offsetof(BorderVertex, side);
    borderAttrs[2].location = 2; borderAttrs[2].binding = 0;
    borderAttrs[2].format   = VK_FORMAT_R32G32_SFLOAT;
    borderAttrs[2].offset   = offsetof(BorderVertex, nx);

    VkPipelineVertexInputStateCreateInfo borderVi{};
    borderVi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    borderVi.vertexBindingDescriptionCount = 1;
    borderVi.pVertexBindingDescriptions = &borderBinding;
    borderVi.vertexAttributeDescriptionCount = 3;
    borderVi.pVertexAttributeDescriptions = borderAttrs;

    VkGraphicsPipelineCreateInfo borderGpi = fillGpi;
    borderGpi.pStages = borderStages;
    borderGpi.pVertexInputState = &borderVi;
    borderGpi.pInputAssemblyState = &triIA;
    VK_CHECK(vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &borderGpi, nullptr, &borderPipeline_));

    pipelinesBuilt_ = true;
    return true;
}

// -----------------------------------------------------------------------------
// Swapchain
// -----------------------------------------------------------------------------

bool Renderer::createSwapchain(int width, int height) {
    VkSurfaceCapabilitiesKHR caps{};
    VK_CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice_, surface_, &caps));

    VkExtent2D extent = caps.currentExtent;
    if (extent.width == UINT32_MAX) {
        extent.width  = std::clamp((uint32_t)width,  caps.minImageExtent.width,  caps.maxImageExtent.width);
        extent.height = std::clamp((uint32_t)height, caps.minImageExtent.height, caps.maxImageExtent.height);
    }
    if (extent.width == 0 || extent.height == 0) return false;

    uint32_t fmtCount = 0;
    VK_CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &fmtCount, nullptr));
    std::vector<VkSurfaceFormatKHR> formats(fmtCount);
    VK_CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &fmtCount, formats.data()));

    VkSurfaceFormatKHR chosen = formats[0];
    wideGamut_ = false;
    cpuLinearOutput_ = false;
    bool matched = false;
    for (const SwapchainPref& pref : kSwapchainPrefs) {
        for (const auto& f : formats) {
            if (f.format == pref.format && f.colorSpace == pref.colorSpace) {
                chosen = f;
                wideGamut_ = pref.wideGamutP3;
                cpuLinearOutput_ = pref.linearOutput;
                matched = true;
                break;
            }
        }
        if (matched) break;
    }
    swapchainFormat_ = chosen.format;
    swapchainColorSpace_ = chosen.colorSpace;
    swapchainExtent_ = extent;
    LOGI("swapchain: format=%d colorspace=%d wideGamut=%d cpuLinear=%d",
         (int)swapchainFormat_, (int)swapchainColorSpace_,
         wideGamut_ ? 1 : 0, cpuLinearOutput_ ? 1 : 0);

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
    sci.presentMode = VK_PRESENT_MODE_FIFO_KHR;
    sci.clipped = VK_TRUE;
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
    return true;
}

void Renderer::destroySwapchain() {
    for (VkImageView v : swapchainViews_) if (v) vkDestroyImageView(device_, v, nullptr);
    swapchainViews_.clear();
    swapchainImages_.clear();
    if (swapchain_) { vkDestroySwapchainKHR(device_, swapchain_, nullptr); swapchain_ = VK_NULL_HANDLE; }
    swapchainExtent_ = { 0, 0 };
}

// -----------------------------------------------------------------------------
// Per-frame command buffers + sync primitives
// -----------------------------------------------------------------------------

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
        for (auto& f : frames_) bufs.push_back(f.cmd);
        vkFreeCommandBuffers(device_, commandPool_, (uint32_t)bufs.size(), bufs.data());
    }
    frames_.clear();
}

// -----------------------------------------------------------------------------
// Buffer / memory helpers
// -----------------------------------------------------------------------------

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
