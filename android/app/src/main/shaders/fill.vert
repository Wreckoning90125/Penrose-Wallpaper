#version 460
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 inPos;
layout(location = 1) in uint inColorIdx;
layout(location = 2) in vec2 inCenter;
layout(location = 3) in vec2 inBulge;
layout(location = 4) in vec3 inBary;
layout(location = 5) in vec4 inTileMat;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
    vec4 hyp;     // x=hypBoostX, y=hypBoostY, z=hypScale, w=projection (0=E², 1=B²)
} pc;

#include "uniforms.glsl"

layout(location = 0) flat out uint vColorIdx;
layout(location = 1) flat out float vRipple;
layout(location = 2) flat out vec2 vBulgeGrad;
layout(location = 3)      out vec3 vBary;
layout(location = 4)      out vec2 vWaveGrad;
layout(location = 5) flat out vec4 vTileMat;

const float TWO_PI = 6.2831853072;

// Phi at point `p` — a sum of `sym` plane waves at equal angular spacing,
// matching the per-tile flat ripple but sampled at any (x, y) in model
// space. `sym` is the family's rotational fold count (anim.z): 5 for the
// Penrose families, 4 for the chair, 8/12/14 for the de Bruijn rhomb
// families. sym < 1 is the isotropic radial case — a tiling with no
// preferred axis, e.g. the pinwheel.
float wavePhi(vec2 p, float omegaT, float pagePhase, float symF) {
    int sym = int(symF + 0.5);
    if (sym < 1) {
        return cos(length(p) * 6.0 + omegaT + pagePhase);
    }
    float phi = 0.0;
    for (int j = 0; j < sym; ++j) {
        float a = float(j) * (TWO_PI / float(sym));
        vec2  e = vec2(cos(a), sin(a));
        phi += cos(dot(p, e) * 6.0 + omegaT + pagePhase);
    }
    return phi / float(sym);
}

// d/dp of wavePhi, at point `p` — the local wave gradient, a 2D vector that
// points along steepest ascent. Used to push vertices around like ripples on
// a pond; shared tile corners move together so the tiling stays seam-free.
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
    vColorIdx = inColorIdx;
    vBulgeGrad = inBulge;
    vBary = inBary;
    vTileMat = inTileMat;

    float amp = ubo.anim.y;
    float waveSym = ubo.anim.z;
    float speed = ubo.effects.z;
    int kind = int(ubo.effects.w + 0.5);

    vec2 displacedPos = inPos;
    float phiCenter = 0.0;
    vWaveGrad = vec2(0.0);

    if (amp > 0.0) {
        float omegaT    = ubo.anim.x * 0.4 * speed;
        float pagePhase = (ubo.anim.w - 0.5) * TWO_PI;

        // Color modulation samples at the tile centroid so all three
        // vertices of a triangle see the same value and the tile shades
        // uniformly. Displacement samples at the vertex's own position so
        // shared corners between neighbouring tiles displace by the same
        // amount and the tiling stays seam-free.
        if (kind != 1) phiCenter = wavePhi(inCenter, omegaT, pagePhase, waveSym);
        if (kind != 0) {
            vec2 grad = waveGradient(inPos, omegaT, pagePhase, waveSym);
            // Bounded amplitude — the gradient norm can hit ~6 at peaks, so
            // 0.006 keeps full-amplitude motion at ~3.6% of world span. The
            // ripple-amount slider further attenuates.
            displacedPos += grad * amp * 0.006;
            // Same gradient, handed to the fragment shader as the wave
            // field's analytic slope — there it bends the shading normal
            // so the ripple catches the light instead of only modulating
            // brightness. Amplitude-scaled so a zero slider means flat.
            vWaveGrad = grad * amp;
        }
    }

    // Hyperbolic projection (Poincaré disk): when pc.hyp.w >= 0.5 the
    // world point is first mapped through the radial homeomorphism
    // E² → B² for which hyperbolic distance from the origin equals
    // Euclidean distance from the origin (x ↦ x̂ · tanh(|x|·scale/2)),
    // then the hyperbolic translation τ_b is applied in B² so the
    // disk re-centres on b. The result is a point of the unit disk;
    // the view matrix then maps disk → clip in the usual way. When
    // hyp.w < 0.5 (Euclidean mode) the projection block is a no-op.
    // See docs/hyperbolic/projection-design.md and Ratcliffe Eq. 4.5.5.
    vec2 world = displacedPos;
    if (pc.hyp.w > 0.5) {
        float r = length(world);
        vec2 dir = (r > 1e-6) ? (world / r) : vec2(0.0);
        // Hyperbolic-radius map; squish by scale so a moderate-size
        // patch reaches a moderate fraction of the disk radius.
        float d = tanh(r * pc.hyp.z * 0.5);
        vec2 z = dir * d;

        // τ_b(z) = ((1-|b|²)·z + (|z|²+2·z·b+1)·b) / (|b|²·|z|² + 2·z·b + 1)
        // Real-vector form of Ratcliffe Eq. 4.5.5; identity when b = 0.
        vec2 b  = pc.hyp.xy;
        float bb = dot(b, b);
        float zz = dot(z, z);
        float zb = dot(z, b);
        float denom = bb * zz + 2.0 * zb + 1.0;
        if (abs(denom) < 1e-6) denom = 1e-6;
        vec2 num = (1.0 - bb) * z + (zz + 2.0 * zb + 1.0) * b;
        world = num / denom;
    }

    float x = pc.view0.x * world.x + pc.view0.y * world.y + pc.view0.z;
    float y = pc.view1.x * world.x + pc.view1.y * world.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);

    vRipple = phiCenter * amp * 0.5;
}
