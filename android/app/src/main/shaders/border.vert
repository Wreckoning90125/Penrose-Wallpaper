#version 460

layout(location = 0) in vec2 inPos;
layout(location = 1) in float inSide;
layout(location = 2) in vec2 inNormal;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
} pc;

layout(set = 0, binding = 0, std140) uniform Palette {
    vec4 palette[10];
    vec4 borderColor;
    vec4 bgColor;
    uvec4 flags;
    vec4 anim;
    vec4 borderGeom;
    vec4 effects;
    vec4 audioBands[2];
    vec4 audioBeat;
} ubo;

const float TWO_PI_OVER_5 = 1.2566370614;
const float HALF_PI       = 1.5707963267;
const float PI_OVER_6     = 0.5235987756;
const float TWO_PI        = 6.2831853072;

// Same field as fill.vert::waveGradient, sampled here so the border quads
// track the displaced fill geometry exactly. Both shaders sample at the
// edge endpoint (not the inset/outset corner) so the border ribbon stays
// pinned to the fill it outlines.
vec2 waveGradient(vec2 p, float omegaT, float pagePhase, float fam) {
    vec2 grad = vec2(0.0);
    if (fam < 1.5) {            // P3 / P2 — 5-fold
        for (int j = 0; j < 5; ++j) {
            float a = float(j) * TWO_PI_OVER_5;
            vec2  e = vec2(cos(a), sin(a));
            grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
        }
        return grad * 0.2;
    } else if (fam < 2.5) {     // Chair — 4-fold
        for (int j = 0; j < 4; ++j) {
            float a = float(j) * HALF_PI;
            vec2  e = vec2(cos(a), sin(a));
            grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
        }
        return grad * 0.25;
    } else if (fam < 3.5) {     // Dodecagonal — 12-fold
        for (int j = 0; j < 12; ++j) {
            float a = float(j) * PI_OVER_6;
            vec2  e = vec2(cos(a), sin(a));
            grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
        }
        return grad * (1.0 / 12.0);
    } else {                    // Pinwheel — radial wave, no preferred axis
        float r = length(p);
        if (r < 1e-4) return vec2(0.0);
        return -sin(r * 6.0 + omegaT + pagePhase) * 6.0 * (p / r);
    }
}

void main() {
    vec2 base = inPos;
    float amp = ubo.anim.y;
    int kind = int(ubo.effects.w + 0.5);
    if (amp > 0.0 && kind != 0) {
        float speed = ubo.effects.z;
        float omegaT    = ubo.anim.x * 0.4 * speed;
        float pagePhase = (ubo.anim.w - 0.5) * TWO_PI;
        float fam       = ubo.anim.z;
        base += waveGradient(base, omegaT, pagePhase, fam) * amp * 0.006;
    }
    vec2 world = base + inNormal * (inSide * ubo.borderGeom.x);
    float x = pc.view0.x * world.x + pc.view0.y * world.y + pc.view0.z;
    float y = pc.view1.x * world.x + pc.view1.y * world.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
