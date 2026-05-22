#version 460

layout(set = 0, binding = 0, std140) uniform Palette {
    vec4 palette[16];
    vec4 borderColor;
    vec4 bgColor;
    uvec4 flags;
    vec4 anim;
    vec4 borderGeom;
    vec4 effects;
    vec4 audioBands[2];
    vec4 audioBeat;
} ubo;

layout(location = 0) out vec4 outColor;

void main() {
    vec3 c = ubo.borderColor.rgb * ubo.borderColor.a;
    outColor = vec4(c, ubo.borderColor.a);
}
