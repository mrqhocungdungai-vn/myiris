// The renderer↔main IPC channel surface. Split out of electron/main.mjs
// (split-main-process-modules design.md D3) — every ipcMain.handle/on
// registration, and only those, live here. This module marshals arguments
// and delegates to the domain modules constructed in main.mjs's wiring
// block; it holds no logic of its own. One of the four modules permitted to
// import Electron directly.
//
// Diffable against electron/preload.cjs's window.iris surface (design.md
// D3): every channel name here should have a matching preload call, and
// vice versa.
//
// Capability composition (design.md D10): core channels are registered
// directly below; each registered capability's own ipcHandlers (see the
// capability contract in gemini-tools.mjs's header comment) are then
// registered by iteration, never by name — so a capability-specific channel
// is never hardcoded here.
import electron from "electron";

const { ipcMain } = electron;

/**
 * @param {{
 *   getMainWindow: () => any,
 *   getUiMode: () => string,
 *   toggleHud: () => void,
 *   updateTrayMenu: () => void,
 *   startLive: () => any,
 *   stopLive: () => any,
 *   getLiveStatus: () => any,
 *   greetGateFire: () => void,
 *   notifyWakeReady: () => void,
 *   toggleListenOnly: () => void,
 *   isListenOnlyEngaged: () => boolean,
 *   listenOnlyStatePayload?: () => any,
 *   handleSystemAudioUnavailable?: (reason: string) => void,
 *   sendCommand: (command: any) => any,
 *   sendAudioChunk: (chunk: any) => void,
 *   sessionsSnapshot: () => any,
 *   selectWorkstream: (id: string) => any,
 *   createWorkstream: (label: any) => any,
 *   chooseWorkstreamCwd: (id: string) => any,
 *   verbsSnapshot: (id: string) => any,
 *   setVerbModel: (workstreamId: string, verb: any, model: any) => any,
 *   legacyClaudeArtifactsStatus: () => any,
 *   removeLegacyClaudeArtifacts: () => any,
 *   resolvePendingPoQuestion: (answers: any) => any,
 *   getPromptReviewMode: () => string,
 *   setPromptReviewMode: (mode: string) => any,
 *   resolvePromptReview: (payload: any) => any,
 *   sendContextSupplement: (text: any) => any,
 *   getFullConfig: () => any,
 *   writeUserConfig: (updates: any) => any,
 *   savePoToken: (token: any, opts?: any) => any,
 *   testGeminiKey: (key: any) => any,
 *   previewVoice: (payload: any) => any,
 *   checkClaudeHealth: () => any,
 *   getPipelineAvailable: () => boolean,
 *   setUiContextSnapshot: (context: any) => void,
 *   capabilities?: Array<{ ipcHandlers?: Array<{ channel: string, kind: "handle"|"on", fn: Function }> }>,
 * }} deps
 */
export function registerIpc(deps) {
  const {
    getMainWindow,
    getUiMode,
    toggleHud,
    updateTrayMenu,
    startLive,
    stopLive,
    getLiveStatus,
    greetGateFire,
    notifyWakeReady,
    toggleListenOnly,
    isListenOnlyEngaged,
    listenOnlyStatePayload,
    handleSystemAudioUnavailable,
    sendCommand,
    sendAudioChunk,
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    verbsSnapshot,
    setVerbModel,
    legacyClaudeArtifactsStatus,
    removeLegacyClaudeArtifacts,
    resolvePendingPoQuestion,
    getPromptReviewMode,
    setPromptReviewMode,
    resolvePromptReview,
    sendContextSupplement,
    getFullConfig,
    writeUserConfig,
    savePoToken,
    testGeminiKey,
    previewVoice,
    checkClaudeHealth,
    getPipelineAvailable,
    setUiContextSnapshot,
    capabilities = [],
  } = deps;

  ipcMain.handle("sidecar:start", () => startLive());
  ipcMain.handle("sidecar:stop", () => stopLive());
  ipcMain.handle("sidecar:status", () => getLiveStatus());
  // Listen-only mode's narrow bridge (design.md D3): a toggle request, and a
  // query for boot/reload — no report-back channel. State pushes to the
  // renderer one-way over "listen-only:state" from setListenOnlyEngaged,
  // never the reverse.
  ipcMain.on("listen-only:toggle-request", () => toggleListenOnly());
  // The query answers with the same payload the push carries — mode state plus
  // the resolved system-audio configuration (listen-mode-hears-system-audio
  // 1.3) — so a renderer seeded on mount and a renderer updated by a push are
  // configured identically, and neither ever attempts a capture the main-side
  // escape hatch has disabled.
  ipcMain.handle("listen-only:query", () =>
    listenOnlyStatePayload ? listenOnlyStatePayload() : { engaged: isListenOnlyEngaged() },
  );
  // A capture the renderer could not acquire at all. Main decides what that
  // means for the mode; this only carries the fact across (D4).
  ipcMain.on("listen-only:system-audio-unavailable", (_event, payload) => {
    handleSystemAudioUnavailable?.(String(payload?.reason ?? ""));
  });
  ipcMain.handle("sidecar:command", (_event, command) => sendCommand(command));
  ipcMain.handle("sessions:get", () => sessionsSnapshot());
  ipcMain.handle("sessions:select", (_event, id) => selectWorkstream(String(id || "")));
  ipcMain.handle("sessions:new", (_event, label) => {
    const workstream = createWorkstream(label);
    return { status: "ok", session: { id: workstream.id, label: workstream.label }, ...sessionsSnapshot() };
  });
  ipcMain.handle("sessions:choose-cwd", (_event, id) => chooseWorkstreamCwd(String(id || "")));
  // The verb roster is now a DISPLAY surface, not a control: there is no
  // `verbs:select` counterpart to the old `agents:select`, because there is no
  // current verb to select. One is chosen per request, by Iris, from what the
  // user said and what the project looks like.
  ipcMain.handle("verbs:list", (_event, id) => verbsSnapshot(String(id || "")));
  // Iris installs nothing into ~/.claude any more; these only report and, on
  // explicit user action, remove what an older version left there.
  ipcMain.handle("pipeline:legacy-artifacts", () => legacyClaudeArtifactsStatus());
  ipcMain.handle("pipeline:remove-legacy-artifacts", () => removeLegacyClaudeArtifacts());
  ipcMain.handle("verbs:set-model", (_event, payload) =>
    setVerbModel(String(payload?.workstreamId || ""), payload?.verb, payload?.model));
  // Secondary answer path for a pending AskUserQuestion — lets a sighted user
  // click an option directly instead of answering by voice. Whichever path
  // (this, or the Gemini answer_claude_question tool) answers first wins; the
  // other becomes a no-op since the question is already resolved.
  ipcMain.handle("po:answer-question", (_event, answers) => resolvePendingPoQuestion(answers));
  // Renderer's boot-time read of the review-gate mode (see setPromptReviewMode
  // above) plus the UI's Approve/Edit/Cancel and mode-toggle paths. Only
  // Approve/Edit/Cancel have a voice counterpart (respond_to_task_review) —
  // the mode toggle below is UI-only, never model-writable — mirroring the
  // po:answer-question pattern for whichever channel resolves first.
  ipcMain.handle("prompt:status", () => ({ reviewMode: getPromptReviewMode() }));
  ipcMain.handle("prompt:resolve-review", (_event, payload) => resolvePromptReview(payload));
  ipcMain.handle("prompt:set-review-mode", (_event, payload) => setPromptReviewMode(payload?.mode));
  ipcMain.handle("context-supplement:send", (_event, text) => sendContextSupplement(text));
  ipcMain.handle("hud:toggle", () => {
    toggleHud();
    updateTrayMenu();
    return { mode: getUiMode() };
  });
  ipcMain.on("hud:interactive", (_event, on) => {
    const win = getMainWindow();
    if (win && getUiMode() === "hud") {
      win.setIgnoreMouseEvents(!on, { forward: true });
    }
  });
  ipcMain.on("win:control", (_event, action) => {
    const win = getMainWindow();
    if (!win) return;
    if (action === "close") win.close();
    else if (action === "minimize") win.minimize();
  });
  ipcMain.handle("config:get", () => getFullConfig());
  ipcMain.handle("config:save", (_event, updates) => writeUserConfig(updates));
  // `key` selects which Claude credential is being written — the subscription
  // token or the metered API key. Defaulted in savePoToken, which also rejects
  // any key that is not one of those two.
  ipcMain.handle("config:save-po-token", (_event, payload) =>
    savePoToken(payload?.token, payload?.key ? { key: payload.key } : {}),
  );
  ipcMain.handle("config:remove-po-token", (_event, payload) =>
    savePoToken("", { remove: true, ...(payload?.key ? { key: payload.key } : {}) }),
  );
  ipcMain.handle("config:test-gemini", (_event, payload) => testGeminiKey(payload?.key));
  ipcMain.handle("config:test-claude", () => checkClaudeHealth());
  // Renderer's boot-time read of the pipeline master switch (see design.md
  // decision 1/3) — cached, synchronous-feeling; live updates arrive over the
  // pipeline_availability sidecar event emitted whenever the value flips.
  ipcMain.handle("pipeline:status", () => ({ available: getPipelineAvailable() }));
  ipcMain.handle("config:preview-voice", (_event, payload) => previewVoice(payload || {}));
  ipcMain.on("iris:boot-done", () => greetGateFire());
  // The renderer announcing that it has subscribed to iris:wake. Main holds a
  // wake requested while no window existed and flushes it here, so the global
  // wake hotkey works with the deck closed (wake-sleep-voice).
  ipcMain.on("iris:wake-ready", () => notifyWakeReady());
  ipcMain.on("iris:ui-context", (_event, context) => {
    if (context && typeof context === "object") {
      setUiContextSnapshot(context);
    }
  });
  ipcMain.on("live:audio", (_event, chunk) => sendAudioChunk(chunk));

  // Capability composition (design.md D10): each registered capability's own
  // channels, registered by iteration — never by name, so a capability's
  // channel set never needs a matching edit here.
  for (const cap of capabilities) {
    for (const { channel, kind, fn } of cap.ipcHandlers || []) {
      ipcMain[kind](channel, /** @type {any} */ (fn));
    }
  }
}
