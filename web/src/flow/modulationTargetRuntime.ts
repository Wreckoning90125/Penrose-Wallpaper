import type { DragMode } from '../types';

export type HeldParamMap = Record<string, boolean | undefined>;

export function finiteModulation(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function clampTargetValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function editHoldsParam(dragMode: DragMode, heldParams: HeldParamMap, key: string): boolean {
  return dragMode === 'hold' && heldParams[key] === true;
}

export function editHoldsAnyParam(dragMode: DragMode, heldParams: HeldParamMap, keys: readonly string[]): boolean {
  return dragMode === 'hold' && keys.some(key => heldParams[key] === true);
}

export function editRidesParam(dragMode: DragMode, heldParams: HeldParamMap, key: string): boolean {
  return dragMode === 'ride' && heldParams[key] === true;
}

export function editRidesAnyParam(dragMode: DragMode, heldParams: HeldParamMap, keys: readonly string[]): boolean {
  return dragMode === 'ride' && keys.some(key => heldParams[key] === true);
}

export function editHoldsActiveTarget(dragMode: DragMode, activeEditKey: string | null, targetKey: string): boolean {
  return dragMode === 'hold' && activeEditKey === targetKey;
}

// Canonical ride/hold target math, matching the TPMS visualizer:
// ride changes the baseline while the current graph delta stays applied;
// hold makes the edited target use the pointer-owned baseline until release.
export function applyModulationTargetRange(
  baseline: number,
  modulation: number | undefined,
  min: number,
  max: number,
): number {
  const signal = finiteModulation(modulation);
  return signal === null
    ? clampTargetValue(baseline, min, max)
    : clampTargetValue(baseline + signal * (max - min), min, max);
}

export function modulationTargetDelta(modulation: number | undefined, min: number, max: number): number | null {
  const signal = finiteModulation(modulation);
  return signal === null ? null : signal * (max - min);
}
