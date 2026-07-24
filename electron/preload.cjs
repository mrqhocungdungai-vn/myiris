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
  listAgents: (workstreamId) => ipcRenderer.invoke("agents:list", workstreamId),
  selectAgent: (workstreamId, agent) => ipcRenderer.invoke("agents:select", { workstreamId, agent }),
  installAgents: () => ipcRenderer.invoke("agents:install"),
  installPipelinePrereqs: () => ipcRenderer.invoke("pipeline:install-prereqs"),
  setAgentModel: (workstreamId, role, model) =>
    ipcRenderer.invoke("agents:set-model", { workstreamId, role, model }),
  answerPoQuestion: (answers) => ipcRenderer.invoke("po:answer-question", answers),
  getPromptStatus: () => ipcRenderer.invoke("prompt:status"),
  resolvePromptReview: (payload) => ipcRenderer.invoke("prompt:resolve-review", payload),
  setPromptReviewMode: (enabled) => ipcRenderer.invoke("prompt:set-review-mode", { enabled }),
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
  onMuteToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:mute-toggle", handler);
    return () => ipcRenderer.removeListener("iris:mute-toggle", handler);
  },
  reportSpeakerMute: (muted) => ipcRenderer.send("iris:speaker-mute-state", Boolean(muted)),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (updates) => ipcRenderer.invoke("config:save", updates),
  savePoToken: (token) => ipcRenderer.invoke("config:save-po-token", { token }),
  removePoToken: () => ipcRenderer.invoke("config:remove-po-token"),
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
});
