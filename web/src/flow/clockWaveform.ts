// Clock waveform shaping shared by the signal graph (signalUtils) and the
// renderer's lighting choreography (webgpuRenderer). Deliberately dependency
// free: signalUtils pulls @xyflow/react, which must stay out of the renderer
// chunk.
//
// Shaping maps the clock's raw 0..1 sawtooth transport phase to the selected
// waveform, also normalized 0..1. It applies to the clock's *output signal*
// and to phases derived from the transport (choreography); phase *transport*
// consumers that integrate per-tick progress (field waves) must keep the raw
// sawtooth — unwrapping a shaped (non-monotonic) waveform would misread every
// descending sample as a wrap.
export const CLOCK_WAVEFORM_SAW = 0;
export const CLOCK_WAVEFORM_SINE = 1;
export const CLOCK_WAVEFORM_TRIANGLE = 2;
export const CLOCK_WAVEFORM_SQUARE = 3;

export function shapeClockWaveform(phase: number, waveform: number): number {
  const p = phase - Math.floor(phase);
  switch (waveform) {
    case CLOCK_WAVEFORM_SINE: return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    case CLOCK_WAVEFORM_TRIANGLE: return 1 - Math.abs(2 * p - 1);
    case CLOCK_WAVEFORM_SQUARE: return p < 0.5 ? 0 : 1;
    default: return p; // saw: identity, the pre-waveform behaviour
  }
}
