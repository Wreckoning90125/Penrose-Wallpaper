// Graph-preset (de)serialization: pure transforms between the live xyflow
// nodes/edges + app state and the saved JSON preset shape, and back. No React or
// component state — the ControlGraph component calls these to save/load presets.
// Extracted from ControlGraph so the save/load format lives in one place.
import type { Edge, Node } from '@xyflow/react';
import type { Oklch } from '../color/palette';
import { dataBoolean, dataObject, dataString, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { isOperatorKind, operatorKindFromData, type OperatorKind } from './operatorSpecs';
import { isJsonObject, jsonArray, jsonBoolean, jsonNumber, jsonString, type JsonArray, type JsonObject, type JsonValue } from './jsonUtil';
import { clampFlowZoom, snapValue, type FlowViewport } from './flowLayout';
import { GRAPH_PRESET_SETTING_KEYS } from './settingKeys';
import type { Gains, GraphPresetAppState } from '../types';
import type { Settings, SettingValue } from '../settings/androidSettings';

export type GainKey = keyof Gains;

const EMPTY_JSON_OBJECT: JsonObject = {};

export function isGainKey(value: string): value is GainKey {
  return value === 'relief' || value === 'emissive' || value === 'film' || value === 'metal';
}

export type GraphPresetNodeData = {
  deletableClock: boolean;
  fxBypass: boolean;
  fxKind: string | null;
  fxSelects: Record<string, string>;
  gainKey: GainKey | null;
  operatorKind: OperatorKind | null;
  selectValues: Record<string, string>;
  values: Record<string, number>;
};

export type GraphPresetNode = {
  data: GraphPresetNodeData;
  id: string;
  position: { x: number; y: number };
  type: string;
};

export type GraphPresetEdge = {
  animated: boolean;
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
};

export type GraphPreset = {
  appState: GraphPresetAppState | null;
  edges: GraphPresetEdge[];
  nodes: GraphPresetNode[];
  snapEnabled: boolean;
  version: 1;
  viewport: FlowViewport;
};

export function numberRecordFromJson(value: JsonValue | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isJsonObject(value)) return out;
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) out[key] = candidate;
  }
  return out;
}

export function stringRecordFromJson(value: JsonValue | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isJsonObject(value)) return out;
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string') out[key] = candidate;
  }
  return out;
}



export function graphPresetNodeFromNode(node: Node): GraphPresetNode {
  const data = node.data;
  const gainKey = dataString(data, 'gainKey');
  const fxKind = dataString(data, 'kind');
  return {
    data: {
      deletableClock: dataBoolean(data, 'deletable'),
      fxBypass: dataBoolean(data, 'bypass'),
      fxKind: node.type === 'fx' && fxKind ? fxKind : null,
      fxSelects: stringRecordFromObject(dataObject(data, 'selects')),
      gainKey: isGainKey(gainKey) ? gainKey : null,
      operatorKind: operatorKindFromData(data),
      selectValues: stringRecordFromObject(dataObject(data, 'selectValues')),
      values: numberRecordFromObject(dataObject(data, 'values')),
    },
    id: node.id,
    position: {
      x: node.position.x,
      y: node.position.y,
    },
    type: String(node.type ?? ''),
  };
}

export function graphPresetEdgeFromEdge(edge: Edge): GraphPresetEdge {
  return {
    animated: edge.animated === true,
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? null,
    target: edge.target,
    targetHandle: edge.targetHandle ?? null,
  };
}

export function settingValueFromJson(value: JsonValue | undefined): SettingValue | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

export function graphPresetSettingsFromJson(value: JsonValue | undefined): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!isJsonObject(value)) return out;
  for (const key of GRAPH_PRESET_SETTING_KEYS) {
    const next = settingValueFromJson(value[key]);
    if (next !== null) out[key] = next;
  }
  return out;
}

export function graphPresetSettingsFromSettings(settings: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const key of GRAPH_PRESET_SETTING_KEYS) out[key] = settings[key];
  return out;
}

export function graphPresetCustomColorsFromJson(value: JsonValue | undefined): Oklch[] | null {
  if (value === null) return null;
  const colors = jsonArray(value);
  if (colors.length === 0) return null;
  const out: Oklch[] = [];
  for (const item of colors) {
    const color = jsonArray(item);
    if (color.length < 3) continue;
    out.push([
      jsonNumber(color[0], 0),
      jsonNumber(color[1], 0),
      jsonNumber(color[2], 0),
    ]);
  }
  return out.length > 0 ? out : null;
}

export function graphPresetGainsFromJson(value: JsonValue | undefined): Partial<Gains> {
  const out: Partial<Gains> = {};
  if (!isJsonObject(value)) return out;
  for (const key of ['relief', 'emissive', 'film', 'metal']) {
    const gain = jsonNumber(value[key], Number.NaN);
    if (Number.isFinite(gain) && isGainKey(key)) out[key] = gain;
  }
  return out;
}

export function graphPresetAppStateFromJson(value: JsonValue | undefined): GraphPresetAppState | null {
  if (!isJsonObject(value)) return null;
  const dragModeValue = jsonString(value['dragMode']);
  return {
    categoryId: jsonString(value['categoryId']),
    customColors: graphPresetCustomColorsFromJson(value['customColors']),
    dragMode: dragModeValue === 'hold' ? 'hold' : 'ride',
    gains: graphPresetGainsFromJson(value['gains']),
    selectedColor: Math.max(0, Math.round(jsonNumber(value['selectedColor'], 0))),
    settings: graphPresetSettingsFromJson(value['settings']),
    targetId: jsonString(value['targetId']),
  };
}


export function graphPresetFromState(
  nodes: readonly Node[],
  edges: readonly Edge[],
  viewport: FlowViewport,
  snapEnabled: boolean,
  appState: GraphPresetAppState,
): GraphPreset {
  return {
    appState,
    edges: edges.map(graphPresetEdgeFromEdge),
    nodes: nodes.map(graphPresetNodeFromNode),
    snapEnabled,
    version: 1,
    viewport,
  };
}

export function graphPresetNodeFromJson(value: JsonValue): GraphPresetNode | null {
  if (!isJsonObject(value)) return null;
  const id = jsonString(value['id']);
  const type = jsonString(value['type']);
  const position = isJsonObject(value['position']) ? value['position'] : EMPTY_JSON_OBJECT;
  if (!id || !type) return null;
  const data = isJsonObject(value['data']) ? value['data'] : EMPTY_JSON_OBJECT;
  const gainKey = jsonString(data['gainKey']);
  const operatorKind = jsonString(data['operatorKind']);
  const fxKind = jsonString(data['fxKind']);
  return {
    data: {
      deletableClock: jsonBoolean(data['deletableClock'], false),
      fxBypass: jsonBoolean(data['fxBypass'], false),
      fxKind: fxKind ? fxKind : null,
      fxSelects: stringRecordFromJson(data['fxSelects']),
      gainKey: isGainKey(gainKey) ? gainKey : null,
      operatorKind: isOperatorKind(operatorKind) ? operatorKind : null,
      selectValues: stringRecordFromJson(data['selectValues']),
      values: numberRecordFromJson(data['values']),
    },
    id,
    position: {
      x: snapValue(jsonNumber(position['x'], 0)),
      y: snapValue(jsonNumber(position['y'], 0)),
    },
    type,
  };
}

export function graphPresetEdgeFromJson(value: JsonValue): GraphPresetEdge | null {
  if (!isJsonObject(value)) return null;
  const id = jsonString(value['id']);
  const source = jsonString(value['source']);
  const target = jsonString(value['target']);
  if (!id || !source || !target) return null;
  return {
    animated: jsonBoolean(value['animated'], false),
    id,
    source,
    sourceHandle: value['sourceHandle'] === null ? null : jsonString(value['sourceHandle']),
    target,
    targetHandle: value['targetHandle'] === null ? null : jsonString(value['targetHandle']),
  };
}

export function collectPresetNodes(values: JsonArray): GraphPresetNode[] {
  const nodes: GraphPresetNode[] = [];
  for (const value of values) {
    const node = graphPresetNodeFromJson(value);
    if (node) nodes.push(node);
  }
  return nodes;
}

export function collectPresetEdges(values: JsonArray): GraphPresetEdge[] {
  const edges: GraphPresetEdge[] = [];
  for (const value of values) {
    const edge = graphPresetEdgeFromJson(value);
    if (edge) edges.push(edge);
  }
  return edges;
}

export function graphPresetFromText(text: string): GraphPreset | null {
  const parsed: JsonValue = JSON.parse(text);
  if (!isJsonObject(parsed) || parsed['version'] !== 1) return null;
  const viewport = isJsonObject(parsed['viewport']) ? parsed['viewport'] : EMPTY_JSON_OBJECT;
  return {
    appState: graphPresetAppStateFromJson(parsed['appState']),
    edges: collectPresetEdges(jsonArray(parsed['edges'])),
    nodes: collectPresetNodes(jsonArray(parsed['nodes'])),
    snapEnabled: jsonBoolean(parsed['snapEnabled'], true),
    version: 1,
    viewport: {
      x: jsonNumber(viewport['x'], 0),
      y: jsonNumber(viewport['y'], 0),
      zoom: clampFlowZoom(jsonNumber(viewport['zoom'], 0.62)),
    },
  };
}

export function edgeFromPreset(edge: GraphPresetEdge): Edge {
  return {
    animated: edge.animated,
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  };
}

export function isObsoletePipelineEdge(edge: Edge): boolean {
  return (edge.source === 'tiling' && edge.target === 'palette')
    || (edge.source === 'projection' && edge.target === 'renderer')
    || (edge.source === 'palette' && edge.target === 'renderer')
    || (edge.source === 'postprocess' && edge.target === 'renderer')
    || (edge.source === 'postfx' && edge.target === 'renderer')
    || (edge.source === 'postfx' && edge.target === 'material')
    || (edge.source === 'clock' && edge.target === 'postfx');
}

export function nodeWithPresetData(node: Node, preset: GraphPresetNode): Node {
  const values = preset.data.values;
  const selectValues = preset.data.selectValues;
  // FX nodes (incl. the base tonemap) carry their kind/bypass/values/selects in
  // the preset; apply them so the chain round-trips. Operator nodes carry
  // values + selectValues. Structural nodes drive off settings, so untouched.
  if (node.type === 'fx') {
    return {
      ...node,
      data: {
        ...node.data,
        bypass: preset.data.fxBypass,
        values: { ...numberRecordFromObject(dataObject(node.data, 'values')), ...values },
        selects: { ...stringRecordFromObject(dataObject(node.data, 'selects')), ...preset.data.fxSelects },
      },
      position: preset.position,
      selected: false,
    };
  }
  const nextData = node.type === 'operator' && (Object.keys(values).length > 0 || Object.keys(selectValues).length > 0)
    ? { ...node.data, selectValues, values }
    : node.data;
  return {
    ...node,
    data: nextData,
    position: preset.position,
    selected: false,
  };
}

