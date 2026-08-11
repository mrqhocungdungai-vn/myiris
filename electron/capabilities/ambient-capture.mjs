import { createSessionCapture } from "../session-capture.mjs";
import { ambientCaptureForcedOff } from "../worker-env.mjs";

// Ambient session capture, on its own.
//
// Extracted from second-brain.mjs because every one of its four state
// variables and seven functions is used only here — the surrounding capability
// touches it only through the handful of entry points this factory returns. It
// is a self-contained little machine with one job: decide whether retention is
// LIVE right now, and act exactly on the transitions.
//
// The dependencies are injected rather than imported so the gates can be driven
// directly in a test: `isListenOnlyEngaged` and `recentUtterances` both change
// under the caller's feet at runtime, and `ambientCaptureForcedOff` is an env
// escape hatch.

/**
 * @param {{
 *   sessionsDir: string,
 *   flushIntervalMs: number,
 *   recentUtterances: () => Array<{ text: string, at: number }>,
 *   isListenOnlyEngaged: () => boolean,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   forcedOff?: () => boolean,
 * }} deps
 */
export function createAmbientCapture({
  sessionsDir,
  flushIntervalMs,
  recentUtterances,
  isListenOnlyEngaged,
  emitEvent,
  emitToRenderer,
  forcedOff = ambientCaptureForcedOff,
}) {
// Ambient session capture (ambient-memory): the opt-in retention of
// conversation text into sessionsDir. Two independent gates decide
// whether it is actually LIVE right now — the user's persisted preference
// (renderer -> ambient-capture:set-enabled) and whether Iris is awake and
// listening (main's own onAwake/onAsleep hooks, wired from the live
// session) — and either one being false means nothing is retained (design
// D1/spec "Capture follows the microphone and stops with it"). `sessionCapture`
// itself starts disabled (D1) and is the single thing that ever writes.
const sessionCapture = createSessionCapture();
let ambientPreferenceEnabled = false;
let ambientAwake = false;
let ambientFlushTimer = null;

function ambientCaptureLive() {
  // Ambient capture stands aside for the whole span listen-only mode is
  // engaged (ambient-session-capture). The reason is the CONSENT, not a
  // competing writer: this preference is consent to retain the user's own
  // conversations with Iris, and while that mode is engaged what she hears
  // widens to whatever the machine is playing — remote participants, a video,
  // people who never agreed to anything. That span is now retained by nobody,
  // which is the correct outcome and not a gap. Going not-live flushes what
  // accumulated, and coming back live re-enables with a fresh watermark, so
  // the span is neither duplicated nor back-filled.
  return ambientPreferenceEnabled && ambientAwake && !isListenOnlyEngaged() && !forcedOff();
}

async function flushAmbientCapture() {
  return sessionCapture.flush({
    utterances: recentUtterances(),
    dir: sessionsDir,
    onError: (error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not flush the ambient session capture: ${error.message}` });
    },
  });
}

function startAmbientFlushTimer() {
  if (ambientFlushTimer) return;
  ambientFlushTimer = setInterval(() => {
    flushAmbientCapture();
  }, flushIntervalMs);
  ambientFlushTimer.unref?.();
}

function stopAmbientFlushTimer() {
  if (!ambientFlushTimer) return;
  clearInterval(ambientFlushTimer);
  ambientFlushTimer = null;
}

// The single mutation point for the live/not-live transition (mirrors
// probeSecondBrainAvailability's shape above): acts only on a real flip, so
// repeated calls with the same inputs — the renderer re-sending its
// preference, a second onAwake while already awake — cost nothing and, more
// importantly, never reset the watermark or re-flush needlessly. Turning
// live OFF flushes what accumulated under the consent already given, before
// disabling (spec "Sleep stops retention... what accumulated is flushed
// rather than dropped" / "Disabling stops retention immediately").
async function syncAmbientCaptureState() {
  const live = ambientCaptureLive();
  if (live === sessionCapture.isEnabled()) return;
  if (live) {
    sessionCapture.enable(Date.now());
    startAmbientFlushTimer();
  } else {
    stopAmbientFlushTimer();
    await flushAmbientCapture();
    sessionCapture.disable();
  }
  emitToRenderer("ambient-capture:state", { live });
}

/** Called on the renderer's persisted-preference message (ambient-capture:set-enabled). */
function setAmbientCapturePreference(enabled) {
  ambientPreferenceEnabled = Boolean(enabled);
  return syncAmbientCaptureState();
}

/** Called from the live session's own wake/sleep hooks — never by the renderer directly. */
function setAmbientCaptureAwake(awake) {
  ambientAwake = Boolean(awake);
  return syncAmbientCaptureState();
}

  // The two IPC channels that belong to this domain, declared here so the
  // handler and the state it touches cannot drift apart.
  /** @type {Array<{ channel: string, kind: "handle" | "on", fn: Function }>} */
  const ipcHandlers = [
    // Ambient session capture (ambient-memory): the renderer's persisted
    // preference (localStorage, same as its sibling toggles) is the only way
    // this ever turns on — main defaults to off and stays off until this
    // arrives (design D1). Fire-and-forget from the renderer's point of view;
    // the live/not-live result reaches it over "ambient-capture:state".
    {
      channel: "ambient-capture:set-enabled",
      kind: "on",
      fn: (_event, payload) => {
        setAmbientCapturePreference(Boolean(payload?.enabled));
      },
    },
    // Boot-time/HUD-open pull, mirroring listen-only:query — the renderer's
    // indicator needs the current state on mount, before any transition has
    // fired the push above.
    {
      channel: "ambient-capture:query",
      kind: "handle",
      fn: () => ({ enabled: ambientPreferenceEnabled, live: ambientCaptureLive(), forcedOff: forcedOff() }),
    },
  ];

  /** Everything the capability needs; nothing else escapes. */
  return {
    ipcHandlers,
    isLive: ambientCaptureLive,
    isPreferenceEnabled: () => ambientPreferenceEnabled,
    setPreference: setAmbientCapturePreference,
    setAwake: setAmbientCaptureAwake,
    sync: syncAmbientCaptureState,
    flush: flushAmbientCapture,
    stopTimer: stopAmbientFlushTimer,
    // Reported to the renderer so the indicator can say WHY it is off.
    isForcedOff: forcedOff,
  };
}
