# Physical material — architecture reference

The renderer turns flat tilings into lit, beveled, physical surfaces. The
technique is lifted from a studied reference — a TSL/WebGPU
hyperbolic-audio visualiser that renders a flat unit disk as a real
physical material. What that reference does with three.js
`MeshPhysicalNodeMaterial` we do by hand in GLSL because the Vulkan
renderer has no node-material engine. The reference's lesson is
**architectural, not its 50-slider UI**: a scalar field plus its
screen-space gradient plus a real BRDF is a physical surface.

Open work tracks in `todo.md` (Phase E HDR + bloom + AgX, Phase F border
merge); the parallel tiling-families track lives in
`docs/tilings/ROADMAP.md`.

---

## Files and ownership

Renderer is **Vulkan 1.3, dynamic rendering** (no `VkRenderPass`
object), drawing two pipelines straight to the swapchain image. Two
draws per frame: fill triangles, then border quads. Shaders are GLSL
460, compiled by `glslc` in the NDK build.

- `cpp/renderer/render_state.h`: `FillVertex`, `BorderVertex`, `PushBlock`,
  `PaletteUbo`, `MaterialParams`, and `applyLightControls`.
- `cpp/renderer/renderer_vulkan.cpp`: device, swapchain, pipeline setup, and
  vertex-attribute descriptions.
- `cpp/renderer/renderer_geometry.cpp`: `buildGeometry()` for tile vertex
  lists and `updatePaletteUbo()` for the cold palette path.
- `cpp/renderer/renderer.cpp`: lifecycle plus `drawFrame`, including per-frame
  UBO patching and audio-graph evaluation.
- `cpp/settings.h` and `cpp/jni_bridge.cpp`: `Settings` plus JNI decode for
  every user-facing control.
- `kotlin/Settings.kt` and `kotlin/SettingsFragment.kt`: persistence keys,
  Material screen sliders, and the preset picker grid.
- `kotlin/preset/MaterialPreset.kt` and `tools/bake_preset_thumbnails.py`:
  preset bundles plus baked tile-rhomb thumbnails.
- `shaders/fill.vert` and `fill.frag`: fill-stage displacement, parallax,
  bevel, and BRDF.
- `shaders/border.vert` and `border.frag`: expanded-quad borders.
- `shaders/uniforms.glsl`: shared `Palette` UBO included by every stage through
  `GL_GOOGLE_include_directive`.

**Fill vertex** (`render_state.h`) — non-indexed, 3 verts pushed per triangle:

```c
struct FillVertex {
  float x, y; uint32_t colorIdx; float cx, cy; float depth;
  float bx, by, bz;    // edge-distance barycentric basis
  float tileType, tileOrientX, tileOrientY, tileRadius;  // per-tile id
};
```

→ `fill.vert` inputs `loc0..loc5`: `vec2 inPos`, `uint inColorIdx`,
`vec2 inCenter`, `vec2 inBulge`, `vec3 inBary`, `vec4 inTileMat`.
→ `fill.vert` outputs `loc0..loc5`: `flat uint vColorIdx`, `flat float
vRipple`, `flat vec2 vBulgeGrad`, `vec3 vBary`, `vec2 vWaveGrad`,
`flat vec4 vTileMat`.

**Uniform block `PaletteUbo`** (`render_state.h`) — std140. The
shader-side declaration lives once in `shaders/uniforms.glsl` and is
`#include`d by every stage, so a row added here only has to be added
in one shader file.

```c
struct PaletteUbo {
  float palette[16][4]; float borderColor[4]; float bgColor[4];
  uint32_t flags[4]; float anim[4];
  // anim: x=time y=rippleAmt z=waveSym w=pageOffset
  float borderGeom[4]; float effects[4];
  // effects: x=brightness y=depth z=rippleSpeed w=rippleKind
  float audioBands[2][4]; float audioBeat[4];
  // Material rows — packed from MaterialParams (see settings.h).
  float matNormal[4]; float matSurface[4];
  float matLobeA[4]; float matLobeB[4];
  float matIrid[4]; float matSheenCol[4];
  float keyLight[4]; float keyColor[4];
  float fillLight[4]; float fillColor[4]; float ambient[4];
};
```

**Vertex attributes** are declared in `renderer_vulkan.cpp::buildPipelines` —
`VkVertexInputAttributeDescription fillAttrs[6]`. Adding an attribute = grow
that array + bump `vertexAttributeDescriptionCount`.

**Swapchain formats**: preferred is `A2B10G10R10_UNORM_PACK32` on the
Display-P3 colour space (10-bit). sRGB swapchains write linear colour and let
hardware encode on store. No depth buffer, no offscreen/HDR target; the HDR
composite pass that owns AgX tonemap is tracked in `todo.md`.

**Already present, ready to exploit:**

- `fill.vert::waveGradient()` — the **analytic** 2-D slope of the ripple
  field. Used to fold ripple slope into the shading normal, and also the
  natural driver for audio-reactive surface motion.
- `inDepth` (parallax bulge, ±1 on one vertex) is linear across a
  triangle → exact analytic gradient, no `dFdx` needed.
- The palette is OKLCH-derived linear RGB from `color.cpp`, which also
  holds the sRGB and wide-gamut-P3 encode paths.
- `classify()` computes a per-tile **type**, **orientation**, and **ring
  distance** — the per-tile material-identity fields wired into the
  channel table below.
- Geometry is non-indexed: each triangle's 3 vertices are independent,
  so per-triangle attribute values are free to assign.
- The modulation **node graph** (`graph/`) drives every material +
  lighting parameter from audio bands, beat, clock, and home-screen
  page-scroll, layered on top of the slider baselines.

---

## The technique

Stripped of its framework, the reference renderer is:

- A **flat** surface, geometric normal `(0,0,1)`, orthographic view.
- A scalar field `H(x,y)` treated as a **height field**.
- The surface normal reconstructed *per fragment* as
  `normalize(vec3(-dHdx, -dHdy, 1))`. No height geometry, no normal-map texture.
- That normal driving a **full principled BRDF** (Disney / MaterialX standard
  surface): base colour, roughness, metalness, clearcoat, sheen, thin-film
  iridescence, emissive, IOR.
- Real lights (directional key + point fill + ambient), OKLab colour, a filmic
  tonemap (the reference uses ACES) on output.
- **The same scalar field also modulates the physical channels** —
  `roughness = base + mod·f(H)`, likewise metalness, emission, sheen. The field
  is not just geometry; it is the material's spatial variation.

The idea underneath: **a 3-D-looking physical surface needs only a scalar
field, its screen-space gradient as a normal, a real BRDF, and that same field
wired into the BRDF's channels — not 3-D geometry, not textures.**

**It is all portable shader math.** TSL is a node front-end that compiles to
WGSL; every node maps one-to-one to GLSL we compile with `glslc`:

- `dFdx` / `dFdy`: GLSL core derivatives emitted to SPIR-V.
- `MeshPhysicalNodeMaterial`: hand-written Cook-Torrance GGX plus lobes in
  `fill.frag`.
- OKLab to linear-sRGB node: `color.cpp` palette authoring.
- ACES filmic tonemap: one GLSL function; AgX remains the HDR composite target.
- Directional, point, and ambient lights: light vectors plus colours in the UBO.
- `uniform()` param registry: `PaletteUbo` fields plus the existing node graph.

**A tiling beats the reference's single disk in two structural ways.**

1. *Clean normals.* The reference must use `dFdx` of `H` because its field has
   no closed-form gradient, and `dFdx` across a discontinuity smears garbage. We
   assemble `H` from terms with **analytic** gradients — the bevel
   (piecewise-linear `inBary`), the parallax bulge (linear `inDepth`), and the
   already-analytic `waveGradient` — so the normal is exact and seam-clean.
2. *Per-tile material identity.* The reference has one field, so one material
   varying continuously. We have **discrete tiles**, each carrying type,
   orientation, and ring distance. Different physical channels can key to
   different structural fields: metalness by tile type, anisotropy along tile
   orientation, iridescence thickness by ring — material variation the tiling
   *is*, not material variation painted on. A single continuous disk cannot do
   this.

---

## Material architecture

The reference exposes ~50 sliders. We do **not**. The architecture is kept; the
UI is replaced by structure + audio + a curated handful of controls.

**Channel-modulation pattern.** Every modulatable BRDF channel `X` is

```text
X_effective = X_base  +  X_mod · f(field)
```

`X_base` is a constant from the active material preset. `f(field)` is a scalar
in roughly `[0,1]` drawn from one of the tiling's own fields. **The pairing of
channel to field is fixed in the shader by design intent — it is not a knob.**
That single decision is what removes ~30 sliders:

- Normal keys to bevel `edgeDist`, bulge `vDepth`, and wave `vWaveGrad`, giving
  beveled chips, domed tiles, and lit ripple.
- Roughness keys to bevel `edgeDist`, so contact valleys read as more worn.
- Metalness keys to per-tile `type`, making alternating tile kinds read as
  distinct metals.
- Emissive keys to `max(vRipple, 0)` or per-tile `type`, so ripple crests and
  chosen tiles glow.
- Sheen intensity keys to bevel `edgeDist`, catching light along tile edges.
- Anisotropy direction keys to per-tile `orientation` from `classify()`, giving
  brushed-metal streaks aligned per tile.
- Iridescence thickness keys to per-tile `ring` distance plus ripple/audio
  offsets, shifting the film colour with distance and sound.

**The control surface.** Two layers, both real, neither audio-dependent:

- **Material presets** — six built-in bundles (`Matte`, `Ceramic`, `Pearl`,
  `Brushed metal`, `Lacquer`, `Oil-slick`) on the Material screen,
  picker rendered as a 2-column grid of baked tile-thumbnails. A one-tap
  starting point that writes the slider values into `SharedPreferences`.
- **Per-parameter sliders** — every user-facing `MaterialParams` field is
  on the Material screen (eight surface + two variation knobs + five
  lighting + three sheen-tint RGB + two iridescent-film min/max). A
  preset seeds the group; the user tunes from there. The whole look is
  reachable with no audio running — essential for a static live
  wallpaper or lock screen.

**Modulation.** Every per-frame parameter is also a target of the existing
node graph, which evaluates against audio bands, the beat, a clock, and
the home-screen page-scroll offset. A target's graphed value *adds onto*
its settings base, so modulation rides on top of whatever the user set:
the wallpaper can sit still, breathe to a clock, sway with home-screen
panning, or pulse to sound. The channel→field pairings in the table
above stay fixed in the shader; what the user sets and the graph drives
is the parameters.

**Storage.** Per-tile identity reaches the shader as the `inTileMat`
vertex attribute. The material and light parameters are `PaletteUbo`
rows packed from a `MaterialParams` struct; the persisted `Settings`
flow through `jni_bridge::decodeSettings` into that struct each frame.

---

## BRDF lobes

Four lobes hand-written in `fill.frag`, ported from the glTF Sample
Viewer GLSL:

- **Sheen.** Estevez–Kulla "Charlie" distribution with Ashikhmin
  visibility — a retroreflective velvet lobe that peaks at grazing
  angles, so the beveled chamfers gain a soft fabric rim. Tinted by
  `MaterialParams.sheenColor` (user-settable RGB), independent of
  metalness.
- **Clearcoat.** A second tight GGX lobe at the fixed dielectric F0
  0.04. Its Fresnel attenuates the base lobes by `(1 − clearcoat·Fc)` to
  conserve energy.
- **Anisotropy.** The base GGX is replaced by the anisotropic `D`/`V`
  pair; the tangent frame is the per-tile orientation
  (`inTileMat.yz`) re-orthogonalised against the shading normal, so
  each tile streaks its highlight along its own classifier edge.
  `at == ab` is exact isotropy, so the term degrades cleanly.
- **Iridescence.** A thin-film interference Fresnel (Belcour & Barla
  2017) blended over the plain Schlick Fresnel. Film thickness sweeps
  with the tile's distance from the origin (`inTileMat.w`) and the
  ripple phase, so an oil-slick drifts across the tiling and pulses
  with the wave. The thickness range is per-material (Pearl 250–400 nm
  lands on teal/violet, Oil-slick 380–700 nm cycles the full visible
  spectrum) and user-tunable via the Iridescent-film slider pair.

---

## Lighting rig

`fill.frag` runs a key + fill + ambient rig, with the per-light BRDF
factored into `shadeLight()` — anisotropic GGX + iridescent Fresnel,
Lambert diffuse, Charlie sheen, and the clearcoat lobe, evaluated once
per light. The fill is dimmer, cooler, and opposite the key — bounce
light; the ambient is a faint tinted flat term. The iridescent Fresnel
is view-only, so it is evaluated once and shared by both lights.
Intensities are recalibrated so a flat non-metal plateau still
reproduces its palette colour. The full rig is derived by
`applyLightControls` (in `render_state.h`) from five user-facing
controls: angle, elevation, intensity, warmth, ambient.

There is **no in-shader tonemap**. AgX needs a linear working space, and
`fill.frag` writes directly to a swapchain that is either hardware-sRGB
or already-encoded P3 — an in-shader tonemap would be wrong on the P3
path. It belongs in the HDR composite pass tracked in `todo.md`.

---

## Risks / gotchas

- `dFdx` / `dFdy` are valid only in the fragment stage under uniform
  control flow — satisfied here. The bevel `min()` crease is the one
  non-smooth point; it is the intended bevel ridge, not an artefact.
- There is no depth buffer and none is added — the normal is a
  *shading* normal; this is not a Z-test.
- Mobile cost: GGX + clearcoat + sheen + iridescence + three lights is
  comfortably real-time on any Vulkan-capable mobile GPU (the
  reference runs a per-fragment zero-loop *and* the full physical
  material and holds frame rate). If a low-end tier is ever needed,
  gate the heavier lobes behind a preset flag.
- `tools/verify_tilings.cpp` is unaffected — tiling topology never
  changes; the material attributes are pure shading data.

---

## Verification

- `glslc` compiles all shaders — the NDK build does this. Locally,
  `glslangValidator -V --target-env vulkan1.3 <shader>` validates a
  shader to SPIR-V without the full Android build, and `spirv-val` runs
  the SPIR-V conformance check.
- CI: `assembleRelease`, `lintRelease`, the `tiling-verify` job, the
  UBSan build, and `validate shaders` stay green.
