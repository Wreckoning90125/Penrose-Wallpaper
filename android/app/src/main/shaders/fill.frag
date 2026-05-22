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
layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

// --- Material constants ------------------------------------------------------
// Each tile is shaded as a beveled physical chip: a flat-topped plateau
// ringed by a chamfer that catches the key light. The chamfer normal is
// derived analytically from the screen-space gradient of the edge-distance
// field carried in vBary, so it reads correctly at any zoom. Lighting is a
// single-key principled BRDF (Lambert diffuse + GGX specular) over a flat
// ambient term; ambient and key are calibrated so a tile's plateau
// reproduces its palette colour at brightness 1 — the bevel is the only
// visible departure from the previous flat look.
const float kBevelWidth    = 0.30;   // edge-distance span of the chamfer
const float kBevelStrength = 1.05;   // tan of the chamfer's peak slope
const float kRoughness     = 0.55;
const float kMetalness     = 0.0;
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

    // Albedo: palette RGB with the master brightness, per-tile parallax
    // gradient, and quasicrystal ripple as multiplicative modifiers — the
    // flat look of the previous shader, reused as the material base colour
    // rather than written straight to the framebuffer.
    float brightness = ubo.effects.x;
    float depthMod   = 1.0 + ubo.effects.y * vDepth;
    float rippleMod  = 1.0 + vRipple;
    vec3 albedo = clamp(c.rgb * brightness * depthMod * rippleMod, 0.0, 1.0);

    // Bevel surface normal. edgeDist is 0 on every tile boundary edge and
    // rises toward the tile interior; its screen-space gradient points
    // inward, perpendicular to the nearest edge. The chamfer normal tilts
    // away from that direction, by an amount fading from the edge
    // (kBevelStrength) to the plateau (0).
    float edgeDist = min(min(vBary.x, vBary.y), vBary.z);
    vec2  g    = vec2(dFdx(edgeDist), dFdy(edgeDist));
    float gLen = length(g);
    vec3  N    = vec3(0.0, 0.0, 1.0);
    if (gLen > 1e-7) {
        vec2  inward = g / gLen;
        float e      = clamp(edgeDist / kBevelWidth, 0.0, 1.0);
        float tilt   = kBevelStrength * cos(e * (PI * 0.5));
        N = normalize(vec3(-inward * tilt, 1.0));
    }

    // Principled single-key BRDF in tangent space (+z toward the viewer).
    vec3  V = vec3(0.0, 0.0, 1.0);
    vec3  L = normalize(kLightDir);
    vec3  H = normalize(L + V);
    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = clamp(dot(V, H), 0.0, 1.0);

    float a  = kRoughness * kRoughness;
    float a2 = a * a;
    vec3  F0 = mix(vec3(0.04), albedo, kMetalness);
    vec3  F  = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
    float D  = ggxDistribution(NdotH, a2);
    float G  = smithVisibility(NdotV, NdotL, a * 0.5);
    vec3  spec = (D * G) * F / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;

    vec3 diffuse = albedo * (1.0 - kMetalness) * NdotL;

    vec3 lit = albedo * kAmbient
             + (diffuse + spec) * kLightColor * kKeyIntensity;

    outColor = vec4(clamp(lit, 0.0, 1.0), c.a);
}
