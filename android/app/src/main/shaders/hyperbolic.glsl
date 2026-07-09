// Shared Poincaré-disk projection helpers — radial homeomorphism
// E² → B² followed by the τ_b hyperbolic translation in B². fill.vert and
// border.vert both use projectHyp(); the tangent helpers remain available to
// shaders that need to transport a model-space tangent through the same disk
// map. Pulled in via #include with GL_GOOGLE_include_directive, which must be
// enabled at the top of each shader that pulls this file in.
//
// Projection params (b, s) come in as function args rather than as
// references to a push-constant block, so this file stays decoupled
// from the calling stage's PC layout.
//
// Refs: Ratcliffe §4.5 (conformal ball model + τ_b Eq. 4.5.5);
//       docs/hyperbolic/projection-design.md (full design).

#ifndef PENROSE_HYPERBOLIC_GLSL
#define PENROSE_HYPERBOLIC_GLSL

// Radial map z = x̂ · tanh(|x|·s/2). Reduces to the identity derivative
// scale s/2 at the origin and maps world-space radius into the unit disk.
vec2 radialProjectHyp(vec2 world, float s) {
    float r = length(world);
    vec2 dir = (r > 1e-6) ? (world / r) : vec2(0.0);
    float d = tanh(r * s * 0.5);
    return dir * d;
}

// Hyperbolic translation τ_b on a point already in B².
vec2 boostHypDisk(vec2 z, vec2 b) {
    float bb = dot(b, b);
    float zz = dot(z, z);
    float zb = dot(z, b);
    float denom = bb * zz + 2.0 * zb + 1.0;
    if (abs(denom) < 1e-6) denom = 1e-6;
    vec2 num = (1.0 - bb) * z + (zz + 2.0 * zb + 1.0) * b;
    return num / denom;
}

// Radial map z = x̂ · tanh(|x|·s/2) then τ_b in B². Reduces to the
// identity at s = 0; reduces to the radial map at b = 0.
vec2 projectHyp(vec2 world, vec2 b, float s) {
    return boostHypDisk(radialProjectHyp(world, s), b);
}

// Analytical disk-space tangent of the radial map applied to world
// tangent `tangW` at world point `p`. Decomposes tangW into polar
// basis at p; the radial component scales by f'(r)=(s/2)·sech²(r·s/2),
// the tangential by f(r)/r=tanh(r·s/2)/r. Finite-difference would
// underflow against the float position once r·s/2 ≳ 4, which a
// default-zoom gen-6 patch hits routinely.
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

// τ_b applied to a tangent vector at z (the radial-map output). τ_b is
// conformal: dτ_b/dz = (1-|b|²) / (1+b̄z)². For the unit-normal
// direction only the rotation matters; arg(1/(1+b̄z)²) = -2·arg(q)
// with q = 1+b̄z. In real-vector form q = (1+b·z, -b×z) and the
// rotation factor (unit complex) is q̄²/|q|² = (qx²-qy², -2·qx·qy)/|q|².
vec2 boostTangent(vec2 z, vec2 b, vec2 tangD) {
    float qx = 1.0 + b.x * z.x + b.y * z.y;
    float qy = b.x * z.y - b.y * z.x;
    float qm = qx * qx + qy * qy;
    if (qm < 1e-12) return tangD;
    float cRe = (qx * qx - qy * qy) / qm;
    float cIm = -2.0 * qx * qy / qm;
    return vec2(cRe * tangD.x - cIm * tangD.y,
                cRe * tangD.y + cIm * tangD.x);
}

#endif // PENROSE_HYPERBOLIC_GLSL
