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
| C — sheen / clearcoat / iridescence / anisotropy lobes | todo | — |
| D — key + fill + ambient lights, light tint, tonemap | todo | — |
| E — HDR offscreen + bloom | todo | — |
| F — border merge + curated audio-graph wiring | todo | — |

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

**Where the user-facing controls actually are.** Total new controls across all
phases, deliberately small:

- **One "Material" preset picker**, sitting beside the existing palette picker.
  Each preset is a bundle of the `X_base` constants — the reference's own answer
  to slider overload was exactly this (its `Metallic` / `Pearl` / `Bubblegum`
  presets). Target set: `Matte`, `Ceramic`, `Pearl`, `Brushed metal`,
  `Lacquer`, `Oil-slick`.
- **2–3 sliders only**: surface relief (bevel + wave normal strength), gloss
  (a single value steering roughness + clearcoat together), key-light azimuth.
- **The audio graph** drives the motion. The node graph already exists and
  already maps audio bands → ripple / brightness / depth. Phase F adds a *small,
  curated* set of new graph targets — light azimuth, iridescence thickness,
  gloss — so the surface polishes, the light orbits, and the oil-slick pumps on
  transients. Not "every uniform is a target": a handful chosen for musicality.

Everything else — which channel keys to which field, the modulation amounts —
is fixed in the shader. The material is expressive because the *tiling* and the
*audio* are expressive, not because the user tunes 50 numbers.

**Storage.** Per-tile `type` / `orientation` / `ring` reach the shader as one
`vec4` vertex attribute, `inTileMat`, written by `buildGeometry()` (Phase B).
The `X_base` constants stay `fill.frag` `const`s; Phase D appends them as
`PaletteUbo` `vec4` rows (std140, all vec4-aligned — see Risks for the
shared-include mitigation) when it grows the UBO for the light uniforms, and
the Phase F preset picker drives those rows.

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

### Phase C — sheen, clearcoat, iridescence, anisotropy

Hand-written lobes added to `fill.frag`, summed with the Phase-A GGX. Reference
implementations are the glTF Sample Viewer GLSL — port, do not re-derive (the
exact functions are checked against the live sources):

- **Sheen** — `KHR_materials_sheen`: Estevez–Kulla "Charlie" distribution
  `D_Charlie` + `V_Sheen` (with its `lambdaSheen` numeric fit, ~25 lines total).
  Sheen colour is an OKLCH value from the preset; intensity keys to `edgeDist`.
- **Clearcoat** — `KHR_materials_clearcoat`: a second `D_GGX`/`V_GGX` lobe at
  fixed F0 0.04 with its own roughness, layered over the base lobes;
  energy-conserve by attenuating the base by `(1 − Fc)`.
- **Anisotropy** — `D_GGX_anisotropic` + `V_GGX_anisotropic` (the `at`/`ab`
  split-roughness form). The tangent frame is `inTileMat.yz` — the per-tile
  orientation already in the attribute — so each tile gets brushed-metal
  streaks aligned to its own classifier edge. A single continuous field cannot
  do this; the tiling can.
- **Iridescence** — `KHR_materials_iridescence` (Belcour & Barla 2017): the
  thin-film term `evalIridescence(outsideIOR, eta2, cosθ1, thickness, baseF0)`
  with its `evalSensitivity` spectral fit (~80 lines). Film thickness keys to
  `inTileMat.w` (centroid radius) offset by ripple/audio so the slick shifts
  across the tiling and with the music.
- **Done when:** the `Pearl` and `Oil-slick` presets read as iridescent; sheen
  catches a velvet rim on grazing tiles; clearcoat adds a wet gloss layer;
  brushed-metal presets streak along each tile's orientation.

### Phase C — sheen, clearcoat, thin-film iridescence

Hand-written lobes added to `fill.frag`, summed with the Phase-A GGX. Reference
implementations are the glTF Sample Viewer GLSL — port, do not re-derive:

- **Sheen** — `KHR_materials_sheen`: Estevez–Kulla "Charlie" sheen distribution
  `D_Charlie` + `V_Ashikhmin`/`V_Charlie` visibility (~15 lines). Sheen colour
  is an OKLCH value from the preset; intensity keys to `edgeDist` (§4).
- **Clearcoat** — `KHR_materials_clearcoat`: a second GGX lobe at fixed F0 0.04,
  its own roughness, layered over the base lobes; energy-conserve by attenuating
  the base by `(1 − Fc)`.
- **Iridescence** — `KHR_materials_iridescence` (Belcour & Barla 2017, "A
  Practical Extension to Microfacet Theory for the Modeling of Varying
  Iridescence"): the thin-film term `evalIridescence(outIOR, eta2, cosθ1,
  thickness, baseF0)` with its `evalSensitivity` spectral fit (~80 lines). Film
  thickness keys to the per-tile `ring` field offset by ripple/audio so the
  slick shifts across the tiling and with the music.
- **Done when:** the `Pearl` and `Oil-slick` presets read as iridescent; sheen
  catches a velvet rim on grazing tiles; clearcoat adds a wet gloss layer.

### Phase D — lights + tonemap

- **Lights.** Replace Phase A's single hard-coded `const` light with a key
  directional + fill point + ambient, each an OKLCH-tinted colour, positions
  from azimuth/elevation. Store light vectors + colours in `PaletteUbo`;
  `updatePaletteUbo()` writes them. Key azimuth is the one light slider; the
  rest are preset constants.
- **Tonemap.** Apply **AgX** in `fill.frag` before the existing OKLCH/P3 encode
  so specular, clearcoat, and emissive highlights resolve instead of clipping.
  AgX is preferred over the reference's ACES for its lower hue-shift on
  saturated colours — it protects the authored OKLCH palette. ACES filmic is an
  acceptable fallback. (Promoted to a real post pass in Phase E.)
- **Done when:** the key light sweeps highlights as its azimuth changes; the
  10-bit P3 swapchain shows smooth tonemapped rolloff with no banding.

### Phase E — HDR offscreen + bloom

Promote tonemapping from in-shader to a real post chain so highlights and
emissive tile-cores glow.

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

### Phase F — border merge + curated audio-graph wiring

- **Border merge.** Draw the border inside `fill.frag` as a `smoothstep` on the
  Phase-A `edgeDist`; remove the `border.*` shaders, the `BorderVertex` path,
  and the border pipeline. One pipeline draws fill + border.
- **Curated graph wiring.** Add a *small* set of new modulation-graph targets —
  key-light azimuth, iridescence thickness, gloss — to the existing node graph
  (`graph/`). Audio then drives the surface: light orbits on the beat, the
  oil-slick pumps, gloss tracks energy. Deliberately not "every uniform" — see
  §4.
- **Done when:** a Material picker sits beside the palette picker; the surface
  is audio-reactive through the graph; one pipeline draws fill + border.

---

## 6. Files touched — master list

| File | Phase(s) | Change |
|------|----------|--------|
| `render_state.h` | A✓, B | `FillVertex` (+`inBary`✓, +`inTileMat`); `PaletteUbo` (+material/light rows) |
| `renderer_vulkan.cpp` | A✓, B, E, F | vertex attrs; offscreen + bloom + composite pipelines; drop border pipeline |
| `renderer_geometry.cpp` | A✓, B, F | edge basis✓; `inTileMat` from `classify()`; UBO material/light writes; drop border build |
| `renderer.cpp` | E, F | `drawFrame` multi-pass sequence; graph targets |
| `shaders/fill.vert` | A✓, B | pass `inBary`✓, `vWaveGrad`✓; pass `inTileMat` |
| `shaders/fill.frag` | A✓, B, C, D, F | bevel+wave normal✓, base BRDF✓; channels, lobes, lights, tonemap, border |
| `shaders/uniforms.glsl` (new) | B | shared uniform block, `#include`d (see Risks) |
| `shaders/border.*` | F | removed |
| `shaders/bloom_down/up.frag`, `composite.frag` (new) | E | post chain |
| node-graph params + Android UI | B, F | Material preset picker; curated modulation targets |

---

## 7. Risks / gotchas

- **The uniform block is duplicated across four shaders.** Any `PaletteUbo`
  change must land identically in `fill.vert`, `fill.frag`, `border.vert`,
  `border.frag` or std140 offsets drift and every uniform reads garbage.
  Phase B factors the block into a shared `shaders/uniforms.glsl` and
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
- Material params currently live as `fill.frag` `const`s. They must move to the
  UBO in Phase B *before* audio/sliders can reach them; until then, editing the
  look means editing the shader.

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
