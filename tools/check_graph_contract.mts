// Graph contract check (standalone). Asserts the STABLE data invariants of the
// extracted pure schema modules — "a control was added without its setting key /
// preset key", the 8-vertex-buffer attribute cap, FX-catalog completeness — plus
// the §0 wire contract (the render is a function of graph topology). Interactive
// graph behavior stays in the ReactFlow runtime; this script checks stable schema
// and wire invariants. Run:
// npm run graph:contract
import { readFileSync } from 'node:fs';
import type { Edge, Node } from '@xyflow/react';
import { EFFECT_CATALOG } from '../web/src/render/postFxCatalog.ts';
import { renderInputsFromEdges } from '../web/src/flow/renderInputs.ts';
import { spliceMaterialFieldBypasses } from '../web/src/flow/materialLanes.ts';
import {
  CLOCK_CONTROLS,
  BORDER_CONTROLS,
  LIGHT_CONTROLS,
  MATERIAL_CONTROLS,
  PROJECTION_CONTROLS,
  RIPPLE_TARGET_CONTROLS,
  type ControlSpec,
} from '../web/src/flow/controlSpecs.ts';
import {
  CLOCK_SETTING_KEYS,
  BORDER_SETTING_KEYS,
  GRAPH_PRESET_SETTING_KEYS,
  LIGHT_SETTING_KEYS,
  MATERIAL_SETTING_KEYS,
  PROJECTION_SETTING_KEYS,
  RIPPLE_TARGET_SETTING_KEYS,
} from '../web/src/flow/settingKeys.ts';

type NodeSchema = { name: string; controls: ControlSpec[]; keys: readonly string[] };

const NODES: NodeSchema[] = [
  { name: 'material', controls: MATERIAL_CONTROLS, keys: MATERIAL_SETTING_KEYS },
  { name: 'lighting', controls: LIGHT_CONTROLS, keys: LIGHT_SETTING_KEYS },
  { name: 'projection', controls: PROJECTION_CONTROLS, keys: PROJECTION_SETTING_KEYS },
  { name: 'clock', controls: CLOCK_CONTROLS, keys: CLOCK_SETTING_KEYS },
  { name: 'ripple', controls: RIPPLE_TARGET_CONTROLS, keys: RIPPLE_TARGET_SETTING_KEYS },
  { name: 'border', controls: BORDER_CONTROLS, keys: BORDER_SETTING_KEYS },
];

const preset = new Set<string>(GRAPH_PRESET_SETTING_KEYS);
const violations: string[] = [];

for (const node of NODES) {
  const keys = new Set<string>(node.keys);
  for (const [controlKey] of node.controls) {
    if (!keys.has(controlKey)) {
      violations.push(`${node.name}: control '${controlKey}' is missing from its setting-key group (won't edit-gate correctly)`);
    }
  }
  for (const key of node.keys) {
    if (!preset.has(key)) {
      violations.push(`${node.name}: setting '${key}' is missing from GRAPH_PRESET_SETTING_KEYS (won't round-trip in saved graphs)`);
    }
  }
}

// Render contract: the fill and edge meshes intentionally have different vertex
// interfaces. Track the TSL attribute names directly so a renderer edit cannot
// silently add a ninth WebGPU vertex buffer again. Three/TSL calls often use
// attribute<'float'>('name', 'float'), so this regex must accept the generic
// form as well as bare attribute('name') calls.
const FILL_CUSTOM_ATTRS = new Set<string>(['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief']);
const EDGE_CUSTOM_ATTRS = new Set<string>(['tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'edgeSide', 'edgeSlope']);
const ALLOWED_CUSTOM_ATTRS = new Set<string>([...FILL_CUSTOM_ATTRS, ...EDGE_CUSTOM_ATTRS]);
const renderer = readFileSync('web/src/render/webgpuRenderer.ts', 'utf8');
const geometrySrc = readFileSync('web/src/tiling/geometry.ts', 'utf8');
for (const match of renderer.matchAll(/attribute(?:<[^>]+>)?\(\s*['"](\w+)['"]/g)) {
  const name = match[1];
  if (name && !ALLOWED_CUSTOM_ATTRS.has(name)) {
    violations.push(`renderer: material references vertex attribute '${name}' beyond the allowed fill/edge interface {${[...ALLOWED_CUSTOM_ATTRS].join(', ')}} — risks exceeding the WebGPU vertex-buffer limit (black tiles). Add it deliberately to the interface or pack it into an existing attribute.`);
  }
}

if (!geometrySrc.includes('function setFillCustomAttributes') || !geometrySrc.includes('function setEdgeCustomAttributes')) {
  violations.push('renderer: custom fill/edge attributes must be packed through setFillCustomAttributes/setEdgeCustomAttributes so attribute count does not become vertex-buffer count');
}
const fillVertexBuffers = 4; // position + color + paletteSlot + interleaved custom lanes
const edgeVertexBuffers = 2; // position + interleaved custom lanes
if (fillVertexBuffers > 8) {
  violations.push(`renderer: fill mesh uses ${fillVertexBuffers} vertex buffers; WebGPU limit is 8`);
}
if (edgeVertexBuffers > 8) {
  violations.push(`renderer: edge mesh uses ${edgeVertexBuffers} vertex buffers; WebGPU limit is 8`);
}

// FX catalog completeness: every FxKind must have an EFFECT_CATALOG entry, so no
// effect exists that users cannot add (builders are already exhaustive via the
// Record<FxKind> type). Parse the FxKind union from source and compare.
const catalogSrc = readFileSync('web/src/render/postFxCatalog.ts', 'utf8');
const unionMatch = catalogSrc.match(/export type FxKind =([\s\S]*?);/);
const catalogKinds = new Set<string>(EFFECT_CATALOG.map(descriptor => descriptor.kind));
if (unionMatch && unionMatch[1]) {
  for (const match of unionMatch[1].matchAll(/'(\w+)'/g)) {
    const kind = match[1];
    if (kind && !catalogKinds.has(kind)) {
      violations.push(`postFxCatalog: FxKind '${kind}' has no EFFECT_CATALOG entry (the effect exists but is missing from the Add menu)`);
    }
  }
}

// §0 wire contract — the render is a function of graph topology, asserted directly
// against renderInputsFromEdges: a fully-wired canonical graph connects every
// render input, a wireless one connects none, and cutting a wire drops exactly its
// own input ("cut a wire and the thing it represents stops"). Locked in per the
// "make that contractual in the harshest possible way" directive now that §0 is
// settled; if the canonical topology is still in flux, update these wires with it.
const wireNode = (id: string, type: string): Node => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const wire = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge =>
  ({ id, source, sourceHandle, target, targetHandle });
const contractNodes: Node[] = [
  wireNode('atlas', 'atlas'),
  wireNode('tiling', 'tiling'),
  wireNode('projection', 'projection'),
  wireNode('palette', 'palette'),
  wireNode('material', 'material'),
  wireNode('lighting', 'lighting'),
  wireNode('renderer', 'renderer'),
  wireNode('tonemap', 'fx'),
  wireNode('display', 'display'),
  wireNode('postfx', 'postfx'),
  wireNode('edgeProfile', 'edgeProfile'),
  wireNode('clock', 'clock'),
];
const canonicalWires = {
  atlasTiling: wire('w1', 'atlas', 'out', 'tiling', 'in'),
  tilingProjection: wire('w2', 'tiling', 'out', 'projection', 'in'),
  projectionPalette: wire('w3', 'projection', 'out', 'palette', 'in'),
  paletteMaterial: wire('w4', 'palette', 'color', 'material', 'color'),
  materialRenderer: wire('w5', 'material', 'surface', 'renderer', 'surface'),
  materialPostfxRelief: wire('w5r', 'material', 'relief', 'postfx', 'relief'),
  materialPostfxColor: wire('w5c', 'material', 'color', 'postfx', 'color'),
  clockPostfxPhase: wire('w5p', 'clock', 'out', 'postfx', 'phase'),
  lightingRenderer: wire('w6', 'lighting', 'out', 'renderer', 'lighting'),
  rendererTonemap: wire('w7a', 'renderer', 'frame', 'tonemap', 'frame'),
  tonemapDisplay: wire('w7b', 'tonemap', 'frame', 'display', 'frame'),
  displaceRenderer: wire('w8', 'postfx', 'displace', 'renderer', 'displace'),
  reliefRenderer: wire('w9', 'postfx', 'relief', 'renderer', 'relief'),
  colorFieldRenderer: wire('w10', 'postfx', 'color', 'renderer', 'color'),
  undulateRenderer: wire('w11', 'postfx', 'undulate', 'renderer', 'undulate'),
  borderRenderer: wire('w12', 'edgeProfile', 'border', 'renderer', 'border'),
};
const allWires: Edge[] = Object.values(canonicalWires);
type RenderInput = 'geometry' | 'lighting' | 'color' | 'material' | 'materialColor' | 'materialRelief' | 'projection' | 'fieldDisplace' | 'fieldRelief' | 'fieldColor' | 'fieldUndulate' | 'fieldPhase' | 'border';
const RENDER_INPUTS: readonly RenderInput[] = ['geometry', 'lighting', 'color', 'material', 'materialColor', 'materialRelief', 'projection', 'fieldDisplace', 'fieldRelief', 'fieldColor', 'fieldUndulate', 'fieldPhase', 'border'];

const fullyWired = renderInputsFromEdges(contractNodes, allWires);
for (const key of RENDER_INPUTS) {
  if (!fullyWired[key]) violations.push(`wire-contract: the fully-wired canonical graph should connect '${key}', but renderInputsFromEdges reports it disconnected`);
}
const wireless = renderInputsFromEdges(contractNodes, []);
for (const key of RENDER_INPUTS) {
  if (wireless[key]) violations.push(`wire-contract: a wireless graph must render nothing, but '${key}' reports connected`);
}
const cutDrops: { wire: keyof typeof canonicalWires; input: RenderInput }[] = [
  { wire: 'displaceRenderer', input: 'fieldDisplace' },
  { wire: 'reliefRenderer', input: 'fieldRelief' },
  { wire: 'reliefRenderer', input: 'materialRelief' },
  { wire: 'colorFieldRenderer', input: 'fieldColor' },
  { wire: 'colorFieldRenderer', input: 'materialColor' },
  { wire: 'undulateRenderer', input: 'fieldUndulate' },
  { wire: 'clockPostfxPhase', input: 'fieldPhase' },
  { wire: 'borderRenderer', input: 'border' },
  { wire: 'materialPostfxRelief', input: 'materialRelief' },
  { wire: 'materialPostfxRelief', input: 'fieldRelief' },
  { wire: 'materialPostfxColor', input: 'materialColor' },
  { wire: 'materialPostfxColor', input: 'fieldColor' },
  { wire: 'atlasTiling', input: 'geometry' },
  { wire: 'tilingProjection', input: 'geometry' },
  { wire: 'rendererTonemap', input: 'geometry' },
  { wire: 'tonemapDisplay', input: 'geometry' },
  { wire: 'projectionPalette', input: 'projection' },
  { wire: 'paletteMaterial', input: 'color' },
  { wire: 'materialRenderer', input: 'material' },
  { wire: 'lightingRenderer', input: 'lighting' },
];
for (const { wire: cutId, input } of cutDrops) {
  const remaining = allWires.filter(edge => edge.id !== canonicalWires[cutId].id);
  if (renderInputsFromEdges(contractNodes, remaining)[input]) {
    violations.push(`wire-contract: cutting ${cutId} must drop '${input}', but renderInputsFromEdges still reports it connected`);
  }
}

const bypassWires: Edge[] = [
  canonicalWires.atlasTiling,
  canonicalWires.tilingProjection,
  canonicalWires.projectionPalette,
  canonicalWires.paletteMaterial,
  canonicalWires.materialRenderer,
  wire('b1', 'material', 'relief', 'renderer', 'relief'),
  wire('b2', 'material', 'color', 'renderer', 'color'),
  canonicalWires.lightingRenderer,
  canonicalWires.rendererTonemap,
  canonicalWires.tonemapDisplay,
  canonicalWires.borderRenderer,
];
const bypassInputs = renderInputsFromEdges(contractNodes, bypassWires);
if (!bypassInputs.materialRelief || !bypassInputs.materialColor) {
  violations.push('wire-contract: material relief/color must be routable directly to the Scene Pass when Field Source is removed');
}
if (bypassInputs.fieldRelief || bypassInputs.fieldColor || bypassInputs.fieldDisplace || bypassInputs.fieldUndulate) {
  violations.push('wire-contract: material->renderer bypass must not imply Field Source procedural outputs');
}
const splicedWires = spliceMaterialFieldBypasses(allWires, 'postfx');
const splicedInputs = renderInputsFromEdges(contractNodes, splicedWires);
if (!splicedInputs.materialRelief || !splicedInputs.materialColor) {
  violations.push('wire-contract: deleting Field Source must preserve material relief/color via direct Scene Pass bypass wires');
}
if (splicedInputs.fieldRelief || splicedInputs.fieldColor) {
  violations.push('wire-contract: deleting Field Source must remove procedural relief/color while preserving material lanes');
}
if (splicedInputs.fieldPhase) {
  violations.push('wire-contract: deleting Field Source must also remove the clock phase input');
}

const graphPresetSrc = readFileSync('web/src/flow/graphPreset.ts', 'utf8');
const controlGraphSrc = readFileSync('web/src/flow/ControlGraph.tsx', 'utf8');
const graphTopologySrc = readFileSync('web/src/flow/graphTopology.ts', 'utf8');
for (const token of ['isObsoletePipelineEdge', 'isCurrentDefaultFieldEdge', 'isCurrentClockPhaseEdge']) {
  if (graphPresetSrc.includes(token) || controlGraphSrc.includes(token) || graphTopologySrc.includes(token)) {
    violations.push(`wire-contract: runtime graph code must validate current edges instead of carrying ${token}`);
  }
}
for (const token of ["next.source === 'tiling'", "next.source === 'projection'", "next.source === 'palette' &&", "next.source === 'postprocess'"]) {
  if (controlGraphSrc.includes(token) || graphTopologySrc.includes(token)) {
    violations.push(`wire-contract: preset load must not repair stale pipeline topology through '${token}' branches`);
  }
}

if (violations.length > 0) {
  for (const v of violations) process.stderr.write(`[graph-contract] ${v}\n`);
  process.stderr.write(`[graph-contract] ${violations.length} violation(s)\n`);
  process.exit(1);
}
process.stdout.write('[graph-contract] OK: controls map to setting keys + round-trip, and the §0 wire contract holds\n');
