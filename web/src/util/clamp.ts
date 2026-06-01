// Shared numeric clamp. Non-finite input clamps to `min` so NaN never
// propagates into uniforms/settings. Previously duplicated in App, the control
// graph, and the renderer (which called it clampRange).
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
