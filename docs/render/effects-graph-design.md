# Effects / Field / Projection Graph — design spec

Status: design (brainstorm output). This is **Block 1 of a larger control-graph
overhaul**. It defines how the web control graph stops being decorative and
becomes the source of truth that _compiles_ the render pipeline ("full
authority"), starting with a chainable post-FX system and the node architecture
the rest of the overhaul reuses.

Governing rules live in and are NOT restated here — read first:

- [`tsl-post-fx-model.md`](tsl-post-fx-model.md) — renderer layer boundary, r184 TSL chain shape, repo ownership rules.
- [`../platform/control-graph-regressions.md`](../platform/control-graph-regressions.md) — graph/renderer failure cases that are hard requirements (no inert ports, ride/hold, no graph-wide `setNodes` for frame-rate state, frame-in/out, target-range modulation, measured handles).
- `../../.local/Zorin/MANIFEST.md` — the ranked technique backlog mined from the Zorin corpus (sources for the field/contour/projection work).
- Reference implementations: `.local/procedural-morphology-lab` (chainable FX + node-scoped routing), `.local/three-docs` + `.local/three-examples` (r184 `pass→effect→outputNode`), `.local/tpmsTsl.ts` (Mikkelsen luminance relief/contours), `.local/renderer.ts` (the `trails` "acid hands" feedback + mask modes), `.local/controls` (`MultiSwitch` 3-way pattern).

Code anchors (verified): `web/src/render/webgpuRenderer.ts` (renderer, `rebuildPostPipeline`, material/position nodes, `setAudioDrive`), `web/src/tiling/geometry.ts` (CPU mesh builder: `classify`, `createProjector`, emits `tileOrient/tileRing/tileCenter`), `web/src/flow/ControlGraph.tsx` (the graph; `evaluateAudioModulations`, `isValidGraphConnection`, presets), `web/src/types.ts`.

---

## 1. Problem & intent

The graph today is two things tangled together: a **decorative backbone**
(`atlas→tiling→…→display` edges that change zero pixels — verified: the edge list
never crosses the prop boundary; only `evaluateAudioModulations` reads edges, and
only for handles in `AUDIO_TARGET_RANGES`) and a **real modulation patch bay**
(analysis/clock/operators → setting-handle targets) that is keyed by **handle name
only**, so target-node identity is discarded.

The post-FX layer is a single hardcoded chain in `rebuildPostPipeline`
(pixelate→posterize→film→rgbShift→sobel-mix→optional afterImage), rebuilt only
when afterImage crosses zero. Everything else is uniform-driven.

Intent: make the graph the **authoritative, serializable description** the renderer
compiles, starting with post-FX, on rails that later carry surface/field and
projection. A wire must **determine execution, be a locked annotation, or not
exist**.

## 2. Architecture (the reusable foundation)

**2.1 Render-graph spec channel.** `ControlGraph` derives an ordered, wired spec
from the graph and pushes it to the renderer (new callback, sibling to
`onAudioModulation`). The spec is plain JSON-able data:

```
PostChainSpec = Array<{ id: string, kind: string, bypass: boolean, params: Record<string, number> }>
```

`params` already include this frame's resolved node-scoped modulation. This is the
**first fragment of a general render-graph spec**; surface/field and projection
fragments use the same channel later.

**2.2 Renderer-owned registry.** The renderer holds
`registry[kind] = { createUniforms(), apply(inputNode, uniforms): Node, domain, compose }`.
TSL builders + GPU resource lifecycles (RenderTargets, `updateBefore`, dispose)
live here — never in the UI. (`tsl-post-fx-model.md` boundary; R3F-style
declarative-description + reconciling-backend.)

**2.3 Recompile vs uniform split.** Signature = `spec.map(n => `${n.id}:${n.kind}:${n.bypass}`).join('|')`.
Topology/bypass change → rebuild `RenderPipeline.outputNode`. Param/modulation
change → write uniforms only (no recompile). This retires the afterImage rebuild
(afterimage becomes a normal node). Matches r184 `needsUpdate`-on-structure and
morphology's `lastChainSignature`.

**2.4 Pure-data catalog (shared, `three`-free).** `postFxCatalog` describes each
kind: label, icon, params (key/label/min/max/default/step), ports, domain,
compose mode. `ControlGraph` imports only this (preserves its zero-`three`
boundary, verified). Renderer keys TSL builders by the same `kind`.

**2.5 Node-scoped modulation `(nodeId, handle)`.** Resolve modulation per
(targetNodeId, targetHandle) — like morphology `sceneViewer.tsx:1480` — so N
nodes of the same kind don't collide. Legacy global-handle targets keep working
until the honesty pass unifies them. Target-range rule unchanged:
`clamp(baseline + graphValue*(max-min), min, max)`, ride/hold per
`control-graph-regressions.md`.

**2.6 Two execution domains, one system.** "Fold it all in" = the same
spec/registry/routing spans:

- **Frame-domain** (after `pass(scene,camera)`): the catalog in §3. Buildable now.
- **Surface/field-domain** (before scene pass; needs normals/geometry/feedback):
  the field/contour/shell work in §5. Next wave, identical rails.

## 3. Frame-domain catalog (Block 1, build now)

Standard node: `frame` in → `frame` out, one modulation inlet per param, a
`bypass` toggle. All params bind to `uniform()` (live, no recompile) unless marked
_structural_ (loop counts) which recompile. `L`=linear/pre-tonemap, `D`=display/post-tonemap.

Ranges are wide-on-purpose (user reviews numbers on screen). Full table with
defaults: see conversation §2 catalog; summary:

- **The six (rebuilt atomic):** Pixelate (custom `pixelateNode`, D) · Posterize (`posterize`, D) · Film grain (`film`, D) · RGB shift (`rgbShift`, D) · Sobel (mix `mix(in,sobel(in),m)`, D) · Afterimage (remapped to trail half-life → `damp=0.5^(1/frames)`, cap ≤0.985, D).
- **New r184 (verified frame-in/out, three 0.184.0):** Bloom (additive, L) · Dot screen (D) · Chromatic aberration (D) · Sepia (blend, D) · Bleach (blend, D) · Blur (`hashBlur`, L) · Anamorphic (additive, L; `samples` structural) · AA (one node, mode OFF/FXAA/SMAA; FXAA=D, SMAA=L; TAA later, needs velocity MRT).
- **Feedback node (3-way):** one node, `MultiSwitch` mode = **Afterimage / Trails / Both**. Internally two atomic kinds (`afterImage`, `trails`) so the data keeps them separable; the node emits one or both into the spec. `trails` = r184 port of `.local/renderer.ts` "acid hands": ping-pong `max(prev·decay, frame)` + feedback UV zoom/rotate + hue-per-cycle + mask 3-way (none/surface/inverse) via background-color distance (`palette.bg`, no MRT). Persistence remapped like afterimage; display-domain (bounded).
- **Contours (luminance, colorable):** Mikkelsen luminance-isolines (frame subset of `tpmsTsl.ts`) — `fwidth`-thresholded lines from luminance gradient; line **color is an independent control**. Source-selectable later (§5 unifies luminance/curvature/biharmonic/SDF sources).
- **SDF edge profiles (parilov):** bevel / halo / glow / relief keyed to **distance-from-tile-edge**. We already emit tile-edge geometry → bake/provide an edge SDF; profile is a 1-D ramp. Post-FX/field hybrid; folded into Block 1.
- **Tone-map node (output transform):** explicit positioned `renderOutput(node, AgX, sRGB)` with `RenderPipeline.outputColorTransform=false`; defaults just before Display; linear effects upstream, display effects downstream; soft warning if an effect is on the wrong side.

## 4. Compiler + graph UX (§3)

- **Compile:** walk `frame` edges Display→scene; collect ordered FX nodes; build `outputNode` by folding `registry[kind].apply` (replace/blend `out=f(in)`, additive `out=in.add(f(in))`, feedback = internal state). Recompile on signature change only.
- **Add** = add. **Delete** = delete
- **Add menu + toolbar go icon-based (lucide-react)** — the dense word-button row is replaced with compact icons (codex's prior attempt regressed; do it right per `control-graph-regressions.md` chrome rules).
- **3-way switches** (Feedback mode, Trails mask, future Contour source) reuse the `.local/controls` `MultiSwitch` pattern.
- **Ride/hold** applies to every FX param slider + its modulation (existing begin/end-edit + heldParams path).
- Honor all regression rules: measured handles + `useUpdateNodeInternals`, no graph-wide `setNodes` for frame-rate state, `nodrag/nopan/nowheel` discipline, No inert ports. no fake wires. IF A WIRE CAN BE DELETED AND NOTHING CHANGES ITS FAKE. IF I CAN REMOVE ALL WIRES FROM TILE TO RENDER SINK THE WHOLE APP IS FAKE.

## 5. Surface/field-domain (Block 2 — next wave, same rails)

Same spec/registry/routing, but nodes resolve **before** the scene pass into
material/position/attribute nodes (per `tsl-post-fx-model.md` surface layer).

- **Generalized field-source (the real ripple decoupling).** A field gets its **own
  frame** — its own domain, phase, orientation — _independent of the tiling_. The
  _relationship_ between field-frame and tiling-frame is the controllable thing
  (beyond "hold tiling steady"):
  - **Domain:** object / tile-local / projected / screen / quasicrystal-lift.
  - **Orientation:** lock to `tileOrient`, OR a separate cross-field, OR world/screen, OR rotate relative to tiling over time.
  - **Sizing operator:** local patch ↔ whole.
  - Routes to displacement.z / color.gain / material params / projection via typed adapters. Today's ripple becomes one preset ("plate"/Chladni vs "worm").
- **Dipole × orientation field** (`2021-Dipole` closed-form `φ=(p·r̂)/r³`, gradient `E`; tiles-as-charges). Orientation via the field-source's frame (NOT hardwired to `tileOrient`).
- **Contours, unified & colorable** — line **source selectable**: luminance (Mikkelsen) / curvature (`grinspun2006cds` shape operator) / **biharmonic scalar field (`jacobson2010mfe` mixed-FEM, GPU-iterable)** / distance-from-edge SDF (parilov). Lines independently colorable.
- **Full Mikkelsen normal-relief** (`tpmsTsl.ts`) — prior-frame luminance perturbs the shading **normal**; needs scene normals, so it lives here, not in post.
- **Peng volumetric shells** (`peng2004imt`) — distance-field shells around the surface (fur/cracks/relief).

## 6. Projection (Block 3)

- **Continuous** Euclid↔disk↔ball as GPU sliders (move the projection math to the
  shader; `boostCoordinateNodes` already proves Möbius works live). `hyp_scale`
  stops being dual-role/dead-in-Poincaré.
- **Closed-form conformal / holomorphic warps** beyond Möbius (`z^k`, `exp`,
  Joukowski, Schwarz–Christoffel, elliptic) — cheap per-pixel, angle-preserving,
  richer than Möbius. **Not** the solver-based conformal papers (`weber*`, Penner,
  `2021-Conformal` are offline — explicitly out for real-time).
- **Quasicrystal cut-and-project field** (parent-folder `harriss2004` / `radin` /
  `On_Canonical_Substitution`) — the deepest on-theme field.
- **Optional exotic:** Hopf fibration (parent `Hongwan_Liu-Hopf_fibration`),
  conformal cone-foci (hand-rolled closed-form, not the solver).

## 7. The rest of the overhaul (do not forget)

- **Graph honesty pass:** every backbone wire becomes real / locked-annotation / removed (done for the §0 inputs); the swapped `postfx` node is now the wired `Field source` (displace/relief/color outlets → renderer inlets, surface-domain), distinct from `postprocess` ("Post-FX" = frame); remaining: split Projection's live vs rebuild controls.
- **Node-scoped modulation unification:** migrate all targets to `(nodeId,handle)`.
- **Presets serialize everything:** nodes+positions, edges, settings, palette/custom colors, modulation routing, post-chain, viewport; auto-layout only for on-load default/explicit-align, never silently over user presets.
- **Optional geometry:** `kovacs2010rcs` real-time creased subdivision / `tosun2011mbs` closed-form manifold surfaces for smoother tiles.
- **GIF/phase:** clock becomes a real phase signal (morphology `out_clock = framesCaptured/totalFrames`) for seamless loop export.

## 8. Constraints / preservation

- **Cost tiers** (keep continuous controls in the uniform tier): live uniform (mat*\*, light*\_, brightness, depth, ripple\_\_, fx\_\*, boost) · buffer update (palette colors) · CPU rebuild (family/seed/generation, projection mode, Poincaré hyp_scale, subdivisions, color_count/mode, border) · pipeline rebuild.
- **r184 correctness:** color-space domains respected via the tone-map node (Sobel/FXAA after, Bloom/SMAA before); multi-pass/MRT effects (TAA/GTAO/SSR/DOF…) follow the stateful-pass ownership rules in `tsl-post-fx-model.md`.
- **Render verification** is visual/headed-browser work, not center-pixel polling. Device loss uses the canonical WebGPU path.

## 9. Sequence

1. **Block 1 ** foundation (spec channel, registry, pure-data catalog, node-scoped routing for FX, compiler walk, UX, tone-map node) + frame-domain catalog incl. Feedback 3-way, Contours(luminance), parilov SDF profiles.
2. **Block 2:** surface/field-domain on the same rails (generalized field-source, dipole×orientation, unified colorable contours incl. jacobson biharmonic + grinspun curvature + full Mikkelsen relief, peng shells).
3. **Block 3:** projection (continuous + conformal/holomorphic + quasicrystal + exotic).
4. **Cross-cutting:** graph honesty pass, modulation unification, presets, GIF/phase, icons that are more understandable and widely recognized.

## 10. Open questions / risks (do not be a bitch and defer or you're fired)

- Edge-SDF generation for parilov: bake per geometry build vs. compute-pass; needs the tile-edge set already produced in `buildEdgeGeometry`.
- Feedback ping-pong in r184 TSL: model on `AfterImageNode`'s history-RT mechanism; "Both" mode ordering.
- Tone-map node + `outputColorTransform=false`: verify no double color transform; confirm pass texture is pre-tonemap linear (verified in r184 RenderPipeline).
- Persistence remap curve constants (afterimage/trails) tuned on screen with the user.
- Catalog ranges/defaults are first-draft; user retunes against live output.
