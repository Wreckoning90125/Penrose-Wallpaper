#version 460
#extension GL_GOOGLE_include_directive : require

#include "uniforms.glsl"

layout(location = 0) flat in uint vColorIdx;
layout(location = 1) flat in float vRipple;
layout(location = 2) flat in vec2 vBulgeGrad;
layout(location = 3)      in vec3 vBary;
layout(location = 4)      in vec2 vWaveGrad;
layout(location = 5) flat in vec4 vTileMat;
layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

// Fill-tile material. Each tile is a beveled physical chip: a flat plateau
// ringed by a chamfer. The shading normal is reconstructed per fragment from
// three analytic height fields — bevel, parallax bulge, quasicrystal ripple —
// and drives a principled BRDF: anisotropic GGX with a thin-film-iridescent
// Fresnel, Lambert diffuse, a Charlie sheen lobe, and a clearcoat lobe, lit
// by a key + fill + ambient rig. Every parameter is a UBO value (the bases
// in MaterialParams); roughness and metalness are also keyed to the tiling's
// own fields.

// The lobe parameters shadeLight() needs, unpacked once from the UBO.
struct Material {
    vec3  sheenColor;
    float sheen, sheenRough;
    float clearcoat, coatRough;
    float anisotropy, iridescence;
};

float ggxDistribution(float NdotH, float a2) {
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-7);
}

float smithVisibility(float NdotV, float NdotL, float k) {
    float gv = NdotV / max(NdotV * (1.0 - k) + k, 1e-7);
    float gl = NdotL / max(NdotL * (1.0 - k) + k, 1e-7);
    return gv * gl;
}

// Estevez-Kulla "Charlie" sheen distribution — a velvet lobe that peaks at
// grazing angles (sin²h → 1), unlike GGX which peaks head-on.
float charlieDistribution(float roughness, float NdotH) {
    float invA  = 1.0 / max(roughness * roughness, 1e-4);
    float sin2h = max(1.0 - NdotH * NdotH, 1e-7);
    return (2.0 + invA) * pow(sin2h, invA * 0.5) / (2.0 * PI);
}

// Ashikhmin visibility — the lightweight sheen visibility term Filament
// pairs with the Charlie distribution.
float ashikhminVisibility(float NdotL, float NdotV) {
    return clamp(1.0 / max(4.0 * (NdotL + NdotV - NdotL * NdotV), 1e-7),
                 0.0, 1.0);
}

// --- Thin-film iridescence (Belcour & Barla 2017), ported from the glTF
// Sample Viewer. evalIridescence returns a colour-shifting reflectance that
// stands in for the plain Fresnel when a thin film coats the surface. -------
const mat3 XYZ_TO_REC709 = mat3(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252);

float sq(float x) { return x * x; }
vec3  sq(vec3 x)  { return x * x; }

float fSchlick(float f0, float vh) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - vh, 0.0, 1.0), 5.0);
}
vec3 fSchlick(vec3 f0, float vh) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - vh, 0.0, 1.0), 5.0);
}

vec3 fresnel0ToIor(vec3 f0) {
    vec3 s = sqrt(clamp(f0, 0.0, 0.9999));
    return (1.0 + s) / (1.0 - s);
}
float iorToFresnel0(float t, float i) { return sq((t - i) / (t + i)); }
vec3  iorToFresnel0(vec3 t, float i)  { return sq((t - vec3(i)) / (t + vec3(i))); }

vec3 evalSensitivity(float opd, vec3 shift) {
    float phase = 2.0 * PI * opd * 1.0e-9;
    vec3 val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
    vec3 pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
    vec3 vr  = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
    vec3 xyz = val * sqrt(2.0 * PI * vr) * cos(pos * phase + shift) * exp(-sq(phase) * vr);
    xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09)
           * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * sq(phase));
    xyz /= 1.0685e-7;
    return XYZ_TO_REC709 * xyz;
}

vec3 evalIridescence(float outerIor, float filmIor, float cosTheta1,
                     float thickness, vec3 baseF0) {
    float iridIor = mix(outerIor, filmIor, smoothstep(0.0, 0.03, thickness));
    float sinTheta2Sq = sq(outerIor / iridIor) * (1.0 - sq(cosTheta1));
    float cosTheta2Sq = 1.0 - sinTheta2Sq;
    if (cosTheta2Sq < 0.0) return vec3(1.0);
    float cosTheta2 = sqrt(cosTheta2Sq);

    float r0   = iorToFresnel0(iridIor, outerIor);
    float r12  = fSchlick(r0, cosTheta1);
    float t121 = 1.0 - r12;
    float phi12 = (iridIor < outerIor) ? PI : 0.0;
    float phi21 = PI - phi12;

    vec3 baseIor = fresnel0ToIor(clamp(baseF0, 0.0, 0.9999));
    vec3 r1  = iorToFresnel0(baseIor, iridIor);
    vec3 r23 = fSchlick(r1, cosTheta2);
    vec3 phi23 = vec3(0.0);
    if (baseIor.x < iridIor) phi23.x = PI;
    if (baseIor.y < iridIor) phi23.y = PI;
    if (baseIor.z < iridIor) phi23.z = PI;

    float opd = 2.0 * iridIor * thickness * cosTheta2;
    vec3  phi = vec3(phi21) + phi23;

    vec3 r123  = clamp(r12 * r23, 1e-5, 0.9999);
    vec3 r123s = sqrt(r123);
    vec3 rs    = sq(t121) * r23 / (vec3(1.0) - r123);

    vec3 result = vec3(r12) + rs;
    vec3 cm = rs - vec3(t121);
    for (int m = 1; m <= 2; ++m) {
        cm *= r123s;
        vec3 sm = 2.0 * evalSensitivity(float(m) * opd, float(m) * phi);
        result += cm * sm;
    }
    return max(result, vec3(0.0));
}

// --- Anisotropic GGX (glTF Sample Viewer). at == ab collapses both back to
// the isotropic GGX distribution and height-correlated Smith visibility. ----
float dGGXaniso(float NdotH, float TdotH, float BdotH, float at, float ab) {
    float a2 = at * ab;
    vec3  f  = vec3(ab * TdotH, at * BdotH, a2 * NdotH);
    // dot(f,f) is the squared length of H expressed in the T/B/N basis,
    // weighted by the roughnesses — provably positive, so it is divided
    // straight. A max() guard here would floor the denominator on glossy
    // surfaces and flatten the specular peak.
    float w2 = a2 / dot(f, f);
    return a2 * w2 * w2 / PI;
}

float vGGXaniso(float NdotL, float NdotV, float TdotV, float BdotV,
                float TdotL, float BdotL, float at, float ab) {
    float gv = NdotL * length(vec3(at * TdotV, ab * BdotV, NdotV));
    float gl = NdotV * length(vec3(at * TdotL, ab * BdotL, NdotL));
    return clamp(0.5 / max(gv + gl, 1e-7), 0.0, 1.0);
}

// Full principled response of one directional light: anisotropic GGX
// specular with the iridescent Fresnel, Lambert diffuse, the Charlie sheen
// lobe, and the clearcoat lobe with its energy-conserving base attenuation.
// Returns the white-light response; the caller scales by colour × intensity.
vec3 shadeLight(vec3 N, vec3 L, vec3 V, vec3 T, vec3 B,
                vec3 albedo, vec3 F0, vec3 iridF, float a, float metalness,
                Material mat) {
    float NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) return vec3(0.0);
    vec3  H = normalize(L + V);
    float NdotV = max(dot(N, V), 1e-4);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = clamp(dot(V, H), 0.0, 1.0);

    // Iridescent Fresnel blended over the plain Schlick one.
    vec3 F = mix(fSchlick(F0, VdotH), iridF, mat.iridescence);

    // Anisotropic base specular along the tile's tangent frame.
    float at = max(a * (1.0 + mat.anisotropy), 1e-4);
    float ab = max(a * (1.0 - mat.anisotropy), 1e-4);
    float D   = dGGXaniso(NdotH, dot(T, H), dot(B, H), at, ab);
    float Vis = vGGXaniso(NdotL, NdotV, dot(T, V), dot(B, V),
                          dot(T, L), dot(B, L), at, ab);
    vec3  spec = (D * Vis) * F * NdotL;

    vec3 diffuse = albedo * (1.0 - metalness) * NdotL;

    // Charlie velvet sheen.
    float sheenD = charlieDistribution(mat.sheenRough, NdotH);
    float sheenV = ashikhminVisibility(NdotL, NdotV);
    vec3  sheen  = mat.sheenColor * (mat.sheen * sheenD * sheenV * NdotL);

    // Clearcoat lobe; its Fresnel attenuates the base layers below it.
    float coatA    = mat.coatRough * mat.coatRough;
    float coatD    = ggxDistribution(NdotH, coatA * coatA);
    float coatG    = smithVisibility(NdotV, NdotL, coatA * 0.5);
    float coatF    = 0.04 + 0.96 * pow(1.0 - VdotH, 5.0);
    float coatLobe = mat.clearcoat * coatD * coatG * coatF
                   / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;
    float baseAtten = 1.0 - mat.clearcoat * coatF;

    return (diffuse + spec + sheen) * baseAtten + vec3(coatLobe);
}

void main() {
    uint idx = vColorIdx;
    if (idx >= 16u) idx = 15u;
    vec4 c = ubo.palette[idx];

    // Unpack the material + lighting parameters from the UBO.
    float bevelWidth    = ubo.matNormal.x;
    float bevelStrength = ubo.matNormal.y;
    float waveHeight    = ubo.matNormal.z;
    float bulgeTilt     = ubo.matNormal.w;
    float roughBase     = ubo.matSurface.x;
    float roughMod      = ubo.matSurface.y;
    float metalBase     = ubo.matSurface.z;
    float metalMod      = ubo.matSurface.w;
    float emissiveGain  = ubo.matLobeA.x;
    float iridIOR       = ubo.matLobeB.w;
    Material mat;
    mat.sheenColor  = ubo.matSheenCol.rgb;
    mat.sheen       = ubo.matLobeA.y;
    mat.sheenRough  = ubo.matLobeA.z;
    mat.clearcoat   = ubo.matLobeA.w;
    mat.coatRough   = ubo.matLobeB.x;
    mat.anisotropy  = ubo.matLobeB.y;
    mat.iridescence = ubo.matLobeB.z;

    // Albedo: palette RGB with master brightness only. The bulge and ripple
    // are carried by the shading normal (the ripple also by the emissive).
    vec3 albedo = clamp(c.rgb * ubo.effects.x, 0.0, 1.0);

    // Edge distance: 0 on every tile boundary edge, rising toward the tile
    // interior. Drives both the bevel normal and the seam roughness.
    float edgeDist = min(min(vBary.x, vBary.y), vBary.z);

    // Shading normal. `slope` accumulates -dH/d(x,y) for a height field that
    // sums the ripple, the parallax bulge, and the bevel: the ripple and
    // bulge apply everywhere; the bevel tilts the chamfer away from the
    // inward edge-distance gradient, fading from edge to plateau.
    vec2 slope = -vWaveGrad * waveHeight
               - vBulgeGrad * (ubo.effects.y * bulgeTilt);
    vec2  g    = vec2(dFdx(edgeDist), dFdy(edgeDist));
    float gLen = length(g);
    if (gLen > 1e-7) {
        vec2  inward = g / gLen;
        float e      = clamp(edgeDist / bevelWidth, 0.0, 1.0);
        slope += -inward * (bevelStrength * cos(e * (PI * 0.5)));
    }
    vec3 N = normalize(vec3(slope, 1.0));

    // Physical channels keyed to the tiling's own fields: roughness rises in
    // the seam valleys (a worn-edge read), metalness comes from the tile type.
    float seam      = 1.0 - smoothstep(0.0, bevelWidth, edgeDist);
    float roughness = clamp(roughBase + roughMod * seam, 0.045, 1.0);
    float metalness = clamp(metalBase + metalMod * vTileMat.x, 0.0, 1.0);
    float a  = roughness * roughness;
    vec3  F0 = mix(vec3(0.04), albedo, metalness);

    // View is straight on. Iridescence depends only on the view angle, so its
    // colour-shifting Fresnel is evaluated once and shared by both lights.
    // Thickness sweeps with the tile's radius and the ripple — a drifting
    // oil-slick.
    vec3  V = vec3(0.0, 0.0, 1.0);
    float filmThick = mix(ubo.matIrid.x, ubo.matIrid.y,
                          0.5 + 0.5 * sin(vTileMat.w * 6.0 + vRipple * 3.0));
    vec3  iridF = evalIridescence(1.0, iridIOR, max(N.z, 1e-4), filmThick, F0);

    // Anisotropy tangent frame: the tile orientation re-orthogonalised against
    // the shading normal. N always has a positive z, so it is never parallel
    // to the in-plane orientation and the subtraction never collapses.
    vec3 oriented = vec3(vTileMat.yz, 0.0);
    vec3 T = normalize(oriented - N * dot(N, oriented));
    vec3 B = cross(N, T);

    vec3 key  = shadeLight(N, normalize(ubo.keyLight.xyz),  V, T, B,
                           albedo, F0, iridF, a, metalness, mat)
              * ubo.keyColor.rgb * ubo.keyLight.w;
    vec3 fill = shadeLight(N, normalize(ubo.fillLight.xyz), V, T, B,
                           albedo, F0, iridF, a, metalness, mat)
              * ubo.fillColor.rgb * ubo.fillLight.w;

    // Ambient fills the unlit side; ripple crests add an emissive glow.
    vec3 ambient  = albedo * ubo.ambient.rgb * ubo.ambient.w;
    vec3 emissive = albedo * emissiveGain * max(vRipple, 0.0);

    outColor = vec4(clamp(ambient + key + fill + emissive, 0.0, 1.0), c.a);
}
