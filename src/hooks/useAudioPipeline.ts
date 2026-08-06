import { useEffect, useRef, useState } from "react";
import { SYSTEM_DEFAULT_MIC, micConstraints } from "../lib/mic-device";
import {
  DEFAULT_SYSTEM_AUDIO_GAIN,
  acquireLoopbackBranch,
  releaseLoopbackBranch,
  resolveInputMix,
  watchCaptureLiveness,
  type LoopbackBranch,
  type SystemAudioState,
} from "../lib/system-audio";

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
  onSystemAudioUnavailable,
}: {
  onLog?: (level: string, message: string) => void;
  micDeviceId?: string;
  // A capture that cannot be acquired AT ALL is the one failure that does not
  // end in "still engaged": the mode has nothing to offer, so main is told and
  // it disengages (listen-mode-hears-system-audio D4). Reported, never
  // decided here — the renderer does not own the mode.
  onSystemAudioUnavailable?: (reason: string) => void;
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

  // ===== System audio (listen-mode-hears-system-audio D2) =====
  // The second branch into the SAME worklet: one mixed PCM stream crosses IPC,
  // exactly as before, so nothing downstream of the worklet changes. Held in
  // explicit refs rather than being left to the context's teardown, because a
  // mic hot-swap tears the graph down and rebuilds it — without these, a swap
  // would either leak a live system capture (with the OS recording indicator
  // still lit) or silently lose system audio for the rest of the meeting.
  const micGainRef = useRef<GainNode | null>(null);
  const loopbackRef = useRef<LoopbackBranch | null>(null);
  const cancelLivenessRef = useRef<(() => void) | null>(null);
  // Main's resolved configuration, pushed with the mode state — never read
  // from the environment here, so there is one authority for both.
  const systemAudioWantedRef = useRef(false);
  const systemAudioGainRef = useRef(DEFAULT_SYSTEM_AUDIO_GAIN);
  const [systemAudioState, setSystemAudioState] = useState<SystemAudioState>("off");

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

  /** Applies the current mix to whichever branches exist right now. */
  function applyMix(systemAudioActive: boolean) {
    const mix = resolveInputMix({ systemAudioActive, systemAudioGain: systemAudioGainRef.current });
    if (micGainRef.current) micGainRef.current.gain.value = mix.micGain;
    if (loopbackRef.current) loopbackRef.current.gain.gain.value = mix.systemGain;
    return mix;
  }

  /**
   * Drops the system-audio source and nothing else: the mode stays engaged,
   * Iris stays silent, and the microphone keeps flowing. Disengaging is the
   * user's decision, never a consequence of the capture failing — an automatic
   * disengage would restore Iris's voice in a room she was silenced for.
   */
  function detachSystemAudio(nextState: SystemAudioState) {
    cancelLivenessRef.current?.();
    cancelLivenessRef.current = null;
    releaseLoopbackBranch(loopbackRef.current);
    loopbackRef.current = null;
    applyMix(false);
    setSystemAudioState(nextState);
  }

  /**
   * Opens the loopback capture and sums it into the existing worklet. A no-op
   * when the mode does not want it, when there is no capture graph to attach
   * to yet (startCapture attaches it itself once there is), or when it is
   * already attached.
   */
  async function attachSystemAudio() {
    if (!systemAudioWantedRef.current) return;
    if (loopbackRef.current) return;
    const context = inputContextRef.current;
    const worklet = inputProcessorRef.current;
    if (!context || !worklet) return;

    const epoch = captureEpochRef.current;
    let branch: LoopbackBranch;
    try {
      branch = await acquireLoopbackBranch({
        context,
        destination: worklet,
        gain: resolveInputMix({ systemAudioActive: true, systemAudioGain: systemAudioGainRef.current }).systemGain,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog?.("error", `System audio: could not start capturing this machine's audio (${message}).`);
      setSystemAudioState("off");
      onSystemAudioUnavailable?.(message);
      return;
    }
    // A device swap (or a disengage) that landed while getDisplayMedia was
    // resolving: the graph this branch was built for is gone, so stop the
    // capture rather than attaching it to a context nobody reads.
    if (captureEpochRef.current !== epoch || !systemAudioWantedRef.current || inputProcessorRef.current !== worklet) {
      releaseLoopbackBranch(branch);
      return;
    }

    loopbackRef.current = branch;
    applyMix(true);
    setSystemAudioState("live");

    // A track that ends is the same failure as one that never carried audio —
    // both mean Iris has stopped hearing the meeting.
    branch.stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (loopbackRef.current !== branch) return;
        onLog?.("error", "System audio: the capture ended. Iris is still listening, on the microphone only.");
        detachSystemAudio("degraded");
      });
    });

    cancelLivenessRef.current = watchCaptureLiveness({
      analyser: branch.analyser,
      onSilent: () => {
        if (loopbackRef.current !== branch) return;
        onLog?.(
          "error",
          "System audio: the capture is delivering silence. Iris is still listening, on the microphone only.",
        );
        detachSystemAudio("degraded");
      },
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
      // channelCount/channelCountMode are pinned rather than left to default:
      // the worklet reads `inputs[0][0]` only (mic-downsample.js), so a stereo
      // source would have its right channel silently discarded. Forcing an
      // explicit single channel makes the graph do a proper 0.5*(L+R) down-mix
      // instead. The system-audio track is mono with default processing but
      // stereo without it, so which one arrives depends on constraints a future
      // change could reasonably alter — this holds either way.
      workletNode = new AudioWorkletNode(context, "mic-downsample", {
        channelCount: 1,
        channelCountMode: "explicit",
      });
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

    // The mic reaches the worklet through its own gain node so the mix has one
    // place to set both branches. Alone it sits at unity — nothing about a
    // microphone-only session changes.
    const micGain = context.createGain();
    micGain.gain.value = 1;
    source.connect(micGain);
    micGain.connect(workletNode);

    inputContextRef.current = context;
    inputStreamRef.current = stream;
    inputSourceRef.current = source;
    inputProcessorRef.current = workletNode;
    micGainRef.current = micGain;
    onLog?.("info", "WebRTC echo cancellation enabled for microphone.");
    // A device swap rebuilds this whole graph, so the system-audio branch has
    // to be re-acquired here rather than assumed to have survived it.
    await attachSystemAudio();
    return activeDeviceId;
  }

  async function stopCapture() {
    // Before the context closes: a loopback stream left running would keep the
    // OS recording indicator lit with nothing reading it.
    detachSystemAudio("off");
    inputProcessorRef.current?.disconnect();
    micGainRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    await inputContextRef.current?.close().catch(() => undefined);

    inputProcessorRef.current = null;
    micGainRef.current = null;
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
  // main, which pushes the resolved state — mode plus the system-audio
  // configuration it resolved (listen-mode-hears-system-audio 1.3) — and the
  // renderer only executes it. flushPlayback() still fires on the engaging
  // edge, cutting whatever Iris was already saying.
  //
  // `systemAudio` false is the escape hatch: no capture is opened, so the mode
  // behaves exactly as it did before this feature existed, indicator included.
  function applyListenOnlyState({
    engaged,
    systemAudio = false,
    systemAudioGain = DEFAULT_SYSTEM_AUDIO_GAIN,
  }: {
    engaged: boolean;
    systemAudio?: boolean;
    systemAudioGain?: number;
  }) {
    outputMutedRef.current = engaged;
    setOutputMuted(engaged);
    if (engaged) flushPlayback();

    systemAudioGainRef.current = systemAudioGain;
    const wanted = engaged && systemAudio;
    if (wanted === systemAudioWantedRef.current) return;
    systemAudioWantedRef.current = wanted;
    if (wanted) void attachSystemAudio();
    else detachSystemAudio("off");
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
    // The session ending releases everything the mode owned, capture included
    // — no capture outlives the session that justified it.
    systemAudioWantedRef.current = false;
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
    systemAudioState,
    start,
    stop,
    restartCapture,
    flushPlayback,
    playGeminiAudio,
    toggleMute,
    applyListenOnlyState,
  };
}
