#version 460

// Palette UBO. Mirrors C++ `PaletteUbo` layout.
layout(set = 0, binding = 0, std140) uniform Palette {
    vec4 palette[10];
    vec4 borderColor;
    vec4 bgColor;
    uvec4 flags;
} ubo;

layout(location = 0) flat in uint vColorIdx;
layout(location = 0) out vec4 outColor;

void main() {
    uint idx = vColorIdx;
    if (idx >= 10u) idx = 9u;
    outColor = ubo.palette[idx];
}
