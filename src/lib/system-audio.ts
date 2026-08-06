// Listen-only mode's second audio source: the audio this machine is playing
// (listen-mode-hears-system-audio D2/D5). Kept out of useAudioPipeline so the
// decisions — how the two sources are mixed, and whether a capture is actually
// delivering anything — are plain functions with no Web Audio in sight, and so
// the hook stays about the graph's lifecycle rather than about this branch.

export type SystemAudioState = "off" | "live" | "degraded";

/**
 * The floor on the microphone's own gain in a mixed stream. Derived gains are
 * clamped to it so a system-audio gain of 1.0 cannot silence the user
 * entirely — the mode exists so Iris hears the meeting AS WELL AS the room,
 * never instead of it.
 */
export const MIN_MIC_GAIN = 0.25;

export const DEFAULT_SYSTEM_AUDIO_GAIN = 0.7;

export interface InputMix {
  micGain: number;
  systemGain: number;
  sources: Array<"microphone" | "system">;
  state: "microphone" | "mixed";
}

/**
 * Which sources are live, what gain each carries, and what that adds up to.
 *
 * The microphone's gain is DERIVED from the system-audio gain rather than
 * fixed, so the nominal full-scale sum stays at 1.0 and the mix has headroom
 * by construction. The worklet does clamp (`mic-downsample.js`), but clamping
 * is clipping by another name: it adds harmonic distortion, and distortion
 * degrades exactly the transcription this mode exists to produce. The clamp
 * stays as a last resort, not as the plan.
 *
 * The microphone runs with `autoGainControl` on, normalising toward full
 * scale, so "both sources are loud at once" is the ordinary case in a meeting
 * rather than the edge case.
 */
export function resolveInputMix({
  systemAudioActive,
  systemAudioGain,
}: {
  systemAudioActive: boolean;
  systemAudioGain: number;
}): InputMix {
  if (!systemAudioActive) {
    return { micGain: 1, systemGain: 0, sources: ["microphone"], state: "microphone" };
  }
  const requested = Number.isFinite(systemAudioGain) ? systemAudioGain : DEFAULT_SYSTEM_AUDIO_GAIN;
  const system = Math.min(1, Math.max(0, requested));
  return {
    micGain: Math.max(MIN_MIC_GAIN, 1 - system),
    systemGain: system,
    sources: ["microphone", "system"],
    state: "mixed",
  };
}

/**
 * Whether a window of samples is bit-exact silence.
 *
 * This is the failure that actually occurs, and it is not an error: with the
 * loopback feature blocked, `getDisplayMedia` resolves, the track reports
 * `live`, and every sample is exactly zero until the track later ends. A check
 * that only asks whether acquisition succeeded reports a working capture while
 * Iris hears nothing for the length of a meeting.
 *
 * The threshold needs no tuning because it is not a threshold: a working
 * capture never read exactly zero across a window, and a blocked one always
 * did. An empty window is NOT silence — observing nothing is not evidence.
 */
export function isCaptureSilent(samples: ArrayLike<number>): boolean {
  if (!samples.length) return false;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== 0) return false;
  }
  return true;
}

/**
 * The tooltip on the headphone control, in both the deck and the HUD. One
 * definition so the two surfaces cannot describe the same mode differently —
 * and so the degraded state is named wherever the control is, since that is
 * the only place the user looks to find out whether Iris is hearing anything.
 */
export function listenOnlyControlTitle(engaged: boolean, state: SystemAudioState): string {
  if (!engaged) return "Listen-only mode — Iris goes silent and hears your machine as well as the room";
  if (state === "degraded") {
    return "Listen-only mode — Iris is NOT hearing your machine's audio (microphone only). Click to leave.";
  }
  if (state === "live") return "Listen-only mode — Iris is silent and hearing your machine. Click to leave.";
  return "Listen-only mode — Iris is silent. Click to leave.";
}

/** How often the liveness watch samples the loopback branch after engaging. */
export const LIVENESS_PROBE_INTERVAL_MS = 750;
/** How many consecutive all-zero probes before the capture is called failed. */
export const LIVENESS_PROBE_TICKS = 6;

export interface LoopbackBranch {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

/**
 * Opens the system-audio capture and wires it into `destination` through its
 * own gain node, with an analyser tapped off for the liveness check.
 *
 * Audio only: no video is requested, so there is no screen or window source to
 * discard and no picker to dismiss. Rejects if the capture cannot be acquired
 * at all — the caller decides what that means for the mode.
 */
export async function acquireLoopbackBranch({
  context,
  destination,
  gain,
}: {
  context: AudioContext;
  destination: AudioNode;
  gain: number;
}): Promise<LoopbackBranch> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true });
  // A stream with no audio track is the same failure as a rejection, and is
  // worth catching here rather than as silence four seconds later.
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("the system-audio capture carried no audio track");
  }
  const source = context.createMediaStreamSource(stream);
  const gainNode = context.createGain();
  gainNode.gain.value = gain;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(gainNode);
  gainNode.connect(destination);
  gainNode.connect(analyser);
  return { stream, source, gain: gainNode, analyser };
}

/** Disconnects the branch and stops its tracks, so no capture outlives its use. */
export function releaseLoopbackBranch(branch: LoopbackBranch | null) {
  if (!branch) return;
  try {
    branch.gain.disconnect();
    branch.source.disconnect();
    branch.analyser.disconnect();
  } catch {
    // Already disconnected, or the context closed underneath us.
  }
  branch.stream.getTracks().forEach((track) => track.stop());
}

/**
 * Watches a freshly-opened branch for the silent-capture failure and calls
 * `onSilent` once if every probe across the window reads bit-exact zero. Stops
 * itself the moment any real signal arrives — a meeting that simply starts
 * quiet must not be reported as broken, so the watch ends on first evidence
 * rather than running for the whole engagement.
 *
 * Returns a canceller, which is also what a disengage or a device swap calls.
 */
export function watchCaptureLiveness({
  analyser,
  onSilent,
  intervalMs = LIVENESS_PROBE_INTERVAL_MS,
  ticks = LIVENESS_PROBE_TICKS,
  setInterval: setTimer = globalThis.setInterval,
  clearInterval: clearTimer = globalThis.clearInterval,
}: {
  analyser: AnalyserNode;
  onSilent: () => void;
  intervalMs?: number;
  ticks?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}): () => void {
  const buffer = new Float32Array(analyser.fftSize);
  let remaining = ticks;
  const timer = setTimer(() => {
    analyser.getFloatTimeDomainData(buffer);
    if (!isCaptureSilent(buffer)) {
      clearTimer(timer);
      return;
    }
    remaining -= 1;
    if (remaining > 0) return;
    clearTimer(timer);
    onSilent();
  }, intervalMs);
  return () => clearTimer(timer);
}
