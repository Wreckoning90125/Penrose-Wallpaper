# Physical-material rendering — plan

The renderer is geometrically complete (11 tiling families, closure-verified by
`tools/verify_tilings.cpp`, table-driven). Visually it is still flat-shaded
polygons. This document is the single pick-up point for turning the tiling into
a lit, beveled, physical surface. It carries the full context, the technique,
and a five-phase build sequence — every phase is committed work; the order is
sequencing, not optionality.

---

## 1. Where the renderer is now

Branch base: `main` after the eight-family / verifier / doc-tree merge (PR #3).
Renderer is **Vulkan, dynamic rendering** (no `VkRenderPass` object), drawing
two pipelines straight to the swapchain image — **no depth buffer, no
offscreen/HDR target**. Two draws per frame: fill triangles, then border quads.

**Files and ownership:**

| File | Lines | Owns |
|------|-------|------|
| `cpp/renderer/render_state.h` | 60 | `FillVertex`, `BorderVertex`, `PushBlock`, `PaletteUbo` structs |
| `cpp/renderer/renderer_vulkan.cpp` | 660 | device / swapchain / pipeline setup, vertex-attribute descriptions |
| `cpp/renderer/renderer_geometry.cpp` | 345 | `buildGeometry()` (tiles → vertex lists), `updatePaletteUbo()` |
| `cpp/renderer/renderer.cpp` | 638 | lifecycle, `drawFrame` |
| `shaders/fill.vert` | 106 | fill vertex stage — wave displacement, parallax |
| `shaders/fill.frag` | 35 | fill fragment — flat `palette[idx] × brightness × depth × ripple` |
| `shaders/border.vert` / `border.frag` | 62 / 20 | expanded-quad borders |

Shaders are GLSL 460, compiled by `glslc` in the NDK build.

**Fill vertex** (`render_state.h:24`) — non-indexed, 3 verts pushed per triangle:

```c
struct FillVertex { float x, y; uint32_t colorIdx; float cx, cy; float depth; };
```

→ `fill.vert` inputs: `loc0 vec2 inPos`, `loc1 uint inColorIdx`,
`loc2 vec2 inCenter`, `loc3 float inDepth`.

**Uniform block `PaletteUbo`** (`render_state.h:48`) — std140, **mirrored
verbatim in all four shaders**:

```c
struct PaletteUbo {
  float palette[16][4]; float borderColor[4]; float bgColor[4];
  uint32_t flags[4]; float anim[4];      // anim:    x=time y=rippleAmt z=waveSym w=pageOffset
  float borderGeom[4]; float effects[4]; // effects: x=brightness y=depth z=rippleSpeed w=rippleKind
  float audioBands[2][4]; float audioBeat[4];
};
```

**Vertex attributes** are declared at `renderer_vulkan.cpp:400` —
`VkVertexInputAttributeDescription fillAttrs[4]`, formats
`R32G32_SFLOAT / R32_UINT / R32G32_SFLOAT / R32_SFLOAT`. Adding an attribute =
grow that array + the pipeline's `vertexAttributeDescriptionCount`.

**Swapchain formats** (`renderer_vulkan.cpp:44`): preferred is
`A2B10G10R10_UNORM_PACK32` on the Display-P3 colour space (10-bit), with sRGB
8-bit fallbacks.

**Already present, ready to exploit:**

- `fill.vert` computes `waveGradient()` — the **analytic** 2-D slope of the
  ripple field. Used today only to displace vertices; it is exactly the wave's
  contribution to a surface normal, for free.
- `inDepth` (parallax bulge, ±1 on one vertex) is linear across a triangle →
  constant analytic gradient.
- The palette is OKLCH-derived linear RGB from `color.cpp`, which also holds the
  sRGB and wide-gamut-P3 encode paths.
- `classify()` computes a per-tile **orientation** (currently spent only on a
  colour bucket).
- Geometry is non-indexed: each triangle's 3 vertices are independent, so
  per-triangle attribute values are free to assign.

---

## 2. Two tracks

Work splits into **tiling choice** (what we draw) and **surface
sophistication** (how it looks). This document drives the surface track in
full. The tiling track is tracked in `docs/tilings/ROADMAP.md`; its committed
next item is the **Hat / Spectre einstein** family — see §8. The two tracks are
independent and can progress in parallel.

---

## 3. The technique

Reference studied: a TSL/WebGPU hyperbolic audio visualiser. Stripped of the
framework, the whole render is:

- A **flat** surface, geometric normal `(0,0,1)`, orthographic view.
- A scalar field `H(x,y)` treated as a **height field**.
- The surface normal reconstructed *per fragment* as
  `normalize(vec3(-dHdx·s, -dHdy·s, 1))`. No height geometry, no normal-map
  texture.
- That normal drives a **full principled BRDF** (Disney / MaterialX standard
  surface): base colour, roughness, metalness, clearcoat, sheen, thin-film
  iridescence, emissive, IOR.
- Real lights (directional key + point fill + ambient), OKLab colour, filmic
  tonemap on output.

The idea underneath: **a 3-D-looking physical surface needs only a scalar
field, its screen-space gradient as a normal, and a real BRDF — not 3-D
geometry.**

**It is all portable shader math.** TSL is a node front-end that compiles to
WGSL; every node maps one-to-one to GLSL we already compile:

| Reference (TSL / three.js) | Our Vulkan / GLSL equivalent | Status |
|---|---|---|
| `dFdx` / `dFdy` | `dFdx` / `dFdy` (GLSL core → SPIR-V) | available |
| `MeshPhysicalNodeMaterial` | hand-written Cook-Torrance GGX + lobes in `fill.frag` | ~250 lines, standard |
| OKLab → linear-sRGB | already in `color.cpp` and the shader | present |
| filmic tonemap | one GLSL function | available |
| directional / point / ambient lights | light uniforms | trivial |
| storage-buffer attributes | Vulkan SSBO / vertex attributes | present |
| `uniform()` param registry | the node-graph editor's params | present, richer |

**A tiling beats the reference's single disk in two structural ways.** The
reference must use `dFdx` of `H` because its field has no closed-form gradient,
and `dFdx` across a tiling seam smears garbage (the 2×2 quad straddles a
discontinuity). We assemble `H` from terms with **analytic** gradients —
bevel, bulge, and the already-analytic `waveGradient` — so the normal is exact
and seam-clean. And because we have discrete tiles, each tile carries its own
material identity: orientation-aligned anisotropy, type-driven material sets,
the substitution hierarchy expressible as material change across scale — none
of which a single continuous disk can do.

---

## 4. The pipeline — five phases

Each phase is one commit-sized, on-device-verifiable step. Phase N renders
correctly on its own; Phase N+1 builds on it.

### Phase 1 — edge-distance vertex attribute

One attribute delivers analytic anti-aliasing, exact borders, and the **bevel
height field**.

- Add `float edge[3]` to `FillVertex` (a `vec3`). Single-pass-wireframe basis:
  within a triangle, vertex *k* carries `1` in component *k*, `0` elsewhere;
  interpolated component *k* falls linearly to `0` along the edge **opposite**
  vertex *k*. `min(edge.x, edge.y, edge.z)` per fragment is distance-to-nearest-
  edge.
- **Mask internal fan cuts.** Tiles that are not triangles (rhombs, Chair, P1)
  are fanned into triangles in `buildGeometry()`; the fan diagonals are not
  real tile boundaries and must not bevel. Rule: if the edge opposite vertex
  *k* is an internal diagonal, set component *k* to `1` at all three vertices →
  that component is ≡1 and never the `min` near a real seam. Plain triangle
  families (P3, P2, Tübingen, Danzer, Pinwheel) use the standard
  `(1,0,0)/(0,1,0)/(0,0,1)` basis; fanned convex polygons mark the two
  vertex-0 diagonals internal; the P1 centroid-fan marks the two spokes
  internal.
- **Files:** `render_state.h` (`FillVertex`); `renderer_vulkan.cpp`
  (`fillAttrs` 4→5, format `R32G32B32_SFLOAT`, bump count); `renderer_geometry.cpp`
  (`buildGeometry` sets `edge[3]` per triangle, beside the fan loops at
  `renderer_geometry.cpp:105-154`); `fill.vert` (`loc4 in vec3 inEdge` →
  interpolated `out vec3 vEdge`).
- **Done when:** the tiling renders unchanged, plus the border can be drawn (a
  `smoothstep` on `min(vEdge)`) and matches the existing border-quad output.

### Phase 2 — height field + analytic normal

In `fill.frag`, build a per-fragment height `H` as the sum of three terms,
each with a clean gradient:

- **Bevel:** `edge = min(vEdge.x, vEdge.y, vEdge.z)`;
  `Hb = bevelDepth · smoothstep(0, bevelWidth, edge)` — `0` at the seam, full
  inside. `vEdge` is piecewise-linear and continuous within a triangle, so
  `dFdx(edge)/dFdy(edge)` are clean; the only crease is the `min` switch, which
  is the bevel ridge itself.
- **Bulge:** `Hu = depthAmount · vDepth` (reuse `effects.y` and the existing
  `vDepth` varying). Linear across the triangle → constant gradient.
- **Wave:** add varying `out vec2 vWaveGrad` to `fill.vert`, set it to
  `waveGradient(inPos, …)` (already computed there) — the fragment shader gets
  the wave slope with no recomputation.
- **Normal:** `N = normalize(vec3(-dHdx, -dHdy, 1))`, where
  `dHdx = dFdx(Hb) + dFdx(Hu) + vWaveGrad.x · waveHeightScale` (likewise y).
  Tangent space is the wallpaper plane — for a flat 2-D tiling that is the
  shading frame. This is a shading normal only; no depth buffer is involved.
- **Files:** `fill.vert` (emit `vWaveGrad`); `fill.frag` (height + normal).
- **Done when:** a debug view of `N` shows clean per-tile bevels, smooth
  bulges, and wave slope, with no fizz along internal fan cuts.

### Phase 3 — principled BRDF + lights

The screenshot-changing phase: tiles become lit physical inlay.

- **Uniforms** — append to `PaletteUbo` and the block in all four shaders:
  `light0` (key direction.xyz + intensity.w), `light0col`, `light1` (fill point
  pos.xyz + intensity), `light1col`, `lightAmb`, `material` (roughness,
  metalness, clearcoat, clearcoatRoughness), `material2` (sheen, specular,
  bevelDepth, bevelWidth). `updatePaletteUbo()` writes them.
- **`fill.frag` shading:** base colour = `palette[idx]` (Type/Orient/Ring still
  pick it) as albedo; then a principled BRDF against the Phase-2 normal —
  Lambert/Burley diffuse, Cook-Torrance GGX specular (`D_GGX`, `V_SmithGGX`,
  `F_Schlick`), a clearcoat GGX lobe, a Charlie/velvet sheen lobe. Sum over key
  + fill + ambient. Reference implementations: Filament's shading-model doc and
  the glTF-Sample-Viewer.
- **Output:** apply an AgX tonemap in-shader before the existing OKLCH/P3
  encode so specular highlights resolve instead of clipping. The 10-bit P3
  swapchain carries this well.
- **Files:** `render_state.h` (`PaletteUbo`); all four shaders (uniform block);
  `renderer_geometry.cpp` (`updatePaletteUbo`); `fill.frag` (BRDF + tonemap).
- **Done when:** the key light sweeps highlights across tiles as it moves;
  seams read as valleys the light falls into (free contact darkening from the
  bevel normal); every family reads as physical inlay.

### Phase 4 — HDR offscreen + bloom + AgX post pass

Promote tonemapping from in-shader to a real post chain so highlights and
emissive tile-cores glow.

- Add an `R16G16B16A16_SFLOAT` offscreen colour attachment sized to the
  swapchain; the fill and border pipelines render into it.
- A **dual-Kawase bloom**: a luminance-thresholded downsample chain (~5 mips)
  then an upsample-combine — ~5 small pipelines, cheap.
- A fullscreen **composite/tonemap pass**: sample HDR + bloom, AgX tonemap,
  then the `color.cpp` encode (sRGB or wide-gamut P3), write to the swapchain.
- Vulkan work: offscreen images + views + a sampler + the bloom and composite
  pipelines + descriptor sets. Dynamic rendering keeps each pass a plain
  begin/end-rendering.
- **Files:** `renderer_vulkan.cpp` (attachments, samplers, bloom + composite
  pipelines); `renderer.cpp` (`drawFrame` pass sequence); new
  `shaders/bloom_down.frag`, `bloom_up.frag`, `composite.frag`.
- **Done when:** bright tiles and wave crests bloom; the composite pass owns
  tonemap + encode; `fill.frag` writes linear HDR.

### Phase 5 — anisotropy, iridescence, node-graph wiring, border merge

Completes the material system and removes the border-quad pipeline.

- **Anisotropy:** `buildGeometry()` writes the `classify()` per-tile
  orientation as a vertex attribute (a tangent `vec2`); `fill.frag` runs an
  anisotropic GGX along it — brushed-metal streaks aligned per tile.
- **Iridescence:** a thin-film interference lobe (Belcour–Barla 2017), film
  thickness (nm) and IOR as uniforms.
- **Node-graph wiring:** every material / light / bevel uniform becomes a
  modulation target in the existing node-graph editor — roughness, sheen,
  clearcoat, film thickness, key-light azimuth, bevel height. The audio
  pipeline then drives the surface: light orbits, film thickness pumps, the
  surface polishes and roughens on transients.
- **Border merge:** draw the border inside `fill.frag` as a `smoothstep` on the
  Phase-1 edge distance; remove the `border.*` shaders, the `BorderVertex`
  path, and the border pipeline.
- **Files:** `render_state.h` (`FillVertex` orientation attr, `PaletteUbo`
  material fields); `renderer_vulkan.cpp` (attribute, drop border pipeline);
  `renderer_geometry.cpp` (write orientation, drop border build); `fill.frag`;
  the node-graph param registry + Android settings UI.
- **Done when:** a "material" picker sits beside the palette picker; the
  surface is audio-reactive through the node graph; one pipeline draws fill +
  border.

---

## 5. Files touched — master list

| File | Phase(s) | Change |
|------|----------|--------|
| `render_state.h` | 1, 3, 5 | `FillVertex` (+edge, +orientation); `PaletteUbo` (+light/material) |
| `renderer_vulkan.cpp` | 1, 4, 5 | vertex attrs; offscreen + bloom + composite pipelines; drop border pipeline |
| `renderer_geometry.cpp` | 1, 3, 5 | per-triangle edge basis; orientation attr; UBO writes; drop border build |
| `renderer.cpp` | 4 | `drawFrame` multi-pass sequence |
| `shaders/fill.vert` | 1, 2 | pass `inEdge`; emit `vEdge`, `vWaveGrad` |
| `shaders/fill.frag` | 2, 3, 5 | height field, normal, BRDF, anisotropy, iridescence, border |
| `shaders/border.*` | 5 | removed |
| `shaders/uniforms.glsl` (new) | 1 | shared uniform block (see Risks) |
| `shaders/bloom_down/up.frag`, `composite.frag` (new) | 4 | post chain |
| node-graph params + Android UI | 5 | material / light modulation targets |

---

## 6. Risks / gotchas

- **The uniform block is duplicated across four shaders.** Any `PaletteUbo`
  change must land identically in `fill.vert`, `fill.frag`, `border.vert`,
  `border.frag` or std140 offsets drift and every uniform reads garbage.
  Phase 1 factors the block into a shared `shaders/uniforms.glsl` and
  `#include`s it (`glslc` supports `#include` with `-I`); confirm the build
  script passes the include directory.
- `dFdx` / `dFdy` are valid only in the fragment stage under uniform control
  flow — satisfied here.
- There is no depth buffer and none is added — the normal is a *shading*
  normal; this is not a Z-test.
- Mobile cost: GGX + clearcoat + sheen + three lights is comfortably real-time
  on any Vulkan-capable mobile GPU (the reference runs a per-fragment loop and
  holds frame rate). A quality tier gates the heavier lobes: Low = flat +
  bevel, High = full PBR + bloom + iridescence.
- `tools/verify_tilings.cpp` is unaffected — tiling topology never changes;
  the new attributes are pure shading data.

---

## 7. Verification

- `glslc` compiles all shaders — the NDK build does this; runnable locally.
- CI: `assembleRelease`, `lintRelease`, the `tiling-verify` job, and the UBSan
  build stay green.
- On-device per phase, as listed in each phase's "done when".

---

## 8. Tiling track — committed next item

`docs/tilings/ROADMAP.md` and `docs/tilings/catalogue.md` mark the **Hat /
Spectre einstein** as the next family. It is a 2023 result
(Smith–Myers–Kaplan–Goodman-Strauss): the Hat is a 13-edge polykite tiling
aperiodically with reflections; the Spectre is the strictly chiral monotile,
needing no reflected copies. Both carry a published **metatile substitution**
(H, T, P, F clusters) that is volume-hierarchic — it enters the engine the way
the Danzer family did: one `FamilyInfo` row plus one geometry function that
runs the metatile substitution and maps metatiles to Hat/Spectre outlines,
checked by `tools/verify_tilings.cpp`. The Spectre's curved-edge variant
(`Tile(1,1)`) reads as interlocking organic forms, visually unlike anything
else in the app. This track is independent of the five render phases above and
can run alongside them.
