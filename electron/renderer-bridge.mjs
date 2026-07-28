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

/** @param {{ getMainWindow: () => any }} deps */
export function createRendererBridge({ getMainWindow }) {
  let userTranscriptBuffer = "";
  let modelTranscriptBuffer = "";

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
      emitEvent({ type: "transcript", speaker: "you", text: userTranscriptBuffer.trim() });
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
    getUiContext,
    setUiContext,
  };
}
