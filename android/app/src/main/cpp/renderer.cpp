#include "renderer.h"

#include "color.h"
#include "log.h"
#include "penrose.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace penrose {

// =============================================================================
// Vertex layout, push constants, palette UBO
// =============================================================================
namespace {

struct FillVertex {
    float x, y;
    uint32_t colorIdx;  // index into palette
};

struct BorderVertex {
    float x, y;
};

// Push constants. The fill and border pipelines share this layout — the
// `isBorder` flag selects which color to emit in the fragment shader.
// Layout (std430-aligned via vec4 padding):
//   vec4 viewRow0   // (cosR*s/w, -sinR*s/w, panX/w + 0.5, _padding)
//   vec4 viewRow1   // (sinR*s/h,  cosR*s/h, panY/h + 0.5, _padding)
// total = 32 bytes
struct PushBlock {
    float view0x, view0y, view0z, _pad0;
    float view1x, view1y, view1z, _pad1;
};
static_assert(sizeof(PushBlock) == 32, "PushBlock layout");

// Palette UBO. std140-compatible: each vec4 is 16-aligned. Layout:
//   vec4 palette[kMaxColors]   // 10 colors, fill mode
//   vec4 borderColor           // last 4 floats are color RGBA
//   vec4 bgColor               // RGBA, alpha unused (cleared opaque)
//   uvec4 flags                // x = isBorder switch read by frag shader
struct PaletteUbo {
    float palette[kMaxColors][4];
    float borderColor[4];
    float bgColor[4];
    uint32_t flags[4]; // x = isBorder (set per draw via descriptor update is overkill — handled in frag shader via push const instead)
};

constexpr VkFormat kPreferredFormats[] = {
    VK_FORMAT_R8G8B8A8_SRGB,
    VK_FORMAT_B8G8R8A8_SRGB,
    VK_FORMAT_R8G8B8A8_UNORM,
    VK_FORMAT_B8G8R8A8_UNORM,
};

// =============================================================================
// Geometry assembly — builds fill triangles and de-duplicated border edges.
// =============================================================================

struct EdgeRec {
    float p1x, p1y, p2x, p2y;
    uint8_t t1, t2;
    uint8_t k1, k2;
    bool secondSet;
};

struct EdgeKey {
    int32_t mx, my;
    bool operator==(const EdgeKey& o) const { return mx == o.mx && my == o.my; }
};
struct EdgeKeyHash {
    size_t operator()(const EdgeKey& k) const noexcept {
        // Cantor pairing on signed → unsigned bits; good enough for ~64k tiles.
        const uint64_t a = static_cast<uint32_t>(k.mx);
        const uint64_t b = static_cast<uint32_t>(k.my);
        return std::hash<uint64_t>{}(a * 0x9E3779B97F4A7C15ULL + b);
    }
};

// hideSeam rule per family — same logic as web/penrose.js FAMILIES[*].hideSeam.
inline bool hideSeam(Family fam, uint8_t k1, uint8_t k2) {
    switch (fam) {
        case Family::P3:    return k1 == (uint8_t)EdgeKind::Base && k2 == (uint8_t)EdgeKind::Base;
        case Family::P2:    return k1 == (uint8_t)EdgeKind::Leg  && k2 == (uint8_t)EdgeKind::Leg;
        case Family::Chair: return false;
    }
    return false;
}

} // anonymous namespace

// =============================================================================
// Lifecycle
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
// Instance / device
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

    // Pick MSAA sample count. 4× is essentially free on tile GPUs and is what
    // makes the borders look crisp at 1px widths.
    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(physicalDevice_, &props);
    const VkSampleCountFlags supported =
        props.limits.framebufferColorSampleCounts;
    if (supported & VK_SAMPLE_COUNT_4_BIT) msaaSamples_ = VK_SAMPLE_COUNT_4_BIT;
    else if (supported & VK_SAMPLE_COUNT_2_BIT) msaaSamples_ = VK_SAMPLE_COUNT_2_BIT;
    else msaaSamples_ = VK_SAMPLE_COUNT_1_BIT;
    LOGI("MSAA samples: %d", (int)msaaSamples_);

    // Feature chain: Features2 -> Vulkan14Features -> Vulkan13Features.
    // We currently only need 1.3-promoted features (dynamicRendering, sync2),
    // but the 1.4 struct is chained in empty so any future feature flip
    // (pushDescriptor, dynamicRenderingLocalRead, maintenance5/6, hostImageCopy,
    // indexTypeUint8, etc.) is a one-line edit instead of a chain refactor.
    VkPhysicalDeviceVulkan14Features v14{};
    v14.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_4_FEATURES;

    VkPhysicalDeviceVulkan13Features v13{};
    v13.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES;
    v13.dynamicRendering = VK_TRUE;
    v13.synchronization2 = VK_TRUE;
    v13.pNext = &v14;

    VkPhysicalDeviceFeatures2 feats{};
    feats.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2;
    feats.pNext = &v13;
    // Wide lines aren't universally supported; we don't rely on them and clamp
    // to 1.0 in the pipeline state.
    feats.features.wideLines = VK_FALSE;

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
// Descriptor objects
// =============================================================================

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
    if (paletteUbo_) { vkDestroyBuffer(device_, paletteUbo_, nullptr); paletteUbo_ = VK_NULL_HANDLE; }
    if (paletteUboMem_) { vkFreeMemory(device_, paletteUboMem_, nullptr); paletteUboMem_ = VK_NULL_HANDLE; }
    if (descPool_) { vkDestroyDescriptorPool(device_, descPool_, nullptr); descPool_ = VK_NULL_HANDLE; }
    if (descSetLayout_) { vkDestroyDescriptorSetLayout(device_, descSetLayout_, nullptr); descSetLayout_ = VK_NULL_HANDLE; }
    descSet_ = VK_NULL_HANDLE;
}

void Renderer::destroyPipelines() {
    if (fillPipeline_)   { vkDestroyPipeline(device_, fillPipeline_, nullptr);   fillPipeline_ = VK_NULL_HANDLE; }
    if (borderPipeline_) { vkDestroyPipeline(device_, borderPipeline_, nullptr); borderPipeline_ = VK_NULL_HANDLE; }
    if (pipelineLayout_) { vkDestroyPipelineLayout(device_, pipelineLayout_, nullptr); pipelineLayout_ = VK_NULL_HANDLE; }
    if (fillVert_)       { vkDestroyShaderModule(device_, fillVert_, nullptr); fillVert_ = VK_NULL_HANDLE; }
    if (fillFrag_)       { vkDestroyShaderModule(device_, fillFrag_, nullptr); fillFrag_ = VK_NULL_HANDLE; }
    if (borderVert_)     { vkDestroyShaderModule(device_, borderVert_, nullptr); borderVert_ = VK_NULL_HANDLE; }
    if (borderFrag_)     { vkDestroyShaderModule(device_, borderFrag_, nullptr); borderFrag_ = VK_NULL_HANDLE; }
    pipelinesBuilt_ = false;
}

// =============================================================================
// Shaders + pipeline construction
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
    if (!loadShader("shaders/fill.vert.spv", fillVert_)) return false;
    if (!loadShader("shaders/fill.frag.spv", fillFrag_)) return false;
    if (!loadShader("shaders/border.vert.spv", borderVert_)) return false;
    if (!loadShader("shaders/border.frag.spv", borderFrag_)) return false;

    // Push constants are only read by the vertex shaders; the fragment shaders
    // pull all per-frame state from the palette UBO. Limit the range to
    // VERTEX_BIT so validation doesn't flag a stage mismatch.
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

bool Renderer::buildPipelines() {
    if (pipelinesBuilt_) {
        if (fillPipeline_)   { vkDestroyPipeline(device_, fillPipeline_, nullptr);   fillPipeline_ = VK_NULL_HANDLE; }
        if (borderPipeline_) { vkDestroyPipeline(device_, borderPipeline_, nullptr); borderPipeline_ = VK_NULL_HANDLE; }
    }

    // Common rasterization/MSAA/colorblend
    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = msaaSamples_;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    // Premultiplied alpha blending so border alpha < 1 looks right against fills.
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
    fillStages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    fillStages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    fillStages[0].module = fillVert_;
    fillStages[0].pName = "main";
    fillStages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    fillStages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    fillStages[1].module = fillFrag_;
    fillStages[1].pName = "main";

    VkVertexInputBindingDescription fillBinding{};
    fillBinding.binding = 0;
    fillBinding.stride = sizeof(FillVertex);
    fillBinding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription fillAttrs[2]{};
    fillAttrs[0].location = 0; fillAttrs[0].binding = 0;
    fillAttrs[0].format = VK_FORMAT_R32G32_SFLOAT;
    fillAttrs[0].offset = offsetof(FillVertex, x);
    fillAttrs[1].location = 1; fillAttrs[1].binding = 0;
    fillAttrs[1].format = VK_FORMAT_R32_UINT;
    fillAttrs[1].offset = offsetof(FillVertex, colorIdx);

    VkPipelineVertexInputStateCreateInfo fillVi{};
    fillVi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    fillVi.vertexBindingDescriptionCount = 1;
    fillVi.pVertexBindingDescriptions = &fillBinding;
    fillVi.vertexAttributeDescriptionCount = 2;
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
    VkPipelineShaderStageCreateInfo borderStages[2]{};
    borderStages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    borderStages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    borderStages[0].module = borderVert_;
    borderStages[0].pName = "main";
    borderStages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    borderStages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    borderStages[1].module = borderFrag_;
    borderStages[1].pName = "main";

    VkVertexInputBindingDescription borderBinding{};
    borderBinding.binding = 0;
    borderBinding.stride = sizeof(BorderVertex);
    borderBinding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription borderAttr{};
    borderAttr.location = 0; borderAttr.binding = 0;
    borderAttr.format = VK_FORMAT_R32G32_SFLOAT;
    borderAttr.offset = 0;

    VkPipelineVertexInputStateCreateInfo borderVi{};
    borderVi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    borderVi.vertexBindingDescriptionCount = 1;
    borderVi.pVertexBindingDescriptions = &borderBinding;
    borderVi.vertexAttributeDescriptionCount = 1;
    borderVi.pVertexAttributeDescriptions = &borderAttr;

    VkPipelineInputAssemblyStateCreateInfo lineIA{};
    lineIA.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    lineIA.topology = VK_PRIMITIVE_TOPOLOGY_LINE_LIST;

    VkGraphicsPipelineCreateInfo borderGpi = fillGpi;
    borderGpi.pStages = borderStages;
    borderGpi.pVertexInputState = &borderVi;
    borderGpi.pInputAssemblyState = &lineIA;
    VK_CHECK(vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &borderGpi, nullptr, &borderPipeline_));

    pipelinesBuilt_ = true;
    return true;
}

// =============================================================================
// Geometry
// =============================================================================

bool Renderer::buildGeometry() {
    // Generate tiles per current settings.
    auto tiles = generate(settings_.family, settings_.seedIdx, settings_.generation);
    if (tiles.empty()) { LOGE("buildGeometry: empty tile set"); return false; }

    // Classify for color buckets.
    Classification cls = classify(tiles, settings_.family, settings_.colorMode, settings_.colorCount);

    // -------- Fill vertices ---------------------------------------------------
    // Penrose tris -> 3 verts. Chair L -> fan from vert 0 = 4 triangles.
    std::vector<FillVertex> fills;
    fills.reserve(tiles.size() * 6);

    float minX =  1e9f, minY =  1e9f;
    float maxX = -1e9f, maxY = -1e9f;

    for (size_t i = 0; i < tiles.size(); ++i) {
        const Tile& t = tiles[i];
        const uint32_t paletteIdx = static_cast<uint32_t>(
            bucketToPaletteIdx(cls.bucket[i], cls.numBuckets, settings_.colorCount));
        if (t.vcount == 3) {
            for (int v = 0; v < 3; ++v) {
                fills.push_back(FillVertex{ t.x[v], t.y[v], paletteIdx });
                minX = std::min(minX, t.x[v]); maxX = std::max(maxX, t.x[v]);
                minY = std::min(minY, t.y[v]); maxY = std::max(maxY, t.y[v]);
            }
        } else {
            // 6-vert L-tromino fan from v0.
            for (int v = 1; v + 1 < t.vcount; ++v) {
                fills.push_back(FillVertex{ t.x[0],     t.y[0],     paletteIdx });
                fills.push_back(FillVertex{ t.x[v],     t.y[v],     paletteIdx });
                fills.push_back(FillVertex{ t.x[v + 1], t.y[v + 1], paletteIdx });
            }
            for (int v = 0; v < 6; ++v) {
                minX = std::min(minX, t.x[v]); maxX = std::max(maxX, t.x[v]);
                minY = std::min(minY, t.y[v]); maxY = std::max(maxY, t.y[v]);
            }
        }
    }
    fillVertexCount_ = static_cast<uint32_t>(fills.size());
    geomMinX_ = minX; geomMaxX_ = maxX;
    geomMinY_ = minY; geomMaxY_ = maxY;

    // -------- Border vertices (dedup edges, honour hideSeam) -----------------
    std::vector<BorderVertex> borders;
    if (settings_.borderOn) {
        std::vector<Edge> edges;
        edges.reserve(tiles.size() * (settings_.family == Family::Chair ? 6 : 3));
        for (const Tile& t : tiles) {
            if (t.vcount == 3) edgesPenrose(t, edges);
            else               edgesChair(t, edges);
        }

        std::unordered_map<EdgeKey, EdgeRec, EdgeKeyHash> edgeMap;
        edgeMap.reserve(edges.size() / 2 + 16);
        constexpr float kKeyScale = 1.0e5f;
        for (const Edge& e : edges) {
            const float mx = (e.p1x + e.p2x) * 0.5f;
            const float my = (e.p1y + e.p2y) * 0.5f;
            EdgeKey key{ static_cast<int32_t>(std::lround(mx * kKeyScale)),
                         static_cast<int32_t>(std::lround(my * kKeyScale)) };
            auto it = edgeMap.find(key);
            if (it == edgeMap.end()) {
                EdgeRec r{ e.p1x, e.p1y, e.p2x, e.p2y, e.tileType, 0, e.kind, 0, false };
                edgeMap.emplace(key, r);
            } else {
                it->second.t2 = e.tileType;
                it->second.k2 = e.kind;
                it->second.secondSet = true;
            }
        }
        borders.reserve(edgeMap.size() * 2);
        for (const auto& kv : edgeMap) {
            const EdgeRec& r = kv.second;
            if (r.secondSet && r.t1 == r.t2 && hideSeam(settings_.family, r.k1, r.k2)) continue;
            borders.push_back({ r.p1x, r.p1y });
            borders.push_back({ r.p2x, r.p2y });
        }
    }
    borderVertexCount_ = static_cast<uint32_t>(borders.size());

    // -------- Upload to GPU --------------------------------------------------
    // Recreate buffers if size changed. For simplicity, always free+reallocate;
    // geometry rebuild is cold-path (settings change), not per-frame.
    auto reallocBuffer = [&](VkBuffer& buf, VkDeviceMemory& mem, VkDeviceSize size) {
        if (buf) { vkDestroyBuffer(device_, buf, nullptr); buf = VK_NULL_HANDLE; }
        if (mem) { vkFreeMemory(device_, mem, nullptr); mem = VK_NULL_HANDLE; }
        if (size == 0) return true;
        return createBuffer(size, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                            buf, mem);
    };

    const VkDeviceSize fillSize = sizeof(FillVertex) * fills.size();
    const VkDeviceSize borderSize = sizeof(BorderVertex) * borders.size();
    if (!reallocBuffer(fillVertBuf_, fillVertMem_, fillSize)) return false;
    if (!reallocBuffer(borderVertBuf_, borderVertMem_, borderSize)) return false;

    if (fillSize > 0) {
        void* mapped = nullptr;
        VK_CHECK(vkMapMemory(device_, fillVertMem_, 0, fillSize, 0, &mapped));
        std::memcpy(mapped, fills.data(), fillSize);
        vkUnmapMemory(device_, fillVertMem_);
    }
    if (borderSize > 0) {
        void* mapped = nullptr;
        VK_CHECK(vkMapMemory(device_, borderVertMem_, 0, borderSize, 0, &mapped));
        std::memcpy(mapped, borders.data(), borderSize);
        vkUnmapMemory(device_, borderVertMem_);
    }

    LOGI("geom: %zu tiles, %u fillVerts, %u borderVerts, bounds [%.3f,%.3f]-[%.3f,%.3f]",
         tiles.size(), fillVertexCount_, borderVertexCount_,
         geomMinX_, geomMinY_, geomMaxX_, geomMaxY_);
    return true;
}

void Renderer::updatePaletteUbo() {
    if (!paletteUboMapped_) return;
    PresetResult ps = buildPreset(settings_.preset, settings_.colorCount);
    PaletteUbo ubo{};
    for (int i = 0; i < kMaxColors; ++i) {
        SrgbRGBA c = oklchToSrgb(ps.colors[i]);
        ubo.palette[i][0] = c.r;
        ubo.palette[i][1] = c.g;
        ubo.palette[i][2] = c.b;
        ubo.palette[i][3] = c.a;
    }
    SrgbRGBA bc = oklchToSrgb(settings_.borderColor, settings_.borderAlpha);
    ubo.borderColor[0] = bc.r; ubo.borderColor[1] = bc.g; ubo.borderColor[2] = bc.b; ubo.borderColor[3] = bc.a;

    Oklch bgOk = (settings_.bgMode == BackgroundMode::Match) ? ps.colors[0] : settings_.bgColor;
    SrgbRGBA bg = oklchToSrgb(bgOk);
    ubo.bgColor[0] = bg.r; ubo.bgColor[1] = bg.g; ubo.bgColor[2] = bg.b; ubo.bgColor[3] = 1.0f;
    ubo.flags[0] = 0;
    std::memcpy(paletteUboMapped_, &ubo, sizeof(ubo));
}

// =============================================================================
// Public lifecycle entry points
// =============================================================================

bool Renderer::onSurfaceCreated(ANativeWindow* window) {
    if (!window || instance_ == VK_NULL_HANDLE) return false;
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
    if (!createMsaaTargets()) return false;
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
    vkDeviceWaitIdle(device_);
    destroyPerFrameResources();
    destroyMsaaTargets();
    destroySwapchain();
    if (!createSwapchain(width, height)) return false;
    if (!createMsaaTargets()) return false;
    if (!buildPipelines()) return false;
    if (!createPerFrameResources()) return false;
    swapchainReady_ = true;
    return true;
}

void Renderer::onSurfaceDestroyed() {
    if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
    destroyPerFrameResources();
    destroyMsaaTargets();
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

void Renderer::onVisibilityChanged(bool visible) { visible_ = visible; }

void Renderer::onSettingsChanged(const Settings& s) {
    const bool needGeom = geometryChanged(settings_, s) || classificationChanged(settings_, s)
                       || s.borderOn != settings_.borderOn;
    settings_ = s;
    if (deviceReady_ && swapchainReady_) {
        vkDeviceWaitIdle(device_);
        if (needGeom) buildGeometry();
        updatePaletteUbo();
    } else {
        settingsDirty_ = true;
    }
}

// =============================================================================
// Touch state
// =============================================================================

void Renderer::touchBegin(float, float) { /* state is updated incrementally via touchMove */ }
void Renderer::touchMove(float x, float y, float prevX, float prevY) {
    view_.panX += (x - prevX);
    view_.panY += (y - prevY);
}
void Renderer::touchPinch(float, float, float scale, float rotDelta) {
    view_.zoom = std::clamp(view_.zoom * scale, 0.25f, 8.0f);
    view_.rotation += rotDelta;
}
void Renderer::touchEnd() {}
void Renderer::resetView() { view_ = ViewState{}; }

// =============================================================================
// Swapchain / MSAA target
// =============================================================================

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
    for (VkFormat pref : kPreferredFormats) {
        bool found = false;
        for (const auto& f : formats) {
            if (f.format == pref && f.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
                chosen = f; found = true; break;
            }
        }
        if (found) break;
    }
    swapchainFormat_ = chosen.format;
    swapchainExtent_ = extent;

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

bool Renderer::createMsaaTargets() {
    if (msaaSamples_ == VK_SAMPLE_COUNT_1_BIT) return true;

    VkImageCreateInfo ici{};
    ici.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ici.imageType = VK_IMAGE_TYPE_2D;
    ici.format = swapchainFormat_;
    ici.extent = { swapchainExtent_.width, swapchainExtent_.height, 1 };
    ici.mipLevels = 1;
    ici.arrayLayers = 1;
    ici.samples = msaaSamples_;
    ici.tiling = VK_IMAGE_TILING_OPTIMAL;
    ici.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT;
    ici.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    ici.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VK_CHECK(vkCreateImage(device_, &ici, nullptr, &msaaImage_));

    VkMemoryRequirements req{};
    vkGetImageMemoryRequirements(device_, msaaImage_, &req);
    uint32_t typeIdx = findMemoryType(req.memoryTypeBits,
                                      VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT);
    if (typeIdx == UINT32_MAX) {
        typeIdx = findMemoryType(req.memoryTypeBits,
                                 VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    }
    VkMemoryAllocateInfo mai{};
    mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    mai.allocationSize = req.size;
    mai.memoryTypeIndex = typeIdx;
    VK_CHECK(vkAllocateMemory(device_, &mai, nullptr, &msaaMemory_));
    VK_CHECK(vkBindImageMemory(device_, msaaImage_, msaaMemory_, 0));

    VkImageViewCreateInfo vci{};
    vci.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vci.image = msaaImage_;
    vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vci.format = swapchainFormat_;
    vci.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    VK_CHECK(vkCreateImageView(device_, &vci, nullptr, &msaaView_));
    return true;
}

void Renderer::destroyMsaaTargets() {
    if (msaaView_)   { vkDestroyImageView(device_, msaaView_, nullptr); msaaView_ = VK_NULL_HANDLE; }
    if (msaaImage_)  { vkDestroyImage(device_, msaaImage_, nullptr); msaaImage_ = VK_NULL_HANDLE; }
    if (msaaMemory_) { vkFreeMemory(device_, msaaMemory_, nullptr); msaaMemory_ = VK_NULL_HANDLE; }
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
        for (auto& f : frames_) bufs.push_back(f.cmd);
        vkFreeCommandBuffers(device_, commandPool_, (uint32_t)bufs.size(), bufs.data());
    }
    frames_.clear();
}

// =============================================================================
// Frame
// =============================================================================

void Renderer::drawFrame() {
    if (!deviceReady_ || !swapchainReady_) return;
    if (!visible_) return;

    if (settingsDirty_) {
        vkDeviceWaitIdle(device_);
        buildGeometry();
        updatePaletteUbo();
        settingsDirty_ = false;
    }

    FrameSync& f = frames_[currentFrame_];
    vkWaitForFences(device_, 1, &f.inFlight, VK_TRUE, UINT64_MAX);

    uint32_t imageIndex = 0;
    VkResult acq = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX,
                                         f.imageAvailable, VK_NULL_HANDLE, &imageIndex);
    if (acq == VK_ERROR_OUT_OF_DATE_KHR) return;
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

    // Layout transitions: swapchain image + MSAA image (if any) go to
    // COLOR_ATTACHMENT_OPTIMAL. Both started as UNDEFINED, which is fine
    // because the loadOp is CLEAR — we don't need the previous contents.
    VkImageMemoryBarrier2 barriers[2]{};
    auto fillBarrier = [&](VkImageMemoryBarrier2& b, VkImage img) {
        b.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
        b.srcStageMask = VK_PIPELINE_STAGE_2_TOP_OF_PIPE_BIT;
        b.dstStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
        b.dstAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
        b.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        b.newLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        b.image = img;
        b.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    };
    fillBarrier(barriers[0], swapchainImages_[imageIndex]);
    uint32_t barrierCount = 1;
    if (msaaSamples_ != VK_SAMPLE_COUNT_1_BIT) {
        fillBarrier(barriers[1], msaaImage_);
        barrierCount = 2;
    }

    VkDependencyInfo dep{};
    dep.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
    dep.imageMemoryBarrierCount = barrierCount;
    dep.pImageMemoryBarriers = barriers;
    vkCmdPipelineBarrier2(f.cmd, &dep);

    // Clear from the palette's bgColor (uploaded to UBO; mirrored here from
    // the same OKLCH conversion so the load-op clear matches what the shader
    // sees in the UBO).
    PresetResult ps = buildPreset(settings_.preset, settings_.colorCount);
    Oklch bgOk = (settings_.bgMode == BackgroundMode::Match) ? ps.colors[0] : settings_.bgColor;
    SrgbRGBA bg = oklchToSrgb(bgOk);

    VkRenderingAttachmentInfo color{};
    color.sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO;
    if (msaaSamples_ != VK_SAMPLE_COUNT_1_BIT) {
        color.imageView = msaaView_;
        color.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        color.resolveMode = VK_RESOLVE_MODE_AVERAGE_BIT;
        color.resolveImageView = swapchainViews_[imageIndex];
        color.resolveImageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    } else {
        color.imageView = swapchainViews_[imageIndex];
        color.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    }
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

    // Compute push-constant view matrix. Map model-space [-bbox..+bbox] into
    // clip space [-1, +1] preserving aspect and applying pan/zoom/rotation.
    const float gw = std::max(geomMaxX_ - geomMinX_, 1e-3f);
    const float gh = std::max(geomMaxY_ - geomMinY_, 1e-3f);
    const float surfW = (float)swapchainExtent_.width;
    const float surfH = (float)swapchainExtent_.height;
    const float aspect = surfW / surfH;
    // base scale: fit shorter axis at 95% with aspect-correct stretch.
    float baseScale = std::min(2.0f / gw, 2.0f / gh) * 0.95f;
    float sX = (aspect >= 1.0f ? baseScale / aspect : baseScale) * view_.zoom;
    float sY = (aspect >= 1.0f ? baseScale          : baseScale * aspect) * view_.zoom;
    const float cosR = std::cos(view_.rotation);
    const float sinR = std::sin(view_.rotation);
    // Translation: convert pan in pixels to clip-space offset (-1..+1).
    const float tX = (view_.panX / surfW) * 2.0f;
    const float tY = (view_.panY / surfH) * 2.0f;

    // Affine model→clip. Model space coords are math-convention (y-up) but
    // Vulkan clip-space y points down. We match the HTML reference's behavior:
    // pass model coords through unflipped, which yields a vertically-mirrored
    // image vs. math convention — fine, since the tilings used here are
    // symmetric and the result is visually identical.
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
    if (settings_.borderOn && borderVertexCount_ > 0) {
        vkCmdBindPipeline(f.cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, borderPipeline_);
        VkDeviceSize off = 0;
        vkCmdBindVertexBuffers(f.cmd, 0, 1, &borderVertBuf_, &off);
        vkCmdPushConstants(f.cmd, pipelineLayout_,
                           VK_SHADER_STAGE_VERTEX_BIT,
                           0, sizeof(pc), &pc);
        vkCmdDraw(f.cmd, borderVertexCount_, 1, 0, 0);
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
    if (pr != VK_SUCCESS && pr != VK_ERROR_OUT_OF_DATE_KHR && pr != VK_SUBOPTIMAL_KHR) {
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
