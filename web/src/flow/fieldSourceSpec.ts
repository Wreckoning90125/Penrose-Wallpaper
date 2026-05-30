// Addable field-source nodes: per-node wave parameters (NOT global settings) and
// the pure derivation from graph topology to the renderer's extra wave slots.
// Each field source emits relief/undulate/colour waves with its own freq + speed;
// the default singleton field source ("postfx") stays on slot 0, and up to
// FIELD_SLOT_LIMIT of these addable sources fill the extra slots. A source only
// contributes a field whose outlet is actually wired to the renderer (§0).
import type { Edge, Node } from '@xyflow/react';
import type { FieldSlot } from '../types';

// [key, label, min, max, step, default]
export type FieldParamSpec = readonly [string, string, number, number, number, number];

// Amplitude param ids are amp_*-prefixed so they never collide with the field
// OUTLET ids (relief/undulate/color) on the same node.
export const FIELD_SOURCE_PARAMS: readonly FieldParamSpec[] = [
  ['amp_relief', 'Relief', 0, 100, 1, 24],
  ['amp_undulate', 'Undulate', 0, 100, 1, 24],
  ['amp_color', 'Color', 0, 100, 1, 24],
  ['freq', 'Freq', 0, 100, 1, 65],
  ['speed', 'Speed', 0, 200, 1, 40],
];

export const FIELD_SOURCE_OUTLETS = [
  { id: 'relief', label: 'Relief' },
  { id: 'undulate', label: 'Undulate' },
  { id: 'color', label: 'Color' },
];

export const FIELD_SLOT_LIMIT = 3;

export function fieldParamDefaults(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, , , , , value] of FIELD_SOURCE_PARAMS) out[key] = value;
  return out;
}

function paramValue(values: Record<string, number>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// The same amplitude scaling the default field source uses (renderer applySettings):
// relief/undulate map 0..100 -> 0..0.075, colour 0..100 -> 0..0.22, freq /10, speed /50.
// `valuesFor` returns each node's params after audio modulation, so wired params
// (relief/undulate/color/freq/speed) are driven by operators just like the default.
export function deriveFieldSlots(
  nodes: readonly Node[],
  edges: readonly Edge[],
  valuesFor: (node: Node) => Record<string, number>,
): FieldSlot[] {
  const wiredToRenderer = (id: string, handle: string): boolean =>
    edges.some(edge => edge.source === id && edge.sourceHandle === handle
      && edge.target === 'renderer' && edge.targetHandle === handle);
  const slots: FieldSlot[] = [];
  for (const node of nodes) {
    if (node.type !== 'fieldSource') continue;
    if (slots.length >= FIELD_SLOT_LIMIT) break;
    const reliefWired = wiredToRenderer(node.id, 'relief');
    const undulateWired = wiredToRenderer(node.id, 'undulate');
    const colorWired = wiredToRenderer(node.id, 'color');
    if (!reliefWired && !undulateWired && !colorWired) continue;
    const values = valuesFor(node);
    slots.push({
      freq: paramValue(values, 'freq', 65) / 10,
      speed: paramValue(values, 'speed', 40) / 50,
      relief: reliefWired ? paramValue(values, 'amp_relief', 0) / 100 * 0.075 : 0,
      undulate: undulateWired ? paramValue(values, 'amp_undulate', 0) / 100 * 0.075 : 0,
      color: colorWired ? paramValue(values, 'amp_color', 0) / 100 * 0.22 : 0,
    });
  }
  return slots;
}
