// The signal-evaluation engine: turns the modulation graph (analysis -> operators
// -> targets, plus clock sources) into a per-handle signal map each frame, then
// the per-target modulation values. Pure (no React/three) — the renderer/App
// drive it with refs. This is the "wire is the data flow" core for modulation.
import type { Edge, Node } from '@xyflow/react';
import type { AudioFeatures, AudioModulationValues, DragMode } from '../types';
import { audioTargetRange } from './audioTargets';
import { dataObject, dataString, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { isMathOperator, operatorKindFromData, operatorSpec } from './operatorSpecs';
import { audioFeatureValue, clampSignal, clockSignalValue, signalKey } from './signalUtils';
import { fxDescriptor } from '../render/postFxCatalog';

export type AudioOperatorRuntimeState = {
  held: Record<string, number | undefined>;
  previous: Record<string, number | undefined>;
  triggerHigh: Record<string, boolean | undefined>;
};
export type LiveOperatorData = {
  selectValues: Record<string, string>;
  values: Record<string, number>;
};
export type LiveOperatorDataMap = Record<string, LiveOperatorData | undefined>;

function inputSignal(
  edges: readonly Edge[],
  signals: Map<string, number>,
  nodeId: string,
  handle: string,
  fallback = 0,
): number {
  let count = 0;
  let total = 0;
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== handle) continue;
    const value = signals.get(signalKey(edge.source, edge.sourceHandle));
    if (typeof value !== 'number') continue;
    total += value;
    count += 1;
  }
  return count > 0 ? total / count : fallback;
}

function operatorControl(values: Record<string, number>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' ? value : fallback;
}

function evaluateOperatorSignal(
  node: Node,
  edges: readonly Edge[],
  signals: Map<string, number>,
  state: AudioOperatorRuntimeState,
  liveOperators: LiveOperatorDataMap,
): void {
  const kind = operatorKindFromData(node.data);
  if (!kind) return;
  const spec = operatorSpec(kind);
  const live = liveOperators[node.id];
  const values = {
    ...numberRecordFromObject(dataObject(node.data, 'values')),
    ...(live?.values ?? {}),
  };
  const selects = {
    ...stringRecordFromObject(dataObject(node.data, 'selectValues')),
    ...(live?.selectValues ?? {}),
  };
  const input = (handle: string, fallback = 0): number => inputSignal(edges, signals, node.id, handle, fallback);
  const previousKey = `${node.id}:previous`;
  const previous = state.previous[previousKey] ?? 0;
  let output = 0;

  if (spec.kind === 'gain') output = input('signal') * operatorControl(values, 'gain', 1);
  if (spec.kind === 'bias') output = input('signal') + operatorControl(values, 'bias', 0);
  if (spec.kind === 'clamp') {
    const min = operatorControl(values, 'min', 0);
    const max = operatorControl(values, 'max', 1);
    output = Math.max(min, Math.min(max, input('signal')));
  }
  if (spec.kind === 'smooth') {
    const amount = clampSignal(operatorControl(values, 'amount', 0));
    const alpha = Math.max(0.04, 1 - amount * 0.96);
    output = previous + (input('signal') - previous) * alpha;
  }
  if (spec.kind === 'mix') {
    const amount = clampSignal(input('mix', operatorControl(values, 'blend', 0.5)));
    output = input('a') * (1 - amount) + input('b') * amount;
  }
  if (spec.kind === 'multiply') output = input('a') * input('b', 1) * operatorControl(values, 'scale', 1);
  if (spec.kind === 'add') output = input('a') + input('b') + operatorControl(values, 'offset', 0);
  if (spec.kind === 'map') {
    const inMin = operatorControl(values, 'inMin', 0);
    const inMax = operatorControl(values, 'inMax', 1);
    const outMin = operatorControl(values, 'outMin', 0);
    const outMax = operatorControl(values, 'outMax', 1);
    const t = Math.abs(inMax - inMin) < 1e-6 ? 0 : (input('signal') - inMin) / (inMax - inMin);
    output = outMin + clampSignal(t) * (outMax - outMin);
  }
  if (spec.kind === 'envelope') {
    const gate = input('gate') > 0.5 ? 1 : 0;
    const attack = operatorControl(values, 'attack', 0);
    const release = operatorControl(values, 'release', 0);
    const alpha = gate > previous
      ? Math.max(0.02, 1 / (1 + attack * 60))
      : Math.max(0.02, 1 / (1 + release * 60));
    output = previous + (gate - previous) * alpha;
  }
  if (spec.kind === 'lag') {
    const lag = operatorControl(values, 'time', 0);
    const alpha = Math.max(0.02, 1 / (1 + lag * 60));
    output = previous + (input('signal') - previous) * alpha;
  }
  if (spec.kind === 'threshold') output = input('signal') >= operatorControl(values, 'threshold', 0.5) ? 1 : 0;
  if (spec.kind === 'invert') output = operatorControl(values, 'pivot', 0.5) * 2 - input('signal');
  if (spec.kind === 'math') {
    const op = isMathOperator(selects['op'] ?? '') ? selects['op'] : 'multiply';
    const identity = op === 'add' ? 0 : op === 'subtract' ? 0 : 1;
    const a = input('a');
    const b = input('b', operatorControl(values, 'valB', identity));
    if (op === 'add') output = a + b;
    if (op === 'subtract') output = a - b;
    if (op === 'multiply') output = a * b;
    if (op === 'divide') output = Math.abs(b) < 1e-6 ? 0 : a / b;
  }
  if (spec.kind === 'sh') {
    const trigger = input('trigger') > 0.5;
    const triggerKey = `${node.id}:trigger`;
    const heldKey = `${node.id}:held`;
    if (trigger && !state.triggerHigh[triggerKey]) state.held[heldKey] = input('signal');
    state.triggerHigh[triggerKey] = trigger;
    output = state.held[heldKey] ?? input('signal');
  }

  state.previous[previousKey] = output;
  for (const handle of spec.outputs) signals.set(signalKey(node.id, handle), output);
}

export function fxModulatedParams(
  node: Node,
  edges: readonly Edge[],
  signals: Map<string, number>,
  activeEditKey: string | null,
  dragMode: DragMode,
): Record<string, number> {
  const descriptor = fxDescriptor(dataString(node.data, 'kind'));
  const base = numberRecordFromObject(dataObject(node.data, 'values'));
  if (!descriptor) return base;
  const out: Record<string, number> = { ...base };
  for (const param of descriptor.params) {
    const edge = edges.find(e => e.target === node.id && e.targetHandle === param.key);
    if (!edge) continue;
    const signal = signals.get(signalKey(edge.source, edge.sourceHandle));
    if (typeof signal !== 'number') continue;
    const editKey = `fx:${node.id}:${param.key}`;
    if (dragMode === 'hold' && activeEditKey === editKey) continue;
    const baseValue = base[param.key] ?? param.def;
    out[param.key] = Math.min(param.max, Math.max(param.min, baseValue + signal * (param.max - param.min)));
  }
  return out;
}

export function evaluateSignals(
  features: AudioFeatures,
  nodes: readonly Node[],
  edges: readonly Edge[],
  state: AudioOperatorRuntimeState,
  liveOperators: LiveOperatorDataMap,
): Map<string, number> {
  const signals = new Map<string, number>();
  const analysisLive = edges.some(edge => edge.source === 'transport' && edge.target === 'analysis');
  for (const edge of edges) {
    if (!analysisLive || edge.source !== 'analysis') continue;
    const value = audioFeatureValue(features, edge.sourceHandle);
    if (value !== null) signals.set(signalKey('analysis', edge.sourceHandle), value);
  }
  const nodeLookup = new Map(nodes.map(node => [node.id, node]));
  for (const edge of edges) {
    const source = nodeLookup.get(edge.source);
    if (source?.type === 'clock' && edge.sourceHandle === 'out') {
      signals.set(signalKey(source.id, 'out'), clockSignalValue(source));
    }
  }
  const operatorNodes = nodes.filter(node => node.type === 'operator');
  const operatorById = new Map(operatorNodes.map(node => [node.id, node]));
  const orderedOperators: Node[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: Node): void => {
    if (visited.has(node.id) || visiting.has(node.id)) return;
    visiting.add(node.id);
    for (const edge of edges) {
      if (edge.target !== node.id) continue;
      const sourceNode = operatorById.get(edge.source);
      if (sourceNode) visit(sourceNode);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    orderedOperators.push(node);
  };
  for (const node of operatorNodes) visit(node);
  for (const node of orderedOperators) {
    evaluateOperatorSignal(node, edges, signals, state, liveOperators);
  }

  // Drop runtime state for operators no longer in the graph, so deleted operators
  // don't leave stale held/previous/trigger entries that accumulate across
  // add/delete cycles. Active operators (still in operatorNodes) keep their state,
  // so their smoothing/envelope/sample-and-hold continuity is untouched.
  const activeOperatorIds = new Set(operatorNodes.map(node => node.id));
  pruneOperatorState(state.held, activeOperatorIds);
  pruneOperatorState(state.previous, activeOperatorIds);
  pruneOperatorState(state.triggerHigh, activeOperatorIds);

  return signals;
}

function pruneOperatorState<T>(record: Record<string, T>, activeIds: Set<string>): void {
  for (const key of Object.keys(record)) {
    const id = key.slice(0, key.lastIndexOf(':'));
    if (!activeIds.has(id)) delete record[key];
  }
}

export function modulationsFromSignals(signals: Map<string, number>, edges: readonly Edge[]): AudioModulationValues {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const range = audioTargetRange(edge.targetHandle);
    if (!range) continue;
    const value = signals.get(signalKey(edge.source, edge.sourceHandle));
    if (typeof value !== 'number') continue;
    const key = edge.targetHandle ?? '';
    sums.set(key, (sums.get(key) ?? 0) + value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out: AudioModulationValues = {};
  for (const [key, sum] of sums) {
    const count = counts.get(key) ?? 1;
    const value = sum / count;
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}
