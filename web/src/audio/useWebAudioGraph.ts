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
};

const DEFAULT_OUTPUT_VOLUME = 0.5;

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

function bandAverage(data: Uint8Array, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end && i < data.length; i++) {
    sum += (data[i] ?? 0) / 255;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
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

function waveletTransient(samples: Uint8Array): number {
  const scales = [16, 32, 64];
  let peak = 0;
  for (const scale of scales) {
    const radius = scale * 2;
    const stride = Math.max(4, Math.floor(scale / 2));
    for (let center = radius; center < samples.length - radius; center += stride) {
      let re = 0;
      let im = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const t = offset / scale;
        const sample = ((samples[center + offset] ?? 128) - 128) / 128;
        const envelope = Math.exp(-0.5 * t * t);
        const phase = 5 * t;
        re += sample * envelope * Math.cos(phase);
        im += sample * envelope * Math.sin(phase);
      }
      peak = Math.max(peak, Math.hypot(re, im) / scale);
    }
  }
  return clamp01(peak * 0.25);
}

export function useWebAudioGraph(): WebAudioGraph {
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const prevFreqRef = useRef<Uint8Array | null>(null);
  const onsetStatRef = useRef({ avg: 0, variance: 0 });
  const cwtStatRef = useRef({ avg: 0, variance: 0 });
  const snapshotRef = useRef<AudioSnapshot>(EMPTY_SNAPSHOT);
  const volumeRef = useRef(DEFAULT_OUTPUT_VOLUME);
  const listenersRef = useRef(new Set<() => void>());

  const publish = useCallback((updater: (snapshot: AudioSnapshot) => AudioSnapshot) => {
    const next = updater(snapshotRef.current);
    if (next === snapshotRef.current) return;
    snapshotRef.current = next;
    for (const listener of listenersRef.current) listener();
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const ensureContext = useCallback(async () => {
    if (!contextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const outputGain = context.createGain();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      outputGain.gain.value = volumeRef.current;
      contextRef.current = context;
      analyserRef.current = analyser;
      outputGainRef.current = outputGain;
    }
    if (contextRef.current.state !== 'running') {
      await contextRef.current.resume();
    }
    const context = contextRef.current;
    const analyser = analyserRef.current;
    const outputGain = outputGainRef.current;
    if (!context || !analyser || !outputGain) throw new Error('audio graph unavailable');
    return { context, analyser, outputGain };
  }, []);

  const disconnectSource = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    outputGainRef.current?.disconnect();
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
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const timeDomain = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(timeDomain);
      const bass = bandAverage(freq, 2, 12);
      const mid = bandAverage(freq, 12, 72);
      const high = bandAverage(freq, 72, 240);
      const timeStats = rmsAndPeak(timeDomain);
      const prevFreq = prevFreqRef.current;
      let flux = 0;
      let weightedFlux = 0;
      let weightTotal = 0;
      if (prevFreq) {
        for (let i = 1; i < freq.length; i += 1) {
          const diff = Math.max(0, ((freq[i] ?? 0) - (prevFreq[i] ?? 0)) / 255);
          const weight = i + 1;
          flux += diff;
          weightedFlux += diff * weight;
          weightTotal += weight;
        }
      }
      prevFreqRef.current = new Uint8Array(freq);
      const spectralFlux = clamp01((flux / Math.max(1, freq.length)) * 8);
      const onsetStrength = updateZ(weightedFlux / Math.max(1, weightTotal), onsetStatRef.current);
      const cwtTransient = updateZ(waveletTransient(timeDomain), cwtStatRef.current);
      const crestFactor = clamp01((timeStats.peak / Math.max(0.0001, timeStats.rms) - 1) / 8);
      const features: AudioFeatures = {
        bass,
        mid,
        high,
        rms: clamp01(timeStats.rms * 3),
        spectralFlux,
        onsetStrength,
        cwtTransient,
        crestFactor,
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
    const { context, analyser } = await ensureContext();
    disconnectSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
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
    const { context, analyser, outputGain } = await ensureContext();
    disconnectSource();
    const audio = new Audio();
    objectUrlRef.current = URL.createObjectURL(file);
    audio.src = objectUrlRef.current;
    audio.loop = true;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
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
  }), [getSnapshot, loadFile, pause, play, seek, setLoop, setVolume, startMic, stop, subscribe]);
}
