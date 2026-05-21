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

layout(location = 0) flat in uint vColorIdx;
layout(location = 1) flat in float vRipple;
layout(location = 2)      in float vDepth;
layout(location = 0) out vec4 outColor;

void main() {
    uint idx = vColorIdx;
    if (idx >= 10u) idx = 9u;
    vec4 c = ubo.palette[idx];

    // Master brightness, per-tile parallax gradient, and quasicrystal
    // ripple compose as multiplicative modifiers on the palette RGB.
    // Depth interpolates smoothly across each triangle from `vDepth`
    // values planted at the corners by buildGeometry — fat Penrose
    // rhombi brighten at the apex, thin rhombi darken there.
    float brightness = ubo.effects.x;
    float depthMod   = 1.0 + ubo.effects.y * vDepth;
    float rippleMod  = 1.0 + vRipple;
    vec3 rgb = clamp(c.rgb * brightness * depthMod * rippleMod, 0.0, 1.0);
    outColor = vec4(rgb, c.a);
}
