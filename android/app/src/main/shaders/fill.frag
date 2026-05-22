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
layout(location = 2)      in float vDepth;
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

float ggxDistribution(float NdotH, float a2) {
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-7);
}

float smithVisibility(float NdotV, float NdotL, float k) {
    float gv = NdotV / max(NdotV * (1.0 - k) + k, 1e-7);
    float gl = NdotL / max(NdotL * (1.0 - k) + k, 1e-7);
    return gv * gl;
}

void main() {
    uint idx = vColorIdx;
    if (idx >= 16u) idx = 15u;
    vec4 c = ubo.palette[idx];

    // Albedo: palette RGB with master brightness and the per-tile parallax
    // gradient. The quasicrystal ripple no longer modulates albedo — it is
    // carried by the shading normal (vWaveGrad) and the emissive term below.
    float brightness = ubo.effects.x;
    float depthMod   = 1.0 + ubo.effects.y * vDepth;
    vec3 albedo = clamp(c.rgb * brightness * depthMod, 0.0, 1.0);

    // Edge distance: 0 on every tile boundary edge, rising toward the tile
    // interior. Drives both the bevel normal and the seam roughness.
    float edgeDist = min(min(vBary.x, vBary.y), vBary.z);

    // Shading normal. `slope` accumulates -dH/d(x,y) for a height field that
    // is the sum of the ripple and the bevel; N = normalize(vec3(slope, 1)).
    // The ripple term applies everywhere; the bevel term tilts the chamfer
    // away from the inward edge-distance gradient, fading edge → plateau.
    vec2 slope = -vWaveGrad * kWaveHeight;
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
    float a2 = a * a;
    vec3  F0 = mix(vec3(0.04), albedo, metalness);
    vec3  F  = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
    float D  = ggxDistribution(NdotH, a2);
    float G  = smithVisibility(NdotV, NdotL, a * 0.5);
    vec3  spec = (D * G) * F / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;

    vec3 diffuse = albedo * (1.0 - metalness) * NdotL;

    // Emissive: ripple crests glow. vRipple is the wave height at the tile
    // centroid; only crests (positive) emit, so troughs stay shaded by the
    // normal rather than self-lighting.
    vec3 emissive = albedo * kEmissive * max(vRipple, 0.0);

    vec3 lit = albedo * kAmbient
             + (diffuse + spec) * kLightColor * kKeyIntensity
             + emissive;

    outColor = vec4(clamp(lit, 0.0, 1.0), c.a);
}
