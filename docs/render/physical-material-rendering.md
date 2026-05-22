# Physical-material rendering — plan

The renderer is geometrically complete (11 tiling families, closure-verified by
`tools/verify_tilings.cpp`, table-driven). This document is the single pick-up
point for turning the flat tiling into a lit, beveled, physical surface. It
carries the full context, the technique, the material architecture, and a
phased build sequence. Every phase is committed work; the order is sequencing,
not optionality.

The technique is lifted from a studied reference — a TSL/WebGPU hyperbolic-audio
visualiser that renders a flat unit disk as a real physical material. What that
reference does with three.js `MeshPhysicalNodeMaterial` we do by hand in GLSL,
because the Vulkan renderer has no node-material engine. The reference's lesson
is **architectural, not its 50-slider UI**: a scalar field plus its
screen-space gradient plus a real BRDF is a physical surface. We take the
architecture and drop the slider farm — see §4.

---

## 0. Status — what is already built

| Phase | State | Commit |
|-------|-------|--------|
| A — edge-distance attribute, bevel+wave normal, base BRDF | **done** | `50c7599`, `dba42ef` |
| B — per-tile material identity, field-driven channels, bulge normal | **done** | `73ba5aa` + bulge commit |
| C — sheen / clearcoat / iridescence / anisotropy lobes | **done** | `d2e43ea`, `7933d4d` |
| D — key + fill + ambient lights | **done** | `ea43bf6` |
| E — HDR offscreen + bloom + AgX tonemap | todo | — |
| F — parameterized look: settings, presets, modulation, border merge | in progress | material→UBO migration done (`43be608`) |

Phase A landed: `FillVertex` carries a per-triangle edge-distance basis
(`inBary`); `fill.frag` lifts a bevel chamfer height field from it, derives the
chamfer normal analytically from the screen-space gradient, folds in the ripple
field's analytic slope (`waveGradient`), and shades the result with a
single-key principled BRDF (Lambert + GGX) over an ambient term, calibrated so a
tile plateau reproduces its palette colour at brightness 1. Material parameters
are GLSL `const`s grouped at the top of `fill.frag`; they migrate to the UBO in
Phase B when audio/sliders need to reach them.

---

## 1. Where the renderer is now

Renderer is **Vulkan 1.3, dynamic rendering** (no `VkRenderPass` object),
drawing two pipelines straight to the swapchain image — **no depth buffer, no
offscreen/HDR target** (until Phase E). Two draws per frame: fill triangles,
then border quads. Shaders are GLSL 460, compiled by `glslc` in the NDK build.

**Files and ownership:**

| File | Owns |
|------|------|
| `cpp/renderer/render_state.h` | `FillVertex`, `BorderVertex`, `PushBlock`, `PaletteUbo` structs |
| `cpp/renderer/renderer_vulkan.cpp` | device / swapchain / pipeline setup, vertex-attribute descriptions |
| `cpp/renderer/renderer_geometry.cpp` | `buildGeometry()` (tiles → vertex lists), `updatePaletteUbo()` |
| `cpp/renderer/renderer.cpp` | lifecycle, `drawFrame` (per-frame UBO patch) |
| `shaders/fill.vert` / `fill.frag` | fill stage — displacement, parallax, bevel, BRDF |
| `shaders/border.vert` / `border.frag` | expanded-quad borders |

**Fill vertex** (`render_state.h`) — non-indexed, 3 verts pushed per triangle:

```c
struct FillVertex {
  float x, y; uint32_t colorIdx; float cx, cy; float depth;
  float bx, by, bz;   // edge-distance barycentric basis (Phase A)
};
```

→ `fill.vert` inputs `loc0..loc4`: `vec2 inPos`, `uint inColorIdx`,
`vec2 inCenter`, `float inDepth`, `vec3 inBary`.
→ `fill.vert` outputs `loc0..loc4`: `flat uint vColorIdx`, `flat float vRipple`,
`float vDepth`, `vec3 vBary`, `vec2 vWaveGrad`.

**Uniform block `PaletteUbo`** (`render_state.h`) — std140, **mirrored verbatim
in all four shaders** (see Risks):

```c
struct PaletteUbo {
  float palette[16][4]; float borderColor[4]; float bgColor[4];
  uint32_t flags[4]; float anim[4];      // anim:    x=time y=rippleAmt z=waveSym w=pageOffset
  float borderGeom[4]; float effects[4]; // effects: x=brightness y=depth z=rippleSpeed w=rippleKind
  float audioBands[2][4]; float audioBeat[4];
};
```

**Vertex attributes** are declared in `renderer_vulkan.cpp::buildPipelines` —
`VkVertexInputAttributeDescription fillAttrs[5]`. Adding an attribute = grow
that array + bump `vertexAttributeDescriptionCount`.

**Swapchain formats**: preferred is `A2B10G10R10_UNORM_PACK32` on the
Display-P3 colour space (10-bit), with sRGB 8-bit fallbacks — wide gamut and
the extra bit depth carry tonemapped highlights well.

**Already present, ready to exploit:**

- `fill.vert::waveGradient()` — the **analytic** 2-D slope of the ripple field.
  Phase A folds it into the shading normal; it is also the natural driver for
  audio-reactive surface motion.
- `inDepth` (parallax bulge, ±1 on one vertex) is linear across a triangle →
  exact analytic gradient, no `dFdx` needed.
- The palette is OKLCH-derived linear RGB from `color.cpp`, which also holds the
  sRGB and wide-gamut-P3 encode paths.
- `classify()` computes a per-tile **type**, **orientation**, and **ring
  distance** — today spent only on a colour bucket. These are free per-tile
  material-identity fields (see §4).
- Geometry is non-indexed: each triangle's 3 vertices are independent, so
  per-triangle attribute values are free to assign.
- The modulation **node graph** (`graph/`) already drives ripple / brightness /
  depth from the audio analyser every frame — the wiring point for Phase F.

---

## 2. Two tracks

Work splits into **tiling choice** (what we draw) and **surface
sophistication** (how it looks). This document drives the surface track in
full. The tiling track is tracked in `docs/tilings/ROADMAP.md`; its committed
next item is the **Hat / Spectre einstein** family — see §9. The two tracks are
independent and can progress in parallel.

---

## 3. The technique

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

| Reference (TSL / three.js) | Our Vulkan / GLSL equivalent |
|---|---|
| `dFdx` / `dFdy` | `dFdx` / `dFdy` (GLSL core → SPIR-V) |
| `MeshPhysicalNodeMaterial` | hand-written Cook-Torrance GGX + lobes in `fill.frag` |
| OKLab → linear-sRGB node | already in `color.cpp` and authored into the palette |
| ACES filmic tonemap | one GLSL function (we use AgX — §D) |
| directional / point / ambient lights | light vectors + colours in the UBO |
| `uniform()` param registry | `PaletteUbo` fields + the existing node graph |

**A tiling beats the reference's single disk in two structural ways.**

1. *Clean normals.* The reference must use `dFdx` of `H` because its field has
   no closed-form gradient, and `dFdx` across a discontinuity smears garbage. We
   assemble `H` from terms with **analytic** gradients — the bevel (piecewise-
   linear `inBary`), the parallax bulge (linear `inDepth`), and the already-
   analytic `waveGradient` — so the normal is exact and seam-clean.
2. *Per-tile material identity.* The reference has one field, so one material
   varying continuously. We have **discrete tiles**, each carrying type,
   orientation, and ring distance. Different physical channels can key to
   different structural fields: metalness by tile type, anisotropy along tile
   orientation, iridescence thickness by ring — material variation the tiling
   *is*, not material variation painted on. A single continuous disk cannot do
   this.

---

## 4. Material architecture — and why there is no slider farm

The reference exposes ~50 sliders. We do **not**. The architecture is kept; the
UI is replaced by structure + audio + a curated handful of controls.

**Channel-modulation pattern.** Every modulatable BRDF channel `X` is

```
X_effective = X_base  +  X_mod · f(field)
```

`X_base` is a constant from the active material preset. `f(field)` is a scalar
in roughly `[0,1]` drawn from one of the tiling's own fields. **The pairing of
channel to field is fixed in the shader by design intent — it is not a knob.**
That single decision is what removes ~30 sliders:

| Channel | Field it keys to | Read |
|---|---|---|
| normal | bevel `edgeDist` + bulge `vDepth` + wave `vWaveGrad` | beveled chips, domed tiles, lit ripple |
| roughness | bevel `edgeDist` (rougher in seam valleys) | free contact-grime / worn-edge read |
| metalness | per-tile `type` | structural — alternating tile kinds read as different metals |
| emissive | `max(vRipple, 0)` and/or per-tile `type` | ripple crests and chosen tiles glow |
| sheen intensity | bevel `edgeDist` (sheen rises toward grazing rim) | velvet catch along every tile edge |
| anisotropy direction | per-tile `orientation` from `classify()` | brushed-metal streaks aligned per tile |
| iridescence thickness | per-tile `ring` distance, offset by ripple/audio | oil-slick that shifts with distance and sound |

**The control surface.** Two layers, both real, neither audio-dependent:

- **Material presets** — a picker beside the palette picker, each a named
  bundle of `MaterialParams` values (`Matte`, `Ceramic`, `Pearl`,
  `Brushed metal`, `Lacquer`, `Oil-slick`). A one-tap starting point.
- **Per-parameter settings** — every `MaterialParams` field is user-settable,
  grouped in the settings drawer (Surface / Lobes / Lighting). A preset seeds
  the group; the user tunes from there. The whole look is reachable with no
  audio running — essential for a static live wallpaper or lock screen.

**Modulation.** Every parameter is also a target of the existing node graph,
which evaluates against audio bands, the beat, and a clock; Phase F adds the
home-screen pan offset as a fourth source. A target's graphed value *adds
onto* its settings base, so modulation rides on top of whatever the user set:
the wallpaper can sit still, breathe to a clock, sway with home-screen
panning, or pulse to sound. The channel→field pairings in the table above
stay fixed in the shader; what the user sets and the graph drives is the
parameters.

**Storage.** Per-tile identity reaches the shader as the `inTileMat` vertex
attribute (Phase B). The material and light parameters are `PaletteUbo` rows
packed from a `MaterialParams` struct (done, `43be608`). Phase F connects that
struct to the persisted settings and the node graph.

---

## 5. The pipeline — phases

Phase A is done (§0). Each remaining phase is one commit-sized, on-device-
verifiable step; phase N renders correctly on its own.

### Phase B — per-tile material identity, field-driven channels, bulge normal — done

- **`inTileMat` attribute.** `vec4 inTileMat` on `FillVertex` = type normalised
  over the family's distinct kinds, the unit `(cos,sin)` of the `ClassSpec`
  classifier edge, and the centroid radius — written per tile in
  `buildGeometry()`; `fillAttrs` 5→6.
- **Field-driven channels.** `fill.frag` keys physical channels off the
  tiling's own fields: `roughness = base + mod·seam` (seam = `1 − smoothstep`
  of `edgeDist`) for a worn-edge read; `metalness = base + mod·inTileMat.x` so
  distinct tile types read as distinct metals; an `emissive` term glows on the
  ripple crest.
- **Bulge in the normal.** The parallax-depth field is linear over each
  triangle, so its model-space gradient is exact and constant per triangle.
  `buildGeometry()` solves the 2×2 system for that gradient direction;
  `fill.frag` tilts the shading normal along it. The bulge is real shading
  relief — and neither it nor the ripple modulates albedo any more.

The material `X_base` constants live as `fill.frag` `const`s. Phase D moves
them into `PaletteUbo` alongside the light uniforms it adds there; the Phase F
Material preset picker then writes those rows.

### Phase C — sheen, clearcoat, iridescence, anisotropy — done

Four BRDF lobes hand-written in `fill.frag`, ported from the glTF Sample
Viewer GLSL (commits `d2e43ea`, `7933d4d`):

- **Sheen.** Estevez–Kulla "Charlie" distribution with Ashikhmin visibility —
  a retroreflective velvet lobe that peaks at grazing angles, so the beveled
  chamfers gain a soft fabric rim. Tinted by `kSheenColor`, independent of
  metalness.
- **Clearcoat.** A second tight GGX lobe at the fixed dielectric F0 0.04. Its
  Fresnel attenuates the base lobes by `(1 − clearcoat·Fc)` to conserve energy.
- **Anisotropy.** The base GGX is replaced by the anisotropic `D`/`V` pair; the
  tangent frame is the per-tile orientation (`inTileMat.yz`) re-orthogonalised
  against the shading normal, so each tile streaks its highlight along its own
  classifier edge. `at == ab` is exact isotropy, so the term degrades cleanly.
- **Iridescence.** A thin-film interference Fresnel (Belcour & Barla 2017)
  blended over the plain Schlick Fresnel. Film thickness sweeps with the tile's
  distance from the origin (`inTileMat.w`) and the ripple phase, so an
  oil-slick drifts across the tiling and pulses with the wave.

The lobe `X_base` values are `fill.frag` `const`s; Phase D moves the material
and light block into `PaletteUbo`, and the Phase F preset picker drives it.

### Phase D — key + fill + ambient lights — done

`fill.frag`'s single hard-coded key light is replaced by a key + fill +
ambient rig, and the per-light BRDF is factored into `shadeLight()` —
anisotropic GGX + iridescent Fresnel, Lambert diffuse, Charlie sheen, and the
clearcoat lobe, evaluated once per light (commit `ea43bf6`). The fill is
dimmer, cooler, and opposite the key — bounce light; the ambient is a faint
tinted flat term. The iridescent Fresnel is view-only, so it is evaluated once
and shared by both lights. Intensities are recalibrated so a flat non-metal
plateau still reproduces its palette colour.

The tonemap is **not** done in-shader. AgX needs a linear working space, and
`fill.frag` writes directly to a swapchain that is either hardware-sRGB or
already-encoded P3 — an in-shader tonemap would be wrong on the P3 path. It
belongs in Phase E's composite pass, which owns a linear HDR buffer and the
single encode. Light and material constants stay `fill.frag` `const`s;
Phase F migrates them to `PaletteUbo`.

### Phase E — HDR offscreen + bloom + AgX tonemap

A real post chain so specular and clearcoat glints and emissive ripple crests
resolve and glow instead of clipping. This is also where tonemapping correctly
belongs — the composite pass owns a linear HDR buffer and the single colour
encode, so AgX is applied once, in linear, regardless of the swapchain path.

- Add an `R16G16B16A16_SFLOAT` offscreen colour attachment sized to the
  swapchain; the fill and border pipelines render into it as linear HDR.
- A **dual-Kawase bloom**: luminance-thresholded downsample chain (~5 mips) then
  upsample-combine — ~5 small pipelines, cheap on mobile.
- A fullscreen **composite/tonemap pass**: sample HDR + bloom, AgX tonemap, then
  the `color.cpp` encode, write to the swapchain.
- Vulkan work: offscreen images + views + a sampler + the bloom and composite
  pipelines + descriptor sets. Dynamic rendering keeps each pass a plain
  begin/end-rendering.
- **Files:** `renderer_vulkan.cpp` (attachments, samplers, pipelines);
  `renderer.cpp` (`drawFrame` pass sequence); new `shaders/bloom_down.frag`,
  `bloom_up.frag`, `composite.frag`.
- **Done when:** bright tiles and wave crests bloom; the composite pass owns
  tonemap + encode; `fill.frag` writes linear HDR.

### Phase F — parameterized look: settings, presets, modulation, border merge

The material is fully in the UBO (done — `MaterialParams` → `PaletteUbo`,
commit `43be608`). Phase F connects it to the user and the graph.

- **Settings + presets.** `MaterialParams` becomes a persisted settings
  record. A Material preset picker beside the palette picker seeds it
  (`Matte`, `Ceramic`, `Pearl`, `Brushed metal`, `Lacquer`, `Oil-slick`); the
  settings drawer exposes the fields, grouped (Surface / Lobes / Lighting).
  `updatePaletteUbo` packs the live settings in place of the defaults.
- **Modulation sources.** The node graph already evaluates against audio
  bands, the beat, and a clock. Add the home-screen pan offset as a fourth
  source, and expose every material parameter as a graph target whose value
  *adds onto* its settings base. The per-frame UBO patch writes the modulated
  result. The wallpaper then sits exactly as set, or breathes to a clock,
  sways with home-screen panning, or pulses to sound — the user's choice, and
  every look is reachable with no audio at all.
- **Border merge.** Draw the border inside `fill.frag` as a `smoothstep` on
  the Phase-A `edgeDist`; remove the `border.*` shaders, the `BorderVertex`
  path, and the border pipeline. One pipeline draws fill + border.
- **Done when:** every look is reachable from the settings UI with no audio;
  presets seed it; the graph layers audio / clock / pan on top; one pipeline
  draws fill + border.

---

## 6. Files touched — master list

| File | Phase(s) | Change |
|------|----------|--------|
| `render_state.h` | A✓ B✓ F | `FillVertex` `inBary` + `inTileMat` done; `PaletteUbo` material/light rows (F) |
| `renderer_vulkan.cpp` | A✓ B✓ E F | vertex attributes done; offscreen + bloom + composite pipelines (E); drop border pipeline (F) |
| `renderer_geometry.cpp` | A✓ B✓ F | edge basis + `inTileMat` done; UBO writes, drop border build (F) |
| `renderer.cpp` | E F | multi-pass `drawFrame` (E); audio-graph targets (F) |
| `shaders/fill.vert` | A✓ B✓ | `inBary`, `inBulge`, `vWaveGrad`, `inTileMat` — done |
| `shaders/fill.frag` | A✓ B✓ C✓ D✓ F | normal, channels, four lobes, key/fill/ambient lights done; border merge (F) |
| `shaders/uniforms.glsl` (new) | F | shared uniform block, `#include`d, added with the UBO migration |
| `shaders/border.*` | F | removed |
| `shaders/bloom_down/up.frag`, `composite.frag` (new) | E | post chain + AgX tonemap |
| node-graph params + Android UI | F | Material preset picker; curated audio-modulation targets |

---

## 7. Risks / gotchas

- **The uniform block is duplicated across four shaders.** Any `PaletteUbo`
  change must land identically in `fill.vert`, `fill.frag`, `border.vert`,
  `border.frag` or std140 offsets drift and every uniform reads garbage.
  Phase F factors the block into a shared `shaders/uniforms.glsl` and
  `#include`s it — `glslc` resolves `#include` relative to the source file by
  default, so no build-script change is needed beyond adding `*.glsl` to the
  shader task's input-tracking glob (so an edit retriggers compilation) while
  keeping it out of the compile list.
- `dFdx` / `dFdy` are valid only in the fragment stage under uniform control
  flow — satisfied here. The bevel `min()` crease is the one non-smooth point;
  it is the intended bevel ridge, not an artefact.
- There is no depth buffer and none is added — the normal is a *shading*
  normal; this is not a Z-test.
- Mobile cost: GGX + clearcoat + sheen + iridescence + three lights is
  comfortably real-time on any Vulkan-capable mobile GPU (the reference runs a
  per-fragment zero-loop *and* the full physical material and holds frame rate).
  If a low-end tier is ever needed, gate the heavier lobes behind a preset flag.
- `tools/verify_tilings.cpp` is unaffected — tiling topology never changes; the
  new attributes are pure shading data.
- Material and light params live as `fill.frag` `const`s. Phase F migrates them
  to the UBO; until then, editing the look means editing the shader and they
  cannot be driven by audio or sliders.

---

## 8. Verification

- `glslc` compiles all shaders — the NDK build does this. Locally,
  `glslangValidator -V --target-env vulkan1.3 <shader>` validates a shader to
  SPIR-V without the full Android build (used to check Phase A).
- CI: `assembleRelease`, `lintRelease`, the `tiling-verify` job, and the UBSan
  build stay green.
- On-device per phase, as listed in each phase's "done when".

---

## 9. Tiling track — committed next item

`docs/tilings/ROADMAP.md` and `docs/tilings/catalogue.md` mark the **Hat /
Spectre einstein** as the next family. It is a 2023 result
(Smith–Myers–Kaplan–Goodman-Strauss): the Hat is a 13-edge polykite tiling
aperiodically with reflections; the Spectre is the strictly chiral monotile,
needing no reflected copies. Both carry a published **metatile substitution**
(H, T, P, F clusters) that is volume-hierarchic — it enters the engine the way
the Danzer family did: one `FamilyInfo` row plus one geometry function that runs
the metatile substitution and maps metatiles to Hat/Spectre outlines, checked by
`tools/verify_tilings.cpp`. The Spectre's curved-edge variant reads as
interlocking organic forms, visually unlike anything else in the app. This
track is independent of the render phases above and can run alongside them.
