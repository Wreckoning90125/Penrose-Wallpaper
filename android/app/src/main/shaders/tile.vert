#version 460

layout(push_constant) uniform PC {
    vec2 scale;       // model -> clip-space scale
    vec2 offset;      // model -> clip-space translation
    vec4 palette[2];  // [0] = L (obtuse) color, [1] = S (acute) color
} pc;

layout(location = 0) in vec2 inPos;
layout(location = 1) in uint inColorIdx;

layout(location = 0) flat out uint vColorIdx;

void main() {
    vec2 ndc = inPos * pc.scale + pc.offset;
    // Vulkan's clip space has Y pointing down. The reference HTML uses
    // standard math (+Y up), so flip Y here to keep the tiling upright.
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
    vColorIdx = inColorIdx;
}
