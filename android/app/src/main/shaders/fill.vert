#version 460

layout(location = 0) in vec2 inPos;
layout(location = 1) in uint inColorIdx;
layout(location = 2) in vec2 inCenter;
layout(location = 3) in float inDepth;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
} pc;

layout(set = 0, binding = 0, std140) uniform Palette {
    vec4 palette[10];
    vec4 borderColor;
    vec4 bgColor;
    uvec4 flags;
    vec4 anim;       // x=time, y=rippleAmount, z=family, w=pageOffset
    vec4 borderGeom;
    vec4 effects;    // x=brightness, y=depthAmount, z=rippleSpeed, w=rippleKind
    vec4 audioBands[2];
    vec4 audioBeat;
} ubo;

layout(location = 0) flat out uint vColorIdx;
layout(location = 1) flat out float vRipple;
layout(location = 2)      out float vDepth;

const float TWO_PI_OVER_5 = 1.2566370614;
const float HALF_PI       = 1.5707963267;
const float TWO_PI        = 6.2831853072;

// Phi at point `p` — sum of plane waves with the same phase as the
// per-tile flat ripple but sampled at any (x, y) in model space. The
// derivative w.r.t. p is the wave gradient, useful for physical
// displacement that stays coherent across shared tile corners.
float wavePhi(vec2 p, float omegaT, float pagePhase, float fam) {
    float phi = 0.0;
    if (fam < 1.5) {
        for (int j = 0; j < 5; ++j) {
            float a = float(j) * TWO_PI_OVER_5;
            vec2  e = vec2(cos(a), sin(a));
            phi += cos(dot(p, e) * 6.0 + omegaT + pagePhase);
        }
        return phi * 0.2;
    } else {
        for (int j = 0; j < 4; ++j) {
            float a = float(j) * HALF_PI;
            vec2  e = vec2(cos(a), sin(a));
            phi += cos(dot(p, e) * 6.0 + omegaT + pagePhase);
        }
        return phi * 0.25;
    }
}

// d/dp of wavePhi, also at point `p`. Returns the local wave gradient — a
// 2D vector that points in the direction of steepest ascent of the wave.
// Used to push vertices around like ripples on a pond.
vec2 waveGradient(vec2 p, float omegaT, float pagePhase, float fam) {
    vec2 grad = vec2(0.0);
    if (fam < 1.5) {
        for (int j = 0; j < 5; ++j) {
            float a = float(j) * TWO_PI_OVER_5;
            vec2  e = vec2(cos(a), sin(a));
            grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
        }
        return grad * 0.2;
    } else {
        for (int j = 0; j < 4; ++j) {
            float a = float(j) * HALF_PI;
            vec2  e = vec2(cos(a), sin(a));
            grad += -sin(dot(p, e) * 6.0 + omegaT + pagePhase) * (6.0 * e);
        }
        return grad * 0.25;
    }
}

void main() {
    vColorIdx = inColorIdx;
    vDepth = inDepth;

    float amp = ubo.anim.y;
    float fam = ubo.anim.z;
    float speed = ubo.effects.z;
    int kind = int(ubo.effects.w + 0.5);

    vec2 displacedPos = inPos;
    float phiCenter = 0.0;

    if (amp > 0.0) {
        float omegaT    = ubo.anim.x * 0.4 * speed;
        float pagePhase = (ubo.anim.w - 0.5) * TWO_PI;

        // Color modulation samples at the tile centroid so all three
        // vertices of a triangle see the same value and the tile shades
        // uniformly. Displacement samples at the vertex's own position so
        // shared corners between neighbouring tiles displace by the same
        // amount and the tiling stays seam-free.
        if (kind != 1) phiCenter = wavePhi(inCenter, omegaT, pagePhase, fam);
        if (kind != 0) {
            vec2 grad = waveGradient(inPos, omegaT, pagePhase, fam);
            // Bounded amplitude — the gradient norm can hit ~6 at peaks, so
            // 0.006 keeps full-amplitude motion at ~3.6% of world span. The
            // ripple-amount slider further attenuates.
            displacedPos += grad * amp * 0.006;
        }
    }

    float x = pc.view0.x * displacedPos.x + pc.view0.y * displacedPos.y + pc.view0.z;
    float y = pc.view1.x * displacedPos.x + pc.view1.y * displacedPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);

    vRipple = phiCenter * amp * 0.5;
}
