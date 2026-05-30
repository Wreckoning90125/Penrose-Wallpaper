// Pure leaf utilities for the signal/modulation graph: which audio features are
// wireable, the (nodeId,handle) signal key, the audio-feature lookup, and the
// clock node's live 0..1 phase. No React/three — used by the eval engine and the
// node components.
import type { Node } from '@xyflow/react';
import type { AudioFeatures } from '../types';
import { dataObject, dataString } from './nodeData';
import { clampNumber } from '../util/clamp';
import { operatorKindFromData, operatorSpec } from './operatorSpecs';
import { fxDescriptor } from '../render/postFxCatalog';
import { audioTargetRange } from './audioTargets';
import { FIELD_SOURCE_PARAMS } from './fieldSourceSpec';

export const AUDIO_FEATURE_HANDLES = new Set([
  'rms',
  'bass',
  'mid',
  'high',
  'spectralFlux',
  'onsetStrength',
  'cwtTransient',
  'crestFactor',
]);

export function clampSignal(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function audioFeatureValue(features: AudioFeatures, handle: string | null | undefined): number | null {
  switch (handle) {
    case 'rms': return features.rms;
    case 'bass': return features.bass;
    case 'mid': return features.mid;
    case 'high': return features.high;
    case 'spectralFlux': return features.spectralFlux;
    case 'onsetStrength': return features.onsetStrength;
    case 'cwtTransient': return features.cwtTransient;
    case 'crestFactor': return features.crestFactor;
    default: return null;
  }
}

export function clockSignalValue(node: Node): number {
  const settings = dataObject(node.data, 'settings');
  const enabled = settings ? Object.getOwnPropertyDescriptor(settings, 'clock_enabled')?.value : undefined;
  if (String(enabled ?? '1') === '0') return 0;
  const rateValue = settings ? Object.getOwnPropertyDescriptor(settings, 'clock_rate')?.value : undefined;
  const parsedRate = Number.parseInt(String(rateValue ?? '100'), 10);
  const rate = clampNumber(Number.isFinite(parsedRate) ? parsedRate : 100, 0, 240) / 100;
  if (rate <= 0) return 0;
  const phase = (performance.now() * 0.001 * rate) % 1;
  return phase < 0 ? phase + 1 : phase;
}

export function signalKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}:${handle ?? 'out'}`;
}

export function operatorInputHandles(node: Node): readonly string[] {
  const kind = operatorKindFromData(node.data);
  return kind ? operatorSpec(kind).inputs : [];
}

export function operatorOutputHandles(node: Node): readonly string[] {
  const kind = operatorKindFromData(node.data);
  return kind ? operatorSpec(kind).outputs : [];
}

export function isSignalSource(node: Node, handle: string | null | undefined): boolean {
  if (!handle) return false;
  if (node.id === 'analysis') return AUDIO_FEATURE_HANDLES.has(handle);
  if (node.type === 'operator') return operatorOutputHandles(node).includes(handle);
  return node.type === 'clock' && handle === 'out';
}

export function isSignalTarget(node: Node, handle: string | null | undefined): boolean {
  if (!handle) return false;
  if (node.type === 'operator') return operatorInputHandles(node).includes(handle);
  if (node.type === 'fx') {
    const descriptor = fxDescriptor(dataString(node.data, 'kind'));
    return descriptor ? descriptor.params.some(p => p.key === handle) : false;
  }
  if (node.type === 'fieldSource') return FIELD_SOURCE_PARAMS.some(([key]) => key === handle);
  return audioTargetRange(handle) !== null;
}
