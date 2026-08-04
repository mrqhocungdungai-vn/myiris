import { useEffect, useRef, useState } from "react";
import { SYSTEM_DEFAULT_MIC, micConstraints } from "../lib/mic-device";

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
 * The single play/drop decision for a Gemini audio chunk, used at both guard
 * points in playGeminiAudio so the tested logic is the production logic.
 */
export function shouldDropChunk({
  muted,
  chunkEpoch,
  currentEpoch,
}: {
  muted: boolean;
  chunkEpoch: number;
  currentEpoch: number;
}): boolean {
  return muted || chunkEpoch !== currentEpoch;
}

/**
 * Owns the mic-capture/Gemini-playback Web Audio graph, its lifecycle refs,
 * and the passive level meters — mirrors the extraction pattern already used
 * for gesture control in useHandControl.ts. Mic and playback levels are
 * tracked separately so the orb can tell WHO is talking: your mic drives the
 * radial-bar signature, Gemini's playback drives the smooth wave.
 */
export function useAudioPipeline({
  onLog,
  micDeviceId,
}: {
  onLog?: (level: string, message: string) => void;
  micDeviceId?: string;
} = {}) {
  const inputContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<AudioWorkletNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const flushEpochRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const outputMutedRef = useRef(false);
  const [outputMuted, setOutputMuted] = useState(false);
  const micDeviceIdRef = useRef(micDeviceId ?? SYSTEM_DEFAULT_MIC);
  micDeviceIdRef.current = micDeviceId ?? SYSTEM_DEFAULT_MIC;
  // Bumped at the entry of every startCapture() call (mirrors flushEpochRef's
  // pattern for playback). A losing call whose awaits resolve after a newer
  // one has started is detected here and cleaned up rather than left as an
  // unreferenced, never-stopped MediaStream (hot mic, lit OS recording light).
  const captureEpochRef = useRef(0);

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

  const captureBaseConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };

  async function acquireStream(deviceId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: micConstraints(captureBaseConstraints, deviceId),
      video: false,
    });
  }

  // Returns the actually-active device id (which may differ from the
  // requested one after a fallback), or null if capture did not start —
  // callers reconcile persisted/displayed selection from this return value
  // rather than a second callback channel.
  async function startCapture(deviceId?: string): Promise<string | null> {
    if (typeof window.iris === "undefined" || inputContextRef.current) return null;

    const epoch = ++captureEpochRef.current;
    const requestedDeviceId = deviceId ?? micDeviceIdRef.current;
    let activeDeviceId = requestedDeviceId;
    let stream: MediaStream;
    try {
      stream = await acquireStream(requestedDeviceId);
    } catch (error) {
      if (requestedDeviceId === SYSTEM_DEFAULT_MIC) {
        const message = error instanceof Error ? error.message : String(error);
        onLog?.("error", `Mic capture failed: could not open the microphone (${message}).`);
        return null;
      }
      onLog?.(
        "warn",
        `Mic capture: selected microphone (${requestedDeviceId}) unavailable, falling back to System Default.`,
      );
      try {
        stream = await acquireStream(SYSTEM_DEFAULT_MIC);
        activeDeviceId = SYSTEM_DEFAULT_MIC;
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        onLog?.("error", `Mic capture failed: System Default microphone unavailable (${message}).`);
        return null;
      }
    }

    if (captureEpochRef.current !== epoch) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }

    // Apply mute state to the freshly acquired stream before wiring it in —
    // read via the ref so a mute toggled during the acquisition window above
    // is honored rather than silently resuming transmission (design.md).
    stream.getAudioTracks().forEach((track) => (track.enabled = !mutedRef.current));

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);

    // Passive meter tap for the reactive HUD (does not affect what is sent).
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    inputAnalyserRef.current = analyser;

    // Downsampling runs off the main thread in an AudioWorklet (audio rendering
    // thread), not a ScriptProcessorNode — see openspec/changes/unstall-render-and-audio.
    let workletNode: AudioWorkletNode;
    try {
      try {
        await context.audioWorklet.addModule(new URL("../worklets/mic-downsample.js", import.meta.url));
      } catch {
        // Packaged file:// builds may not resolve the Vite-bundled worklet URL;
        // retry against the public/ copy served relative to the app's base (design D4).
        await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/mic-downsample.js`);
      }
      workletNode = new AudioWorkletNode(context, "mic-downsample");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog?.("error", `Mic capture failed: could not load the AudioWorklet (${message}).`);
      inputAnalyserRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
      return null;
    }

    if (captureEpochRef.current !== epoch) {
      // A newer startCapture()/restartCapture() call won the race — stop the
      // just-opened tracks/context instead of assigning them to the live refs.
      inputAnalyserRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
      return null;
    }

    workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      window.iris.sendAudioChunk(event.data);
    };

    source.connect(workletNode);

    inputContextRef.current = context;
    inputStreamRef.current = stream;
    inputSourceRef.current = source;
    inputProcessorRef.current = workletNode;
    onLog?.("info", "WebRTC echo cancellation enabled for microphone.");
    return activeDeviceId;
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
    flushEpochRef.current++;
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
    const epoch = flushEpochRef.current;
    if (shouldDropChunk({ muted: outputMutedRef.current, chunkEpoch: epoch, currentEpoch: flushEpochRef.current })) {
      return;
    }
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

    if (shouldDropChunk({ muted: outputMutedRef.current, chunkEpoch: epoch, currentEpoch: flushEpochRef.current })) {
      source.disconnect();
      return;
    }

    const startAt = Math.max(context.currentTime + 0.03, playbackTimeRef.current || 0);
    try {
      source.start(startAt);
    } catch {
      // Context closing/closed underneath us — epoch guard already covers the normal case.
      return;
    }
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
  }

  function toggleMute() {
    const stream = inputStreamRef.current;
    const next = !muted;
    mutedRef.current = next;
    stream?.getAudioTracks().forEach((track) => (track.enabled = !next));
    setMuted(next);
  }

  // A pure setter, not a renderer-owned toggle: listen-only mode is owned by
  // main, which pushes the resolved state; the renderer only executes the
  // drop this flag decides (replace-listening-mode-with-listen-only
  // design.md D3). flushPlayback() still fires on the engaging edge.
  function setOutputMutedValue(engaged: boolean) {
    outputMutedRef.current = engaged;
    setOutputMuted(engaged);
    if (engaged) flushPlayback();
  }

  async function start(): Promise<string | null> {
    sessionStartRef.current = Date.now();
    return startCapture();
  }

  // App.tsx's hot-swap path: tears down and rebuilds the capture graph on a
  // newly selected device without touching the output/playback context or
  // resetting sessionStartRef/muted — that's the full stop()'s job, not this
  // one's (design.md).
  async function restartCapture(deviceId: string): Promise<string | null> {
    await stopCapture();
    return startCapture(deviceId);
  }

  async function stop() {
    await stopCapture();
    flushPlayback();
    await outputContextRef.current?.close().catch(() => undefined);
    outputContextRef.current = null;
    outputAnalyserRef.current = null;
    playbackTimeRef.current = 0;
    mutedRef.current = false;
    setMuted(false);
    outputMutedRef.current = false;
    setOutputMuted(false);
    sessionStartRef.current = null;
  }

  return {
    inputLevelRef,
    outputLevelRef,
    sessionStartRef,
    muted,
    outputMuted,
    start,
    stop,
    restartCapture,
    flushPlayback,
    playGeminiAudio,
    toggleMute,
    setOutputMutedValue,
  };
}
