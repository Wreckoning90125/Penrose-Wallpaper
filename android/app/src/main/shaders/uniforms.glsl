// Shared uniform block for every renderer shader. Mirroring this layout
// across multiple files is a std140-offset drift hazard — Phase C/D added
// eleven material rows that previously only fill.frag carried — so the
// block lives in one place and every stage #includes it. Stages that read
// only part of the block (fill.vert, border.*) still include the full
// struct; std140 fixes the layout, unused fields cost nothing.
//
// `#include` resolution is gated by GL_GOOGLE_include_directive (the
// Khronos-blessed include extension); the directive must be enabled at
// the top of each shader that pulls this file in.

#ifndef PENROSE_UNIFORMS_GLSL
#define PENROSE_UNIFORMS_GLSL

layout(set = 0, binding = 0, std140) uniform Palette {
    vec4  palette[18];
    vec4  borderColor;
    vec4  bgColor;
    uvec4 flags;
    vec4  anim;          // x=time, y=rippleAmount, z=waveSymmetry, w=pageOffset
    vec4  borderGeom;
    vec4  effects;       // x=brightness, y=depthAmount, z=rippleSpeed, w=rippleKind
    vec4  audioBands[2];
    vec4  audioBeat;
    // Physical material — packed from MaterialParams in render_state.h.
    vec4  matNormal;     // bevelWidth, bevelStrength, waveHeight, bulgeTilt
    vec4  matSurface;    // roughBase, roughMod, metalBase, metalMod
    vec4  matLobeA;      // emissive, sheen, sheenRough, clearcoat
    vec4  matLobeB;      // coatRough, anisotropy, iridescence, iridIOR
    vec4  matIrid;       // iridThickMin, iridThickMax, --, --
    vec4  matSheenCol;   // sheenColor.rgb, --
    vec4  keyLight;      // keyDir.xyz, keyIntensity
    vec4  keyColor;      // keyColor.rgb, --
    vec4  fillLight;     // fillDir.xyz, fillIntensity
    vec4  fillColor;     // fillColor.rgb, --
    vec4  ambient;       // ambientColor.rgb, ambientAmount
} ubo;

#endif // PENROSE_UNIFORMS_GLSL
