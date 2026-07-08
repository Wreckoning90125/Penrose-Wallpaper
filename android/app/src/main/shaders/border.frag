#version 460
#extension GL_GOOGLE_include_directive : require

#include "uniforms.glsl"

layout(location = 0) flat in float vRole;
layout(location = 0) out vec4 outColor;

void main() {
    vec4 color = ubo.borderColor;
    if (vRole > 2.5) {
        color = ubo.sourceMarkC;
    } else if (vRole > 1.5) {
        color = ubo.sourceMarkB;
    } else if (vRole > 0.5) {
        color = ubo.sourceMarkA;
    }
    vec3 c = color.rgb * color.a;
    outColor = vec4(c, color.a);
}
