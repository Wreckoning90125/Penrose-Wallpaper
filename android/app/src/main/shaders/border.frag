#version 460
#extension GL_GOOGLE_include_directive : require

#include "uniforms.glsl"

layout(location = 0) out vec4 outColor;

void main() {
    vec3 c = ubo.borderColor.rgb * ubo.borderColor.a;
    outColor = vec4(c, ubo.borderColor.a);
}
