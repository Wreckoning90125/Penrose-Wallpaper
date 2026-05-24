#version 460
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 inPos;
layout(location = 1) in float inSide;
layout(location = 2) in vec2 inNormal;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
    vec4 hyp;     // x=hypBoostX, y=hypBoostY, z=hypScale, w=projection (0=E², 1=B²)
} pc;

#include "uniforms.glsl"

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

// Hyperbolic-radius map E² → B², then τ_b boost in B². Identical to the
// inline block in fill.vert; pulled out as a function here because the
// disk-mode border path calls it twice per vertex (the base point and a
// small step along the edge tangent) so the resulting tangent in disk
// space can drive the border-quad extrusion.
vec2 projectHyp(vec2 world) {
    float r = length(world);
    vec2 dir = (r > 1e-6) ? (world / r) : vec2(0.0);
    float d = tanh(r * pc.hyp.z * 0.5);
    vec2 z = dir * d;
    vec2 b  = pc.hyp.xy;
    float bb = dot(b, b);
    float zz = dot(z, z);
    float zb = dot(z, b);
    float denom = bb * zz + 2.0 * zb + 1.0;
    if (abs(denom) < 1e-6) denom = 1e-6;
    vec2 num = (1.0 - bb) * z + (zz + 2.0 * zb + 1.0) * b;
    return num / denom;
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

    vec2 finalPos;
    if (pc.hyp.w > 0.5) {
        // Disk-space border extrusion. The hyperbolic projection's
        // Jacobian is ~sech²(r·s/2): tiny far from the origin (~5e-4
        // for a typical r=5, s=1.5), so world-space extrusion produces
        // sub-pixel borders exactly where the arc curvature matters
        // most. Project the base point, then sample a small step along
        // the edge tangent (perpendicular to inNormal in world) to get
        // the projected tangent. The disk normal is the rotate-90 of
        // that, and the half-width converts world → disk via the
        // central-projection scale s/2 (the derivative of tanh(r·s/2)
        // at r=0). Net effect: borders are visibly constant-thickness
        // across the entire disk, and edge polyline subdivision shows
        // up as a true arc-approximating ribbon.
        vec2 z      = projectHyp(base);
        vec2 tangW  = vec2(inNormal.y, -inNormal.x);
        vec2 zStep  = projectHyp(base + tangW * 1e-3);
        vec2 tangD  = zStep - z;
        float tLen  = length(tangD);
        vec2 nDisk  = (tLen > 1e-9) ? vec2(-tangD.y, tangD.x) / tLen : inNormal;
        float halfWidth = ubo.borderGeom.x * pc.hyp.z * 0.5;
        finalPos = z + nDisk * (inSide * halfWidth);
    } else {
        finalPos = base + inNormal * (inSide * ubo.borderGeom.x);
    }

    float x = pc.view0.x * finalPos.x + pc.view0.y * finalPos.y + pc.view0.z;
    float y = pc.view1.x * finalPos.x + pc.view1.y * finalPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
