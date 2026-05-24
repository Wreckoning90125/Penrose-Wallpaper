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

// Analytical disk-space tangent of the radial map z = p · tanh(|p|·s/2)/|p|
// applied to world tangent `tangW` at world point `p`. Decomposes tangW
// into the radial and tangential components in polar basis at p; the
// radial component scales by f'(r) = (s/2)·sech²(r·s/2), the tangential
// by f(r)/r = tanh(r·s/2)/r. Replaces a finite-difference step that
// loses all precision when the jacobian shrinks below ~1e-7 (i.e. just
// past r·s/2 ≈ 4, which a default-zoom gen-6 patch hits routinely).
// Does NOT include the τ_b rotation; for the normal direction the
// missing factor is a uniform conformal rotation that is small for the
// |b|≤0.92 boost range and acceptable for border alignment.
vec2 projTangentRadial(vec2 p, vec2 tangW, float s) {
    float r = length(p);
    if (r < 1e-6) return tangW * (s * 0.5);
    vec2 er = p / r;
    float vr = dot(tangW, er);
    vec2 vt = tangW - vr * er;
    float rs2 = r * s * 0.5;
    float ch = cosh(rs2);
    float fpR = (s * 0.5) / (ch * ch);
    float ftOverR = tanh(rs2) / r;
    return fpR * vr * er + ftOverR * vt;
}

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
        // most. Project the base point, compute the projected tangent
        // analytically (finite-difference would underflow against the
        // disk-space position once r·s/2 ≳ 4), perpendicular = disk
        // normal, and extrude in disk space at width = world halfwidth
        // × hypScale/2 (the central scale-factor s/2 that converts
        // world units to disk units near the origin). Result: borders
        // are visibly constant-thickness across the entire disk, so
        // edge polyline subdivision reads as a true arc-approximating
        // ribbon instead of vanishing.
        vec2 z      = projectHyp(base);
        vec2 tangW  = vec2(inNormal.y, -inNormal.x);
        vec2 tangD  = projTangentRadial(base, tangW, pc.hyp.z);
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
