#version 460

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

layout(location = 0) flat in uint vColorIdx;
layout(location = 1) flat in float vRipple;
layout(location = 2) flat in vec2 vBulgeGrad;
layout(location = 3)      in vec3 vBary;
layout(location = 4)      in vec2 vWaveGrad;
layout(location = 5) flat in vec4 vTileMat;
layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

// --- Material constants ------------------------------------------------------
// Each tile is shaded as a beveled physical chip: a flat-topped plateau
// ringed by a chamfer that catches the key light. The chamfer normal is
// derived analytically from the screen-space gradient of the edge-distance
// field; the ripple field's analytic slope bends it too. Physical channels
// are keyed to the tiling's own fields — roughness to seam distance,
// metalness to tile type — so material variation is the tiling, not a
// painted-on texture. Lighting is a single-key principled BRDF (Lambert +
// GGX) over a flat ambient term; ambient and key are calibrated so a
// non-metal tile plateau reproduces its palette colour at brightness 1.
const float kBevelWidth    = 0.30;   // edge-distance span of the chamfer
const float kBevelStrength = 1.05;   // tan of the chamfer's peak slope
const float kWaveHeight    = 0.12;   // ripple slope → shading-normal tilt
const float kBulgeTilt     = 0.70;   // parallax-bulge normal tilt at depth 1
const float kRoughBase     = 0.50;   // plateau roughness
const float kRoughMod      = 0.35;   // extra roughness in the seam valleys
const float kMetalBase     = 0.0;
const float kMetalMod      = 0.40;   // metalness gained across tile types
const float kEmissive      = 0.6;    // ripple-crest glow gain
const float kAmbient       = 0.32;
const float kKeyIntensity  = 0.85;
const vec3  kLightColor    = vec3(1.0, 0.99, 0.97);
// Screen-space key direction. The Vulkan framebuffer's y axis points down,
// so a negative y component places the light above the wallpaper; the
// positive z component tilts it toward the viewer.
const vec3  kLightDir      = vec3(-0.35, -0.45, 0.80);
// Sheen — a retroreflective velvet lobe, brightest at grazing angles.
const float kSheen         = 0.35;
const float kSheenRough    = 0.30;
const vec3  kSheenColor    = vec3(1.0, 0.97, 0.92);
// Clearcoat — a thin glossy layer over the base material.
const float kClearcoat     = 0.45;
const float kCoatRough     = 0.10;
// Anisotropy — stretches the base specular lobe along each tile's
// orientation. 0 is isotropic.
const float kAnisotropy    = 0.40;
// Thin-film iridescence — Belcour-Barla. Film thickness (nanometres) sweeps
// with the tile's distance from the origin and the ripple.
const float kIridescence   = 0.45;
const float kIridIOR       = 1.30;
const float kIridThickMin  = 280.0;
const float kIridThickMax  = 560.0;

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
    float w2 = a2 / max(dot(f, f), 1e-7);
    return a2 * w2 * w2 / PI;
}

float vGGXaniso(float NdotL, float NdotV, float TdotV, float BdotV,
                float TdotL, float BdotL, float at, float ab) {
    float gv = NdotL * length(vec3(at * TdotV, ab * BdotV, NdotV));
    float gl = NdotV * length(vec3(at * TdotL, ab * BdotL, NdotL));
    return clamp(0.5 / max(gv + gl, 1e-7), 0.0, 1.0);
}

void main() {
    uint idx = vColorIdx;
    if (idx >= 16u) idx = 15u;
    vec4 c = ubo.palette[idx];

    // Albedo: palette RGB with master brightness only. The parallax bulge
    // and the quasicrystal ripple no longer modulate albedo — both are
    // carried by the shading normal, the ripple also by the emissive term.
    float brightness = ubo.effects.x;
    vec3 albedo = clamp(c.rgb * brightness, 0.0, 1.0);

    // Edge distance: 0 on every tile boundary edge, rising toward the tile
    // interior. Drives both the bevel normal and the seam roughness.
    float edgeDist = min(min(vBary.x, vBary.y), vBary.z);

    // Shading normal. `slope` accumulates -dH/d(x,y) for a height field that
    // is the sum of the ripple, the parallax bulge, and the bevel;
    // N = normalize(vec3(slope, 1)). The ripple and bulge terms apply
    // everywhere; the bevel term tilts the chamfer away from the inward
    // edge-distance gradient, fading edge → plateau.
    //
    // Bulge: vBulgeGrad is the unit model-space gradient direction of the
    // tile's depth field — -gradient tilts the normal off the bulge, so each
    // tile reads as a raised dome / sunk pit. Zero for the flat Chair family.
    vec2 slope = -vWaveGrad * kWaveHeight
               - vBulgeGrad * (ubo.effects.y * kBulgeTilt);
    vec2  g    = vec2(dFdx(edgeDist), dFdy(edgeDist));
    float gLen = length(g);
    if (gLen > 1e-7) {
        vec2  inward = g / gLen;
        float e      = clamp(edgeDist / kBevelWidth, 0.0, 1.0);
        float tilt   = kBevelStrength * cos(e * (PI * 0.5));
        slope += -inward * tilt;
    }
    vec3 N = normalize(vec3(slope, 1.0));

    // Physical channels keyed to the tiling's own fields:
    //   roughness  rises in the seam valleys — a free worn-edge read
    //   metalness  comes from the tile type — distinct kinds, distinct metal
    float seam      = 1.0 - smoothstep(0.0, kBevelWidth, edgeDist);
    float roughness = clamp(kRoughBase + kRoughMod * seam, 0.045, 1.0);
    float metalness = clamp(kMetalBase + kMetalMod * vTileMat.x, 0.0, 1.0);

    // Principled single-key BRDF in tangent space (+z toward the viewer).
    vec3  V = vec3(0.0, 0.0, 1.0);
    vec3  L = normalize(kLightDir);
    vec3  H = normalize(L + V);
    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = clamp(dot(V, H), 0.0, 1.0);

    float a  = roughness * roughness;
    vec3  F0 = mix(vec3(0.04), albedo, metalness);
    vec3  F  = fSchlick(F0, VdotH);

    // Thin-film iridescence — a colour-shifting Fresnel blended over the
    // plain one. Film thickness sweeps with the tile's distance from the
    // origin (vTileMat.w) and the ripple, so the slick drifts across the
    // tiling and pulses with the wave.
    float filmThick = mix(kIridThickMin, kIridThickMax,
                          0.5 + 0.5 * sin(vTileMat.w * 6.0 + vRipple * 3.0));
    vec3  iridF = evalIridescence(1.0, kIridIOR, NdotV, filmThick, F0);
    F = mix(F, iridF, kIridescence);

    // Anisotropic base specular. The tangent frame is the tile's own
    // orientation (vTileMat.yz) re-orthogonalised against the shading
    // normal, so a brushed-metal streak aligns to each tile. at == ab is
    // exact isotropy, so kAnisotropy = 0 reproduces plain GGX.
    vec3  oriented = vec3(vTileMat.yz, 0.0);
    vec3  Taxis = normalize(oriented - N * dot(N, oriented));
    vec3  Baxis = cross(N, Taxis);
    float at = max(a * (1.0 + kAnisotropy), 1e-4);
    float ab = max(a * (1.0 - kAnisotropy), 1e-4);
    float D   = dGGXaniso(NdotH, dot(Taxis, H), dot(Baxis, H), at, ab);
    float Vis = vGGXaniso(NdotL, NdotV, dot(Taxis, V), dot(Baxis, V),
                          dot(Taxis, L), dot(Baxis, L), at, ab);
    vec3  spec = (D * Vis) * F * NdotL;

    vec3 diffuse = albedo * (1.0 - metalness) * NdotL;

    // Sheen — a Charlie velvet lobe over the base, retroreflective at
    // grazing angles, so the beveled chamfers gain a soft fabric rim.
    // Independent of metalness; tinted by kSheenColor.
    float sheenD = charlieDistribution(kSheenRough, NdotH);
    float sheenV = ashikhminVisibility(NdotL, NdotV);
    vec3  sheen  = kSheenColor * (kSheen * sheenD * sheenV * NdotL);

    // Clearcoat — a second, tight GGX lobe at the fixed dielectric F0 0.04,
    // layered on top. Its Fresnel reflects part of the key away before it
    // reaches the base, so the base lobes are attenuated by (1 - clearcoat·Fc)
    // to keep the surface from gaining energy.
    float coatA    = kCoatRough * kCoatRough;
    float coatD    = ggxDistribution(NdotH, coatA * coatA);
    float coatG    = smithVisibility(NdotV, NdotL, coatA * 0.5);
    float coatF    = 0.04 + 0.96 * pow(1.0 - VdotH, 5.0);
    float coatLobe = kClearcoat * coatD * coatG * coatF
                   / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;
    float baseAtten = 1.0 - kClearcoat * coatF;

    // Emissive: ripple crests glow. vRipple is the wave height at the tile
    // centroid; only crests (positive) emit, so troughs stay shaded by the
    // normal rather than self-lighting.
    vec3 emissive = albedo * kEmissive * max(vRipple, 0.0);

    vec3 lit = albedo * kAmbient
             + ((diffuse + spec + sheen) * baseAtten + vec3(coatLobe))
               * kLightColor * kKeyIntensity
             + emissive;

    outColor = vec4(clamp(lit, 0.0, 1.0), c.a);
}
