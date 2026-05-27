import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioFeatures, AudioStatus, AudioTransport, WebAudioGraph } from '../types';

const EMPTY_FEATURES: AudioFeatures = {
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
};

const EMPTY_TRANSPORT: AudioTransport = {
  duration: 0,
  currentTime: 0,
  playing: false,
  loop: true,
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

export function useWebAudioGraph(): WebAudioGraph {
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const lastBeatRef = useRef(0);
  const [features, setFeatures] = useState(EMPTY_FEATURES);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [transport, setTransport] = useState(EMPTY_TRANSPORT);

  const ensureContext = useCallback(async () => {
    if (!contextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      contextRef.current = context;
      analyserRef.current = analyser;
    }
    if (contextRef.current.state !== 'running') {
      await contextRef.current.resume();
    }
    const context = contextRef.current;
    const analyser = analyserRef.current;
    if (!context || !analyser) throw new Error('audio graph unavailable');
    return { context, analyser };
  }, []);

  const disconnectSource = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
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

    const tick = (time: number) => {
      analyser.getByteFrequencyData(freq);
      const bass = bandAverage(freq, 2, 12);
      const mid = bandAverage(freq, 12, 72);
      const treble = bandAverage(freq, 72, 240);
      const level = Math.min(1, bass * 0.45 + mid * 0.35 + treble * 0.2);
      const beat = bass > 0.48 && time - lastBeatRef.current > 180 ? bass : 0;
      if (beat > 0) lastBeatRef.current = time;
      setFeatures({ level, bass, mid, treble, beat });
      const audio = audioElRef.current;
      if (audio) {
        setTransport(current => ({
          ...current,
          duration: Number.isFinite(audio.duration) ? audio.duration : 0,
          currentTime: audio.currentTime,
          playing: !audio.paused,
          loop: audio.loop,
        }));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startMic = useCallback(async () => {
    const { context, analyser } = await ensureContext();
    disconnectSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;
    streamRef.current = stream;
    setStatus('mic');
    setTransport(EMPTY_TRANSPORT);
    startLoop();
  }, [disconnectSource, ensureContext, startLoop]);

  const loadFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const { context, analyser } = await ensureContext();
    disconnectSource();
    const audio = new Audio();
    objectUrlRef.current = URL.createObjectURL(file);
    audio.src = objectUrlRef.current;
    audio.loop = true;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    sourceRef.current = source;
    audioElRef.current = audio;
    await audio.play();
    setStatus('file');
    setTransport({
      duration: 0,
      currentTime: 0,
      playing: true,
      loop: true,
    });
    startLoop();
  }, [disconnectSource, ensureContext, startLoop]);

  const play = useCallback(async () => {
    const audio = audioElRef.current;
    if (!audio) return;
    await ensureContext();
    await audio.play();
    setTransport(current => ({ ...current, playing: true }));
    startLoop();
  }, [ensureContext, startLoop]);

  const pause = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.pause();
    setTransport(current => ({ ...current, playing: false }));
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0));
    setTransport(current => ({ ...current, currentTime: audio.currentTime }));
  }, []);

  const setLoop = useCallback((loop: boolean) => {
    const audio = audioElRef.current;
    if (audio) audio.loop = loop;
    setTransport(current => ({ ...current, loop }));
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    disconnectSource();
    setFeatures(EMPTY_FEATURES);
    setTransport(EMPTY_TRANSPORT);
    setStatus('idle');
  }, [disconnectSource]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    disconnectSource();
    void contextRef.current?.close();
  }, [disconnectSource]);

  return { features, status, transport, startMic, loadFile, play, pause, seek, setLoop, stop };
}
