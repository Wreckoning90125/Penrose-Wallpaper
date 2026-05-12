#version 460

layout(push_constant) uniform PC {
    vec2 scale;
    vec2 offset;
    vec4 palette[2];
} pc;

layout(location = 0) flat in uint vColorIdx;
layout(location = 0) out vec4 outColor;

void main() {
    // Clamp to the palette size in case future tile types leak through.
    uint idx = clamp(vColorIdx, 0u, 1u);
    outColor = pc.palette[idx];
}
