// Graph contract check (standalone). Asserts the STABLE data invariants of the
// extracted pure schema modules — "a control was added without its setting key /
// preset key", the 8-vertex-buffer attribute cap, FX-catalog completeness — plus
// the §0 wire contract (the render is a function of graph topology). Interactive
// graph behavior stays in the ReactFlow runtime; this script checks stable schema
// and wire invariants. Run:
// npm run graph:contract
import { readFileSync } from 'node:fs';
import type { Edge, Node } from '@xyflow/react';
import { InterleavedBufferAttribute, type BufferGeometry } from 'three/webgpu';
import { EFFECT_CATALOG } from '../web/src/render/postFxCatalog.ts';
import { fxBuilder } from '../web/src/render/postFxRegistry.ts';
import { AUDIO_TARGET_RANGES, audioTargetRange } from '../web/src/flow/audioTargets.ts';
import { renderInputsFromEdges } from '../web/src/flow/renderInputs.ts';
import { spliceMaterialFieldBypasses } from '../web/src/flow/materialLanes.ts';
import { evaluateSignals, type AudioOperatorRuntimeState } from '../web/src/flow/signalEval.ts';
import { AUDIO_FEATURE_HANDLES } from '../web/src/flow/signalUtils.ts';
import { buildEdgeGeometryForPatch, buildMeshGeometry } from '../web/src/tiling/geometry.ts';
import { normalizeSettings } from '../web/src/settings/androidSettings.ts';
import type { Patch, Point } from '../web/src/types.ts';
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
const FILL_CUSTOM_ATTRS = new Set<string>(['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'tileShape', 'tileScale', 'tileReliefSlope', 'tileLocal', 'uv', 'tileEdgeBary', 'tileEdgeDistance', 'tileTopology', 'topologyPaletteColor']);
const EDGE_CUSTOM_ATTRS = new Set<string>(['tileType', 'tileRing', 'tileOrient', 'tileCenter', 'tileRelief', 'tileShape', 'tileScale', 'tileLocal', 'tileTopology', 'edgeSide', 'edgeSlope']);
const ALLOWED_CUSTOM_ATTRS = new Set<string>([...FILL_CUSTOM_ATTRS, ...EDGE_CUSTOM_ATTRS]);
const renderer = readFileSync('web/src/render/webgpuRenderer.ts', 'utf8');
const geometrySrc = readFileSync('web/src/tiling/geometry.ts', 'utf8');
const nativeGraphSrc = readFileSync('android/app/src/main/cpp/graph/graph.cpp', 'utf8');
const fxIconSrc = readFileSync('web/src/flow/fxIcons.tsx', 'utf8');
const materialControlKeys = new Set<string>(MATERIAL_CONTROLS.map(([key]) => key));
const borderControlKeys = new Set<string>(BORDER_CONTROLS.map(([key]) => key));
const rippleControlKeys = new Set<string>(RIPPLE_TARGET_CONTROLS.map(([key]) => key));
// Anchor regexes must fail LOUDLY: if a refactor moves the anchored code, a
// silent no-match would turn every downstream assertion vacuous and the gate
// would pass without checking anything.
function requiredAnchor(source: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`[graph-contract] anchor '${label}' no longer matches its source — update the anchor, do not let the checks go vacuous`);
  }
  return match;
}
const rendererAudioKeysMatch = requiredAnchor(renderer, /const RENDERER_AUDIO_SETTING_KEYS:[\s\S]*?=\s*\[(?<body>[\s\S]*?)\];/, 'RENDERER_AUDIO_SETTING_KEYS');
const rendererAudioKeys = new Set<string>();
const rendererAudioKeyBody = rendererAudioKeysMatch.groups?.['body'] ?? '';
for (const match of rendererAudioKeyBody.matchAll(/'([^']+)'/g)) {
  rendererAudioKeys.add(match[1] ?? '');
}
// The renderer consumes modulation through ONE path: setAudioDrive builds a
// per-key overlay over RENDERER_AUDIO_SETTING_KEYS using audioTargetRange,
// and applyDynamicState() writes every dynamic value from the resolved
// effective settings. Anchor both so a refactor cannot silently fork them.
const setAudioDriveBody = requiredAnchor(renderer, /  setAudioDrive\([\s\S]*?\n  \}\n/, 'setAudioDrive')[0];
requiredAnchor(renderer, /private applyDynamicState\(\): void \{/, 'applyDynamicState');
if (!setAudioDriveBody.includes('audioTargetRange(')) {
  violations.push('renderer-contract: setAudioDrive must derive every modulation range from audioTargetRange (AUDIO_TARGET_RANGES is the only range schema)');
}
if (!setAudioDriveBody.includes('this.applyDynamicState()')) {
  violations.push('renderer-contract: setAudioDrive must apply through applyDynamicState() — a separate uniform-write path reintroduces the settings/modulation clobber');
}
// Every renderer-side overlay key needs a range entry (the overlay builder
// throws at runtime otherwise), and every modulation target that is not a
// known App-side key must be consumed by the renderer overlay — a target
// missing from RENDERER_AUDIO_SETTING_KEYS is wireable in the UI but dead.
// Parsed from App.tsx so the allowlist cannot drift from the code that
// actually implements the App-side modulation path.
const appSrc = readFileSync('web/src/App.tsx', 'utf8');
const liveModulatedMatch = requiredAnchor(appSrc, /const LIVE_MODULATED_SETTING_KEYS[\s\S]*?=\s*\[(?<body>[\s\S]*?)\];/, 'LIVE_MODULATED_SETTING_KEYS');
const APP_SIDE_TARGETS = new Set(['luminance']);
for (const match of (liveModulatedMatch.groups?.['body'] ?? '').matchAll(/'([^']+)'/g)) {
  APP_SIDE_TARGETS.add(match[1] ?? '');
}
for (const setting of rendererAudioKeys) {
  if (!audioTargetRange(setting)) {
    violations.push(`renderer-contract: '${setting}' is in RENDERER_AUDIO_SETTING_KEYS but has no AUDIO_TARGET_RANGES entry (setAudioDrive throws on the first tick)`);
  }
}
for (const setting of Object.keys(AUDIO_TARGET_RANGES)) {
  if (!APP_SIDE_TARGETS.has(setting) && !rendererAudioKeys.has(setting)) {
    violations.push(`renderer-contract: modulation target '${setting}' is wireable but absent from RENDERER_AUDIO_SETTING_KEYS — it would be silently dead in the renderer`);
  }
}
// Wherever a setting is both a node control and a modulation target, the two
// schemas must agree on its range.
const controlListsForRangeCheck: readonly (readonly [string, readonly ControlSpec[]])[] = [
  ['CLOCK_CONTROLS', CLOCK_CONTROLS],
  ['BORDER_CONTROLS', BORDER_CONTROLS],
  ['LIGHT_CONTROLS', LIGHT_CONTROLS],
  ['MATERIAL_CONTROLS', MATERIAL_CONTROLS],
  ['PROJECTION_CONTROLS', PROJECTION_CONTROLS],
  ['RIPPLE_TARGET_CONTROLS', RIPPLE_TARGET_CONTROLS],
];
for (const [listName, list] of controlListsForRangeCheck) {
  for (const [key, , min, max] of list) {
    const range = audioTargetRange(key);
    if (range && (range[0] !== min || range[1] !== max)) {
      violations.push(`range-contract: '${key}' is [${min}, ${max}] in ${listName} but [${range[0]}, ${range[1]}] in AUDIO_TARGET_RANGES — one schema must own the range`);
    }
  }
}
for (const match of renderer.matchAll(/attribute(?:<[^>]+>)?\(\s*['"](\w+)['"]/g)) {
  const name = match[1];
  if (name && !ALLOWED_CUSTOM_ATTRS.has(name)) {
    violations.push(`renderer: material references vertex attribute '${name}' beyond the allowed fill/edge interface {${[...ALLOWED_CUSTOM_ATTRS].join(', ')}} — risks exceeding the WebGPU vertex-buffer limit (black tiles). Add it deliberately to the interface or pack it into an existing attribute.`);
  }
}

for (const descriptor of EFFECT_CATALOG) {
  if (!fxBuilder(descriptor.kind)) {
    violations.push(`fx-contract: '${descriptor.kind}' is listed in EFFECT_CATALOG but has no renderer builder`);
  }
  const iconMapped = fxIconSrc.includes(`${descriptor.icon},`) || fxIconSrc.includes(`${descriptor.icon}:`);
  if (!iconMapped) {
    violations.push(`fx-contract: '${descriptor.kind}' uses unmapped FX icon '${descriptor.icon}'`);
  }
}

const rendererUniformContracts: {
  setting: string;
  uniform: string;
  controls: Set<string>;
  audioTarget: boolean;
  modulated: boolean;
}[] = [
  { setting: 'field_pattern', uniform: 'fieldPattern', controls: rippleControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_style', uniform: 'ornamentStyle', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_amount', uniform: 'ornamentAmount', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_width', uniform: 'ornamentWidth', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_density', uniform: 'ornamentDensity', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_phase', uniform: 'ornamentPhase', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'ornament_twist', uniform: 'ornamentTwist', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'surface_contour_amount', uniform: 'surfaceContourAmount', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'surface_contour_source', uniform: 'surfaceContourSource', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'surface_contour_spacing', uniform: 'surfaceContourSpacing', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'surface_contour_width', uniform: 'surfaceContourWidth', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'surface_contour_phase', uniform: 'surfaceContourPhase', controls: materialControlKeys, audioTarget: true, modulated: true },
  { setting: 'edge_profile_width', uniform: 'edgeProfileWidth', controls: borderControlKeys, audioTarget: true, modulated: true },
  { setting: 'edge_profile_glow', uniform: 'edgeProfileGlow', controls: borderControlKeys, audioTarget: true, modulated: true },
];

for (const contract of rendererUniformContracts) {
  if (!contract.controls.has(contract.setting)) {
    violations.push(`renderer-contract: '${contract.setting}' is not exposed by its owning control node`);
  }
  if (!preset.has(contract.setting)) {
    violations.push(`renderer-contract: '${contract.setting}' is missing from graph preset keys`);
  }
  const audioRange = Object.getOwnPropertyDescriptor(AUDIO_TARGET_RANGES, contract.setting)?.value;
  if (contract.audioTarget && !Array.isArray(audioRange)) {
    violations.push(`renderer-contract: '${contract.setting}' should be audio-modulatable but has no AUDIO_TARGET_RANGES entry`);
  }
  if (!contract.audioTarget && Array.isArray(audioRange)) {
    violations.push(`renderer-contract: '${contract.setting}' should remain static but is listed as an audio target`);
  }
  if (!renderer.includes(`${contract.uniform}: uniform(`)) {
    violations.push(`renderer-contract: '${contract.setting}' has no '${contract.uniform}' uniform allocation`);
  }
  if (!renderer.includes(`this.uniforms.${contract.uniform}.value = intSetting(settings, '${contract.setting}'`)) {
    violations.push(`renderer-contract: '${contract.setting}' is not loaded from settings into '${contract.uniform}'`);
  }
  if (contract.modulated && !rendererAudioKeys.has(contract.setting)) {
    violations.push(`renderer-contract: '${contract.setting}' is not in RENDERER_AUDIO_SETTING_KEYS, so the modulation overlay never carries it`);
  }
}
if (!renderer.includes('ornamentMaskNode(')) {
  violations.push('renderer-contract: ornament controls exist but the renderer has no ornamentMaskNode implementation');
}
if (!renderer.includes('fieldPatternNode(')) {
  violations.push('renderer-contract: field_pattern exists but the renderer has no fieldPatternNode implementation');
}
if (!renderer.includes("attribute<'vec3'>('tileEdgeDistance', 'vec3')")) {
  violations.push('renderer-contract: tileEdgeDistance is emitted by fill geometry but not consumed by the surface material');
}
if (!renderer.includes("attribute<'vec4'>('tileTopology', 'vec4')")) {
  violations.push('renderer-contract: tileTopology is emitted by fill geometry but not consumed by the surface material');
}
if (!renderer.includes("attribute<'vec3'>('topologyPaletteColor', 'vec3')")) {
  violations.push('renderer-contract: topologyPaletteColor is emitted by fill geometry but not consumed by the surface material');
}
for (const setting of ['surface_contour_l', 'surface_contour_c', 'surface_contour_h']) {
  if (!materialControlKeys.has(setting)) {
    violations.push(`renderer-contract: '${setting}' is not exposed by the material control node`);
  }
  if (!preset.has(setting)) {
    violations.push(`renderer-contract: '${setting}' is missing from graph preset keys`);
  }
  if (!renderer.includes(`intSetting(settings, '${setting}'`)) {
    violations.push(`renderer-contract: '${setting}' is not loaded from settings into the surface contour colour`);
  }
}
for (const setting of ['edge_profile_l', 'edge_profile_c', 'edge_profile_h']) {
  if (!borderControlKeys.has(setting)) {
    violations.push(`renderer-contract: '${setting}' is not exposed by the border control node`);
  }
  if (!preset.has(setting)) {
    violations.push(`renderer-contract: '${setting}' is missing from graph preset keys`);
  }
  const audioRange = Object.getOwnPropertyDescriptor(AUDIO_TARGET_RANGES, setting)?.value;
  if (!Array.isArray(audioRange)) {
    violations.push(`renderer-contract: '${setting}' should be audio-modulatable but has no AUDIO_TARGET_RANGES entry`);
  }
  if (!renderer.includes(`intSetting(settings, '${setting}'`)) {
    violations.push(`renderer-contract: '${setting}' is not loaded from settings into the edge profile colour`);
  }
  if (!rendererAudioKeys.has(setting)) {
    violations.push(`renderer-contract: '${setting}' is not in RENDERER_AUDIO_SETTING_KEYS, so the modulation overlay never carries it`);
  }
}
if (
  !renderer.includes('surfaceContourR: uniform(')
  || !renderer.includes('surfaceContourG: uniform(')
  || !renderer.includes('surfaceContourB: uniform(')
  || !renderer.includes('this.uniforms.surfaceContourR.value = contourColor[0]')
  || !renderer.includes('this.uniforms.surfaceContourG.value = contourColor[1]')
  || !renderer.includes('this.uniforms.surfaceContourB.value = contourColor[2]')
) {
  violations.push('renderer-contract: surface contour colour settings do not drive renderer colour uniforms');
}
if (
  !renderer.includes('borderMix: uniform(')
  || !renderer.includes('this.uniforms.borderMix.value = borderMix')
  || !renderer.includes('.mul(this.uniforms.borderMix)')
) {
  violations.push('renderer-contract: edge profile fill shading must be gated by the Border -> Scene Pass wire, not only the border mesh visibility');
}
if (/\bfwidth\b/.test(renderer)) {
  violations.push('renderer-contract: webgpuRenderer.ts must not use fwidth in shared material nodes; ornament/field nodes feed vertex-stage displacement where derivatives are invalid');
}
const postSignatureMatch = requiredAnchor(renderer, /postChainSignatureOf\(spec: PostChainSpec\): string \{[\s\S]*?\n  \}/, 'postChainSignatureOf');
const postSignatureBody = postSignatureMatch[0];
if (postSignatureBody.includes('postNodeIsNoop')) {
  violations.push('post-fx-contract: live numeric FX params must not be part of postChainSignatureOf; audio modulation must update uniforms without rebuilding the post pipeline');
}
if (!renderer.includes("node.kind === 'aa' && this.postNodeIsNoop(node)")) {
  violations.push('post-fx-contract: only structural AA-off selection should skip a no-op post node during pipeline rebuild');
}

if (!geometrySrc.includes('function setFillCustomAttributes') || !geometrySrc.includes('function setEdgeCustomAttributes')) {
  violations.push('renderer: custom fill/edge attributes must be packed through setFillCustomAttributes/setEdgeCustomAttributes so attribute count does not become vertex-buffer count');
}
function backingBufferCount(geometry: BufferGeometry): number {
  const backings = new Set<object>();
  for (const attr of Object.values(geometry.attributes)) {
    backings.add(attr instanceof InterleavedBufferAttribute ? attr.data : attr);
  }
  return backings.size;
}

function sharedPackedCustomBuffer(geometry: BufferGeometry, names: readonly string[], context: string): void {
  let backing: object | null = null;
  for (const name of names) {
    if (!geometry.hasAttribute(name)) {
      violations.push(`renderer: ${context} geometry is missing custom attribute '${name}'`);
      continue;
    }
    const attr = geometry.getAttribute(name);
    if (!(attr instanceof InterleavedBufferAttribute)) {
      violations.push(`renderer: ${context} custom attribute '${name}' is not interleaved; this risks an extra WebGPU vertex-buffer slot`);
      continue;
    }
    if (!backing) {
      backing = attr.data;
    } else if (backing !== attr.data) {
      violations.push(`renderer: ${context} custom attribute '${name}' uses a separate interleaved backing buffer`);
    }
  }
}

const spectreVerts: Point[] = Array.from({ length: 14 }, (_, i) => {
  const theta = Math.PI * 2 * i / 14;
  return [Math.cos(theta), Math.sin(theta)];
});
const contractPatch: Patch = {
  family: 12,
  seed: 0,
  generation: 0,
  tiles: [{ type: 0, verts: spectreVerts }],
};
const contractSettings = normalizeSettings({
  family: '12',
  seed: '0',
  generation: 0,
  border_on: true,
  border_width: 80,
  hyp_fill_subdiv: 1,
  hyp_border_subdiv: 12,
});
const contractFill = buildMeshGeometry(contractPatch, contractSettings).geometry;
const contractEdge = buildEdgeGeometryForPatch(contractPatch, contractSettings);
const fillVertexBuffers = backingBufferCount(contractFill);
const edgeVertexBuffers = contractEdge ? backingBufferCount(contractEdge) : 0;
if (fillVertexBuffers > 8) {
  violations.push(`renderer: fill mesh uses ${fillVertexBuffers} vertex buffers; WebGPU limit is 8`);
}
if (edgeVertexBuffers > 8) {
  violations.push(`renderer: edge mesh uses ${edgeVertexBuffers} vertex buffers; WebGPU limit is 8`);
}
if (contractFill.hasAttribute('normal')) {
  violations.push('renderer: fill geometry must not emit a normal attribute; normalNode owns surface normals');
}
if (contractEdge?.hasAttribute('normal')) {
  violations.push('renderer: edge geometry must not emit a normal attribute; edge normals are material-side');
}
sharedPackedCustomBuffer(contractFill, [...FILL_CUSTOM_ATTRS], 'fill');
if (contractEdge) sharedPackedCustomBuffer(contractEdge, [...EDGE_CUSTOM_ATTRS], 'edge');

// FX catalog completeness: every FxKind must have an EFFECT_CATALOG entry, so no
// effect exists that users cannot add (builders are already exhaustive via the
// Record<FxKind> type). Parse the FxKind union from source and compare.
const catalogSrc = readFileSync('web/src/render/postFxCatalog.ts', 'utf8');
const unionMatch = requiredAnchor(catalogSrc, /export type FxKind =([\s\S]*?);/, 'FxKind union');
const catalogKinds = new Set<string>(EFFECT_CATALOG.map(descriptor => descriptor.kind));
if (unionMatch[1]) {
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
const operatorNode = (id: string, kind: string, values: Record<string, number>): Node => ({
  id,
  type: 'operator',
  position: { x: 0, y: 0 },
  data: { spec: { kind }, values },
});
const emptyOperatorState = (): AudioOperatorRuntimeState => ({
  gateChangedAt: {},
  gateOpen: {},
  held: {},
  previous: {},
  triggerHigh: {},
});
const contractNodes: Node[] = [
  wireNode('atlas', 'atlas'),
  wireNode('tiling', 'tiling'),
  wireNode('ifs', 'ifs'),
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
  ifsRenderer: wire('w5i', 'ifs', 'points', 'renderer', 'attractor'),
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
type RenderInput = 'geometry' | 'attractor' | 'lighting' | 'color' | 'material' | 'materialColor' | 'materialRelief' | 'projection' | 'fieldDisplace' | 'fieldRelief' | 'fieldColor' | 'fieldUndulate' | 'fieldPhase' | 'border';
const RENDER_INPUTS: readonly RenderInput[] = ['geometry', 'attractor', 'lighting', 'color', 'material', 'materialColor', 'materialRelief', 'projection', 'fieldDisplace', 'fieldRelief', 'fieldColor', 'fieldUndulate', 'fieldPhase', 'border'];

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
  { wire: 'ifsRenderer', input: 'attractor' },
  { wire: 'materialPostfxRelief', input: 'materialRelief' },
  { wire: 'materialPostfxRelief', input: 'fieldRelief' },
  { wire: 'materialPostfxColor', input: 'materialColor' },
  { wire: 'materialPostfxColor', input: 'fieldColor' },
  { wire: 'atlasTiling', input: 'geometry' },
  { wire: 'tilingProjection', input: 'geometry' },
  { wire: 'rendererTonemap', input: 'geometry' },
  { wire: 'rendererTonemap', input: 'attractor' },
  { wire: 'tonemapDisplay', input: 'geometry' },
  { wire: 'tonemapDisplay', input: 'attractor' },
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

const amNode = operatorNode('operator-am-contract', 'am', { depth: 2, bias: 0.5 });
const amFeatures = {
  bass: 0.5,
  mid: 0.75,
  high: 0,
  rms: 0,
  spectralFlux: 0,
  onsetStrength: 0,
  cwtTransient: 0,
  crestFactor: 0,
  beat: 0,
  beatPhase: 0,
  pulseLfo: 0,
  pulseConfidence: 0,
  beatConfidence: 0,
  tempoConfidence: 0,
  beatStrength: 0,
  tempo: 0,
  bpm: 120,
};
if (!AUDIO_FEATURE_HANDLES.has('beat') || !AUDIO_FEATURE_HANDLES.has('beatConfidence') || !AUDIO_FEATURE_HANDLES.has('tempo')) {
  violations.push('analysis-contract: beat, beatConfidence and tempo must be wireable audio features');
}
const amSignals = evaluateSignals(
  amFeatures,
  [amNode],
  [
    wire('audio-live', 'transport', 'out', 'analysis', 'in'),
    wire('am-carrier', 'analysis', 'bass', amNode.id, 'carrier'),
    wire('am-modulator', 'analysis', 'mid', amNode.id, 'modulator'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const amValue = amSignals.get(`${amNode.id}:signal`) ?? 0;
if (Math.abs(amValue - 0.75) > 1e-6) {
  violations.push(`operator-contract: AM expected 0.75 from carrier=0.5, modulator=0.75, depth=2, bias=0.5; got ${amValue}`);
}
const amCarrierOnlySignals = evaluateSignals(
  amFeatures,
  [amNode],
  [
    wire('audio-live-carrier', 'transport', 'out', 'analysis', 'in'),
    wire('am-carrier-only', 'analysis', 'bass', amNode.id, 'carrier'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const amCarrierOnlyValue = amCarrierOnlySignals.get(`${amNode.id}:signal`) ?? 0;
if (Math.abs(amCarrierOnlyValue - 0.5) > 1e-6) {
  violations.push(`operator-contract: AM without a modulator should preserve the carrier baseline; got ${amCarrierOnlyValue}`);
}
const pmNode = operatorNode('operator-pm-contract', 'pm', { depth: 0, cycles: 1, offset: 0 });
const pmFeatures = {
  bass: 0.25,
  mid: 0,
  high: 0,
  rms: 0,
  spectralFlux: 0,
  onsetStrength: 0,
  cwtTransient: 0,
  crestFactor: 0,
  beat: 0,
  beatPhase: 0,
  pulseLfo: 0,
  pulseConfidence: 0,
  beatConfidence: 0,
  tempoConfidence: 0,
  beatStrength: 0,
  tempo: 0,
  bpm: 120,
};
const pmSignals = evaluateSignals(
  pmFeatures,
  [pmNode],
  [
    wire('audio-live-pm', 'transport', 'out', 'analysis', 'in'),
    wire('pm-phase', 'analysis', 'bass', pmNode.id, 'phase'),
    wire('pm-modulator', 'analysis', 'mid', pmNode.id, 'modulator'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const pmValue = pmSignals.get(`${pmNode.id}:signal`) ?? 0;
if (Math.abs(pmValue - 1) > 1e-6) {
  violations.push(`operator-contract: PM expected 1 from phase=0.25, cycles=1, depth=0, offset=0; got ${pmValue}`);
}
const beatNode = operatorNode('operator-beat-contract', 'beat', { cyclesA: 4, cyclesB: 5, offset: 0 });
const beatSignals = evaluateSignals(
  pmFeatures,
  [beatNode],
  [
    wire('audio-live-beat', 'transport', 'out', 'analysis', 'in'),
    wire('beat-phase', 'analysis', 'bass', beatNode.id, 'phase'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const beatValue = beatSignals.get(`${beatNode.id}:signal`) ?? 0;
const beatEnvelope = beatSignals.get(`${beatNode.id}:envelope`) ?? 0;
if (Math.abs(beatValue - 0.75) > 1e-6) {
  violations.push(`operator-contract: Beat Osc expected signal 0.75 from phase=0.25, cyclesA=4, cyclesB=5; got ${beatValue}`);
}
if (Math.abs(beatEnvelope - Math.SQRT1_2) > 1e-6) {
  violations.push(`operator-contract: Beat Osc expected envelope sqrt(1/2) from phase=0.25, delta=-1; got ${beatEnvelope}`);
}
const tempoNode = operatorNode('operator-tempo-contract', 'gain', { gain: 2 });
const tempoSignals = evaluateSignals(
  {
    ...amFeatures,
    beatConfidence: 0.8,
    tempo: 0.25,
    bpm: 95,
  },
  [tempoNode],
  [
    wire('audio-live-tempo', 'transport', 'out', 'analysis', 'in'),
    wire('tempo-source', 'analysis', 'tempo', tempoNode.id, 'signal'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const tempoValue = tempoSignals.get(`${tempoNode.id}:signal`) ?? 0;
if (Math.abs(tempoValue - 0.5) > 1e-6) {
  violations.push(`operator-contract: tempo source expected gain-scaled 0.5 from tempo=0.25, gain=2; got ${tempoValue}`);
}
const confidenceNode = operatorNode('operator-confidence-contract', 'gain', { gain: 1 });
const confidenceSignals = evaluateSignals(
  {
    ...pmFeatures,
    beatConfidence: 0.8,
    tempo: 0.25,
    bpm: 95,
  },
  [confidenceNode],
  [
    wire('audio-live-confidence', 'transport', 'out', 'analysis', 'in'),
    wire('confidence-source', 'analysis', 'beatConfidence', confidenceNode.id, 'signal'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const confidenceValue = confidenceSignals.get(`${confidenceNode.id}:signal`) ?? 0;
if (Math.abs(confidenceValue - 0.8) > 1e-6) {
  violations.push(`operator-contract: beatConfidence source expected direct pass-through 0.8; got ${confidenceValue}`);
}
const beatEnvelopeNode = operatorNode('operator-beat-envelope-contract', 'gain', { gain: 1 });
const beatEnvelopeSignals = evaluateSignals(
  {
    ...amFeatures,
    beat: 0.65,
  },
  [beatEnvelopeNode],
  [
    wire('audio-live-beat-envelope', 'transport', 'out', 'analysis', 'in'),
    wire('beat-envelope-source', 'analysis', 'beat', beatEnvelopeNode.id, 'signal'),
  ],
  emptyOperatorState(),
  {},
  1000,
  0,
);
const beatEnvelopeSourceValue = beatEnvelopeSignals.get(`${beatEnvelopeNode.id}:signal`) ?? 0;
if (Math.abs(beatEnvelopeSourceValue - 0.65) > 1e-6) {
  violations.push(`operator-contract: beat source expected direct pass-through 0.65; got ${beatEnvelopeSourceValue}`);
}

if (!/case NodeKind::OpLag:\s*p0 = 0\.0f;/.test(nativeGraphSrc)) {
  violations.push('operator-contract: native Lag default must initialize p0 to 0.0f to match web');
}

const graphPresetSrc = readFileSync('web/src/flow/graphPreset.ts', 'utf8');
const controlGraphSrc = readFileSync('web/src/flow/ControlGraph.tsx', 'utf8');
const graphTopologySrc = readFileSync('web/src/flow/graphTopology.ts', 'utf8');
if (
  !controlGraphSrc.includes('postChainRuntimeSignature(chain)')
  || !controlGraphSrc.includes('postChainSignatureRef.current !== postChainSignature')
) {
  violations.push('post-fx-contract: ControlGraph must emit resolved post chains only when the runtime signature changes, so audio frames do not re-enter setPostChain unnecessarily');
}
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
