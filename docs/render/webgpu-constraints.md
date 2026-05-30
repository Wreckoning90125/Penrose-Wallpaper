# WebGPU / TSL constraints & the graph-render contract

Hard-won rules for this codebase. Violating the first two produced the same
black-tile regression five times; this file exists so they don't recur.

## 1. The material must reference ≤ 8 vertex attributes (hard WebGPU limit)

`maxVertexBuffers` is **8** (W3C WebGPU spec, mirrored in `docs/webGpuW3Spec/`).
A `MeshPhysicalNodeMaterial` already implicitly binds `position`, `normal`, `uv`,
`color`, plus a tangent when anisotropy is on — so the custom attributes
(`tileType`, `tileRing`, `tileOrient`, `tileCenter`) put it at the ceiling.

Adding a **ninth** referenced attribute (e.g. `attribute('edgeDistance')` in the
edge-profile emissive) makes the pipeline invalid → the tiles render **black**.
The console shows: `THREE.Vertex buffer count (9) exceeds the maximum number of
vertex buffers (8)`.

**Rule:** never add a new `attribute(...)` reference to the surface material.
Pack extra per-vertex data into a spare component of an existing attribute —
e.g. carry edge distance in `tileCenter.z` (make `tileCenter` a `vec3`); it stays
one buffer. (Edge-profile is currently reverted for this reason; this is how it
comes back.)

## 2. FX builders must never pass a `null` node arg

`three/addons` post-FX node constructors call `.build()` on their node args. A
`null` (e.g. `chromaticAberration(input, strength, null, scale)` for the required
`centerNode`) throws `THREE.TSL: TypeError: Cannot read properties of null
(reading 'build')` and the effect dies. Pass a real node (screen center is
`vec2(0.5, 0.5)`). Default uniforms must also be finite — `0 * NaN = NaN` in WGSL,
so a NaN factor poisons an otherwise-zero term.

## 3. Verification reality in this repo

- `npm run render:check` loads the dev server (`localhost:5174`) in chromium and
  prints the WebGPU **adapter** + flagged console messages. It is a reliable
  **console-error oracle** (catches §1/§2 errors).
- It is **not** a pixel oracle in a headless/agent shell: with no display the
  adapter is `swiftshader` (software) and the canvas is black with spurious
  `createBuffer size too large` noise that does **not** occur on a real GPU.
- For true pixels run it where WSLg's display is reachable: `RENDER_HEADED=1
  npm run render:check` → `output/playwright/render-check.png`.
- The standing gate is unchanged: `npm run typecheck && npm run ts:policy &&
  npm run js:policy && npm run web:build && npm run render:health`. Green gates
  are necessary but **not** sufficient for render correctness — confirm visually.

## 4. The render is downstream of the graph (the data-flow contract)

What renders is derived from the current edges every change, never from React
props alone. The two walks that enforce this (`web/src/flow/renderInputs.ts`):

- `renderChainConnected` / `renderInputsFromEdges` — the structural inlets
  (`geometry`, `lighting`, `color`, `material`, `projection`) are booleans
  derived from edges and pushed to the renderer; each cut has a distinct
  consequence (geometry hides, lighting unlit, color flat, material neutral,
  projection flat), not one wholesale hide.
- `derivePostChain` (in `ControlGraph.tsx`) — walks `frame` edges from the
  Display sink back to the Scene pass; a node only contributes when it is
  genuinely on that wire path (toneMap included). Reference model:
  `.local/procedural-morphology-lab` (`walkPostFxChain` / `getModulation`).

**Acceptance test:** cut a wire → the thing it represents stops.
`web/bullshitGraphTest.json` (no functional wires) must render nothing of
consequence.

## 5. Module map (pure, non-React schema — reusable, contract-ready)

- `web/src/flow/audioTargets.ts` — `AUDIO_TARGET_RANGES` + `audioTargetRange`
- `web/src/flow/controlSpecs.ts` — per-node control tuples
- `web/src/flow/settingKeys.ts` — per-node setting groups
- `web/src/flow/renderInputs.ts` — edge→render-input derivation
- `web/src/flow/nodeData.ts` — typed accessors for node `data`

A future `tools/check_graph_contract.mts` should import these and assert: every
control exposes an inlet · every inlet is a valid signal target · the FX chain
reaches the sink · material attribute refs ≤ `maxVertexBuffers`. Hold it until
the graph logic is final so it isn't locked against not-yet-100% behavior.

## 5. Post-pipeline rebuilds must free the old node tree's render targets

three's `RenderPipeline.dispose()` frees **only** its quad material; base
`Node.dispose()` just fires an event. So a naive `rebuildPostPipeline` that makes
a fresh `pass(scene, camera)` and fresh addon FX nodes each rebuild **orphans GPU
render targets**: the scene pass's full-res HalfFloat RT, every addon FX node's
internal RTs (bloom/anamorphic/afterImage/trails), and each `convertToTexture`
`RTTNode`'s RT. Toggling an effect (e.g. anamorphic) rebuilds repeatedly →
unbounded GPU growth (observed ~150 MB climbing to 3.7 GB) → device lost (OOM).

**Rules:**
- Create the scene `pass()` **once** and reuse it across rebuilds.
- On each rebuild, walk the previous output node (`Node.traverse`) and free only
  the nodes that **own** a render target: scan each node's own properties for a
  value flagged `isRenderTarget === true` (incl. arrays, e.g. bloom's blur RT
  lists), dispose those targets, and call `node.dispose()` only on owners (its
  override on bloom/anamorphic/afterImage also frees materials/caches).
- **Do not** blanket-`dispose()` every node in the walk: shared TSL singletons
  (`screenUV`/`screenSize` are `nodeImmutable`, referenced app-wide) own no RT, and
  disposing them needlessly tears down a cache reused every frame.
- **Protect** reused nodes from the walk: the scene pass's whole subtree and the
  cached uniform nodes (they survive into the next build); the live feedback nodes
  are disposed explicitly, so protect only the node itself, not its upstream chain.
