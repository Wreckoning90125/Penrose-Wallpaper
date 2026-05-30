# Chainable Post-FX — Block 1 / Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the control graph the **source of truth the renderer is built from** — so detaching a wire has a real consequence — and, *riding on top of that*, replace the hardcoded post-FX chain with individual add/delete/reorder effect nodes the graph compiles into `RenderPipeline.outputNode`, with per-node `(nodeId, handle)` modulation and a tone-map node. The effect catalog is worthless bolted to a disconnected engine: **§0 is the non-negotiable core of this plan, and its acceptance test ("cut the wire → the thing stops") governs every task below.**

**Architecture:** The control graph derives an ordered, serializable `PostChainSpec` by walking `frame` edges from the Display sink back to the Scene pass, and pushes it to the renderer (sibling channel to `onAudioModulation`). The renderer owns a `kind → { createUniforms, apply }` registry of TSL builders, rebuilds `outputNode` only when the chain _signature_ changes, and writes per-node param uniforms every frame. A pure-data catalog (no `three` import) is shared with the UI for node rendering. This is the reusable foundation for the surface/field and projection blocks in `docs/render/effects-graph-design.md`.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` 12, three 0.184.0 WebGPU + TSL, Vite 8. No unit-test runner in this repo — verification is `npm run typecheck` + `npm run ts:policy && npm run js:policy` + `npm run web:build` + `npm run render:health` + manual visual run (`npm run dev`). (Adding vitest for the pure-logic units, e.g. the chain compiler, is a reasonable later opt-in but is intentionally out of scope here to respect the repo's current minimal toolchain.)

**Design references (read before starting):** `docs/render/effects-graph-design.md`, `docs/render/tsl-post-fx-model.md`, `docs/platform/control-graph-regressions.md`. Code anchors: `web/src/render/webgpuRenderer.ts:295` (`rebuildPostPipeline`), `:78` (`pixelateNode`), `web/src/flow/ControlGraph.tsx:2639` (`CompositeFxNode`), `:3195` (`initialEdges`), `:1466` (`evaluateAudioModulations`), `web/src/App.tsx:552` (`onAudioModulation`).

---

## 0. The core job: the graph is a fake patch-bay — make it real (this governs every task below)

**Symptom, reproducible: detach every wire in the graph and the render is unchanged.** `web/bullshitGraphTest.json` (no functional connections) renders identically to the fully-wired default. This is the disease the whole plan exists to cure.

**Why, in code — the renderer is driven by React state, never by the graph:**

- `web/src/App.tsx:434-435` — geometry/material/palette reach the renderer via `setSettings(renderSettings, builtPalette)` + `setGeometry(geometry, edgeGeometry)`, built from `renderSettings`/`patch` **state**, not graph edges.
- `web/src/App.tsx:451` — `setSettings(renderSettings, renderPalette)` re-pushed on any settings change.
- `web/src/App.tsx:225`, `:682-683` — every node slider calls `onSetting`/`onPreviewSetting` → App settings → renderer, **bypassing the graph entirely**. A control's node and wires are irrelevant to whether it takes effect.
- `web/src/flow/ControlGraph.tsx` — the **only** edge consumers are `evaluateSignals` / `derivePostChain` / `renderChainConnected` (audio modulation, the FX frame-chain, the new connectivity gate). The structural backbone (`atlas→tiling→projection→palette→material→renderer`, `lighting→renderer`) is read by **nothing that renders** — it lives only in `isValidGraphConnection` (validation) and `displayedEdges` (drawing). `isObsoletePipelineEdge` (`:1908`) even lists several as "obsolete," confirming zero authority.

**The model to copy — `.local/procedural-morphology-lab`:** its render is a *pure function of the current edges*. `walkPostFxChain` re-derives the chain from edges on every change; `getModulation(nodeId, handle)` returns the wired source's value or `null` when no edge exists. No heal, no force-restore, no parallel hardcoded reactivity — none is needed when topology *is* the truth. Cut a wire → the next derivation omits it → real consequence.

**Compensations to delete — they exist only because the graph isn't authoritative:**

- **delete-heal** (Task 6 reconnects prev→next on delete) — *erases* the consequence of a deletion. Remove it; let the chain walk produce a shorter/broken chain.
- **force-restore** in `applyGraphPreset` (re-pushed "required" edges, overwriting user deletions). Removed — keep removed.
- **parallel `features × gains`** path in `setAudioDrive` (audio reactivity independent of edges). Removed — keep removed.
- **props-bypass** — the renderer reading `renderSettings`/`renderPalette`/`patch` instead of graph-derived inputs. This is the deepest one and the real fix: **the renderer's inputs must be derived from graph topology on every change**, the way morphology does it.

**Also in scope here (honesty, not features):** modulation unified to `(nodeId, handle)` everywhere (no global-handle collisions); the swapped/mislabeled nodes relabeled (`postfx` = surface ripple, not post-FX); presets that **serialize the real graph** and round-trip it exactly (no force-restore, no silent additions).

**Two layers of the same principle — both are mandatory:**

1. **The render is downstream of the graph.** What renders is derived from the current edges on every change — never from React `settings`/`palette`/`patch` props that update regardless of wiring. The renderer is the *reconciler* of a graph evaluation, exactly like morphology's `sceneViewer`.
2. **Each node is downstream of its inlets.** A node computes from what is wired **into it**, not from global state. The material's color comes from its `color` inlet (fed by palette); an unwired inlet means that input is **absent**, not silently supplied from elsewhere. A node with no incoming chain to the sink produces nothing.

**The rule, applied to every task:** a wire must **determine execution, be a locked annotation, or not exist**. The acceptance test for a task is **not** "it typechecks/builds" — it is **cut the wire this task is about and confirm the thing it represents stops** (geometry vanishes, the effect drops out, the modulation dies, the color goes). If cutting changes nothing, the task is not done.

---

## File structure

> **Honesty (§0):** every file below either moves a renderer input from "pushed by App props" to "derived from graph edges," or keeps an effect's contribution gated behind its wire. If a change here doesn't make some wire load-bearing or keep one honest, question why it's in this plan.

| File                               | Responsibility                                                                                                                                                           | Create/Modify |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `web/src/render/postFxCatalog.ts`  | Pure data: effect kinds, params, domain, compose mode, icon. No `three`. Shared by UI + renderer.                                                                        | Create        |
| `web/src/render/postFxRegistry.ts` | TSL builders keyed by kind (`createUniforms`/`apply`) + chain fold. Imports `three/tsl` + addons.                                                                        | Create        |
| `web/src/render/webgpuRenderer.ts` | Add `setPostChain(spec)`, signature recompile, per-frame uniform write, default tone-map; strip the fixed FX from `rebuildPostPipeline`.                                 | Modify        |
| `web/src/types.ts`                 | `PostChainSpec` / `PostChainNode` types.                                                                                                                                 | Modify        |
| `web/src/App.tsx`                  | `onPostChain` callback → `renderer.setPostChain`; apply-on-ready ref.                                                                                                    | Modify        |
| `web/src/flow/ControlGraph.tsx`    | Generic catalog-driven FX node; spec derivation via frame-edge walk; add/reorder/delete (no heal — §0); node-scoped FX modulation; tone-map node; remove monolithic `postprocess`. | Modify        |
| `web/src/style.css`                | Minimal styling for the generic FX node (reuses existing node classes).                                                                                                  | Modify        |

---

## Task 1: Pure-data effect catalog

**Files:**

- Create: `web/src/render/postFxCatalog.ts`

- [ ] **Step 1: Write the catalog module**

```ts
// web/src/render/postFxCatalog.ts
// Pure data shared by the control graph (UI) and the renderer registry.
// MUST NOT import three — the control graph stays three-free.

export type FxDomain = "linear" | "display";
export type FxCompose =
  | "replace"
  | "blend"
  | "additive"
  | "feedback"
  | "transform";

export type FxParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
};

export type FxKind =
  | "pixelate"
  | "posterize"
  | "filmGrain"
  | "rgbShift"
  | "sobel"
  | "afterImage"
  | "bloom"
  | "toneMap";

export type FxDescriptor = {
  kind: FxKind;
  label: string;
  icon: string; // lucide-react icon name
  domain: FxDomain;
  compose: FxCompose;
  params: readonly FxParamSpec[];
};

const P = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): FxParamSpec => ({ key, label, min, max, step, def });

export const EFFECT_CATALOG: readonly FxDescriptor[] = [
  {
    kind: "pixelate",
    label: "Pixelate",
    icon: "Grid2x2",
    domain: "display",
    compose: "replace",
    params: [P("size", "Size", 1, 64, 1, 1)],
  },
  {
    kind: "posterize",
    label: "Posterize",
    icon: "Layers",
    domain: "display",
    compose: "replace",
    params: [P("steps", "Steps", 2, 256, 1, 256)],
  },
  {
    kind: "filmGrain",
    label: "Film grain",
    icon: "Film",
    domain: "display",
    compose: "replace",
    params: [P("amount", "Amount", 0, 1, 0.01, 0)],
  },
  {
    kind: "rgbShift",
    label: "RGB shift",
    icon: "Shuffle",
    domain: "display",
    compose: "replace",
    params: [
      P("amount", "Amount", 0, 0.1, 0.001, 0),
      P("angle", "Angle", 0, 360, 1, 0),
    ],
  },
  {
    kind: "sobel",
    label: "Sobel",
    icon: "PenLine",
    domain: "display",
    compose: "blend",
    params: [P("mix", "Edge mix", 0, 1, 0.01, 0)],
  },
  {
    kind: "afterImage",
    label: "Afterimage",
    icon: "History",
    domain: "display",
    compose: "feedback",
    params: [P("trail", "Trail", 0, 1, 0.01, 0)],
  },
  {
    kind: "bloom",
    label: "Bloom",
    icon: "Sparkles",
    domain: "linear",
    compose: "additive",
    params: [
      P("strength", "Strength", 0, 4, 0.01, 0.5),
      P("radius", "Radius", 0, 1, 0.01, 0.4),
      P("threshold", "Threshold", 0, 1, 0.01, 0.8),
    ],
  },
  {
    kind: "toneMap",
    label: "Tone map",
    icon: "Contrast",
    domain: "linear",
    compose: "transform",
    params: [],
  },
];

const BY_KIND = new Map<string, FxDescriptor>(
  EFFECT_CATALOG.map((d) => [d.kind, d]),
);

export function fxDescriptor(kind: string): FxDescriptor | null {
  return BY_KIND.get(kind) ?? null;
}

export function isFxKind(kind: string): kind is FxKind {
  return BY_KIND.has(kind);
}

export function fxParamDefaults(kind: string): Record<string, number> {
  const descriptor = BY_KIND.get(kind);
  const out: Record<string, number> = {};
  if (!descriptor) return out;
  for (const param of descriptor.params) out[param.key] = param.def;
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: completes with no errors.

- [ ] **Step 3: Policy check**

Run: `npm run ts:policy && npm run js:policy`
Expected: both pass with no violations.

- [ ] **Step 4: Commit**

```bash
git add web/src/render/postFxCatalog.ts
git commit -m "feat(render): add pure-data post-FX effect catalog"
```

---

## Task 2: Renderer-side TSL builder registry

**Files:**

- Create: `web/src/render/postFxRegistry.ts`

The persistence remap turns the afterimage slider into a perceptually even trail length and hard-caps `damp` so it cannot run away (design spec §3): `damp = min(0.985, 0.5^(1/frames))` with `frames = mix(1, 240, trail^2)`.

- [ ] **Step 1: Write the registry module**

```ts
// web/src/render/postFxRegistry.ts
import type Node from "three/src/nodes/core/Node.js";
import {
  clamp,
  convertToTexture,
  float,
  floor,
  Fn,
  max,
  mix,
  posterize,
  screenSize,
  screenUV,
  uniform,
} from "three/tsl";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { rgbShift } from "three/addons/tsl/display/RGBShiftNode.js";
import { sobel } from "three/addons/tsl/display/SobelOperatorNode.js";
import { afterImage } from "three/addons/tsl/display/AfterImageNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { FxKind } from "./postFxCatalog";

export type FxUniforms = Record<string, ReturnType<typeof uniform>>;

export type FxBuilder = {
  createUniforms: () => FxUniforms;
  apply: (input: Node, u: FxUniforms) => Node;
};

const pixelateNode = Fn(([input, pixelSize]: [Node, Node<"float">]) => {
  const texture = convertToTexture(input);
  const px = max(pixelSize, 1.0);
  const snapped = floor(screenUV.mul(screenSize).div(px))
    .mul(px)
    .add(px.mul(0.5))
    .div(screenSize);
  return texture.sample(snapped);
});

// trail (0..1) -> damp, perceptually even and capped so feedback can't accumulate to white.
export function afterImageDamp(trail: number): number {
  const frames = 1 + (240 - 1) * trail * trail;
  return Math.min(0.985, Math.pow(0.5, 1 / Math.max(1, frames)));
}

export const FX_BUILDERS: Record<FxKind, FxBuilder> = {
  pixelate: {
    createUniforms: () => ({ size: uniform(1) }),
    apply: (input, u) => pixelateNode(input, u["size"]!),
  },
  posterize: {
    createUniforms: () => ({ steps: uniform(256) }),
    apply: (input, u) => posterize(input, u["steps"]!),
  },
  filmGrain: {
    createUniforms: () => ({ amount: uniform(0) }),
    apply: (input, u) => film(input, u["amount"]!),
  },
  rgbShift: {
    createUniforms: () => ({ amount: uniform(0), angle: uniform(0) }),
    apply: (input, u) => {
      const shifted = rgbShift(input, 0, 0);
      shifted.amount = u["amount"]!;
      shifted.angle = u["angle"]!;
      return shifted;
    },
  },
  sobel: {
    createUniforms: () => ({ mix: uniform(0) }),
    apply: (input, u) => {
      const base = convertToTexture(input).sample(screenUV);
      const edge = convertToTexture(sobel(input)).sample(screenUV);
      return mix(base, edge, u["mix"]!);
    },
  },
  afterImage: {
    createUniforms: () => ({ damp: uniform(afterImageDamp(0)) }),
    apply: (input, u) => afterImage(input, u["damp"]!),
  },
  bloom: {
    createUniforms: () => ({
      strength: uniform(0.5),
      radius: uniform(0.4),
      threshold: uniform(0.8),
    }),
    apply: (input, u) => {
      const glow = bloom(input, 0.5, 0.4, 0.8);
      glow.strength = u["strength"]!;
      glow.radius = u["radius"]!;
      glow.threshold = u["threshold"]!;
      return input.add(glow);
    },
  },
  // toneMap is handled directly in the renderer (needs renderer toneMapping + colorSpace), not here.
  toneMap: {
    createUniforms: () => ({}),
    apply: (input) => input,
  },
};

export function fxBuilder(kind: string): FxBuilder | null {
  return Object.prototype.hasOwnProperty.call(FX_BUILDERS, kind)
    ? FX_BUILDERS[kind as FxKind]
    : null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `three/addons/tsl/display/BloomNode.js` types are missing, confirm import path against `node_modules/three/examples/jsm/tsl/display/BloomNode.js`; the other four addon imports already exist in `webgpuRenderer.ts:45-48`.)

- [ ] **Step 3: Commit**

```bash
git add web/src/render/postFxRegistry.ts
git commit -m "feat(render): add TSL post-FX builder registry"
```

---

## Task 3: `PostChainSpec` types

**Files:**

- Modify: `web/src/types.ts`

- [ ] **Step 1: Add the types (append after the existing `AudioModulationValues` type, `types.ts:112`)**

```ts
// Ordered, serializable description of the screen post-FX chain the renderer
// compiles. params already include this frame's resolved node-scoped modulation.
export type PostChainNode = {
  id: string;
  kind: string;
  bypass: boolean;
  params: Record<string, number>;
};

export type PostChainSpec = PostChainNode[];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/types.ts
git commit -m "feat(types): add PostChainSpec for graph-driven post-FX"
```

---

## Task 4: Renderer `setPostChain` + signature recompile + uniform write

**Files:**

- Modify: `web/src/render/webgpuRenderer.ts`

This adds the graph-driven chain and reduces `rebuildPostPipeline` to "scene pass, optional default tone-map at output." The fixed pixelate→…→afterImage fold is removed; those effects now arrive as spec nodes.

- [ ] **Step 1: Add imports (extend the `three/tsl` import block and add the registry import near `webgpuRenderer.ts:23`)**

Add to the existing `from 'three/tsl'` import: nothing new required for the core path (the `pass` import already exists). Add a new import line after the existing addon imports (`webgpuRenderer.ts:48`):

```ts
import { renderOutput } from "three/tsl";
import type { PostChainSpec } from "../types";
import { fxBuilder, afterImageDamp, type FxUniforms } from "./postFxRegistry";
import { fxDescriptor } from "./postFxCatalog";
```

- [ ] **Step 2: Add fields (in the class field block near `webgpuRenderer.ts:142`)**

```ts
postChainSpec: PostChainSpec;
postChainSignature: string;
postChainUniforms: Map<string, FxUniforms>;
```

Initialize them in the constructor (after `this.postPipelineUsesAfterImage = false;`, `:208`):

```ts
this.postChainSpec = [];
this.postChainSignature = "";
this.postChainUniforms = new Map();
```

- [ ] **Step 3: Replace `rebuildPostPipeline` (`webgpuRenderer.ts:295-310`) with a graph-driven builder**

```ts
  postChainSignatureOf(spec: PostChainSpec): string {
    return spec.map(node => `${node.id}:${node.kind}:${node.bypass ? 1 : 0}`).join('|');
  }

  rebuildPostPipeline(): void {
    this.postPipeline?.dispose();
    const scenePass = pass(this.scene, this.camera);
    const nextUniforms = new Map<string, FxUniforms>();
    let frame: Node = scenePass;
    let hasToneMap = false;

    for (const node of this.postChainSpec) {
      if (node.bypass) continue;
      const descriptor = fxDescriptor(node.kind);
      if (!descriptor) continue;
      if (descriptor.compose === 'transform' && node.kind === 'toneMap') {
        frame = renderOutput(frame, this.renderer.toneMapping, this.renderer.outputColorSpace);
        nextUniforms.set(node.id, {});
        hasToneMap = true;
        continue;
      }
      const builder = fxBuilder(node.kind);
      if (!builder) continue;
      const existing = this.postChainUniforms.get(node.id);
      const uniforms = existing ?? builder.createUniforms();
      nextUniforms.set(node.id, uniforms);
      frame = builder.apply(frame, uniforms);
    }

    this.postChainUniforms = nextUniforms;
    this.postPipeline = new RenderPipeline(this.renderer, frame);
    // If an explicit tone-map node is in the chain, the renderer must not apply
    // the output transform a second time.
    this.postPipeline.outputColorTransform = !hasToneMap;
    this.postPipeline.needsUpdate = true;
  }

  setPostChain(spec: PostChainSpec): void {
    this.postChainSpec = spec;
    const signature = this.postChainSignatureOf(spec);
    if (signature !== this.postChainSignature) {
      this.postChainSignature = signature;
      this.rebuildPostPipeline();
    }
    this.writePostChainUniforms();
    this.render();
  }

  writePostChainUniforms(): void {
    for (const node of this.postChainSpec) {
      const uniforms = this.postChainUniforms.get(node.id);
      if (!uniforms) continue;
      if (node.kind === 'afterImage') {
        const damp = uniforms['damp'];
        if (damp) damp.value = afterImageDamp(node.params['trail'] ?? 0);
        continue;
      }
      for (const [key, value] of Object.entries(node.params)) {
        const target = uniforms[key];
        if (target) target.value = value;
      }
    }
  }
```

- [ ] **Step 4: Fix the two old `rebuildPostPipeline(...)` callers**

In `init()` (`webgpuRenderer.ts:267`) change `this.rebuildPostPipeline(false);` to `this.rebuildPostPipeline();`.

In `setSettings` (`webgpuRenderer.ts:490-493`) and `setAudioDrive` (`:634-637`) DELETE the `useAfterImage`/`postPipelineUsesAfterImage` rebuild blocks:

```ts
// DELETE in setSettings:
const useAfterImage = this.uniforms.fxAfterImage.value > 0;
if (this.postPipeline && useAfterImage !== this.postPipelineUsesAfterImage) {
  this.rebuildPostPipeline(useAfterImage);
}
// DELETE the identical block in setAudioDrive.
```

Leave the `fx*` uniforms on `this.uniforms` for now (unused by the chain); Task 8 removes the dead writes. The `postPipelineUsesAfterImage` field is now unused — delete its declaration (`:143`) and constructor init (`:208`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Watch for unused `pixelateNode`/`posterize`/`film`/`rgbShift`/`sobel`/`afterImage`/`mix`/etc. imports now that the fold is gone — remove the ones the file no longer uses; `pass`, `uniform`, material-node imports stay.)

- [ ] **Step 6: Build + health**

Run: `npm run web:build`
Expected: build succeeds.
Run: `npm run render:health`
Expected: health check passes.

- [ ] **Step 7: Commit**

```bash
git add web/src/render/webgpuRenderer.ts
git commit -m "feat(render): compile post-FX chain from a PostChainSpec"
```

---

## Task 5: App channel — `onPostChain` → `renderer.setPostChain`

**Files:**

- Modify: `web/src/App.tsx`

Mirror the `onAudioModulation` pattern (`App.tsx:135,552`): keep a ref of the latest spec so a chain pushed before the renderer is ready is applied on ready.

- [ ] **Step 1: Add the spec ref (near `App.tsx:135`)**

```ts
const postChainRef = useRef<import("./types").PostChainSpec>([]);
```

- [ ] **Step 2: Add the callback (near `onAudioModulation`, `App.tsx:552`)**

```ts
const onPostChain = useCallback((spec: import("./types").PostChainSpec) => {
  postChainRef.current = spec;
  rendererRef.current?.setPostChain(spec);
}, []);
```

- [ ] **Step 3: Apply the stored chain when the renderer becomes ready (extend the renderer-ready effect at `App.tsx:376-395`, inside `initRenderer` after `await renderer.init();`)**

```ts
renderer.setPostChain(postChainRef.current);
```

- [ ] **Step 4: Pass the prop to `<ControlGraph>` (in the JSX prop list, `App.tsx:674`, after `onAudioModulation`)**

```tsx
onPostChain = { onPostChain };
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: error that `ControlGraphProps` has no `onPostChain` — resolved in Task 6. To verify just this file in isolation, proceed to Task 6 and typecheck together.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(app): wire onPostChain channel to renderer.setPostChain"
```

---

## Task 6: Control graph — generic FX node, spec derivation, add/reorder/delete

**Files:**

- Modify: `web/src/flow/ControlGraph.tsx`
- Modify: `web/src/style.css`

This replaces the monolithic `postprocess` node (`CompositeFxNode`, `ControlGraph.tsx:2639`) with one generic catalog-driven node type, derives the `PostChainSpec` by walking `frame` edges Display→Scene, and pushes it via `onPostChain`. The default graph ships an empty chain (`renderer` frame → `display` frame), so the scene renders with only the implicit output transform until the user adds effects.

- [ ] **Step 1: Add imports + the `onPostChain` prop type**

At the import block (`ControlGraph.tsx:24-40`) add:

```ts
import {
  EFFECT_CATALOG,
  fxDescriptor,
  fxParamDefaults,
  isFxKind,
  type FxDescriptor,
} from "../render/postFxCatalog";
import type { PostChainSpec } from "../types";
import * as Icons from "lucide-react";
```

In `ControlGraphProps` (`:213`) add:

```ts
  onPostChain: (spec: PostChainSpec) => void;
```

- [ ] **Step 2: Add the generic FX node component (place near `CompositeFxNode`, replacing it; keep `RippleTargetNode` — the `postfx` "Ripple/depth target" node is unrelated surface-domain and stays)**

```tsx
type FxNodeData = {
  activeInputs?: string[];
  activeOutputs?: string[];
  id: string;
  kind: string;
  bypass: boolean;
  values: Record<string, number>;
  onBeginEdit: (paramKey: string) => void;
  onEndEdit: (paramKey: string) => void;
  onFxValue: (id: string, key: string, value: number) => void;
  onFxBypass: (id: string, bypass: boolean) => void;
};

const FxNode = memo(function FxNode({ data }: NodeComponentProps<FxNodeData>) {
  const flow = useReactFlow<Node, Edge>();
  const descriptor = fxDescriptor(data.kind);
  const deleteNode = useCallback(() => {
    const id = data.id;
    flow.setNodes((current) => current.filter((node) => node.id !== id));
    flow.setEdges((current) =>
      current.filter((edge) => edge.source !== id && edge.target !== id),
    );
  }, [data.id, flow]);
  if (!descriptor) return null;
  return (
    <NodeFrame
      title={descriptor.label}
      kind="output"
      variant={3}
      inlets={[
        { id: "frame", label: "Frame" },
        ...descriptor.params.map((p) => ({ id: p.key, label: p.label })),
      ]}
      outlets={[{ id: "frame", label: "Frame" }]}
      activeInputs={data.activeInputs}
      activeOutputs={data.activeOutputs}
    >
      <button
        type="button"
        className="node-delete nodrag nopan"
        aria-label={`Delete ${descriptor.label}`}
        onClick={deleteNode}
      >
        <X size={13} />
      </button>
      <div className="control-grid two-col">
        {descriptor.params.map((param) => (
          <RangeControl
            key={param.key}
            label={param.label}
            value={data.values[param.key] ?? param.def}
            min={param.min}
            max={param.max}
            step={param.step}
            digits={param.step < 1 ? 2 : 0}
            paramKey={`fx:${data.id}:${param.key}`}
            onBeginEdit={data.onBeginEdit}
            onChange={(value) => data.onFxValue(data.id, param.key, value)}
            onEndEdit={data.onEndEdit}
          />
        ))}
      </div>
      <button
        type="button"
        className={`fx-bypass nodrag nopan${data.bypass ? " active" : ""}`}
        onClick={() => data.onFxBypass(data.id, !data.bypass)}
      >
        {data.bypass ? "Bypassed" : "Active"}
      </button>
    </NodeFrame>
  );
});
```

- [ ] **Step 3: Register the node type, drop `postprocess`**

In `nodeTypes` (`ControlGraph.tsx:2709`) remove `postprocess: CompositeFxNode,` and add `fx: FxNode,`.

- [ ] **Step 4: Default graph — Scene→Display frame edge, no monolith**

In `baseNodes` (`:3018`) delete the `postprocess` node object (`:3156-3167`). In `initialEdges` (`:3195`) replace the two old frame edges:

```ts
    { id: 'renderer-postprocess', source: 'renderer', sourceHandle: 'frame', target: 'postprocess', targetHandle: 'frame' },
    { id: 'postprocess-display', source: 'postprocess', sourceHandle: 'frame', target: 'display', targetHandle: 'frame' },
```

with one:

```ts
    { id: 'renderer-display', source: 'renderer', sourceHandle: 'frame', target: 'display', targetHandle: 'frame' },
```

Remove `'postprocess'` from `PROTECTED_NODE_IDS` (`:927`), `LAYOUT_COLUMNS` (`:920`), `PASS_COLUMN_IDS` (`:961`), and the `compositeFxSettingsKey` effect (`:3470-3485`) + its `COMPOSITE_FX_*` constants if now unused (Task 8 covers the settings cleanup; leaving the constants compiles).

- [ ] **Step 5: FX node id counter + live value state + add/insert/delete (no heal — §0)**

Add a ref near `operatorIdRef` (`:2984`):

```ts
const fxIdRef = useRef(1);
const fxValuesRef = useRef<Record<string, Record<string, number>>>({});
```

Add the value/bypass setters and the insert helper (near `addOperatorNode`, `:3803`):

```ts
const onFxValue = useCallback(
  (id: string, key: string, value: number) => {
    const current = fxValuesRef.current[id] ?? {};
    fxValuesRef.current = {
      ...fxValuesRef.current,
      [id]: { ...current, [key]: value },
    };
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, values: fxValuesRef.current[id] } }
          : node,
      ),
    );
  },
  [setNodes],
);

const onFxBypass = useCallback(
  (id: string, bypass: boolean) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, bypass } } : node,
      ),
    );
  },
  [setNodes],
);

const addFxNode = useCallback(
  (kind: string) => {
    if (!isFxKind(kind)) return;
    const id = `fx-${kind}-${fxIdRef.current}`;
    fxIdRef.current += 1;
    const values = fxParamDefaults(kind);
    fxValuesRef.current = { ...fxValuesRef.current, [id]: values };
    const node: Node = {
      id,
      type: "fx",
      position: nextAddPosition(),
      dragHandle: ".flow-node-title",
      data: {
        id,
        kind,
        bypass: false,
        values,
        onBeginEdit: editCallbacks.onBeginEdit,
        onEndEdit: editCallbacks.onEndEdit,
        onFxValue,
        onFxBypass,
      },
    };
    // Insert before Display: find the edge feeding display:frame and splice.
    setEdges((current) => {
      const incoming = current.find(
        (edge) => edge.target === "display" && edge.targetHandle === "frame",
      );
      const rest = current.filter((edge) => edge !== incoming);
      const upstream = incoming?.source ?? "renderer";
      const upstreamHandle = incoming?.sourceHandle ?? "frame";
      return [
        ...rest,
        {
          id: `${upstream}-${id}`,
          source: upstream,
          sourceHandle: upstreamHandle,
          target: id,
          targetHandle: "frame",
          animated: true,
        },
        {
          id: `${id}-display`,
          source: id,
          sourceHandle: "frame",
          target: "display",
          targetHandle: "frame",
          animated: true,
        },
      ];
    });
    setNodes((nodes) => [...nodes, node]);
    setIsAddMenuOpen(false);
    setAddMenuCategory(null);
  },
  [editCallbacks, nextAddPosition, onFxBypass, onFxValue, setEdges, setNodes],
);
```

**No delete-heal (§0).** Do **not** reconnect a deleted node's upstream to its downstream — auto-healing erases the consequence of the deletion and is exactly the fake-patchbay behavior this plan removes. Deletion simply removes the node and its edges; the chain re-derives from the remaining edges (`derivePostChain`/`renderChainConnected`). If deleting a mid-chain node breaks the path from the scene pass to the sink, that is the **correct** result — the frame path is broken, so the render reflects it (effects drop, and if nothing reaches the sink, the shape goes), and the user re-wires to restore. Removing an effect cleanly means the user deliberately reconnects its neighbours, not an automatic heal that hides what happened. So `onBeforeDelete` only filters the deleted nodes/edges and adds nothing back. (This mirrors morphology's `walkPostFxChain`: a deleted node just isn't traversed.)

- [ ] **Step 6: Frame-edge validity for FX chaining**

In `isValidGraphConnection` (`:1327`) replace the `sourceHandle === 'frame'` block (`:1344-1348`) with one that allows scene/fx → fx/display frame links:

```ts
if (sourceHandle === "frame" && targetHandle === "frame") {
  const sourceIsFrame = source.id === "renderer" || source.type === "fx";
  const targetIsFrame = target.id === "display" || target.type === "fx";
  return sourceIsFrame && targetIsFrame;
}
```

- [ ] **Step 7: Derive + push the spec when nodes/edges change**

Add a spec-walk function (module scope, near `evaluateAudioModulations`):

```ts
function derivePostChain(
  nodes: readonly Node[],
  edges: readonly Edge[],
): PostChainSpec {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incomingFrame = (id: string): Edge | undefined =>
    edges.find((edge) => edge.target === id && edge.targetHandle === "frame");
  const chain: PostChainSpec = [];
  const seen = new Set<string>();
  let cursor = incomingFrame("display")?.source;
  for (let i = 0; i < 64 && cursor && !seen.has(cursor); i += 1) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node || node.type !== "fx") break;
    const values = numberRecordFromObject(dataObject(node.data, "values"));
    chain.push({
      id: node.id,
      kind: dataString(node.data, "kind"),
      bypass: dataBoolean(node.data, "bypass"),
      params: values,
    });
    cursor = incomingFrame(node.id)?.source;
  }
  return chain.reverse();
}
```

Add an effect (near the `emitAudioGraph` effect, `:3595`) that pushes it. Note `onFxValue` updates `setNodes`, so this effect re-runs on value changes too:

```ts
useEffect(() => {
  props.onPostChain(derivePostChain(nodes, edges));
}, [edges, nodes, props.onPostChain]);
```

- [ ] **Step 8: Add menu — Effects category**

In `ADD_CATEGORIES` (`:194`) add `{ id: 'effects', label: 'Effects' }` and widen the `AddMenuCategory` type (`:60`) to include `'effects'`. In `addMenuContent` (`:3835`) add an effects branch listing `EFFECT_CATALOG` (skip `toneMap` here — it's added once, Task 9):

```tsx
if (addMenuCategory === "effects") {
  return (
    <div className="add-node-menu nodrag nopan">
      <button
        type="button"
        className="back-button"
        onClick={resetAddMenuCategory}
      >
        Back
      </button>
      {EFFECT_CATALOG.filter((d) => d.kind !== "toneMap").map(
        (d: FxDescriptor) => (
          <button key={d.kind} type="button" onClick={() => addFxNode(d.kind)}>
            {d.label}
          </button>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 9: Minimal CSS for the bypass button**

Append to `web/src/style.css`:

```css
.fx-bypass {
  margin-top: 6px;
  width: 100%;
  font-size: 11px;
  opacity: 0.7;
}
.fx-bypass.active {
  opacity: 1;
  color: var(--accent, #c7682e);
}
```

- [ ] **Step 10: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors (App.tsx + ControlGraph.tsx now agree on `onPostChain`).
Run: `npm run web:build`
Expected: build succeeds.

- [ ] **Step 11: Manual verification**

Run: `npm run dev`, open the served URL.
Expected: scene renders normally with no effects (empty chain). Open Add → Effects → Pixelate; a Pixelate node appears wired between Scene pass and Display; raise its Size and the canvas pixelates live. Add Posterize after it; reorder by rewiring. **§0 consequence test:** delete the wire from Scene pass into the chain (or delete a mid-chain node) → the frame path to the sink is broken → the tiling **disappears** (not "heals"); re-wire and it returns. Cutting `palette → material` likewise drops the geometry. If any of these leaves the render unchanged, the task is not done.

- [ ] **Step 12: Commit**

```bash
git add web/src/flow/ControlGraph.tsx web/src/style.css web/src/App.tsx
git commit -m "feat(graph): compile chainable post-FX nodes from frame edges"
```

---

## Task 7: Node-scoped `(nodeId, handle)` modulation for FX params

**Files:**

- Modify: `web/src/flow/ControlGraph.tsx`

Today `evaluateAudioModulations` keys modulation by target-handle name only (`ControlGraph.tsx:1515`). FX params must resolve per `(nodeId, paramKey)` so two pixelate nodes don't collide, then fold into the pushed spec with the target-range + ride/hold rule.

- [ ] **Step 1: Compute per-FX-node modulation and merge into the spec push**

Replace the Task 6 push effect with one that resolves FX-target edges node-scoped. Add a helper:

```ts
function fxModulatedParams(
  node: Node,
  edges: readonly Edge[],
  signals: Map<string, number>,
  heldParams: Record<string, boolean | undefined>,
  dragMode: DragMode,
): Record<string, number> {
  const descriptor = fxDescriptor(dataString(node.data, "kind"));
  const base = numberRecordFromObject(dataObject(node.data, "values"));
  if (!descriptor) return base;
  const out: Record<string, number> = { ...base };
  for (const param of descriptor.params) {
    const edge = edges.find(
      (e) => e.target === node.id && e.targetHandle === param.key,
    );
    if (!edge) continue;
    const signal = signals.get(signalKey(edge.source, edge.sourceHandle));
    if (typeof signal !== "number") continue;
    const editKey = `fx:${node.id}:${param.key}`;
    if (dragMode === "hold" && heldParams[editKey] === true) continue;
    out[param.key] = Math.min(
      param.max,
      Math.max(
        param.min,
        (base[param.key] ?? param.def) + signal * (param.max - param.min),
      ),
    );
  }
  return out;
}
```

`evaluateAudioModulations` builds a `signals` map internally; expose it by returning `{ values, signals }` or add a sibling exported function `evaluateSignals(features, nodes, edges, state, liveOperators): Map<string,number>` that runs the same source/operator passes (`:1473-1506`) and returns `signals`. Reuse it in both `evaluateAudioModulations` and the FX push to avoid double evaluation.

- [ ] **Step 2: Push spec with resolved params each audio frame**

In `emitAudioGraph` (`:2999`), after computing modulations, also derive + push the FX chain with node-scoped params:

```ts
const emitAudioGraph = useCallback(() => {
  const features = props.audio.getSnapshot().features;
  const signals = evaluateSignals(
    features,
    nodesRef.current,
    edgesRef.current,
    audioOperatorStateRef.current,
    liveOperatorDataRef.current,
  );
  props.onAudioModulation(modulationsFromSignals(signals, edgesRef.current));
  const chain = derivePostChain(nodesRef.current, edgesRef.current).map(
    (node) => {
      const flowNode = nodesRef.current.find((n) => n.id === node.id);
      if (!flowNode) return node;
      return {
        ...node,
        params: fxModulatedParams(
          flowNode,
          edgesRef.current,
          signals,
          heldParamsRef.current,
          props.dragMode,
        ),
      };
    },
  );
  props.onPostChain(chain);
}, [props.audio, props.dragMode, props.onAudioModulation, props.onPostChain]);
```

where `modulationsFromSignals` is the existing target-range averaging from `evaluateAudioModulations` (`:1508-1526`) factored out. Add `heldParamsRef` mirror if not present (ControlGraph already tracks edits via `editCallbacks`; pass `props`-level held state by reusing the begin/end-edit keys `fx:<id>:<key>`). Keep the structural push from Task 6 for topology-only changes.

- [ ] **Step 3: Make FX param handles valid signal targets**

In `isSignalTarget` (`:1321`) add: a target node of `type === 'fx'` accepts any of its descriptor param keys:

```ts
if (node.type === "fx") {
  const descriptor = fxDescriptor(dataString(node.data, "kind"));
  return descriptor ? descriptor.params.some((p) => p.key === handle) : false;
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run web:build`
Expected: both succeed.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Add two Pixelate nodes; wire Audio analysis `bass` → first Pixelate `size` via a Gain operator; play audio. Expected: only the wired node's size modulates; the second is unaffected (node-scoped). Toggle Hold while dragging that slider: modulation suppresses for that param only.

- [ ] **Step 6: Commit**

```bash
git add web/src/flow/ControlGraph.tsx
git commit -m "feat(graph): node-scoped (nodeId,handle) modulation for FX params"
```

---

## Task 8: Tone-map node

**Files:**

- Modify: `web/src/flow/ControlGraph.tsx`
- Modify: `web/src/render/webgpuRenderer.ts`

- [ ] **Step 1: Add a tone-map node to the default graph**

In `baseNodes` add a `fx` node `{ id: 'tonemap', type: 'fx', position: {...}, data: { id: 'tonemap', kind: 'toneMap', bypass: false, values: {}, onBeginEdit, onEndEdit, onFxValue, onFxBypass } }` and default-wire it just before Display: change `initialEdges` `renderer-display` to `renderer-tonemap` + `tonemap-display`. Add `'tonemap'` to `PROTECTED_NODE_IDS` (it should not be deletable; it has no params, only the frame passthrough + the output transform). In `addFxNode`, keep inserting new effects before whatever currently feeds Display (so user effects land upstream of tone-map by default for display-domain effects; linear effects like bloom the user can drag upstream).

- [ ] **Step 2: Domain mismatch soft warning (non-blocking)**

In the FX push (`derivePostChain` consumer), after building the chain, compute whether any `linear`-domain effect sits downstream of the `toneMap` node or any `display`-domain effect sits upstream, and set a `data.warn` flag on those nodes so the node renders a small caution marker. Implementation: walk the ordered chain, track whether tone-map has been passed, compare each `fxDescriptor(kind).domain`. Set via `setNodes` only when the warn set changes (guard like the `activeInputs` effect at `:3575` to avoid frame-rate `setNodes`).

- [ ] **Step 3: Remove dead `fx_*` renderer writes**

In `webgpuRenderer.ts` `setSettings` delete the `this.uniforms.fxPixelSize..fxAfterImage` assignments (`:484-489`) and in `setAudioDrive` the `fx*` assignments (`:628-633`). Remove the now-unused `fx*` fields from `createRendererUniforms` (`:114-119`) and the `pixelateNode`/`posterize`/`film`/`rgbShift`/`sobel`/`afterImage`/`convertToTexture`/`screenUV`/`screenSize`/`floor`/`mix`/`Fn` imports that only the deleted fold used.

- [ ] **Step 4: Remove dead `fx_*` graph targets**

In `ControlGraph.tsx` remove the `fx_*` entries from `AUDIO_TARGET_RANGES` (`:1069`), `COMPOSITE_FX_CONTROLS`/`COMPOSITE_FX_SETTING_KEYS` (`:127`, `:1003`), and the `fx_*` keys from `GRAPH_PRESET_SETTING_KEYS` (`:1012`). Remove `CompositeFxNode` (`:2639`) and the `compositeFxSettingsKey` machinery (`:3289`, `:3470`).

- [ ] **Step 5: Full gate**

Run: `npm run typecheck`
Expected: no errors, no unused-symbol complaints.
Run: `npm run ts:policy && npm run js:policy`
Expected: pass.
Run: `npm run web:build`
Expected: succeeds.
Run: `npm run render:health`
Expected: passes (no false black/occlusion).

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Confirm: scene renders; tone-map node present before Display; add Bloom and drag it upstream of tone-map (linear) — highlights bloom and roll off (no white-clip); add Sobel downstream of tone-map — edges read correctly; a Bloom placed downstream of tone-map shows the caution marker.

- [ ] **Step 7: Commit**

```bash
git add web/src/render/webgpuRenderer.ts web/src/flow/ControlGraph.tsx
git commit -m "feat(graph): tone-map node + retire hardcoded fx_* post path"
```

---

## Self-review

**Spec coverage (design spec §2-§4):** spec channel (Task 3,5) ✓ · renderer registry (Task 2) ✓ · recompile-vs-uniform split (Task 4) ✓ · pure-data catalog, three-free UI (Task 1,6) ✓ · node-scoped modulation (Task 7) ✓ · two-domain foundation — frame-domain delivered, surface/field reuses same channel (out of scope, Block 2) ✓ · catalog: six + bloom (Task 1,2); dotscreen/CA/sepia/bleach/blur/anamorphic/AA = Phase B ✓ (deferred, noted) · Feedback/trails, Contours, parilov SDF = Phase C (deferred, noted) · tone-map node (Task 8) ✓ · compiler walk + add/reorder/delete-heal + incomplete→raw scene (Task 6) ✓ · icon Add menu + MultiSwitch = Phase D (deferred; Task 6 uses word buttons) ✓.

**Placeholder scan:** Task 7 Step 1-2 reference `evaluateSignals`/`modulationsFromSignals` as factor-outs of the existing `evaluateAudioModulations` body — the engineer must extract them; the source lines (`:1473-1526`) are cited and the existing function is the exact template. This is a real refactor, not a placeholder, but flag it as the one task needing judgment.

**Type consistency:** `PostChainSpec`/`PostChainNode` (Task 3) used identically in renderer (Task 4), App (Task 5), graph (Task 6,7). `FxUniforms`/`FxBuilder` (Task 2) used in renderer (Task 4). `fxDescriptor`/`fxParamDefaults`/`isFxKind` (Task 1) used in graph (Task 6) and renderer (Task 4). `onFxValue`/`onFxBypass` signatures match between `FxNode` data and the graph setters.

**Known risk:** Task 7's signal-map factor-out is the highest-judgment step; do it first within the task and typecheck before wiring the push.

---

# Phase B — catalog expansion (long phase)

> **Honesty (§0):** each new effect node is downstream of its inlets — its params are `(nodeId,handle)` modulation targets that fall back to baseline when unwired, and the node only contributes when its `frame` inlet is fed *and* it reaches the sink. No effect reacts to anything it isn't wired to.

Mechanical extensions of Tasks 1-2, plus a one-time type-system extension for
select + structural fields (needed by AA and anamorphic). All signatures below
were verified against `node_modules/three/examples/jsm/tsl/display/`.

## Task 9: Catalog type system — selects + structural fields

**Files:**

- Modify: `web/src/render/postFxCatalog.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/render/postFxRegistry.ts`
- Modify: `web/src/render/webgpuRenderer.ts`
- Modify: `web/src/flow/ControlGraph.tsx`

- [ ] **Step 1: Extend the catalog types (`postFxCatalog.ts`)**

```ts
export type FxParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  structural?: boolean; // changing it rebuilds the chain (e.g. baked loop counts)
};

export type FxSelectOption = { value: string; label: string };
export type FxSelectSpec = {
  key: string;
  label: string;
  options: readonly FxSelectOption[];
  def: string;
  // selects are always structural (they change shader/topology)
};

export type FxDescriptor = {
  kind: FxKind;
  label: string;
  icon: string;
  domain: FxDomain;
  compose: FxCompose;
  params: readonly FxParamSpec[];
  selects?: readonly FxSelectSpec[];
};

export function fxSelectDefaults(kind: string): Record<string, string> {
  const descriptor = BY_KIND.get(kind);
  const out: Record<string, string> = {};
  if (!descriptor?.selects) return out;
  for (const select of descriptor.selects) out[select.key] = select.def;
  return out;
}

export function fxStructuralSignature(
  kind: string,
  params: Record<string, number>,
  selects: Record<string, string>,
): string {
  const descriptor = BY_KIND.get(kind);
  if (!descriptor) return "";
  const parts: string[] = [];
  for (const p of descriptor.params)
    if (p.structural) parts.push(`${p.key}=${params[p.key] ?? p.def}`);
  for (const s of descriptor.selects ?? [])
    parts.push(`${s.key}=${selects[s.key] ?? s.def}`);
  return parts.join(",");
}
```

- [ ] **Step 2: `PostChainNode` gains `selects` (`types.ts`)**

```ts
export type PostChainNode = {
  id: string;
  kind: string;
  bypass: boolean;
  params: Record<string, number>;
  selects: Record<string, string>;
};
```

- [ ] **Step 3: Builder receives the node for structural reads (`postFxRegistry.ts`)**

Change the type and every builder's `apply` to accept the spec node:

```ts
import type { PostChainNode } from "../types";
export type FxBuilder = {
  createUniforms: () => FxUniforms;
  apply: (input: Node, u: FxUniforms, node: PostChainNode) => Node;
};
```

Update existing builders to the 3-arg signature (they ignore `node`).

- [ ] **Step 4: Signature includes structural fields (`webgpuRenderer.ts`)**

```ts
import { fxDescriptor, fxStructuralSignature } from './postFxCatalog';

  postChainSignatureOf(spec: PostChainSpec): string {
    return spec
      .map(node => `${node.id}:${node.kind}:${node.bypass ? 1 : 0}:${fxStructuralSignature(node.kind, node.params, node.selects)}`)
      .join('|');
  }
```

In `rebuildPostPipeline`, pass the node: `frame = builder.apply(frame, uniforms, node);`.

- [ ] **Step 5: UI renders selects; spec carries them (`ControlGraph.tsx`)**

In `FxNode`, after the params grid, render `descriptor.selects` as `<select>` (same markup as the operator node selects, `ControlGraph.tsx:2557`), calling a new `data.onFxSelect(data.id, key, value)`. Add `onFxSelect` setter (mirrors `onFxValue`, writes `data.selects` via `setNodes`). In `addFxNode` seed `selects: fxSelectDefaults(kind)` and store in `fxValuesRef`-style ref. In `derivePostChain`, read `selects: stringRecordFromObject(dataObject(node.data, 'selects'))`. Default node `data` includes `selects`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run web:build`
Expected: both succeed (no behavior change yet — no effect uses selects).

- [ ] **Step 7: Commit**

```bash
git add web/src/render/postFxCatalog.ts web/src/types.ts web/src/render/postFxRegistry.ts web/src/render/webgpuRenderer.ts web/src/flow/ControlGraph.tsx
git commit -m "feat(render): post-FX catalog selects + structural signature"
```

---

## Task 10: Simple new effects — dotScreen, chromaticAberration, sepia, bleach, blur

**Files:**

- Modify: `web/src/render/postFxCatalog.ts` (descriptors)
- Modify: `web/src/render/postFxRegistry.ts` (builders + imports)

- [ ] **Step 1: Add `FxKind` members + descriptors**

Add to `FxKind`: `'dotScreen' | 'chromaticAberration' | 'sepia' | 'bleach' | 'blur'`. Add to `EFFECT_CATALOG`:

```ts
  { kind: 'dotScreen', label: 'Dot screen', icon: 'CircleDot', domain: 'display', compose: 'replace',
    params: [P('angle', 'Angle', 0, 360, 1, 90), P('scale', 'Scale', 0.1, 8, 0.05, 1)] },
  { kind: 'chromaticAberration', label: 'Chromatic', icon: 'Aperture', domain: 'display', compose: 'replace',
    params: [P('strength', 'Strength', 0, 8, 0.05, 0), P('scale', 'Scale', 1, 1.5, 0.01, 1.1)] },
  { kind: 'sepia', label: 'Sepia', icon: 'Coffee', domain: 'display', compose: 'blend',
    params: [P('mix', 'Mix', 0, 1, 0.01, 0)] },
  { kind: 'bleach', label: 'Bleach', icon: 'Sun', domain: 'display', compose: 'blend',
    params: [P('opacity', 'Opacity', 0, 1, 0.01, 0)] },
  { kind: 'blur', label: 'Blur', icon: 'Droplet', domain: 'linear', compose: 'replace',
    params: [P('amount', 'Amount', 0, 1, 0.01, 0)] },
```

- [ ] **Step 2: Add builders (`postFxRegistry.ts`)**

```ts
import { dotScreen } from 'three/addons/tsl/display/DotScreenNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { sepia } from 'three/addons/tsl/display/Sepia.js';
import { bleach } from 'three/addons/tsl/display/BleachBypass.js';
import { hashBlur } from 'three/addons/tsl/display/hashBlur.js';
import { radians } from 'three/tsl';

  dotScreen: {
    createUniforms: () => ({ angle: uniform(90), scale: uniform(1) }),
    apply: (input, u) => { const d = dotScreen(input, 0, 1); d.angle = radians(u['angle']!); d.scale = u['scale']!; return d; },
  },
  chromaticAberration: {
    createUniforms: () => ({ strength: uniform(0), scale: uniform(1.1) }),
    apply: (input, u) => chromaticAberration(input, u['strength']!, null, u['scale']!),
  },
  sepia: {
    createUniforms: () => ({ mix: uniform(0) }),
    apply: (input, u) => mix(convertToTexture(input).sample(screenUV), sepia(input), u['mix']!),
  },
  bleach: {
    createUniforms: () => ({ opacity: uniform(0) }),
    apply: (input, u) => bleach(input, u['opacity']!),
  },
  blur: {
    createUniforms: () => ({ amount: uniform(0) }),
    apply: (input, u) => hashBlur(convertToTexture(input), u['amount']!, { repeats: float(45) }),
  },
```

- [ ] **Step 3: Add to the Add→Effects menu** — already automatic (it maps `EFFECT_CATALOG`, Task 6 Step 8).

- [ ] **Step 4: Verify + manual**

Run: `npm run typecheck && npm run web:build`. Then `npm run dev`: add Dot screen, Chromatic, Sepia (raise Mix), Bleach, Blur — each composes correctly in the chain.

- [ ] **Step 5: Commit**

```bash
git add web/src/render/postFxCatalog.ts web/src/render/postFxRegistry.ts
git commit -m "feat(render): dotScreen, chromatic, sepia, bleach, blur effects"
```

---

## Task 11: Anamorphic (structural samples) + AA (FXAA/SMAA mode)

**Files:**

- Modify: `web/src/render/postFxCatalog.ts`, `web/src/render/postFxRegistry.ts`

- [ ] **Step 1: Descriptors (with selects)**

Add kinds `'anamorphic' | 'aa'`.

```ts
  { kind: 'anamorphic', label: 'Anamorphic', icon: 'Zap', domain: 'linear', compose: 'additive',
    params: [P('threshold', 'Threshold', 0, 1, 0.01, 0.9), P('scale', 'Scale', 0, 20, 0.1, 3)],
    selects: [{ key: 'samples', label: 'Quality', def: '32', options: [
      { value: '16', label: 'Low' }, { value: '32', label: 'Med' }, { value: '64', label: 'High' }] }] },
  { kind: 'aa', label: 'Anti-alias', icon: 'Spline', domain: 'display', compose: 'replace',
    params: [],
    selects: [{ key: 'mode', label: 'Mode', def: 'off', options: [
      { value: 'off', label: 'Off' }, { value: 'fxaa', label: 'FXAA' }, { value: 'smaa', label: 'SMAA' }] }] },
```

Note: catalog `domain` for `aa` is descriptive; the _effective_ domain depends on mode (FXAA=display, SMAA=linear) — surfaced by the Task 8 domain-warning walk using the resolved mode.

- [ ] **Step 2: Builders (read structural from `node`)**

```ts
import { anamorphic } from 'three/addons/tsl/display/AnamorphicNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';

  anamorphic: {
    createUniforms: () => ({ threshold: uniform(0.9), scale: uniform(3) }),
    apply: (input, u, node) => {
      const samples = Number(node.selects['samples'] ?? '32');
      const a = anamorphic(input, 0.9, 3, samples);
      a.threshold = u['threshold']!; a.scale = u['scale']!;
      return input.add(a);
    },
  },
  aa: {
    createUniforms: () => ({}),
    apply: (input, _u, node) => {
      const mode = node.selects['mode'] ?? 'off';
      if (mode === 'fxaa') return fxaa(input);
      if (mode === 'smaa') return smaa(input);
      return input;
    },
  },
```

- [ ] **Step 3: Verify + manual**

`npm run typecheck && npm run web:build`; `npm run dev`: add Anamorphic (streaks, additive), change Quality (chain recompiles via structural signature); add AA, switch FXAA↔SMAA (recompiles).

- [ ] **Step 4: Commit**

```bash
git add web/src/render/postFxCatalog.ts web/src/render/postFxRegistry.ts
git commit -m "feat(render): anamorphic (quality select) + AA (FXAA/SMAA) nodes"
```

---

# Phase C — signature nodes (long phase)

> **Honesty (§0):** Feedback / Contours / Edge-profile contribute **only** through the chain — delete the node or cut its `frame`/surface wire and its contribution vanishes from the render. The custom Trails node owns GPU state, but that state is only in the pipeline when the node is actually wired in; it is not a global toggle.

## Task 12: Feedback node — custom Trails (afterimage / trails / both)

**Files:**

- Create: `web/src/render/trailsNode.ts`
- Modify: `web/src/render/postFxRegistry.ts`, `web/src/render/postFxCatalog.ts`, `web/src/render/webgpuRenderer.ts`

Modeled exactly on `node_modules/three/examples/jsm/tsl/display/AfterImageNode.js` (TempNode + ping-pong RTs + `updateBefore` swap + `setup` fragmentNode). Blend math from `.local/renderer.ts` (verified): `max(prev·decay, frame)` + feedback UV zoom/rotate + hue-per-cycle + background-distance mask. `mode` is structural (selects the fragment variant); `mask`/`decay`/`zoom`/`rotate`/`hue`/`bg` are live uniforms. Persistence uses the same `afterImageDamp` remap.

- [ ] **Step 1: Write `trailsNode.ts`**

```ts
// web/src/render/trailsNode.ts
import {
  RenderTarget,
  Vector2,
  QuadMesh,
  NodeMaterial,
  RendererUtils,
  TempNode,
  NodeUpdateType,
} from "three/webgpu";
import type Node from "three/src/nodes/core/Node.js";
import {
  nodeObject,
  Fn,
  float,
  vec2,
  vec3,
  uv,
  texture,
  passTexture,
  convertToTexture,
  max,
  mix,
  sin,
  cos,
  cross,
  dot,
  normalize,
  distance,
  smoothstep,
  uniform,
} from "three/tsl";

const _size = new Vector2();
const _quadMesh = new QuadMesh();
let _rendererState:
  | ReturnType<typeof RendererUtils.resetRendererState>
  | undefined;

const hueRotate = Fn(([color, angle]: [Node, Node<"float">]) => {
  const k = normalize(vec3(1, 1, 1));
  const c = cos(angle.mul(6.28318530718));
  const s = sin(angle.mul(6.28318530718));
  return color
    .mul(c)
    .add(cross(k, color).mul(s))
    .add(k.mul(dot(k, color)).mul(float(1).sub(c)));
});

export type TrailsMode = "afterimage" | "trails" | "both";

export class TrailsNode extends TempNode {
  textureNode: Node;
  mode: TrailsMode;
  decay = uniform(0.92);
  zoom = uniform(0);
  rotate = uniform(0);
  hue = uniform(0);
  maskMode = uniform(0); // 0 none, 1 surface, 2 inverse
  bg = uniform(vec3(0, 0, 0));
  private _compRT = new RenderTarget(1, 1, { depthBuffer: false });
  private _oldRT = new RenderTarget(1, 1, { depthBuffer: false });
  private _textureNode = passTexture(this, this._compRT.texture);
  private _textureNodeOld = texture(this._oldRT.texture);
  private _material: NodeMaterial | null = null;

  constructor(textureNode: Node, mode: TrailsMode) {
    super("vec4");
    this.textureNode = textureNode;
    this.mode = mode;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  getTextureNode(): Node {
    return this._textureNode;
  }
  setSize(w: number, h: number): void {
    this._compRT.setSize(w, h);
    this._oldRT.setSize(w, h);
  }

  updateBefore(frame: {
    renderer: import("three/webgpu").WebGPURenderer;
  }): void {
    const { renderer } = frame;
    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);
    const map = (this.textureNode as unknown as { value: { type: number } })
      .value;
    this._compRT.texture.type = map.type;
    this._oldRT.texture.type = map.type;
    renderer.getDrawingBufferSize(_size);
    this.setSize(_size.x, _size.y);
    (this._textureNode as unknown as { value: unknown }).value =
      this._compRT.texture;
    (this._textureNodeOld as unknown as { value: unknown }).value =
      this._oldRT.texture;
    _quadMesh.material = this._material;
    _quadMesh.name = "Trails";
    renderer.setRenderTarget(this._compRT);
    _quadMesh.render(renderer);
    const temp = this._oldRT;
    this._oldRT = this._compRT;
    this._compRT = temp;
    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  setup(): Node {
    const newTex = this.textureNode;
    const oldTex = this._textureNodeOld;
    (oldTex as unknown as { uvNode: Node }).uvNode =
      (newTex as unknown as { uvNode?: Node }).uvNode || uv();

    const compose = Fn(() => {
      const cur = (newTex as unknown as { sample: () => Node })
        .sample()
        .toVar();
      // feedback UV warp for trails/both
      let warpedUv: Node = uv();
      if (this.mode !== "afterimage") {
        const center = vec2(0.5, 0.5);
        const p = uv().sub(center).mul(float(1).add(this.zoom));
        const s = sin(this.rotate);
        const c = cos(this.rotate);
        warpedUv = vec2(
          c.mul(p.x).sub(s.mul(p.y)),
          s.mul(p.x).add(c.mul(p.y)),
        ).add(center);
      }
      const old = (oldTex as unknown as { sample: (uv?: Node) => Node })
        .sample(warpedUv)
        .toVar();
      if (this.mode !== "afterimage") {
        old.rgb.assign(hueRotate(old.rgb, this.hue));
      }
      old.mulAssign(this.decay);
      const accum = max(cur, old).toVar();
      if (this.mode === "afterimage") return accum;
      // mask via background-color distance (surface=1 off-bg, inverse=1 on-bg)
      const bgDist = distance(cur.rgb, this.bg);
      const surface = smoothstep(0.003, 0.012, bgDist);
      const m = mix(
        float(1),
        mix(surface, float(1).sub(surface), this.maskMode.sub(1).max(0)),
        this.maskMode.min(1),
      );
      return mix(cur, accum, m);
    });

    const material = this._material || (this._material = new NodeMaterial());
    material.name = "Trails";
    material.fragmentNode = compose();
    return this._textureNode;
  }

  dispose(): void {
    this._compRT.dispose();
    this._oldRT.dispose();
    if (this._material) this._material.dispose();
  }
}

export const trails = (node: Node, mode: TrailsMode): TrailsNode =>
  new TrailsNode(convertToTexture(nodeObject(node)), mode);
```

- [ ] **Step 2: Catalog descriptor**

```ts
// FxKind += 'feedback'
  { kind: 'feedback', label: 'Feedback', icon: 'Repeat', domain: 'display', compose: 'feedback',
    params: [P('trail', 'Persistence', 0, 1, 0.01, 0), P('zoom', 'Zoom', -0.1, 0.1, 0.001, 0),
             P('rotate', 'Rotate', -0.2, 0.2, 0.001, 0), P('hue', 'Hue', -0.5, 0.5, 0.001, 0)],
    selects: [
      { key: 'mode', label: 'Mode', def: 'trails', options: [
        { value: 'afterimage', label: 'Afterimage' }, { value: 'trails', label: 'Trails' }, { value: 'both', label: 'Both' }] },
      { key: 'mask', label: 'Mask', def: 'none', options: [
        { value: 'none', label: 'None' }, { value: 'surface', label: 'Surface' }, { value: 'inverse', label: 'Inverse' }] },
    ] },
```

- [ ] **Step 3: Builder + bg/mask/persistence wiring (`postFxRegistry.ts`)**

```ts
import { trails, type TrailsMode } from './trailsNode';

  feedback: {
    createUniforms: () => ({ trail: uniform(0), zoom: uniform(0), rotate: uniform(0), hue: uniform(0), maskMode: uniform(0), decay: uniform(afterImageDamp(0)) }),
    apply: (input, u, node) => {
      const mode = (node.selects['mode'] ?? 'trails') as TrailsMode;
      const t = trails(input, mode);
      t.decay = u['decay']!; t.zoom = u['zoom']!; t.rotate = u['rotate']!; t.hue = u['hue']!; t.maskMode = u['maskMode']!;
      return t.getTextureNode();
    },
  },
```

In `webgpuRenderer.ts` `writePostChainUniforms`, special-case `feedback`: set `decay = afterImageDamp(params.trail)`, `maskMode = {none:0,surface:1,inverse:2}[selects.mask]`, copy `zoom/rotate/hue`, and set the node's `bg` uniform from the current clear color. Expose the bg: store `this.postBg = [r,g,b]` updated in `setSettings` where the clear color is set (`webgpuRenderer.ts:513`), and in `rebuildPostPipeline` keep a handle to each feedback node's uniforms (already in `postChainUniforms`) to write `bg`. Since `bg` lives on the `TrailsNode` instance, not in `FxUniforms`, store the instance: extend `apply` to also register `t` — simplest: keep a `Map<string, TrailsNode>` on the renderer populated in `rebuildPostPipeline` and write `bg.value.set(...)` each frame.

- [ ] **Step 4: Verify + manual**

`npm run typecheck && npm run web:build && npm run render:health`. Then `npm run dev`: add Feedback; Mode=Afterimage → plain trail, raise Persistence (no OLED runaway — capped); Mode=Trails → zoom/rotate/hue produce the acid-hands flow; Mask=Surface → trails only on tiles; Mask=Inverse → only off-tile. Switching Mode recompiles (structural).

- [ ] **Step 5: Commit**

```bash
git add web/src/render/trailsNode.ts web/src/render/postFxRegistry.ts web/src/render/postFxCatalog.ts web/src/render/webgpuRenderer.ts
git commit -m "feat(render): feedback node (afterimage/trails/both) with mask modes"
```

---

## Task 13: Contours (luminance, colorable)

**Files:**

- Modify: `web/src/render/postFxCatalog.ts`, `web/src/render/postFxRegistry.ts`

- [ ] **Step 1: Descriptor**

```ts
// FxKind += 'contours'
  { kind: 'contours', label: 'Contours', icon: 'Spline', domain: 'display', compose: 'blend',
    params: [P('spacing', 'Spacing', 1, 64, 0.5, 12), P('width', 'Width', 0.02, 0.49, 0.01, 0.12),
             P('mix', 'Mix', 0, 1, 0.01, 0), P('phase', 'Phase', 0, 1, 0.001, 0),
             P('r', 'Line R', 0, 1, 0.01, 0), P('g', 'Line G', 0, 1, 0.01, 0), P('b', 'Line B', 0, 1, 0.01, 0)] },
```

- [ ] **Step 2: Builder (full TSL)**

```ts
import { luminance, fract, abs, fwidth, vec4, screenUV, convertToTexture } from 'three/tsl';

  contours: {
    createUniforms: () => ({ spacing: uniform(12), width: uniform(0.12), mix: uniform(0), phase: uniform(0), r: uniform(0), g: uniform(0), b: uniform(0) }),
    apply: (input, u) => {
      const tex = convertToTexture(input);
      const base = tex.sample(screenUV);
      const luma = luminance(base.rgb);
      const banded = luma.mul(u['spacing']!).add(u['phase']!);
      const line = abs(fract(banded).sub(0.5));
      const aa = fwidth(banded).max(1e-4);
      const lineMask = float(1).sub(smoothstep(u['width']!.sub(aa), u['width']!.add(aa), line));
      const lineColor = vec3(u['r']!, u['g']!, u['b']!);
      return mix(base, vec4(lineColor, base.a), lineMask.mul(u['mix']!));
    },
  },
```

(Add `luminance, fract, abs, fwidth, vec4, vec3, smoothstep, float` to the registry's `three/tsl` imports if not already present.)

- [ ] **Step 3: Verify + manual**

`npm run typecheck && npm run web:build`; `npm run dev`: add Contours, raise Mix → luminance isolines appear; set Line RGB → recolor; Spacing/Width tune density; animate Phase via a wired clock.

- [ ] **Step 4: Commit**

```bash
git add web/src/render/postFxCatalog.ts web/src/render/postFxRegistry.ts
git commit -m "feat(render): colorable luminance contour lines node"
```

---

## Task 14: Edge profile (parilov) — surface-domain bridge node

**Files:**

- Modify: `web/src/tiling/geometry.ts`, `web/src/render/webgpuRenderer.ts`, `web/src/flow/ControlGraph.tsx`, `web/src/settings/androidSettings.ts`

Honest architecture note: a true screen-space SDF needs an extra edge-only pass; the cheaper, correct, resolution-independent form is an **object-space edge-distance attribute** + a material profile. This is therefore the **first surface/field-domain node** (it rides the existing surface contract, not the frame chain), implemented now per the fold-in. It also seeds Block 2.

- [ ] **Step 1: Bake `edgeDistance` attribute (`geometry.ts`)**

In `buildMeshGeometry`, add `const edgeDistance = new Float32Array(vertexCount);` to the buffers, thread it through `MeshBuffers`, `emitTriangle`, `emitProjectedVertex`, `emitVertex`. The fan triangles are `(center, a, b)`; the centroid corner has distance 1, polygon-boundary corners have 0. For `fillSub` use the barycentric centroid weight: in `emitTriangle`'s `point(i,j)` the centroid is corner `a`, so `edgeDist = fa = i/fillSub`. For the non-subdivided path, pass `1` for the center vertex and `0` for `b`,`c`. Set `geometry.setAttribute('edgeDistance', new BufferAttribute(edgeDistance, 1));`.

- [ ] **Step 2: Renderer uniforms + material profile (`webgpuRenderer.ts`)**

Add uniforms `edgeProfileWidth/Glow/colorR/G/B` to `createRendererUniforms` (default width 0, glow 0). In `createMaterial`, read `const edgeDist = attribute<'float'>('edgeDistance','float');` and add to `emissiveNode` a term: `mix(vec3(edgeProfile color)·glow, 0, smoothstep(0, width, edgeDist))` so the glow concentrates at edges (edgeDist≈0). Map graph settings → uniforms in `setSettings`.

- [ ] **Step 3: Settings keys (`androidSettings.ts`)**

Add `edge_profile_width`, `edge_profile_glow`, `edge_profile_r/g/b` to `Settings`/`DEFAULT_SETTINGS` following the existing pattern.

- [ ] **Step 4: Graph node (`ControlGraph.tsx`)**

Add an `EdgeProfileNode` (surface-domain, like `MaterialNode`) with sliders for width/glow/color, wired into the surface contract (outlet to `material:edge` or simply a settings node — follow `RippleTargetNode` integration). Its params are settings-backed (ride/hold via `settingRangeHandlers`). Add the keys to `AUDIO_TARGET_RANGES` so they are modulatable.

- [ ] **Step 5: Verify + manual**

`npm run typecheck && npm run web:build && npm run render:health`; `npm run dev`: raise Edge glow → tile borders gain a resolution-independent halo that follows the geometry under projection/zoom.

- [ ] **Step 6: Commit**

```bash
git add web/src/tiling/geometry.ts web/src/render/webgpuRenderer.ts web/src/flow/ControlGraph.tsx web/src/settings/androidSettings.ts
git commit -m "feat(render): edge-distance attribute + edge-profile surface node"
```

---

# Phase D — UI polish (long phase)

> **Honesty (§0):** appearance only. `MultiSwitch` and icons must not introduce a control that bypasses the graph or a port that does nothing — zero new decoration. If a polished control doesn't map to a real inlet/edge, it doesn't ship.

## Task 15: MultiSwitch 3-way component

**Files:**

- Create: `web/src/flow/MultiSwitch.tsx`
- Modify: `web/src/flow/ControlGraph.tsx`, `web/src/style.css`

Adapt the SVG segmented control from `.local/controls/skins/channel-strip/MultiSwitch.tsx` (one-of-N, keyboard + click, accent on active). Use it in `FxNode` for any `FxSelectSpec` with exactly 3 options (Feedback mode, Feedback mask, AA mode) in place of the `<select>`; keep `<select>` for the anamorphic quality (also 3, but optional — prefer MultiSwitch for consistency).

- [ ] **Step 1: Write `MultiSwitch.tsx`**

```tsx
import { memo, useCallback } from "react";

type MultiSwitchProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
};

export const MultiSwitch = memo(function MultiSwitch({
  label,
  value,
  options,
  onChange,
}: MultiSwitchProps) {
  const onKey = useCallback(
    (event: React.KeyboardEvent) => {
      const idx = options.findIndex((o) => o.value === value);
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        onChange(options[(idx + 1) % options.length]!.value);
        event.preventDefault();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        onChange(options[(idx - 1 + options.length) % options.length]!.value);
        event.preventDefault();
      }
    },
    [onChange, options, value],
  );
  return (
    <div
      className="multiswitch nodrag nopan"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKey}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
});
```

- [ ] **Step 2: Use it in `FxNode`** for 3-option selects (`descriptor.selects` where `options.length === 3`), calling `data.onFxSelect`.

- [ ] **Step 3: CSS** — append a `.multiswitch` segmented style to `style.css` (flex row, equal segments, `.active` uses `--accent`).

- [ ] **Step 4: Verify + manual + commit**

`npm run typecheck && npm run web:build`; `npm run dev`: Feedback mode/mask + AA mode render as 3-way switches and recompile on change.

```bash
git add web/src/flow/MultiSwitch.tsx web/src/flow/ControlGraph.tsx web/src/style.css
git commit -m "feat(graph): MultiSwitch 3-way control for FX mode selects"
```

---

## Task 16: Icon Add menu + toolbar + node icons

**Files:**

- Modify: `web/src/flow/ControlGraph.tsx`, `web/src/style.css`

- [ ] **Step 1: Effect node icons** — in `FxNode`, render the catalog `icon` next to the title via `const Icon = (Icons as Record<string, React.ComponentType<{size?:number}>>)[descriptor.icon] ?? Icons.Box; ... <Icon size={14} />`.

- [ ] **Step 2: Icon Add menu** — in `addMenuContent` effects branch, render each catalog entry as an icon button (icon + tooltip label) instead of a word button; same `onClick={() => addFxNode(d.kind)}`.

- [ ] **Step 3: Toolbar icons** — replace the word-only toolbar buttons (`Reset graph`, `Snap`, `Save/Load graph`, `Restore/Delete link`, `Add`) with lucide icon + `title`/`aria-label` (keep them all; `control-graph-regressions.md` requires fit icon, minimap, add/remove flows stay). Do not change behavior.

- [ ] **Step 4: CSS** — compact `.add-node-menu` icon grid + toolbar icon-button sizing in `style.css`.

- [ ] **Step 5: Full gate + manual + commit**

`npm run typecheck && npm run ts:policy && npm run js:policy && npm run web:build && npm run render:health`; `npm run dev`: Add menu and toolbar are compact icons with tooltips; every prior interaction still works (fit, minimap, save/load, delete-link, add effect/operator/clock).

```bash
git add web/src/flow/ControlGraph.tsx web/src/style.css
git commit -m "feat(graph): icon-based add menu, toolbar, and effect node icons"
```

---

## Self-review (Phases A-D)

**Spec coverage (`docs/render/effects-graph-design.md`):** spec channel + registry + recompile/uniform split + pure-data catalog + node-scoped modulation (A) ✓ · full frame-domain catalog incl. the six, bloom, dotScreen, chromatic, sepia, bleach, blur, anamorphic, AA (A,B) ✓ · tone-map node (A) ✓ · compiler walk + add/reorder/delete-heal + incomplete→raw (A) ✓ · Feedback (afterimage/trails/both, mask modes) (C) ✓ · Contours luminance colorable (C) ✓ · parilov edge profile — implemented as the surface-domain bridge with honest note (C/Task 14) ✓ · MultiSwitch + icon toolbar (D) ✓.

**Placeholder scan:** judgment-heavy steps are explicitly flagged, not hidden — Task 7 (`evaluateSignals`/`modulationsFromSignals` factor-out), Task 12 Step 3 (renderer-side `bg`/`Map<string,TrailsNode>` wiring), Task 14 Steps 1-2 (attribute threading + emissive integration). Each names the exact files, the template to copy, and the verified APIs. No content-free TODOs.

**Type consistency:** `PostChainNode { id, kind, bypass, params, selects }` is identical across types/renderer/registry/graph after Task 9. `FxBuilder.apply(input, u, node)` 3-arg signature applied to every builder. `fxDescriptor/fxParamDefaults/fxSelectDefaults/fxStructuralSignature/isFxKind` used consistently. `TrailsNode` API (`getTextureNode`, uniform fields) matches its builder usage.

**Quality bar for reviews (per the maintainer):** at each task's checkpoint, verify the change _actually runs and renders_, not just typechecks — diff against the morphology-lab reference for node/chain structure quality, confirm no decorative/inert ports were introduced (`control-graph-regressions.md`), and confirm the effect is visible end-to-end in `npm run dev`. Reject "documentation-only done."

**§0 acceptance test (the one that actually matters):** for every wire this plan touches, **cut it in the running app and confirm the represented thing stops** — the render is downstream of the graph, each node downstream of its inlets. The benchmark is `web/bullshitGraphTest.json`: a graph with no functional connections must render **nothing of consequence** (no geometry reaching the sink, no audio reaction). If detaching wires leaves the render unchanged, the plan has failed regardless of green gates.

---

## Block 2 — surface/field domain

Same spec channel as Block 1, and the same §0 rule: the render is downstream of the graph, each node downstream of its inlets — cut a wire and the field/contour/shell stops contributing. Sources: `../../.local/Zorin/MANIFEST.md`.

- Generalized decoupled field-source (its own frame/domain/orientation/sizing operator), dipole × orientation field, `jacobson` biharmonic + `grinspun` curvature + full `tpmsTsl.ts` Mikkelsen normal-relief contours, `peng` volumetric shells.

## Block 3 — projection

Same §0 rule.

- Continuous Euclid ↔ Poincaré disk ↔ ball as live shader sliders (projection math moved into the vertex shader so it modulates without a rebuild), closed-form conformal/holomorphic warps (not the solver-based papers), quasicrystal cut-and-project field, optional Hopf fibration / cone-foci. GIF/phase clock rides on this block's live clock as a real signal, not a decorative node.
