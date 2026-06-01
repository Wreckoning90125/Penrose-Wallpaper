# `web/src/flow` — the control graph

The control graph is the source of truth the renderer is built from: what renders
is derived from the graph's edges every change (see `docs/render/` and
`renderInputs.ts`). `ControlGraph.tsx` is still the large orchestrator, but the
schema, node chrome, layout, preset, and signal pieces live in focused modules so
the graph contract can be reviewed without spelunking through React UI code.

## Dependency direction

Leaf data/utility modules at the top; each layer may import from the ones above
it, never below. `ControlGraph.tsx` sits at the bottom and imports from all of
them — nothing imports from `ControlGraph.tsx`, so there are no cycles.

```
jsonUtil ─ flowLayout ─ nodeData ─ controlSpecs ─ settingKeys ─ audioTargets
        │                                                          │
        ├─ operatorSpecs ─ signalUtils ─ signalEval                │
        ├─ fieldSourceSpec ─ materialLanes ─ renderInputs          │
        ├─ graphPreset ── (jsonUtil, flowLayout, nodeData, operatorSpecs, settingKeys)
        ├─ graphNodeData ─ (graphPreset, operatorSpecs)
        ├─ nodeFrame ─ RangeControl ─ MultiSwitch
        ├─ nodeHelpers ─ (graphNodeData, settingKeys)
        ├─ graphLayout
        ├─ graphEdges ─ fxIcons
        └─ graphNodes ─ (nodeFrame, RangeControl, nodeHelpers, graphNodeData, …)
                                   │
                            ControlGraph.tsx  (orchestrator)
```

## Naming

- PascalCase `.tsx` files are reusable React components (`ControlGraph`,
  `RangeControl`, `MultiSwitch`).
- camelCase `.ts/.tsx` files are schema, helpers, layout, or node collections
  (`graphNodes`, `nodeFrame`, `materialLanes`, `renderInputs`).
- `ControlGraph.tsx` and `graphNodes.tsx` are intentionally named for their
  exported public surface. If they grow further, split by responsibility, not by
  casing churn.

## Modules

| Module | Role |
|---|---|
| `ControlGraph.tsx` | Orchestrator: state/refs, effects, connection validation, auto-layout driving, save/load wiring, and the `ReactFlow` render with its `nodeTypes`/`edgeTypes`. |
| `graphNodes.tsx` | One memo'd presentational component per node kind (`AtlasNode` … `DisplayNode`), each rendering a `NodeFrame` with its controls. |
| `graphEdges.tsx` | Per-node-kind colours, the gradient bezier edge component, and `edgeTypes`. |
| `graphLayout.ts` | Default graph column packing, measured layout, and fit-to-view math. |
| `nodeFrame.tsx` | The framed node card + IO port rails/handles + the row-measurement hook that lines handles up with their labels. Owns `PortSpec` and the renderer/display inlet specs. |
| `RangeControl.tsx` | The shared slider + number-field control. |
| `MultiSwitch.tsx` | The segmented multi-option toggle control. |
| `fxIcons.tsx` | Icon lookup for post-FX kinds. |
| `nodeHelpers.tsx` | Small shared node-UI helpers: meter outlet, time formatter, slider-handler factory, live-boost merge, colour-wheel drawing. |
| `graphNodeData.ts` | The per-node data shapes (`*NodeData`, `NodeComponentProps`, `EditCallbacks`) shared by the orchestrator (builds them) and the components (consume them). |
| `graphPreset.ts` | Pure save/load serialization between live nodes/edges + app state and the JSON preset format. |
| `controlSpecs.ts` | The control definitions (key/label/range) per node group. |
| `settingKeys.ts` | The setting-key groups + the preset round-trip key set. |
| `fieldSourceSpec.ts` | Field Source parameter/outlet definitions and edge-derived field slot derivation. |
| `materialLanes.ts` | Material color/relief lane helpers, including Field Source deletion bypass splicing. |
| `renderInputs.ts` | Derives the per-input render connectivity from the edges. |
| `signalEval.ts` | The modulation engine: analysis → operators → targets, per frame. |
| `signalUtils.ts` | Signal handle/feature helpers shared by the eval engine. |
| `operatorSpecs.ts` | The modulation-operator library + lookups. |
| `audioTargets.ts` | Audio-modulation target ranges. |
| `nodeData.ts` | Loosely-typed node-data accessors (`dataObject`/`dataString`/…). |
| `flowLayout.ts` | Generic flow viewport types + grid-snap / zoom-clamp primitives. |
| `jsonUtil.ts` | Typed JSON model + safe accessors for preset parsing. |

## Invariants worth keeping

- **Render is downstream of the graph.** Don't reintroduce props-only render
  inputs; gate each render input on its edge (`renderInputs.ts`).
- **Faithful extraction.** The modules above were moved verbatim out of
  `ControlGraph.tsx` — behaviour is identical. Keep components free of any closure
  over the orchestrator so they stay independently testable and movable.
- **No type casts or `any` / `unknown` type keywords** anywhere (AST-enforced by
  `npm run ts:policy`; comments and prose are not scanned).
- See `docs/render/webgpu-constraints.md` for the renderer-side rules (8-vertex
  -buffer limit, post-pipeline RT disposal, etc.).
