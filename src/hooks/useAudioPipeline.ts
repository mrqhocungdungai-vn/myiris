import { useEffect, useRef, useState } from "react";

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const outputRate = 16000;
  if (inputRate === outputRate) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function parsePcmRate(mimeType?: string): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  return match ? Number(match[1]) : 24000;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Owns the mic-capture/Gemini-playback Web Audio graph, its lifecycle refs,
 * and the passive level meters — mirrors the extraction pattern already used
 * for gesture control in useHandControl.ts. Mic and playback levels are
 * tracked separately so the orb can tell WHO is talking: your mic drives the
 * radial-bar signature, Gemini's playback drives the smooth wave.
 */
export function useAudioPipeline({ onLog }: { onLog?: (level: string, message: string) => void } = {}) {
  const inputContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const [muted, setMuted] = useState(false);

  // Passive audio level meters (mic in / Gemini out) for the reactive HUD.
  useEffect(() => {
    let raf = 0;
    const buf = new Uint8Array(256);
    const rms = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    };
    const tick = () => {
      const input = Math.min(1, rms(inputAnalyserRef.current) * 2.6);
      const output = Math.min(1, rms(outputAnalyserRef.current) * 2.6);
      inputLevelRef.current += (input - inputLevelRef.current) * 0.4;
      outputLevelRef.current += (output - outputLevelRef.current) * 0.4;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function startCapture() {
    if (typeof window.iris === "undefined" || inputContextRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);

    // Passive meter tap for the reactive HUD (does not affect what is sent).
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    inputAnalyserRef.current = analyser;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      const pcm = downsampleTo16k(input, context.sampleRate);
      if (pcm.byteLength > 0) {
        const chunk = new ArrayBuffer(pcm.byteLength);
        new Uint8Array(chunk).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        window.iris.sendAudioChunk(chunk);
      }
    };

    source.connect(processor);
    processor.connect(context.destination);

    inputContextRef.current = context;
    inputStreamRef.current = stream;
    inputSourceRef.current = source;
    inputProcessorRef.current = processor;
    onLog?.("info", "WebRTC echo cancellation enabled for microphone.");
  }

  async function stopCapture() {
    inputProcessorRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    await inputContextRef.current?.close().catch(() => undefined);

    inputProcessorRef.current = null;
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    inputContextRef.current = null;
    inputAnalyserRef.current = null;
  }

  function flushPlayback() {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    playbackSourcesRef.current = [];
    if (outputContextRef.current) {
      playbackTimeRef.current = outputContextRef.current.currentTime;
    }
  }

  async function playGeminiAudio(chunk: LiveAudioChunk) {
    const rate = parsePcmRate(chunk.mimeType);
    const bytes = base64ToBytes(chunk.data);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;

    const context = outputContextRef.current ?? new AudioContext();
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const buffer = context.createBuffer(1, sampleCount, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    let analyser = outputAnalyserRef.current;
    if (!analyser || analyser.context !== context) {
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(context.destination);
      outputAnalyserRef.current = analyser;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((item) => item !== source);
    };

    const startAt = Math.max(context.currentTime + 0.03, playbackTimeRef.current || 0);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
  }

  function toggleMute() {
    const stream = inputStreamRef.current;
    const next = !muted;
    stream?.getAudioTracks().forEach((track) => (track.enabled = !next));
    setMuted(next);
  }

  async function start() {
    sessionStartRef.current = Date.now();
    await startCapture();
  }

  async function stop() {
    await stopCapture();
    flushPlayback();
    setMuted(false);
    sessionStartRef.current = null;
  }

  return {
    inputLevelRef,
    outputLevelRef,
    sessionStartRef,
    muted,
    start,
    stop,
    flushPlayback,
    playGeminiAudio,
    toggleMute,
  };
}
