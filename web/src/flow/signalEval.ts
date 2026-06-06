// The signal-evaluation engine: turns the modulation graph (analysis -> operators
// -> targets, plus clock sources) into a per-handle signal map each frame, then
// the per-target modulation values. Pure (no React/three) — the renderer/App
// drive it with refs. This is the "wire is the data flow" core for modulation.
import type { Edge, Node } from '@xyflow/react';
import type { AudioFeatures, AudioModulationValues, DragMode } from '../types';
import { audioTargetRange } from './audioTargets';
import { dataObject, dataString, numberRecordFromObject, stringRecordFromObject } from './nodeData';
import { isMathOperator, operatorKindFromData, operatorSpec, type OperatorSpec } from './operatorSpecs';
import { audioFeatureValue, clampSignal, clockSignalValue, signalKey } from './signalUtils';
import { fxDescriptor } from '../render/postFxCatalog';
import { FIELD_SOURCE_PARAMS } from './fieldSourceSpec';
import { applyModulationTargetRange, editHoldsActiveTarget, finiteModulation } from './modulationTargetRuntime';

export type AudioOperatorRuntimeState = {
  gateChangedAt: Record<string, number | undefined>;
  gateOpen: Record<string, boolean | undefined>;
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
  defaultValue = 0,
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
  return count > 0 ? total / count : defaultValue;
}

function operatorControl(values: Record<string, number>, key: string, defaultValue: number): number {
  const value = values[key];
  return typeof value === 'number' ? value : defaultValue;
}

function operatorDefault(spec: OperatorSpec, key: string, defaultValue: number): number {
  return spec.defaults?.[key] ?? defaultValue;
}

function smoothingAlpha(seconds: number, dtSeconds: number): number {
  if (seconds <= 0) return 1;
  if (dtSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - Math.exp(-dtSeconds / seconds)));
}

function evaluateOperatorSignal(
  node: Node,
  edges: readonly Edge[],
  signals: Map<string, number>,
  state: AudioOperatorRuntimeState,
  liveOperators: LiveOperatorDataMap,
  nowMs: number,
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
  const input = (handle: string, defaultValue = 0): number => inputSignal(edges, signals, node.id, handle, defaultValue);
  const previousKey = `${node.id}:previous`;
  const previous = state.previous[previousKey] ?? 0;
  const elapsedKey = `${node.id}:elapsed`;
  const previousNow = state.previous[elapsedKey];
  const dtSeconds = typeof previousNow === 'number'
    ? Math.max(0, Math.min(1, (nowMs - previousNow) * 0.001))
    : 1 / 60;
  state.previous[elapsedKey] = nowMs;
  let output = 0;
  let nextPrevious: number | null = null;
  let gateOutput: number | null = null;

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
    const threshold = operatorControl(values, 'threshold', operatorDefault(spec, 'threshold', 0.5));
    const gate = input('gate') >= threshold ? 1 : 0;
    const attack = operatorControl(values, 'attack', 0);
    const release = operatorControl(values, 'release', 0);
    const alpha = gate > previous
      ? smoothingAlpha(attack, dtSeconds)
      : smoothingAlpha(release, dtSeconds);
    output = previous + (gate - previous) * alpha;
  }
  if (spec.kind === 'lag') {
    const lag = operatorControl(values, 'time', 0);
    const alpha = smoothingAlpha(lag, dtSeconds);
    output = previous + (input('signal') - previous) * alpha;
  }
  if (spec.kind === 'threshold') output = input('signal') >= operatorControl(values, 'threshold', operatorDefault(spec, 'threshold', 0.5)) ? 1 : 0;
  if (spec.kind === 'gate') {
    const value = input('signal');
    const open = operatorControl(values, 'open', operatorDefault(spec, 'open', 0.55));
    const close = operatorControl(values, 'close', operatorDefault(spec, 'close', 0.45));
    const hold = Math.max(0, operatorControl(values, 'hold', operatorDefault(spec, 'hold', 0.08)));
    const attack = Math.max(0, operatorControl(values, 'attack', operatorDefault(spec, 'attack', 0.03)));
    const release = Math.max(0, operatorControl(values, 'release', operatorDefault(spec, 'release', 0.25)));
    const floor = clampSignal(operatorControl(values, 'floor', operatorDefault(spec, 'floor', 0)));
    const openKey = `${node.id}:gateOpen`;
    const changedKey = `${node.id}:gateChangedAt`;
    let isOpen = state.gateOpen[openKey] === true;
    if (!isOpen && value >= open) {
      isOpen = true;
      state.gateChangedAt[changedKey] = nowMs;
    }
    if (isOpen && value <= close) {
      const changedAt = state.gateChangedAt[changedKey] ?? nowMs;
      if ((nowMs - changedAt) * 0.001 >= hold) {
        isOpen = false;
        state.gateChangedAt[changedKey] = nowMs;
      }
    }
    if (isOpen && value > close) state.gateChangedAt[changedKey] = nowMs;
    state.gateOpen[openKey] = isOpen;
    const target = isOpen ? 1 : floor;
    const alpha = target > previous
      ? smoothingAlpha(attack, dtSeconds)
      : smoothingAlpha(release, dtSeconds);
    const gain = previous + (target - previous) * alpha;
    output = value * gain;
    nextPrevious = gain;
    gateOutput = isOpen ? 1 : 0;
  }
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
    const threshold = operatorControl(values, 'threshold', operatorDefault(spec, 'threshold', 0.5));
    const trigger = input('trigger') >= threshold;
    const triggerKey = `${node.id}:trigger`;
    const heldKey = `${node.id}:held`;
    if (trigger && !state.triggerHigh[triggerKey]) state.held[heldKey] = input('signal');
    state.triggerHigh[triggerKey] = trigger;
    output = state.held[heldKey] ?? input('signal');
  }

  state.previous[previousKey] = nextPrevious ?? output;
  for (const handle of spec.outputs) {
    signals.set(signalKey(node.id, handle), handle === 'gate' && gateOutput !== null ? gateOutput : output);
  }
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
    const editKey = `fx:${node.id}:${param.key}`;
    if (finiteModulation(signal) === null || editHoldsActiveTarget(dragMode, activeEditKey, editKey)) continue;
    const baseValue = base[param.key] ?? param.def;
    out[param.key] = applyModulationTargetRange(baseValue, signal, param.min, param.max);
  }
  return out;
}

// Audio modulation for an addable field-source node's per-node params, mirroring
// fxModulatedParams: a wired operator on a param inlet blends into that param.
export function fieldModulatedValues(
  node: Node,
  edges: readonly Edge[],
  signals: Map<string, number>,
  activeEditKey: string | null,
  dragMode: DragMode,
): Record<string, number> {
  const base = numberRecordFromObject(dataObject(node.data, 'values'));
  const out: Record<string, number> = { ...base };
  for (const [key, , min, max, , def] of FIELD_SOURCE_PARAMS) {
    const edge = edges.find(e => e.target === node.id && e.targetHandle === key);
    if (!edge) continue;
    const signal = signals.get(signalKey(edge.source, edge.sourceHandle));
    if (finiteModulation(signal) === null || editHoldsActiveTarget(dragMode, activeEditKey, `field:${node.id}:${key}`)) continue;
    const baseValue = base[key] ?? def;
    out[key] = applyModulationTargetRange(baseValue, signal, min, max);
  }
  return out;
}

export function evaluateSignals(
  features: AudioFeatures,
  nodes: readonly Node[],
  edges: readonly Edge[],
  state: AudioOperatorRuntimeState,
  liveOperators: LiveOperatorDataMap,
  nowMs = performance.now(),
  clockEpochMs = 0,
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
      signals.set(signalKey(source.id, 'out'), clockSignalValue(source, nowMs, clockEpochMs));
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
    evaluateOperatorSignal(node, edges, signals, state, liveOperators, nowMs);
  }

  // Drop runtime state for operators no longer in the graph, so deleted operators
  // don't leave stale held/previous/trigger entries that accumulate across
  // add/delete cycles. Active operators (still in operatorNodes) keep their state,
  // so their smoothing/envelope/sample-and-hold continuity is untouched.
  const activeOperatorIds = new Set(operatorNodes.map(node => node.id));
  pruneOperatorState(state.held, activeOperatorIds);
  pruneOperatorState(state.gateChangedAt, activeOperatorIds);
  pruneOperatorState(state.gateOpen, activeOperatorIds);
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
