# WebGPU / TSL constraints & the graph-render contract

Hard-won rules for this codebase. Violating the first two produced the same
black-tile regression five times; this file exists so they don't recur.

## 1. The material must use ≤ 8 vertex-buffer slots (hard WebGPU limit)

`maxVertexBuffers` is **8** (W3C WebGPU spec, mirrored in `docs/webGpuW3Spec/`).
Three counts vertex buffer slots, not just attribute names. The surface geometry
uses separate buffers for `position`, `color`, and `paletteSlot`, then packs
`tileType`, `tileRing`, `tileOrient`, `tileCenter`, and `tileRelief` into one
interleaved custom buffer. That packing is why the material can read all of
those lanes without exceeding the WebGPU limit.

Adding a **ninth** backing vertex buffer (for example by introducing a new
surface metadata attribute that is not packed with the existing tile metadata)
makes the pipeline invalid → the tiles render **black**.
The console shows: `THREE.Vertex buffer count (9) exceeds the maximum number of
vertex buffers (8)`.

**Rule:** never add a new surface-material `attribute(...)` unless the backing
geometry keeps the total vertex-buffer slots at eight or fewer. Pack extra
per-vertex data into the existing interleaved tile metadata buffer, or widen that
buffer deliberately in `web/src/tiling/geometry.ts`.

## 2. FX builders must never pass a `null` node arg

`three/addons` post-FX node constructors call `.build()` on their node args. A
`null` (e.g. `chromaticAberration(input, strength, null, scale)` for the required
`centerNode`) throws `THREE.TSL: TypeError: Cannot read properties of null
(reading 'build')` and the effect dies. Pass a real node (screen center is
`vec2(0.5, 0.5)`). Default uniforms must also be finite — `0 * NaN = NaN` in WGSL,
so a NaN factor poisons an otherwise-zero term.

## 3. Verification reality in this repo

- A browser probe can be useful as a **console-error oracle** (catches §1/§2
  invalid-pipeline / shader / vertex-buffer errors), but this repo does not keep
  a committed package script for it because browser availability is local-machine
  dependent.
- It is **not** a pixel oracle in a headless/agent shell: with no display the
  adapter is often `swiftshader` (software) and the canvas can be black with
  spurious `createBuffer size too large` noise that does **not** occur on a real
  GPU.
- For true pixels, use the user's running preview or a headed local browser where
  WSLg's display is reachable. Write any screenshots/traces under
  `output/playwright/`.
- The standing web gate is `npm run quality:web` (or, expanded:
  `npm run typecheck && npm run ts:policy && npm run js:policy &&
  npm run web:build && npm run graph:contract`). Green gates
  are necessary but **not** sufficient for render correctness — confirm visually.

## 4. The render is downstream of the graph (the data-flow contract)

What renders is derived from the current edges every change, never from React
props alone. The graph topology helpers in `web/src/flow/graphTopology.ts` and
the render-input derivation in `web/src/flow/renderInputs.ts` enforce this:

- `renderChainConnected` / `renderInputsFromEdges` — the structural inlets
  (`geometry`, `lighting`, `color`, `material`, `projection`) are booleans
  derived from edges and pushed to the renderer; each cut has a distinct
  consequence (geometry hides, lighting unlit, color flat, material neutral,
  projection flat), not one wholesale hide.
- `derivePostChain` — walks `frame` edges from the
  Display sink back to the Scene pass; a node only contributes when it is
  genuinely on that wire path (toneMap included).

**Acceptance test:** cut a wire → the thing it represents stops. The standing
form of this is `npm run graph:contract`, which exercises the canonical graph
wires and verifies that removing each one drops the represented render input.

## 5. Module map (pure, non-React schema — reusable, contract-ready)

- `web/src/flow/audioTargets.ts` — `AUDIO_TARGET_RANGES` + `audioTargetRange`
- `web/src/flow/controlSpecs.ts` — per-node control tuples
- `web/src/flow/settingKeys.ts` — per-node setting groups
- `web/src/flow/renderInputs.ts` — edge→render-input derivation
- `web/src/flow/graphTopology.ts` — graph connection policy, DAG checks, and
  post-FX frame-chain derivation
- `web/src/flow/nodeData.ts` — typed accessors for node `data`

`tools/check_graph_contract.mts` imports these and asserts the stable schema and
wire-contract invariants: controls map to setting keys and preset keys, the
surface material stays within the allowed vertex-buffer slots, the FX catalog is
complete, and the material/field/source/scene-pass wires cut the render inputs
they claim to represent.

## 6. Post-pipeline rebuilds must free the old node tree's render targets

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
