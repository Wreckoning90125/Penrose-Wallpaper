#version 460
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2  inPos;
layout(location = 1) in vec2  inMiter;       // signed corner extrusion direction (world)
layout(location = 2) in float inMiterScale;  // halfWidth multiplier at this corner

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
    vec4 hyp;     // x=hypBoostX, y=hypBoostY, z=hypScale, w=projection (0=E², 1=B²)
} pc;

#include "uniforms.glsl"
#include "hyperbolic.glsl"

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

    float scaledHalf = ubo.borderGeom.x * inMiterScale;

    vec2 finalPos;
    if (pc.hyp.w > 0.5) {
        // Disk-space border extrusion. Per-corner mitered direction in
        // world space → push through the same projection Jacobian as
        // the edge tangent: radial-derivative (projTangentRadial) then
        // τ_b conformal rotation (boostTangent — −2·arg(1+b̄z)). The
        // projection is conformal, so the world-space bisector angle
        // is preserved exactly under the map, i.e. the disk-space
        // miter direction = normalise(J(P) · inMiter). The disk-space
        // width target is `halfWidth × hypScale/2` near the origin
        // (where the radial Jacobian f'(0) = s/2) which keeps borders
        // visibly constant-thickness even where the Jacobian falls to
        // ~sech²(r·s/2) ≪ 1 near the boundary. miterScale carries the
        // 1/|cos(θ/2)| length compensation so the joint closes flush
        // in disk space too — angle-preserving projection means the
        // same compensation works in both spaces.
        vec2 zRadial = (length(base) > 1e-6) ? base / length(base) * tanh(length(base) * pc.hyp.z * 0.5) : vec2(0.0);
        vec2 z       = projectHyp(base, pc.hyp.xy, pc.hyp.z);
        vec2 mDiskR  = projTangentRadial(base, inMiter, pc.hyp.z);
        vec2 mDisk   = boostTangent(zRadial, pc.hyp.xy, mDiskR);
        float mLen   = length(mDisk);
        vec2 mDir;
        if (mLen > 1e-9) {
            mDir = mDisk / mLen;
        } else {
            // Degenerate projection at the disk origin with a radial
            // miter — fall back to the unprojected world miter; it's
            // already on the correct world side. Visually identical
            // since at the origin the Jacobian is the identity scaled
            // by s/2 and orientation is preserved.
            mDir = inMiter;
        }
        finalPos = z + mDir * (scaledHalf * pc.hyp.z * 0.5);
    } else {
        // Euclidean: extrude along the per-corner mitered direction.
        // (mx, my) is already signed for this vertex's world side, so
        // we just add it scaled by halfWidth · miterScale. miterScale =
        // 1 / |cos(θ/2)| for interior angle θ — extends the outside
        // corner just enough to close the gap and trims the inside
        // corner cleanly. The CPU pre-clamps miterScale to kMiterLimit
        // so a near-acute joint can't fire a spike.
        finalPos = base + inMiter * scaledHalf;
    }

    float x = pc.view0.x * finalPos.x + pc.view0.y * finalPos.y + pc.view0.z;
    float y = pc.view1.x * finalPos.x + pc.view1.y * finalPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
