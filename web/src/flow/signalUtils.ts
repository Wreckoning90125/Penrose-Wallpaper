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
import { shapeClockWaveform } from './clockWaveform';
import { LIGHT_CHOREO_PHASE_INLET } from './controlSpecs';

export const AUDIO_FEATURE_HANDLES = new Set([
  'rms',
  'bass',
  'mid',
  'high',
  'spectralFlux',
  'onsetStrength',
  'cwtTransient',
  'crestFactor',
  'beat',
  'beatPhase',
  'pulseLfo',
  'pulseConfidence',
  'beatConfidence',
  'tempoConfidence',
  'beatStrength',
  'tempo',
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
    case 'beat': return features.beat;
    case 'beatPhase': return features.beatPhase;
    case 'pulseLfo': return features.pulseLfo;
    case 'pulseConfidence': return features.pulseConfidence;
    case 'beatConfidence': return features.beatConfidence;
    case 'tempoConfidence': return features.tempoConfidence;
    case 'beatStrength': return features.beatStrength;
    case 'tempo': return features.tempo;
    default: return null;
  }
}

// The clock's raw 0..1 sawtooth transport phase. Phase-transport consumers
// (field-source phase inlets) integrate per-tick progress from this and MUST
// receive the monotonic saw — a shaped waveform would break their unwrap.
export function clockTransportPhase(node: Node, nowMs = performance.now(), epochMs = 0): number {
  const settings = dataObject(node.data, 'settings');
  const enabled = settings ? Object.getOwnPropertyDescriptor(settings, 'clock_enabled')?.value : undefined;
  if (String(enabled ?? '1') === '0') return 0;
  const rateValue = settings ? Object.getOwnPropertyDescriptor(settings, 'clock_rate')?.value : undefined;
  const parsedRate = Number.parseInt(String(rateValue ?? '100'), 10);
  const rate = clampNumber(Number.isFinite(parsedRate) ? parsedRate : 100, 0, 240) / 100;
  if (rate <= 0) return 0;
  const phase = (Math.max(0, nowMs - epochMs) * 0.001 * rate) % 1;
  return phase < 0 ? phase + 1 : phase;
}

// The clock's output signal as seen by the graph (operators, modulation
// targets, the lighting phase inlet): the transport phase shaped by the
// node's waveform setting. Saw (default) is the identity.
export function clockSignalValue(node: Node, nowMs = performance.now(), epochMs = 0): number {
  const settings = dataObject(node.data, 'settings');
  const waveformValue = settings ? Object.getOwnPropertyDescriptor(settings, 'clock_waveform')?.value : undefined;
  const parsedWaveform = Number.parseInt(String(waveformValue ?? '0'), 10);
  return shapeClockWaveform(
    clockTransportPhase(node, nowMs, epochMs),
    Number.isFinite(parsedWaveform) ? clampNumber(parsedWaveform, 0, 3) : 0,
  );
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
  // The lighting choreography phase is a plain signal inlet: any signal source
  // (clock, audio feature, operator blend) may drive it. The wire is the only
  // way to choose the choreography source — there is no dropdown bypass.
  // Other lighting handles stay modulation targets via the audioTargetRange
  // fall-through below.
  if (node.id === 'lighting' && handle === LIGHT_CHOREO_PHASE_INLET.id) return true;
  if (node.type === 'operator') return operatorInputHandles(node).includes(handle);
  if (node.type === 'fx') {
    const descriptor = fxDescriptor(dataString(node.data, 'kind'));
    return descriptor ? descriptor.params.some(p => p.key === handle) : false;
  }
  if (node.type === 'fieldSource') return FIELD_SOURCE_PARAMS.some(([key]) => key === handle);
  return audioTargetRange(handle) !== null;
}
