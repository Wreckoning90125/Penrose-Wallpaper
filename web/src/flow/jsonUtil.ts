// Minimal typed JSON model + safe accessors used when parsing saved graph presets
// (the only loosely-typed input the control graph reads). Each accessor coerces a
// free-form JSON value to the expected primitive, falling back rather than
// throwing, so a malformed preset degrades gracefully instead of crashing.
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue | undefined };
export type JsonValue = null | boolean | number | string | JsonArray | JsonObject;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonArray(value: JsonValue | undefined): JsonArray {
  return Array.isArray(value) ? value : [];
}

export function jsonBoolean(value: JsonValue | undefined, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

export function jsonNumber(value: JsonValue | undefined, defaultValue: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}

export function jsonString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}
