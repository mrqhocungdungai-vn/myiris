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
 *   recordLog?: (record: { level: string, src: string, msg: string, [key: string]: any }) => void,
 * }} deps
 */
export function createRendererBridge({
  getMainWindow,
  now = Date.now,
  // The diagnostic log's tap on the event stream (diagnostic-logging D8).
  // Defaulted to a no-op so this module stays independently constructible and
  // every existing test of it needs no sink.
  recordLog = () => {},
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
  // Whether what is currently accumulating was OVERHEARD — see
  // appendUserTranscript. Cleared with the buffer it describes.
  let userTranscriptOverheard = false;

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
  // When the most recent listening window ended; 0 until one has.
  let listenWindowEndedAt = 0;

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
    // The diagnostic log gets EVERY event, whatever its type — the file is an
    // investigation, and what mattered cannot be decided before the failure it
    // has to explain (diagnostic-logging D7). `{type:"log"}` events carry their
    // own level; anything else is a status transition, which is info.
    const { type, level, message, ...rest } = event ?? {};
    recordLog({
      level: type === "fatal" ? "error" : String(level ?? "info"),
      src: "event",
      msg: String(message ?? type ?? ""),
      type,
      ...rest,
    });

    // DIAGNOSTIC: a narrow selection to the dev terminal. Deliberately still
    // narrow after camera-activity-log gave the renderer's log list somewhere
    // to go and diagnostic-logging gave every event a file — the terminal is
    // the one destination where volume costs something.
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
      // Read from the BUFFER, not from the mode's current state. The two are
      // not the same moment: an utterance closes 1.5s after the last fragment,
      // so the tail of every engagement flushes AFTER the user has already
      // disengaged — and reading the live flag there labelled a video's words
      // as the user's own. Provenance belongs to the content, not to the
      // instant it happens to be written out.
      const overheard = userTranscriptOverheard;

      // Overheard speech does not reach the conversation panel AT ALL, neither
      // as the user's words nor as anything else. That panel is a conversation
      // between the user and Iris; overheard speech is not that, and it is held
      // at 40 lines (App.tsx), so a few minutes of narration would evict the
      // whole real conversation to show a transcript nobody asked for.
      //
      // What the panel gets instead is ONE entry when the mode ends, stating how
      // long Iris listened (announceListenedFor in live-session.mjs). That entry
      // is what the user points at when they ask her about what she heard; she
      // answers from the voice session's own audio context, which still holds
      // the whole engagement, since the window that bounds it is minutes long.
      //
      // It is also kept out of the recent-utterance ring below. Every consumer
      // of that ring renders it into a run's prompt as "what the user said
      // recently", so keeping it would carry a video's words to Claude labelled
      // as the user's own instruction — the same false attribution, one layer
      // deeper and past where the user could notice, and the ring outlives the
      // mode by up to ten minutes. Fencing it as untrusted is real mitigation
      // for content that IS the user's; it is not a licence to mislabel content
      // that is not.
      if (!overheard) {
        emitEvent({ type: "transcript", speaker: "you", text: spoken });
        // Retained at the flush rather than per fragment: a flush is one
        // complete utterance, whereas appendUserTranscript receives arbitrary
        // partial chunks that would fragment the record.
        const at = now();
        recentUtterances.push({ text: spoken, at });
        pruneUtterances(at);
      }
    }
    if (modelTranscriptBuffer.trim()) {
      emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
    }
    userTranscriptBuffer = "";
    userTranscriptOverheard = false;
    modelTranscriptBuffer = "";
  }

  function appendUserTranscript(text) {
    // Sticky for the life of the buffer, and set the moment the text ARRIVES:
    // this is the only point at which the mode's state and the content's
    // origin are the same fact. Once true it stays true, so an utterance that
    // straddles the disengage is treated as overheard — the safe direction,
    // since the cost of withholding one line of the user's own speech is
    // nothing, and the cost of publishing a video's words as theirs is the bug
    // this exists to prevent.
    if (isOverheard()) userTranscriptOverheard = true;
    userTranscriptBuffer += text;
    // A LIVE readout of what Iris is hearing right now, for the caption under
    // the orb — deliberately not the conversation, and deliberately not
    // history: it is emitted per fragment, replaces itself, and is never
    // retained anywhere.
    //
    // It exists because without it "hearing perfectly" and "capture is dead"
    // look identical until the mode ends, and the user finds out only by
    // asking Claude to read a record that turned out to be empty. That is the
    // wrong moment to learn it. Silence here is now a visible fact rather than
    // an absence.
    if (userTranscriptOverheard) {
      emitEvent({ type: "heard_live", text: userTranscriptBuffer.trim() });
    }
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

  /**
   * Stamp the end of a listening window. Speech from before it is not the
   * conversation a later request came from — the user talked about one thing,
   * Iris listened to a room discussing another, and the ring holds ten minutes,
   * so without this the older topic is still attached and reads as context.
   *
   * An explicit setter rather than an inferred edge: an engagement during which
   * NOTHING was heard produces no transcript edge to notice, and that is exactly
   * the case where the stale block misleads most.
   */
  function markListenWindowEnded() {
    listenWindowEndedAt = now();
  }

  /** @returns {number} 0 when no listening window has ever ended. */
  function getListenWindowEndedAt() {
    return listenWindowEndedAt;
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
    markListenWindowEnded,
    getListenWindowEndedAt,
    getUiContext,
    setUiContext,
  };
}
