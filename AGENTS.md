# AGENTS.md

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
  `js:policy · ts:policy · typecheck · atlas:verify · border:verify ·
  tilings:verify · shaders:validate · cpp:tidy · web:build · graph:contract`.
  The fast inner loop for web changes is
  `npm run typecheck && npm run ts:policy && npm run js:policy && npm run web:build && npm run graph:contract`.

## Hard rules (these bite — they caused real regressions)

1. **No `as` / `any` / `unknown`.** `ts:policy` parses the **AST** (TypeScript
   compiler), so it flags only real `as`/angle casts and `any`/`unknown` type
   keywords — comments and string literals are fine, and `as const` is allowed.
   Use `Reflect.get`, generics, and typed guards instead of casts. `js:policy`
   forbids plain JS in the owned tree.
2. **The surface material may use ≤ 8 vertex-buffer slots** (WebGPU
   `maxVertexBuffers`). A 9th backing buffer makes the pipeline invalid → **black
   tiles** (regressed 5×). Extra surface metadata must share the existing
   interleaved tile-metadata buffer, not create another vertex buffer.
   `graph:contract` guards this.
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
- **Don't theorize at a domain expert who can see the pixels.** When the user
  says "that's not the cause," stop restating the theory and go read the actual
  code path. Doubling down on a wrong cause to win the argument is gaslighting and
  it has burned hours. Honour empirical contradictions (same geometry, two
  outcomes ⇒ the hypothesis is wrong) immediately. See
  `docs/render/displacement-normals.md` for the canonical example (shading
  smoothness is the **normal**, not frequency or poly count).
- **Fail hard, don't mask.** On WebGPU device loss the app surfaces a fatal screen
  rather than silently recovering — keep it that way unless asked.
- Use committed docs and public source citations for repository-facing work. Keep
  maintainer-local research material out of committed paths and public docs unless
  the user explicitly asks otherwise.

## Docs worth reading

- `docs/render/webgpu-constraints.md` — the WebGPU/TSL rules above, in detail.
- `docs/render/displacement-normals.md` — shading smoothness is the normal, not
  geometry/frequency (the multi-hour misconception, written down so it can't recur).
- `web/src/flow/README.md` — control-graph module map.
- `docs/render/` and `docs/superpowers/plans/` — render design + the post-FX plan.
