// Pure accessors for reading typed values out of an xyflow node's loosely-typed
// `data` record. No React/three — used across the control graph and reusable by
// the graph-eval engine and the future contract check.

export function dataString(value: object, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const candidate = descriptor?.value;
  return typeof candidate === 'string' ? candidate : '';
}

export function dataBoolean(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.value === true;
}

export function dataObject(value: object, key: string): object | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const candidate = descriptor?.value;
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null;
}

export function numberRecordFromObject(value: object | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value) return out;
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) out[key] = candidate;
  }
  return out;
}

export function stringRecordFromObject(value: object | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string') out[key] = candidate;
  }
  return out;
}
