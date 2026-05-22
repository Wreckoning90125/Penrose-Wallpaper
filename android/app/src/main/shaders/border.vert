#version 460

layout(location = 0) in vec2 inPos;
layout(location = 1) in float inSide;
layout(location = 2) in vec2 inNormal;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
} pc;

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

const float TWO_PI = 6.2831853072;

// Same field as fill.vert::waveGradient, sampled here so the border quads
// track the displaced fill geometry exactly. Both shaders sample at the edge
// endpoint (not the inset/outset corner) so the border ribbon stays pinned to
// the fill it outlines. `sym` is the family's rotational fold count (anim.z);
// sym < 1 is the isotropic radial case (no preferred axis, e.g. pinwheel).
vec2 waveGradient(vec2 p, float omegaT, float pagePhase, float symF) {
    int sym = int(symF + 0.5);
    if (sym < 1) {
        float r = length(p);
        if (r < 1e-4) return vec2(0.0);
        return -sin(r * 6.0 + omegaT + pagePhase) * 6.0 * (p / r);
    }
    vec2 grad = vec2(0.0);
    for (int j = 0; j < sym; ++j) {
        float a = float(j) * (TWO_PI / float(sym));
        vec2  e = vec2(cos(a), sin(a));
        grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
    }
    return grad / float(sym);
}

void main() {
    vec2 base = inPos;
    float amp = ubo.anim.y;
    int kind = int(ubo.effects.w + 0.5);
    if (amp > 0.0 && kind != 0) {
        float speed = ubo.effects.z;
        float omegaT    = ubo.anim.x * 0.4 * speed;
        float pagePhase = (ubo.anim.w - 0.5) * TWO_PI;
        float waveSym   = ubo.anim.z;
        base += waveGradient(base, omegaT, pagePhase, waveSym) * amp * 0.006;
    }
    vec2 world = base + inNormal * (inSide * ubo.borderGeom.x);
    float x = pc.view0.x * world.x + pc.view0.y * world.y + pc.view0.z;
    float y = pc.view1.x * world.x + pc.view1.y * world.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
