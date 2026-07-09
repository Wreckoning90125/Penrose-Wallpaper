import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AudioFeatures, AudioSnapshot, AudioTransport, WebAudioGraph } from '../types';

const EMPTY_FEATURES: AudioFeatures = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  spectralFlux: 0,
  onsetStrength: 0,
  cwtTransient: 0,
  crestFactor: 0,
  beat: 0,
  beatPhase: 0,
  pulseLfo: 0,
  pulseConfidence: 0,
  beatConfidence: 0,
  tempoConfidence: 0,
  beatStrength: 0,
  tempo: 0,
  bpm: 120,
};

const DEFAULT_OUTPUT_VOLUME = 0.5;
const UI_NOTIFY_INTERVAL_MS = 33;
const FFT_SIZE = 2048;
const BEAT_BPM_MIN = 60;
const BEAT_BPM_MAX = 200;
const BEAT_ONSET_BUFFER_LEN = 256;
const BEAT_ACF_LEN = BEAT_ONSET_BUFFER_LEN / 2;
const BEAT_ACF_INTERVAL = 8;
const BEAT_PLL_GAIN = 0.05;
const BEAT_BPM_SMOOTH = 0.95;
const BEAT_ONSET_THRESHOLD = 0.5;
const BEAT_CONF_THRESHOLD = 0.2;
const BAND_EDGES_HZ = [30, 150, 1600, 16000] as const;
const CWT_TARGET_HZ = [2000, 5000, 10000] as const;
const CWT_OMEGA0 = 5;
const CWT_HALF_MIN = 32;
const CWT_HALF_MAX = 128;
const CWT_STRIDE = 4;

const EMPTY_TRANSPORT: AudioTransport = {
  duration: 0,
  currentTime: 0,
  playing: false,
  loop: true,
  sourceName: '',
  volume: DEFAULT_OUTPUT_VOLUME,
};

const EMPTY_SNAPSHOT: AudioSnapshot = {
  features: EMPTY_FEATURES,
  status: 'idle',
  transport: EMPTY_TRANSPORT,
};

type CwtKernel = {
  re: Float32Array;
  im: Float32Array;
};

type BeatPeak = {
  lag: number;
  peak: number;
  confidence: number;
};

function bandRmsHz(data: Uint8Array, sampleRate: number, fftSize: number, loHz: number, hiHz: number): number {
  const binHz = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(loHz / binHz));
  const end = Math.min(data.length, Math.max(start + 1, Math.ceil(hiHz / binHz)));
  if (start >= data.length || end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const value = (data[i] ?? 0) / 255;
    sum += value * value;
  }
  return Math.sqrt(sum / (end - start));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function updateZ(value: number, state: { avg: number; variance: number }): number {
  const delta = value - state.avg;
  const alpha = delta > 0 ? 0.2 : 0.01;
  state.avg += delta * alpha;
  const delta2 = value - state.avg;
  state.variance += (delta * delta2 - state.variance) * alpha;
  const std = Math.sqrt(Math.max(0, state.variance));
  if (std < 0.000001) return 0;
  return clamp01(Math.max(0, (value - state.avg) / std) * 0.5);
}

function rmsAndPeak(samples: Uint8Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const byte of samples) {
    const value = (byte - 128) / 128;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, samples.length)),
    peak,
  };
}

function buildCwtKernels(sampleRate: number): CwtKernel[] {
  return CWT_TARGET_HZ.map(targetHz => {
    const scale = CWT_OMEGA0 * sampleRate / (2 * Math.PI * targetHz);
    const half = Math.max(CWT_HALF_MIN, Math.min(CWT_HALF_MAX, Math.ceil(3 * scale)));
    const length = half * 2 + 1;
    const re = new Float32Array(length);
    const im = new Float32Array(length);
    const norm = Math.pow(Math.PI, -0.25) / Math.sqrt(scale);
    for (let i = 0; i < length; i++) {
      const t = (i - half) / scale;
      const envelope = Math.exp(-0.5 * t * t);
      const phase = CWT_OMEGA0 * t;
      re[i] = norm * envelope * Math.cos(phase);
      im[i] = norm * envelope * Math.sin(phase);
    }
    return { re, im };
  });
}

function waveletTransient(samples: Uint8Array, kernels: readonly CwtKernel[]): number {
  let peak = 0;
  for (const kernel of kernels) {
    const length = kernel.re.length;
    if (length <= 0 || samples.length < length) continue;
    for (let start = 0; start <= samples.length - length; start += CWT_STRIDE) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < length; i++) {
        const sample = ((samples[start + i] ?? 128) - 128) / 128;
        re += sample * kernel.re[i]!;
        im += sample * kernel.im[i]!;
      }
      peak = Math.max(peak, Math.hypot(re, im));
    }
  }
  return peak;
}

function peakLagParabolic(acf: Float32Array, lo: number, hi: number): BeatPeak {
  let bestLag = lo;
  let bestVal = -1;
  let secondVal = -1;
  for (let lag = lo; lag <= hi; lag += 1) {
    const value = acf[lag] ?? -1;
    if (value > bestVal) {
      secondVal = bestVal;
      bestVal = value;
      bestLag = lag;
    } else if (Math.abs(lag - bestLag) > 2 && value > secondVal) {
      secondVal = value;
    }
  }
  const peakHeight = clamp01(bestVal);
  const dominance = bestVal > 0 ? clamp01((bestVal - Math.max(0, secondVal)) / bestVal) : 0;
  const confidence = Math.sqrt(peakHeight * dominance);
  if (bestLag > lo && bestLag < hi) {
    const y0 = acf[bestLag - 1] ?? 0;
    const y1 = acf[bestLag] ?? 0;
    const y2 = acf[bestLag + 1] ?? 0;
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-12) {
      return {
        lag: bestLag + (y0 - y2) / denom,
        peak: bestVal,
        confidence,
      };
    }
  }
  return { lag: bestLag, peak: bestVal, confidence };
}

export function useWebAudioGraph(): WebAudioGraph {
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const transientAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const prevFreqRef = useRef<Uint8Array | null>(null);
  const cwtKernelsRef = useRef<{ sampleRate: number; kernels: CwtKernel[] } | null>(null);
  const onsetStatRef = useRef({ avg: 0, variance: 0 });
  const cwtStatRef = useRef({ avg: 0, variance: 0 });
  const beatOnsetBufferRef = useRef(new Float32Array(BEAT_ONSET_BUFFER_LEN));
  const beatOnsetIndexRef = useRef(0);
  const beatAcfRef = useRef(new Float32Array(BEAT_ACF_LEN));
  const beatLastTickMsRef = useRef(0);
  const beatFpsEmaRef = useRef(60);
  const beatRawBpmRef = useRef(120);
  const beatBpmRef = useRef(120);
  const beatConfidenceRef = useRef(0);
  const beatStrengthRef = useRef(0);
  const pulseConfidenceRef = useRef(0);
  const beatPhaseRef = useRef(0);
  const beatSmoothedRef = useRef(0);
  const snapshotRef = useRef<AudioSnapshot>(EMPTY_SNAPSHOT);
  const volumeRef = useRef(DEFAULT_OUTPUT_VOLUME);
  const listenersRef = useRef(new Set<() => void>());
  const uiListenersRef = useRef(new Set<() => void>());
  const lastUiNotifyRef = useRef(0);
  const uiNotifyTimerRef = useRef(0);

  const flushUiListeners = useCallback(() => {
    if (uiNotifyTimerRef.current) {
      window.clearTimeout(uiNotifyTimerRef.current);
      uiNotifyTimerRef.current = 0;
    }
    lastUiNotifyRef.current = performance.now();
    for (const listener of uiListenersRef.current) listener();
  }, []);

  const publish = useCallback((updater: (snapshot: AudioSnapshot) => AudioSnapshot) => {
    const previous = snapshotRef.current;
    const next = updater(previous);
    if (next === previous) return;
    snapshotRef.current = next;
    for (const listener of listenersRef.current) listener();
    const forceUi = next.status !== previous.status
      || next.transport.playing !== previous.transport.playing
      || next.transport.loop !== previous.transport.loop
      || next.transport.volume !== previous.transport.volume
      || next.transport.duration !== previous.transport.duration
      || next.transport.sourceName !== previous.transport.sourceName;
    if (forceUi) {
      flushUiListeners();
      return;
    }
    const now = performance.now();
    const elapsed = now - lastUiNotifyRef.current;
    if (elapsed >= UI_NOTIFY_INTERVAL_MS) {
      flushUiListeners();
    } else if (!uiNotifyTimerRef.current) {
      uiNotifyTimerRef.current = window.setTimeout(flushUiListeners, UI_NOTIFY_INTERVAL_MS - elapsed);
    }
  }, [flushUiListeners]);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const subscribeUi = useCallback((listener: () => void) => {
    uiListenersRef.current.add(listener);
    return () => {
      uiListenersRef.current.delete(listener);
    };
  }, []);

  const ensureContext = useCallback(async () => {
    if (!contextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const transientAnalyser = context.createAnalyser();
      const outputGain = context.createGain();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.55;
      transientAnalyser.fftSize = FFT_SIZE;
      transientAnalyser.smoothingTimeConstant = 0;
      outputGain.gain.value = volumeRef.current;
      contextRef.current = context;
      analyserRef.current = analyser;
      transientAnalyserRef.current = transientAnalyser;
      outputGainRef.current = outputGain;
    }
    if (contextRef.current.state !== 'running') {
      await contextRef.current.resume();
    }
    const context = contextRef.current;
    const analyser = analyserRef.current;
    const transientAnalyser = transientAnalyserRef.current;
    const outputGain = outputGainRef.current;
    if (!context || !analyser || !transientAnalyser || !outputGain) throw new Error('audio graph unavailable');
    return { context, analyser, transientAnalyser, outputGain };
  }, []);

  const disconnectSource = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    transientAnalyserRef.current?.disconnect();
    outputGainRef.current?.disconnect();
    prevFreqRef.current = null;
    onsetStatRef.current = { avg: 0, variance: 0 };
    cwtStatRef.current = { avg: 0, variance: 0 };
    beatOnsetBufferRef.current.fill(0);
    beatOnsetIndexRef.current = 0;
    beatAcfRef.current.fill(0);
    beatLastTickMsRef.current = 0;
    beatFpsEmaRef.current = 60;
    beatRawBpmRef.current = 120;
    beatBpmRef.current = 120;
    beatConfidenceRef.current = 0;
    beatStrengthRef.current = 0;
    pulseConfidenceRef.current = 0;
    beatPhaseRef.current = 0;
    beatSmoothedRef.current = 0;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    streamRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const analyser = analyserRef.current;
    const transientAnalyser = transientAnalyserRef.current;
    const context = contextRef.current;
    if (!analyser || !transientAnalyser || !context) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const transientFreq = new Uint8Array(transientAnalyser.frequencyBinCount);
    const timeDomain = new Uint8Array(transientAnalyser.fftSize);
    if (!cwtKernelsRef.current || cwtKernelsRef.current.sampleRate !== context.sampleRate) {
      cwtKernelsRef.current = { sampleRate: context.sampleRate, kernels: buildCwtKernels(context.sampleRate) };
    }

    const tick = () => {
      const nowMs = performance.now();
      const previousTickMs = beatLastTickMsRef.current;
      beatLastTickMsRef.current = nowMs;
      if (previousTickMs > 0) {
        const deltaSeconds = Math.max(1 / 240, Math.min(0.25, (nowMs - previousTickMs) / 1000));
        const fps = 1 / deltaSeconds;
        beatFpsEmaRef.current = beatFpsEmaRef.current * 0.95 + fps * 0.05;
      }
      analyser.getByteFrequencyData(freq);
      transientAnalyser.getByteFrequencyData(transientFreq);
      transientAnalyser.getByteTimeDomainData(timeDomain);
      const bass = bandRmsHz(freq, context.sampleRate, analyser.fftSize, BAND_EDGES_HZ[0], BAND_EDGES_HZ[1]);
      const mid = bandRmsHz(freq, context.sampleRate, analyser.fftSize, BAND_EDGES_HZ[1], BAND_EDGES_HZ[2]);
      const high = bandRmsHz(freq, context.sampleRate, analyser.fftSize, BAND_EDGES_HZ[2], BAND_EDGES_HZ[3]);
      const timeStats = rmsAndPeak(timeDomain);
      const prevFreq = prevFreqRef.current;
      let flux = 0;
      let weightedFlux = 0;
      let weightTotal = 0;
      if (prevFreq) {
        for (let i = 1; i < transientFreq.length; i += 1) {
          const diff = Math.max(0, ((transientFreq[i] ?? 0) - (prevFreq[i] ?? 0)) / 255);
          const weight = i + 1;
          flux += diff;
          weightedFlux += diff * weight;
          weightTotal += weight;
        }
      }
      if (!prevFreqRef.current || prevFreqRef.current.length !== transientFreq.length) {
        prevFreqRef.current = new Uint8Array(transientFreq.length);
      }
      prevFreqRef.current.set(transientFreq);
      const spectralFlux = clamp01((flux / Math.max(1, transientFreq.length)) * 8);
      const onsetStrength = updateZ(weightedFlux / Math.max(1, weightTotal), onsetStatRef.current);
      const cwtTransient = updateZ(waveletTransient(timeDomain, cwtKernelsRef.current?.kernels ?? []), cwtStatRef.current);
      const crestFactor = clamp01((timeStats.peak / Math.max(0.0001, timeStats.rms) - 1) / 8);
      const onsetBuffer = beatOnsetBufferRef.current;
      const onsetIndex = beatOnsetIndexRef.current;
      onsetBuffer[onsetIndex] = onsetStrength;
      beatOnsetIndexRef.current = (onsetIndex + 1) % BEAT_ONSET_BUFFER_LEN;
      if ((beatOnsetIndexRef.current % BEAT_ACF_INTERVAL) === 0) {
        const n = BEAT_ONSET_BUFFER_LEN;
        let mean = 0;
        for (let i = 0; i < n; i += 1) {
          mean += onsetBuffer[i] ?? 0;
        }
        mean /= n;
        let variance = 0;
        for (let i = 0; i < n; i += 1) {
          const delta = (onsetBuffer[i] ?? 0) - mean;
          variance += delta * delta;
        }
        if (variance > 1e-12) {
          const invVariance = 1 / variance;
          const acf = beatAcfRef.current;
          for (let lag = 0; lag < BEAT_ACF_LEN; lag += 1) {
            let sum = 0;
            const loop = n - lag;
            for (let i = 0; i < loop; i += 1) {
              const ia = (beatOnsetIndexRef.current + i) % n;
              const ib = (beatOnsetIndexRef.current + i + lag) % n;
              const a = (onsetBuffer[ia] ?? 0) - mean;
              const b = (onsetBuffer[ib] ?? 0) - mean;
              sum += a * b;
            }
            acf[lag] = sum * invVariance;
          }
          const fps = beatFpsEmaRef.current > 1 ? beatFpsEmaRef.current : 60;
          const minLag = Math.max(1, Math.floor(fps * 60 / BEAT_BPM_MAX));
          const maxLag = Math.min(BEAT_ACF_LEN - 1, Math.ceil(fps * 60 / BEAT_BPM_MIN));
          if (minLag < maxLag) {
            const peak = peakLagParabolic(acf, minLag, maxLag);
            if (peak.lag > 0.5) {
              beatRawBpmRef.current = fps * 60 / peak.lag;
            }
            beatBpmRef.current = Math.max(BEAT_BPM_MIN, Math.min(BEAT_BPM_MAX, BEAT_BPM_SMOOTH * beatBpmRef.current + (1 - BEAT_BPM_SMOOTH) * beatRawBpmRef.current));
            beatConfidenceRef.current = peak.confidence;
            beatStrengthRef.current = peak.peak;
          }
        }
      }
      let beatBoundary = false;
      if (beatOnsetIndexRef.current > 0) {
        const phaseInc = beatBpmRef.current / (60 * Math.max(1, beatFpsEmaRef.current));
        beatPhaseRef.current += phaseInc;
        if (onsetStrength > BEAT_ONSET_THRESHOLD && beatConfidenceRef.current > BEAT_CONF_THRESHOLD) {
          const phaseErr = beatPhaseRef.current < 0.5 ? -beatPhaseRef.current : 1 - beatPhaseRef.current;
          beatPhaseRef.current += phaseErr * BEAT_PLL_GAIN * onsetStrength;
        }
        if (beatPhaseRef.current >= 1) {
          beatPhaseRef.current -= 1;
          beatBoundary = true;
        }
        if (beatPhaseRef.current < 0) beatPhaseRef.current += 1;
      }
      const beatTarget = Math.max(beatBoundary ? 1 : 0, cwtTransient);
      const beatRate = beatTarget > beatSmoothedRef.current ? 0.9 : 0.1;
      const beatDeltaSeconds = previousTickMs > 0 ? Math.max(1 / 240, Math.min(0.25, (nowMs - previousTickMs) / 1000)) : 1 / 60;
      const beatK = Math.max(0, Math.min(1, beatRate * beatDeltaSeconds * 60));
      beatSmoothedRef.current += (beatTarget - beatSmoothedRef.current) * beatK;
      pulseConfidenceRef.current = Math.min(beatConfidenceRef.current, Math.min(1, pulseConfidenceRef.current + 0.04 * beatDeltaSeconds * 60));
      const beatPhase = clamp01(beatPhaseRef.current);
      const pulseLfo = clamp01(0.5 - 0.5 * Math.cos(2 * Math.PI * beatPhase));
      const pulseConfidence = clamp01(pulseConfidenceRef.current);
      const tempoConfidence = clamp01(beatConfidenceRef.current);
      const onsetConsensus = clamp01(Math.max(onsetStrength, cwtTransient * 0.75));
      const features: AudioFeatures = {
        bass,
        mid,
        high,
        rms: clamp01(timeStats.rms * 3),
        spectralFlux,
        onsetStrength: onsetConsensus,
        cwtTransient,
        crestFactor,
        beat: clamp01(beatSmoothedRef.current),
        beatPhase,
        pulseLfo,
        pulseConfidence,
        beatConfidence: beatConfidenceRef.current,
        tempoConfidence,
        beatStrength: clamp01(beatStrengthRef.current),
        tempo: clamp01((beatBpmRef.current - BEAT_BPM_MIN) / (BEAT_BPM_MAX - BEAT_BPM_MIN)),
        bpm: beatBpmRef.current,
      };
      const audio = audioElRef.current;
      publish(current => ({
        ...current,
        features,
        transport: audio
          ? {
              ...current.transport,
              duration: Number.isFinite(audio.duration) ? audio.duration : 0,
              currentTime: audio.currentTime,
              playing: !audio.paused,
              loop: audio.loop,
            }
          : current.transport,
      }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [publish]);

  const startMic = useCallback(async () => {
    const { context, analyser, transientAnalyser } = await ensureContext();
    disconnectSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(transientAnalyser);
    sourceRef.current = source;
    streamRef.current = stream;
    publish(current => ({
      ...current,
      status: 'mic',
      transport: { ...EMPTY_TRANSPORT, volume: volumeRef.current },
    }));
    startLoop();
  }, [disconnectSource, ensureContext, publish, startLoop]);

  const loadFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const { context, analyser, transientAnalyser, outputGain } = await ensureContext();
    disconnectSource();
    const audio = new Audio();
    objectUrlRef.current = URL.createObjectURL(file);
    audio.src = objectUrlRef.current;
    audio.loop = true;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    source.connect(transientAnalyser);
    analyser.connect(outputGain);
    outputGain.connect(context.destination);
    sourceRef.current = source;
    audioElRef.current = audio;
    publish(current => ({
      ...current,
      status: 'file',
      transport: {
        duration: 0,
        currentTime: 0,
        playing: false,
        loop: true,
        sourceName: file.name,
        volume: volumeRef.current,
      },
    }));
    try {
      await audio.play();
      publish(current => ({ ...current, transport: { ...current.transport, playing: true } }));
    } catch {
      audio.pause();
    }
    startLoop();
  }, [disconnectSource, ensureContext, publish, startLoop]);

  const play = useCallback(async () => {
    const audio = audioElRef.current;
    if (!audio) return;
    await ensureContext();
    await audio.play();
    publish(current => ({ ...current, transport: { ...current.transport, playing: true } }));
    startLoop();
  }, [ensureContext, publish, startLoop]);

  const pause = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.pause();
    publish(current => ({ ...current, transport: { ...current.transport, playing: false } }));
  }, [publish]);

  const seek = useCallback((time: number) => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0));
    publish(current => ({ ...current, transport: { ...current.transport, currentTime: audio.currentTime } }));
  }, [publish]);

  const setLoop = useCallback((loop: boolean) => {
    const audio = audioElRef.current;
    if (audio) audio.loop = loop;
    publish(current => ({ ...current, transport: { ...current.transport, loop } }));
  }, [publish]);

  const setVolume = useCallback((volume: number) => {
    const next = clamp01(volume);
    volumeRef.current = next;
    const context = contextRef.current;
    const outputGain = outputGainRef.current;
    if (context && outputGain) outputGain.gain.setValueAtTime(next, context.currentTime);
    publish(current => ({ ...current, transport: { ...current.transport, volume: next } }));
  }, [publish]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    disconnectSource();
    publish(() => ({ ...EMPTY_SNAPSHOT, transport: { ...EMPTY_TRANSPORT, volume: volumeRef.current } }));
  }, [disconnectSource, publish]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (uiNotifyTimerRef.current) window.clearTimeout(uiNotifyTimerRef.current);
    disconnectSource();
    void contextRef.current?.close();
  }, [disconnectSource]);

  return useMemo(() => ({
    getSnapshot,
    loadFile,
    pause,
    play,
    seek,
    setLoop,
    setVolume,
    startMic,
    stop,
    subscribe,
    subscribeUi,
  }), [getSnapshot, loadFile, pause, play, seek, setLoop, setVolume, startMic, stop, subscribe, subscribeUi]);
}
