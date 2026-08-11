import { wakeCaption, type Caption } from "./wake-caption";
import { liveHeardCaption } from "./transcript-speaker";

// What the single line under the orb says, and what colour the audio dot is.
//
// Both are **precedence rules**: several conditions can be true at once and the
// order decides which one the user is told about. That ordering is the whole
// content, and it was previously expressed as a nested ternary and a chain of
// early returns inside App.tsx, where nothing could exercise it.

export type { Caption };

export type CaptionInputs = {
  sidecarRunning: boolean;
  wakeWordEnabled: boolean;
  wakeFailed: boolean;
  wakeHotkey: string;
  listenOnlyEngaged: boolean;
  heardLive: string | null;
  audioState: string;
  working: boolean;
  lastTranscriptText: string | null;
  geminiStatus: string;
};

/**
 * The caption, in strict precedence order.
 *
 * 1. **Wake state** first — `wakeCaption` owns the asleep/wake-word wording.
 *    It returns null when the session is awake and has nothing to say.
 * 2. **Listen-only mode** next, ahead of every per-turn state below, because
 *    those describe a conversation that is not happening. Without this,
 *    "hearing perfectly" and "capture is dead" look identical until the mode
 *    ends.
 * 3. Then the live turn states, then the last thing said, then connection
 *    status as the floor.
 */
export function resolveCaption(inputs: CaptionInputs): Caption {
  // No local default for the chord: main owns what is registered, and until
  // that snapshot arrives the caption says nothing about the keyboard rather
  // than naming a key it has not confirmed (wake-sleep-voice).
  const wake = wakeCaption({
    sidecarRunning: inputs.sidecarRunning,
    wakeWordEnabled: inputs.wakeWordEnabled,
    wakeFailed: inputs.wakeFailed,
    wakeHotkey: inputs.wakeHotkey,
  });
  if (wake) return wake;

  if (inputs.listenOnlyEngaged) {
    return inputs.heardLive
      ? { text: liveHeardCaption(inputs.heardLive), dim: false }
      : { text: "Listening — nothing heard yet…", dim: true };
  }

  if (inputs.audioState === "speaking") return { text: "Speaking…", dim: false };
  if (inputs.audioState === "listening") return { text: "Listening…", dim: false };
  if (inputs.working) return { text: "Working on it…", dim: false };
  if (inputs.lastTranscriptText) return { text: inputs.lastTranscriptText, dim: false };
  if (inputs.geminiStatus === "connected") return { text: "How can I help?", dim: true };
  return { text: "Connecting…", dim: true };
}

export type AudioDot = "off" | "warn" | "speaking" | "on";

/**
 * The audio indicator's state.
 *
 * `warn` covers two different situations on purpose — muted, and a session
 * that is up but idle — because both mean "your voice is not reaching Iris
 * right now", which is the one thing the dot exists to say.
 */
export function resolveAudioDot(input: {
  sidecarRunning: boolean;
  muted: boolean;
  audioState: string;
}): AudioDot {
  if (!input.sidecarRunning) return "off";
  if (input.muted) return "warn";
  if (input.audioState === "speaking") return "speaking";
  if (input.audioState === "idle") return "warn";
  return "on";
}

export type ReactorState = "idle" | "listenMode" | "speaking" | "listening" | "working" | "online";

/**
 * What the orb is expressing, in strict precedence order.
 *
 * The listen-only branch sits **above every per-turn state**, and that ordering
 * is the substance: the mode is a *condition*, not a turn, and a "speaking"
 * flash over it would announce a reply that reached nobody. Iris produces none
 * of those replies visibly anyway — they are discarded in main — so the mode is
 * the only thing the orb has to say while it is engaged.
 *
 * Everything is `idle` while the session is down: an orb reporting "listening"
 * with nothing running would be describing a session that does not exist.
 */
export function resolveReactorState(input: {
  running: boolean;
  listenOnlyEngaged: boolean;
  audioState: string;
  working: boolean;
  geminiStatus: string;
}): ReactorState {
  if (!input.running) return "idle";
  if (input.listenOnlyEngaged) return "listenMode";
  if (input.audioState === "speaking") return "speaking";
  if (input.audioState === "listening") return "listening";
  if (input.working) return "working";
  if (input.geminiStatus === "connected") return "online";
  return "idle";
}
