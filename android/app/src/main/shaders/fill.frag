#version 460
#extension GL_GOOGLE_include_directive : require

#include "uniforms.glsl"

layout(location = 0) flat in float vColorSlot;
layout(location = 1) flat in float vRipple;
layout(location = 2) flat in vec2 vBulgeGrad;
layout(location = 3)      in vec3 vBary;
layout(location = 4)      in vec2 vWaveGrad;
layout(location = 5) flat in vec4 vTileMat;
layout(location = 6)      in vec2 vModelPos;
layout(location = 7) flat in vec2 vCenter;
layout(location = 8) flat in vec4 vTopology;
layout(location = 9) flat in vec3 vEdgeDist;
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

float ornamentLine(float distanceToCenter, float width, float aa) {
    return 1.0 - smoothstep(width, width + aa, distanceToCenter);
}

float truchetQuarterArc(vec2 uv, vec2 center, float radius, vec2 quadrant, float width, float aa) {
    vec2 d = uv - center;
    if (d.x * quadrant.x < -0.001 || d.y * quadrant.y < -0.001) return 0.0;
    return ornamentLine(abs(length(d) - radius), width, aa);
}

float truchetArcs(vec2 uv, float bit, float width, float aa) {
    float arc0 = max(
        truchetQuarterArc(uv, vec2(0.5, 0.5), 0.5, vec2(-1.0, -1.0), width, aa),
        truchetQuarterArc(uv, vec2(-0.5, -0.5), 0.5, vec2(1.0, 1.0), width, aa));
    float arc1 = max(
        truchetQuarterArc(uv, vec2(-0.5, 0.5), 0.5, vec2(1.0, -1.0), width, aa),
        truchetQuarterArc(uv, vec2(0.5, -0.5), 0.5, vec2(-1.0, 1.0), width, aa));
    return (bit < 0.5) ? arc0 : arc1;
}

float truchetLines(vec2 uv, float bit, float width, float aa) {
    float line0 = ornamentLine(abs(uv.x - uv.y) * 0.70710678, width, aa);
    float line1 = ornamentLine(abs(uv.x + uv.y) * 0.70710678, width, aa);
    return (bit < 0.5) ? line0 : line1;
}

float ornamentMask(vec2 p, vec2 center, vec4 tileMat) {
    float amount = clamp(ubo.ornament.y, 0.0, 1.0);
    if (amount <= 0.0) return 0.0;
    float scale = max(abs(tileMat.w), 1e-4);
    vec2 orient = tileMat.yz;
    float orientLen = length(orient);
    orient = (orientLen > 1e-4) ? orient / orientLen : vec2(1.0, 0.0);
    vec2 d = p - center;
    float transformChoice = round(clamp(ubo.ornament.w, 0.0, 1.0) * 2.0);
    float squareCellSize = max(scale * 1.41421356237, 1e-4);
    float cellX = floor(dot(center, orient) / squareCellSize);
    float cellY = floor(dot(center, vec2(-orient.y, orient.x)) / squareCellSize);
    float parityX = cellX - floor(cellX * 0.5) * 2.0;
    float parityY = cellY - floor(cellY * 0.5) * 2.0;
    float latticeBit = abs(parityX - parityY) < 0.5 ? 0.0 : 1.0;
    float baseU0 = dot(d, orient) / scale;
    float baseV0 = dot(d, vec2(-orient.y, orient.x)) / scale;
    float d4State = round(clamp(tileMat.x, 0.0, 1.0) * 7.0);
    bool useD4 = abs(ubo.ornamentExtra.w - 18.0) < 0.5;
    float baseU = baseU0;
    float baseV = baseV0;
    bool flipUv = round(clamp(ubo.ornamentExtra.y, 0.0, 1.0) * 3.0) > 1.5;
    float rawU = flipUv ? baseV : baseU;
    float rawV = flipUv ? baseU : baseV;
    bool inverseReverse = transformChoice > 0.5 && transformChoice < 1.5;
    bool mirrorReverse = transformChoice >= 1.5;
    float u = inverseReverse ? -rawU : (mirrorReverse ? -rawU : rawU);
    float v = mirrorReverse ? -rawV : rawV;
    float d4StateBit = (d4State > 0.5 && d4State < 1.5)
        || (d4State > 2.5 && d4State < 3.5)
        || (d4State > 3.5 && d4State < 4.5)
        || (d4State > 4.5 && d4State < 5.5)
        ? 1.0
        : 0.0;
    float classBit = useD4 ? d4StateBit : (tileMat.x < 0.5 ? 0.0 : 1.0);
    float bit = inverseReverse ? 1.0 - classBit : classBit;
    vec2 uv = vec2(u, v);
    float width = mix(0.018, 0.15, clamp(ubo.ornament.z, 0.0, 1.0));
    float aa = max((fwidth(u) + fwidth(v)) * 0.75, 0.0025);
    float singleArcs = truchetArcs(uv, bit, width, aa);
    float singleLines = truchetLines(uv, bit, width, aa);
    float d4ConnectedBit = abs(d4StateBit - latticeBit) > 0.5 ? 1.0 : 0.0;
    float connectedBit = useD4 ? d4ConnectedBit : (abs(classBit - latticeBit) > 0.5 ? 1.0 : 0.0);
    float connectedArcs = truchetArcs(uv, connectedBit, width, aa);
    float connectedLines = truchetLines(uv, connectedBit, width, aa);
    float style = clamp(ubo.ornament.x, 0.0, 4.0);
    float truchet = 0.0;
    if (style < 0.5) truchet = 0.0;
    else if (style < 1.5) truchet = singleArcs;
    else if (style < 2.5) truchet = singleLines;
    else if (style < 3.5) truchet = connectedArcs;
    else if (style < 4.5) truchet = 0.0;
    else truchet = connectedLines;
    float density = clamp(ubo.ornamentExtra.x, 0.0, 1.0);
    float motifActive = density;
    return clamp(truchet * amount * motifActive, 0.0, 1.0);
}

vec2 tileLocalUv(vec2 p, vec2 center, vec4 tileMat) {
    vec2 orient = tileMat.yz;
    float orientLen = length(orient);
    orient = (orientLen > 1e-4) ? orient / orientLen : vec2(1.0, 0.0);
    float scale = max(abs(tileMat.w), 1e-4);
    vec2 d = p - center;
    return vec2(dot(d, orient), dot(d, vec2(-orient.y, orient.x))) / scale;
}

float hashNoise(vec2 p) {
    float h = sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123;
    return fract(h);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hashNoise(i);
    float b = hashNoise(i + vec2(1.0, 0.0));
    float c = hashNoise(i + vec2(0.0, 1.0));
    float d = hashNoise(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float tileMicroGrain(vec2 uv, float seed) {
    float coarse = valueNoise(vec2(uv.x * 31.0 + seed * 0.37, uv.y * 31.0 - seed * 0.19));
    float fine = valueNoise(vec2(
        uv.x * 83.0 + uv.y * 7.0 + seed * 2.7,
        uv.y * 83.0 - uv.x * 5.0 - seed * 1.3));
    float pore = valueNoise(vec2(
        (uv.x + uv.y) * 151.0 + seed * 3.1,
        (uv.x - uv.y) * 37.0 - seed * 2.3));
    float crossHatch = sin((uv.x + uv.y) * 211.0 + seed * 5.29)
        * sin((uv.x - uv.y) * 173.0 - seed * 3.41);
    return clamp(
        0.5 + (coarse - 0.5) * 0.42
            + (fine - 0.5) * 0.28
            + (pore - 0.5) * 0.16
            + crossHatch * 0.045,
        0.0,
        1.0);
}

float brushedStreak(vec2 uv, float seed) {
    float warp = (valueNoise(vec2(uv.y * 18.0 + seed, seed * 0.23)) - 0.5) * 4.0;
    float longScratch = valueNoise(vec2(uv.x * 88.0 + warp + seed, uv.y * 2.5 + seed * 0.19));
    float hairScratch = valueNoise(vec2(uv.x * 330.0 + seed * 3.7, uv.y * 11.0 - seed * 0.31));
    float softBands = valueNoise(vec2(uv.y * 18.0 + seed * 1.9, uv.x * 0.35 + seed * 0.11));
    return clamp(
        0.5 + (longScratch - 0.5) * 0.46
            + (hairScratch - 0.5) * 0.30
            + (softBands - 0.5) * 0.18,
        0.0,
        1.0);
}

float topologyField(vec2 center, vec4 tileMat) {
    vec2 orient = tileMat.yz;
    float orientLen = length(orient);
    orient = (orientLen > 1e-4) ? orient / orientLen : vec2(1.0, 0.0);
    float axial = dot(center, orient);
    float lateral = dot(center, vec2(-orient.y, orient.x));
    float ring = fract(length(center) * 0.12);
    float phase = ubo.anim.x * 0.23 + (ubo.anim.w - 0.5) * (2.0 * PI);
    float ringWave = sin(ring * (2.0 * PI) + tileMat.x * 4.713 + axial * 0.31 + phase);
    float crossWave = sin(lateral * 0.27 - ring * 3.883 + tileMat.x * 2.17 - phase * 0.37);
    return clamp(0.5 + 0.25 * (ringWave + crossWave), 0.0, 1.0);
}

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

vec4 paletteAt(float slot) {
    float x = clamp(slot, 0.0, 17.0);
    int lo = int(floor(x));
    int hi = min(17, lo + 1);
    return mix(ubo.palette[lo], ubo.palette[hi], fract(x));
}

float topologyPaletteSlot(float baseSlot, float degree, float motif, float relaxed, float biharmonic, float ring) {
    int activeCount = int(clamp(float(ubo.flags.y), 1.0, 18.0));
    if (activeCount <= 1) return 0.0;
    float structural = clamp(
        clamp(degree, 0.0, 1.0) * 0.24
        + clamp(motif, 0.0, 1.0) * 0.22
        + clamp(relaxed, 0.0, 1.0) * 0.31
        + clamp(biharmonic, 0.0, 1.0) * 0.23,
        0.0,
        1.0);
    float signedField = structural - 0.5;
    int direction = signedField < 0.0 ? -1 : 1;
    int maxHop = max(1, activeCount - 1);
    int structuralHop = 1 + int(floor(clamp(abs(signedField) * 2.0, 0.0, 1.0) * float(min(2, maxHop - 1))));
    int ringHop = int(floor(clamp(ring, 0.0, 1.0) * float(min(2, maxHop))));
    int motifHop = int(floor(clamp(motif, 0.0, 1.0) * float(min(2, maxHop))));
    int hop = clamp(structuralHop + ringHop + motifHop, 1, maxHop);
    int baseWhole = int(floor(clamp(baseSlot, 0.0, float(activeCount - 1))));
    float baseFrac = clamp(baseSlot - floor(baseSlot), 0.0, 1.0);
    int wrapped = (baseWhole + direction * hop + activeCount * 4) % activeCount;
    float neighbor = direction < 0
        ? max(0.0, float(wrapped) - baseFrac)
        : min(float(activeCount - 1), float(wrapped) + baseFrac);
    return clamp(neighbor, 0.0, float(activeCount - 1));
}

void main() {
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

    float ornament = ornamentMask(vModelPos, vCenter, vTileMat);
    vec2 tileUv = tileLocalUv(vModelPos, vCenter, vTileMat);
    float tileSeed = vTileMat.x * 17.13 + length(vCenter) * 0.37;
    float topology = topologyField(vCenter, vTileMat);
    float structural = clamp(topology * 0.52 + vTopology.x * 0.18 + vTopology.y * 0.14 + vTopology.z * 0.16, 0.0, 1.0);
    float biharmonic = clamp(vTopology.w, 0.0, 1.0);
    float topologySigned = structural - 0.5;
    float rippleKind = floor(ubo.effects.w + 0.5);
    float colorRippleAmount = (rippleKind != 1.0) ? ubo.anim.y : 0.0;
    float topologyMotion = clamp(colorRippleAmount * 4.5, 0.0, 1.0);
    float topologyPaletteBlend = clamp(abs(topologySigned) * topologyMotion * 1.35, 0.0, 0.82);
    float topologySlot = topologyPaletteSlot(vColorSlot, vTopology.x, vTopology.y, vTopology.z, vTopology.w, vTopology.z);
    vec4 c = mix(paletteAt(vColorSlot), paletteAt(topologySlot), topologyPaletteBlend);

    // Albedo: palette RGB with master brightness, plus the tile-local
    // ornament tint. Source markings render as their own sampled strips;
    // the base surface normal stays tied to tile relief, ripple and bevel.
    vec3 baseAlbedo = c.rgb * ubo.effects.x;
    vec3 albedo = clamp(mix(baseAlbedo, vec3(1.0, 0.78, 0.42), ornament * 0.48), 0.0, 1.0);

    // Edge distance: 0 on every tile boundary edge, rising toward the tile
    // interior. Drives both the bevel normal and the seam roughness.
    // vBary_c * vEdgeDist_c = normalized distance to true tile edge c; pinned
    // interior-cut components are 1*1 so subdivision seams never read as edges.
    float edgeDist = clamp(min(min(vBary.x * vEdgeDist.x, vBary.y * vEdgeDist.y), vBary.z * vEdgeDist.z), 0.0, 1.0);
    float safeBevelWidth = max(bevelWidth, 1e-4);

    // Shading normal. `slope` accumulates -dH/d(x,y) for a height field that
    // sums the ripple, the parallax bulge, and the bevel: the ripple and
    // bulge apply everywhere; the bevel tilts the chamfer away from the
    // inward edge-distance gradient, fading from edge to plateau.
    vec2 slope = -vWaveGrad * waveHeight;
    slope += -vBulgeGrad * (ubo.effects.y * bulgeTilt);
    vec2  g    = vec2(dFdx(edgeDist), dFdy(edgeDist));
    float gLen = length(g);
    if (gLen > 1e-7) {
        vec2  inward = g / gLen;
        float e      = clamp(edgeDist / safeBevelWidth, 0.0, 1.0);
        slope += -inward * (bevelStrength * cos(e * (PI * 0.5)));
    }
    vec3 N = normalize(vec3(slope, 1.0));
    float normalFlux = length(dFdx(N.xy)) + length(dFdy(N.xy));

    // Physical channels keyed to the tiling's own fields: roughness rises in
    // the seam valleys (a worn-edge read), metalness comes from the tile type.
    float seam      = 1.0 - smoothstep(0.0, safeBevelWidth, edgeDist);
    float contactShadow = clamp(seam * bevelStrength * 0.18, 0.0, 0.28);
    float ridgeHighlight = clamp(normalFlux * bevelStrength * 1.6, 0.0, 0.18);
    float reliefScalar = 1.0 - cos(clamp(edgeDist / safeBevelWidth, 0.0, 1.0) * (PI * 0.5));
    float centerRing = fract(length(vCenter) * 0.12);
    float contourSource = clamp(ubo.contour.y, 0.0, 7.0);
    float luminanceScalar = clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float curvatureScalar = clamp(normalFlux * 7.0, 0.0, 1.0);
    float contourScalar = edgeDist;
    if (contourSource >= 6.5) {
        contourScalar = clamp(vTopology.w, 0.0, 1.0);
    } else if (contourSource >= 5.5) {
        contourScalar = clamp(vTopology.z, 0.0, 1.0);
    } else if (contourSource >= 4.5) {
        contourScalar = clamp(vTopology.y, 0.0, 1.0);
    } else if (contourSource >= 3.5) {
        contourScalar = clamp(vTopology.x, 0.0, 1.0);
    } else if (contourSource >= 2.5) {
        contourScalar = curvatureScalar;
    } else if (contourSource >= 1.5) {
        contourScalar = luminanceScalar;
    } else if (contourSource >= 0.5) {
        contourScalar = reliefScalar;
    }
    float contourBanded = contourScalar * clamp(ubo.contour.z, 1.0, 64.0) + ubo.contourColor.x;
    float contourCell = abs(fract(contourBanded) - 0.5);
    float contourAa = max(fwidth(contourBanded), 0.003);
    float contourWidth = clamp(ubo.contour.w, 0.01, 0.49);
    float contourMask = (1.0 - smoothstep(contourWidth, contourWidth + contourAa, contourCell))
        * clamp(ubo.contour.x, 0.0, 1.0);
    albedo = clamp(mix(albedo, ubo.contourColor.yzw, contourMask), 0.0, 1.0);
    float edgeProfileWidth = clamp(ubo.borderGeom.x, 0.0, 1.0);
    float edgeProfileGlow = clamp(ubo.borderGeom.y, 0.0, 1.0);
    float edgeProfileSpan = max(edgeProfileWidth * 0.18, 0.001);
    float edgeProfileMask = (1.0 - smoothstep(edgeProfileSpan, edgeProfileSpan + 0.035, edgeDist)) * edgeProfileWidth;
    albedo = clamp(mix(albedo, ubo.edgeProfileColor.rgb, clamp(edgeProfileMask * 0.82, 0.0, 0.88))
        + ubo.edgeProfileColor.rgb * edgeProfileMask * edgeProfileGlow * 0.26, 0.0, 1.0);
    float grain = tileMicroGrain(tileUv, tileSeed);
    float brushed = brushedStreak(tileUv, tileSeed);
    float brushedSigned = (brushed - 0.5) * clamp(mat.anisotropy, 0.0, 1.0);
    float topologyColorGain = topologySigned * topologyMotion;
    vec3 topologyTint = mix(vec3(0.78, 0.90, 1.0), vec3(1.0, 0.82, 0.56), structural);
    float radialPatina = 0.5 + 0.5 * sin(length(vCenter) * 0.55 + vTileMat.x * 5.1);
    float patina = clamp(mix(grain, radialPatina, 0.55) * max(roughMod, metalMod), 0.0, 1.0);
    albedo = clamp(albedo * (1.0 + brushedSigned * 0.10 - patina * 0.08 - contactShadow + topologyColorGain * 0.10)
        + topologyTint * abs(topologyColorGain) * 0.045
        + vec3(1.0, 0.92, 0.72) * ridgeHighlight, 0.0, 1.0);
    float roughness = clamp(roughBase + roughMod * seam + patina * 0.14 + abs(brushedSigned) * 0.16
        + abs(topologySigned) * topologyMotion * 0.08
        + abs(biharmonic - 0.5) * topologyMotion * 0.06 - ornament * 0.18, 0.045, 1.0);
    float metalness = clamp(metalBase + metalMod * vTileMat.x + seam * metalMod * 0.12 + ornament * 0.22 - patina * metalMod * 0.08, 0.0, 1.0);
    float a  = roughness * roughness;
    vec3  F0 = mix(vec3(0.04), albedo, metalness);

    // View is straight on. Iridescence depends only on the view angle, so its
    // colour-shifting Fresnel is evaluated once and shared by both lights.
    // Thickness sweeps with the tile's radius and the ripple — a drifting
    // oil-slick.
    vec3  V = vec3(0.0, 0.0, 1.0);
    float filmThick = mix(ubo.matIrid.x, ubo.matIrid.y,
                          clamp(0.28 + structural * 0.24 + biharmonic * 0.18 + 0.30 * sin(length(vCenter) * 6.0 + vRipple * 3.0), 0.0, 1.0));
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

    // Ambient fills the unlit side; emissive glows uniformly with a
    // crest boost. A pure ripple-coupled form (`emissive * max(vRipple,
    // 0)`) meant the slider did nothing without an active ripple — the
    // 0.25 base term keeps the glow visible while the ripple amplitude
    // still adds the per-crest accent the wave-driven look depends on.
    vec3 ambient  = albedo * ubo.ambient.rgb * ubo.ambient.w;
    vec3 emissive = albedo * (emissiveGain * (0.25 + max(vRipple, 0.0)) + ornament * 0.14 + structural * topologyMotion * 0.08);

    outColor = vec4(clamp(ambient + key + fill + emissive, 0.0, 1.0), c.a);
}
