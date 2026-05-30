# CLAUDE.md

Guidance for AI assistants working in this repo. Keep it accurate — delete or fix
anything that drifts.

## What this is

A Penrose / aperiodic-tiling live wallpaper. The interesting part is `web/` — a
**Three.js WebGPU + TSL** renderer driven by a node-based **control graph**
(`@xyflow/react`). `android/` wraps it; `atlas/`, `tools/`, `scripts/`, `docs/`
support it.

## Commands

- `npm run dev` — Vite dev server.
- `npm run web:preview` — production preview (port-owned; what the user usually runs).
- **Gate** (run before claiming work is done): `npm run quality:local` — runs
  `js:policy · ts:policy · typecheck · atlas:verify · render:health ·
  tilings:verify · shaders:validate · cpp:tidy · web:build · graph:contract`.
  The fast inner loop for web changes is
  `npm run typecheck && npm run ts:policy && npm run js:policy && npm run web:build && npm run render:health && npm run graph:contract`.

## Hard rules (these bite — they caused real regressions)

1. **No `as` / `any` / `unknown`.** `ts:policy` is a **text scan**, so the words
   are banned even inside comments and strings (e.g. "treat X as Y", "any of",
   "unknown reason" will fail the gate). Reword. Use `Reflect.get`, generics, and
   typed guards instead of casts. `js:policy` forbids plain JS in the owned tree.
2. **The surface material may reference ≤ 8 vertex attributes** (WebGPU
   `maxVertexBuffers`). A 9th `attribute(...)` makes the pipeline invalid → **black
   tiles** (regressed 5×). Pack extra per-vertex data into a spare component of an
   existing attribute (`tileType`/`tileRing`/`tileOrient`/`tileCenter`), never a
   new one. `graph:contract` guards this.
3. **Post-pipeline rebuilds must free old render targets.** three's
   `RenderPipeline.dispose()` frees only its quad material; reuse the scene `pass()`
   and dispose the old node tree's RTs each rebuild, or GPU memory climbs to OOM
   (device lost). See `docs/render/webgpu-constraints.md` §5.
4. **FX node constructors must not get a `null` node arg** — they `.build()` it.
   Default uniforms must be finite (`0 * NaN = NaN` in WGSL). Guard divisions.
5. When doing `sed` line-deletions, **re-read exact line numbers immediately
   before each delete** — they drift across edits and linter runs (a stale range
   once corrupted a file mid-session).

## The control graph (`web/src/flow/`)

**The render is downstream of the graph; each node is downstream of its inlets.**
Cut a wire and the thing it represents stops — this is gate-enforced (`graph:contract`,
the §0 wire contract). Don't reintroduce props-only render inputs.

`ControlGraph.tsx` is the orchestrator; the pieces live in focused modules
(node components, edges, frame/ports, slider, preset serialization, layout engine,
node-data types, JSON utils, signal eval). Start at **`web/src/flow/README.md`**
for the module map and dependency direction.

## Working norms (from the user)

- **Preserve the look.** This is a visual app and the user has strong aesthetic
  preferences — ask before non-obvious visual changes; faithful refactors only.
- **Verify in a real render.** The agent shell has no display (swiftshader →
  black), so it is a reliable **console oracle** but **not a pixel oracle**. Pixel
  correctness needs the user's preview (or `RENDER_HEADED=1` where a display
  exists). Don't claim a visual result you can't see.
- **Fail hard, don't mask.** On WebGPU device loss the app surfaces a fatal screen
  rather than silently recovering — keep it that way unless asked.
- Reference implementations the user values: `.local/procedural-morphology-lab`
  (graph-driven render), `docs/webGpuW3Spec/` (WebGPU spec), `.local/Zorin/`
  (Block 2 surface/field-domain papers).

## Docs worth reading

- `docs/render/webgpu-constraints.md` — the WebGPU/TSL rules above, in detail.
- `web/src/flow/README.md` — control-graph module map.
- `docs/render/` and `docs/superpowers/plans/` — render design + the post-FX plan.
