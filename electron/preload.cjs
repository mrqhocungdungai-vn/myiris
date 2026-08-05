const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iris", {
  startSidecar: (options) => ipcRenderer.invoke("sidecar:start", options),
  stopSidecar: () => ipcRenderer.invoke("sidecar:stop"),
  getSidecarStatus: () => ipcRenderer.invoke("sidecar:status"),
  sendCommand: (command) => ipcRenderer.invoke("sidecar:command", command),
  getSessions: () => ipcRenderer.invoke("sessions:get"),
  selectSession: (id) => ipcRenderer.invoke("sessions:select", id),
  newSession: (label) => ipcRenderer.invoke("sessions:new", label),
  chooseProjectFolder: (id) => ipcRenderer.invoke("sessions:choose-cwd", id),
  listVerbs: (workstreamId) => ipcRenderer.invoke("verbs:list", workstreamId),
  getLegacyClaudeArtifacts: () => ipcRenderer.invoke("pipeline:legacy-artifacts"),
  removeLegacyClaudeArtifacts: () => ipcRenderer.invoke("pipeline:remove-legacy-artifacts"),
  setVerbModel: (workstreamId, verb, model) =>
    ipcRenderer.invoke("verbs:set-model", { workstreamId, verb, model }),
  answerPoQuestion: (answers) => ipcRenderer.invoke("po:answer-question", answers),
  getPromptStatus: () => ipcRenderer.invoke("prompt:status"),
  resolvePromptReview: (payload) => ipcRenderer.invoke("prompt:resolve-review", payload),
  setPromptReviewMode: (mode) => ipcRenderer.invoke("prompt:set-review-mode", { mode }),
  sendContextSupplement: (text) => ipcRenderer.invoke("context-supplement:send", text),
  toggleHud: () => ipcRenderer.invoke("hud:toggle"),
  setHudInteractive: (on) => ipcRenderer.send("hud:interactive", Boolean(on)),
  activateDrawingCanvas: () => ipcRenderer.send("canvas:activate"),
  saveCanvasScene: (scene) => ipcRenderer.send("canvas:scene", scene),
  getCanvasScene: () => ipcRenderer.invoke("canvas:get-scene"),
  // canvas-claude-mcp (design.md D3/4.1): main→renderer apply of an
  // externally-originated (Claude) write, and the image-export request/reply
  // pair backing get_canvas({ includeImage: true }). Both only matter while
  // DrawingCanvas is mounted — it registers/tears these down in its own
  // effect, mirroring the on/off pattern of the other subscriptions below.
  onCanvasApply: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("canvas:apply", handler);
    return () => ipcRenderer.removeListener("canvas:apply", handler);
  },
  onCanvasImageRequest: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("canvas:request-image", handler);
    return () => ipcRenderer.removeListener("canvas:request-image", handler);
  },
  replyCanvasImage: (id, image) => ipcRenderer.send("canvas:image-result", { id, image }),
  nativeOpenCanvasFile: () => ipcRenderer.invoke("canvas:native-open-file"),
  nativeSaveCanvasFile: (content, suggestedName) =>
    ipcRenderer.invoke("canvas:native-save-file", { content, suggestedName }),
  nativeExportCanvasImage: (data, format, suggestedName) =>
    ipcRenderer.invoke("canvas:native-export-image", { data, format, suggestedName }),
  windowControl: (action) => ipcRenderer.send("win:control", action),
  onHudMode: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("hud:mode", handler);
    return () => ipcRenderer.removeListener("hud:mode", handler);
  },
  onWakeRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:wake", handler);
    return () => ipcRenderer.removeListener("iris:wake", handler);
  },
  // Listen-only mode (replace-listening-mode-with-listen-only design.md D3):
  // a toggle request and a boot/reload query — no report-back channel. Main
  // pushes state changes one-way over "listen-only:state"; the renderer
  // never asserts the value.
  requestListenOnlyToggle: () => ipcRenderer.send("listen-only:toggle-request"),
  getListenOnlyState: () => ipcRenderer.invoke("listen-only:query"),
  onListenOnlyState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("listen-only:state", handler);
    return () => ipcRenderer.removeListener("listen-only:state", handler);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (updates) => ipcRenderer.invoke("config:save", updates),
  savePoToken: (token, key) => ipcRenderer.invoke("config:save-po-token", { token, key }),
  removePoToken: (key) => ipcRenderer.invoke("config:remove-po-token", { key }),
  testGemini: (key) => ipcRenderer.invoke("config:test-gemini", { key }),
  testClaude: () => ipcRenderer.invoke("config:test-claude"),
  getPipelineStatus: () => ipcRenderer.invoke("pipeline:status"),
  previewVoice: (payload) => ipcRenderer.invoke("config:preview-voice", payload),
  sendUiContext: (context) => ipcRenderer.send("iris:ui-context", context),
  notifyBootDone: () => ipcRenderer.send("iris:boot-done"),
  onUiAction: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("iris:ui-action", handler);
    return () => ipcRenderer.removeListener("iris:ui-action", handler);
  },
  onSleepRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:sleep", handler);
    return () => ipcRenderer.removeListener("iris:sleep", handler);
  },
  sendAudioChunk: (chunk) => ipcRenderer.send("live:audio", chunk),
  onAudioChunk: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:audio", handler);
    return () => ipcRenderer.removeListener("live:audio", handler);
  },
  onAudioInterrupt: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:interrupt", handler);
    return () => ipcRenderer.removeListener("live:interrupt", handler);
  },
  onSidecarEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("sidecar:event", handler);
    return () => ipcRenderer.removeListener("sidecar:event", handler);
  },
  // second-brain-galaxy-view (design.md D3/D7/D8): availability's live push
  // half rides onSidecarEvent above (secondbrain_availability) — this is
  // just the boot-time/HUD-open pull. getSecondBrainGraph always triggers a
  // fresh main-process scan. activate/deactivateSecondBrain start/stop the
  // vault fs.watch exactly on galaxy toggle-on/off (design.md D3 M-2) — the
  // galaxy layer's mount/unmount effect calls these.
  getSecondBrainAvailability: () => ipcRenderer.invoke("secondbrain:availability"),
  getSecondBrainGraph: () => ipcRenderer.invoke("secondbrain:get-graph"),
  readSecondBrainNote: (id) => ipcRenderer.invoke("secondbrain:read-note", id),
  activateSecondBrain: () => ipcRenderer.send("secondbrain:activate"),
  deactivateSecondBrain: () => ipcRenderer.send("secondbrain:deactivate"),
  onSecondBrainGraphUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("secondbrain:graph-updated", handler);
    return () => ipcRenderer.removeListener("secondbrain:graph-updated", handler);
  },
  // open-note-session: the renderer reports open/close from the note
  // reader's existing lifecycle — main is the single authority on which note
  // is open.
  reportNoteOpened: (id) => ipcRenderer.send("secondbrain:note-opened", id),
  reportNoteClosed: () => ipcRenderer.send("secondbrain:note-closed"),
  // second-brain-focus: toggles one node's membership in the shared focus —
  // the hand's tap and a mouse click both call this the same way.
  toggleSecondBrainFocus: (id) => ipcRenderer.invoke("secondbrain:set-focus", id),
  getSecondBrainFocus: () => ipcRenderer.invoke("secondbrain:get-focus"),
  clearSecondBrainFocus: () => ipcRenderer.invoke("secondbrain:clear-focus"),
  // ambient-memory: a one-way send (main is the sole authority on whether
  // retention is actually live — design D1), plus a boot-time pull and a
  // push for every later live/not-live transition.
  setAmbientCaptureEnabled: (enabled) => ipcRenderer.send("ambient-capture:set-enabled", { enabled }),
  getAmbientCaptureState: () => ipcRenderer.invoke("ambient-capture:query"),
  onAmbientCaptureState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ambient-capture:state", handler);
    return () => ipcRenderer.removeListener("ambient-capture:state", handler);
  },
});
