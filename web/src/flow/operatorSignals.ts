import type { Node } from '@xyflow/react';
import { operatorKindFromData, operatorSpec } from './operatorSpecs';
import { signalKey } from './signalUtils';

export type OperatorSignalValues = Readonly<Record<string, number>>;
export type OperatorSignalSnapshot = Readonly<Record<string, OperatorSignalValues | undefined>>;

export type OperatorSignalStore = {
  getSnapshot: () => OperatorSignalSnapshot;
  set: (snapshot: OperatorSignalSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
};

const EMPTY_OPERATOR_SIGNALS: OperatorSignalSnapshot = {};

function signalValuesEqual(a: OperatorSignalValues | undefined, b: OperatorSignalValues | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function signalSnapshotEqual(a: OperatorSignalSnapshot, b: OperatorSignalSnapshot): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!signalValuesEqual(a[key], b[key])) return false;
  }
  return true;
}

export function createOperatorSignalStore(): OperatorSignalStore {
  let snapshot = EMPTY_OPERATOR_SIGNALS;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    set: next => {
      if (signalSnapshotEqual(snapshot, next)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function operatorSignalSnapshot(nodes: readonly Node[], signals: ReadonlyMap<string, number>): OperatorSignalSnapshot {
  const snapshot: Record<string, OperatorSignalValues> = {};
  for (const node of nodes) {
    if (node.type !== 'operator') continue;
    const kind = operatorKindFromData(node.data);
    if (!kind) continue;
    const values: Record<string, number> = {};
    for (const output of operatorSpec(kind).outputs) {
      const value = signals.get(signalKey(node.id, output));
      values[output] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    snapshot[node.id] = values;
  }
  return snapshot;
}
