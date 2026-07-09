#version 460
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2  inPos;
layout(location = 1) in vec2  inSourcePos;
layout(location = 2) in float inRole;
layout(location = 0) flat out float vRole;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
    vec4 hyp;     // x=hypBoostX, y=hypBoostY, z=hypScale, w=projection (0=E², 1=B²)
} pc;

#include "uniforms.glsl"
#include "hyperbolic.glsl"

const float TWO_PI = 6.2831853072;

// Same field as fill.vert::waveGradient. Border vertices carry the source-space
// point that corresponds to the emitted geometry vertex, inverse-projected from
// disk space in Poincare mode, so static inset width and animated displacement
// stay in compatible coordinate systems. `sym` is the family's rotational fold
// count (anim.z); sym < 1 is the isotropic radial case (no preferred axis, e.g.
// pinwheel).
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
    vRole = inRole;
    vec2 source = inSourcePos;
    float amp = ubo.anim.y;
    int kind = int(ubo.effects.w + 0.5);
    if (amp > 0.0 && kind != 0) {
        float speed = ubo.effects.z;
        float omegaT    = ubo.anim.x * 0.4 * speed;
        float pagePhase = (ubo.anim.w - 0.5) * TWO_PI;
        float waveSym   = ubo.anim.z;
        source += waveGradient(source, omegaT, pagePhase, waveSym) * amp * 0.006;
    }

    vec2 finalPos;
    if (pc.hyp.w > 0.5) {
        // Border-ring geometry is baked after the static radial projection so
        // width and joins are measured in disk space. The source coordinate
        // carries the same pre-projection wave field as fill.vert.
        finalPos = projectHyp(source, pc.hyp.xy, pc.hyp.z);
    } else {
        finalPos = source;
    }

    float x = pc.view0.x * finalPos.x + pc.view0.y * finalPos.y + pc.view0.z;
    float y = pc.view1.x * finalPos.x + pc.view1.y * finalPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
