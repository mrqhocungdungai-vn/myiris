// Main → renderer event emission, transcript buffering, and the latest
// UI-state snapshot pushed back from the renderer. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — the
// window is received as an injected accessor rather than imported, so this
// module never touches Electron directly.
//
// Deliberately excludes the canvas-specific pieces of the original block
// (requestCanvasImage, maybeStartCanvasMcp, ensureCanvasMcpForRun,
// pendingCanvasImageRequests, canvasEngaged) — those stay in main.mjs until
// the capability tier (electron/capabilities/canvas.mjs) collects them; they
// don't belong in a bridge every module depends on.

// Bounds on the retained-utterance ring (design.md D8). A verbatim record of
// everything spoken near the microphone is not something to accumulate, so it is
// capped on BOTH axes: an idle session cannot let old speech linger, and a busy
// one cannot grow the ring without limit.
export const RECENT_UTTERANCE_LIMIT = 40;
export const RECENT_UTTERANCE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * @param {{
 *   getMainWindow: () => any,
 *   now?: () => number,
 *   isOverheard?: () => boolean,
 * }} deps
 */
export function createRendererBridge({
  getMainWindow,
  now = Date.now,
  // Whether what Iris is hearing right now is OVERHEARD rather than spoken to
  // her — true exactly while listen-only mode is engaged, when system audio is
  // mixed into the same stream. A line may then be the user, someone else in
  // the room, a remote participant, or a video, and nothing can separate them:
  // the two sources are summed in the renderer's worklet before anything
  // leaves the machine.
  //
  // One predicate decides two things that must never disagree — what the
  // screen calls the line, and whether it counts as the user's own words for
  // the purpose of feeding a run.
  isOverheard = () => false,
}) {
  let userTranscriptBuffer = "";
  let modelTranscriptBuffer = "";

  // The user's own words, kept past the display flush that used to discard them.
  //
  // Iris holds a verbatim transcript of what the user said (Gemini Live's
  // inputAudioTranscription) and, before this, used it only to draw text on
  // screen — everything that reached Claude went through Gemini's paraphrase.
  // This retains it so a caller can read what was actually said.
  //
  // Three constraints, stated here because they are the terms on which this
  // exists at all:
  //   - bounded by count AND age (see the constants above);
  //   - never persisted to disk;
  //   - UNTRUSTED INPUT. The microphone does not distinguish who is speaking
  //     near it, and being the user's own speech is not an exemption. Anything
  //     derived from this that reaches a model prompt must be fenced the same way
  //     spoken content already is (announcements.mjs's fenceUntrustedText).
  //
  // Nothing consumes this yet — the consumer is the companion change
  // (replace-roles-with-verb-tools).
  /** @type {Array<{ text: string, at: number }>} */
  let recentUtterances = [];

  function pruneUtterances(at) {
    const oldest = at - RECENT_UTTERANCE_MAX_AGE_MS;
    recentUtterances = recentUtterances.filter((entry) => entry.at >= oldest);
    if (recentUtterances.length > RECENT_UTTERANCE_LIMIT) {
      recentUtterances = recentUtterances.slice(-RECENT_UTTERANCE_LIMIT);
    }
  }

  // Latest UI-state snapshot pushed by the renderer over iris:ui-context
  // (throttled — see App.tsx). Read by the get_ui_context Gemini tool so voice
  // commands like "open that" or "show history" can resolve without blocking on
  // a renderer round-trip (design.md D1).
  let irisUiContext = {
    tasks: [],
    expandedTaskId: null,
    focusedTaskId: null,
    latestResultTaskId: null,
    pendingTaskMatches: [],
    showHistory: false,
    uiMode: "deck",
  };

  function emitToRenderer(channel, payload) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  }

  function emitEvent(event) {
    // DIAGNOSTIC: surface all events to the dev terminal (the renderer's log
    // list is not rendered, so fatal/connection errors were otherwise invisible).
    if (event?.type === "fatal") {
      console.error("[IRIS][fatal]", event.message || "", event.error || "");
    } else if (event?.type === "gemini_status" || event?.type === "sidecar_status") {
      console.log(`[IRIS][${event.type}]`, JSON.stringify(event.status ?? event));
    }
    emitToRenderer("sidecar:event", { timestamp: Date.now() / 1000, ...event });
  }

  function flushTranscripts() {
    if (userTranscriptBuffer.trim()) {
      const spoken = userTranscriptBuffer.trim();
      const overheard = isOverheard();
      // HEARD_SPEAKER in src/lib/transcript-speaker.ts is the renderer's
      // copy of this literal — the same cross-boundary duplication the IPC
      // channel names already carry between ipc.mjs and preload.cjs.
      emitEvent({ type: "transcript", speaker: overheard ? "heard" : "you", text: spoken });
      // Retained here, at the flush, rather than per fragment: a flush is one
      // complete utterance, whereas appendUserTranscript receives arbitrary
      // partial chunks that would fragment the record.
      //
      // Overheard speech is deliberately NOT retained into this ring. Every
      // consumer of it renders it as "what the user said recently" straight
      // into a run's prompt, so keeping it here would carry a video's words
      // into Claude labelled as the user's own instruction — the same false
      // attribution as on screen, one layer deeper and past the point where
      // the user could notice. The fence around it is real, but a fence is
      // mitigation for content that IS the user's; it is not a licence to
      // mislabel content that is not.
      //
      // Nothing is lost: while the mode is engaged, meeting retention owns
      // what Iris hears and writes all of it to inbox/meetings/, which is the
      // record a Claude verb is meant to read afterwards.
      if (!overheard) {
        const at = now();
        recentUtterances.push({ text: spoken, at });
        pruneUtterances(at);
      }
    }
    if (modelTranscriptBuffer.trim()) {
      emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
    }
    userTranscriptBuffer = "";
    modelTranscriptBuffer = "";
  }

  function appendUserTranscript(text) {
    userTranscriptBuffer += text;
  }

  function appendModelTranscript(text) {
    modelTranscriptBuffer += text;
  }

  /**
   * The retained utterances, newest last, already pruned by age. Returns copies
   * so a caller cannot mutate the ring.
   * @returns {Array<{ text: string, at: number }>}
   */
  function getRecentUtterances() {
    pruneUtterances(now());
    return recentUtterances.map((entry) => ({ ...entry }));
  }

  function getUiContext() {
    return irisUiContext;
  }

  function setUiContext(context) {
    irisUiContext = context;
  }

  return {
    emitToRenderer,
    emitEvent,
    flushTranscripts,
    appendUserTranscript,
    appendModelTranscript,
    getRecentUtterances,
    getUiContext,
    setUiContext,
  };
}
