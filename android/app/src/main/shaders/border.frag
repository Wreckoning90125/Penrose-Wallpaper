#version 460

layout(set = 0, binding = 0, std140) uniform Palette {
    vec4 palette[10];
    vec4 borderColor;
    vec4 bgColor;
    uvec4 flags;
} ubo;

layout(location = 0) out vec4 outColor;

void main() {
    // Premultiplied alpha for the standard SRC_ALPHA / ONE_MINUS_SRC_ALPHA
    // blend mode the pipeline is set up with.
    vec3 c = ubo.borderColor.rgb * ubo.borderColor.a;
    outColor = vec4(c, ubo.borderColor.a);
}
