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
import electron from "electron";
import fs from "node:fs";
import path from "node:path";

const { ipcMain, dialog } = electron;

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
 *   setSpeakerMuted: (muted: boolean) => void,
 *   toggleListenMode: () => void,
 *   isListenModeEngaged: () => boolean,
 *   sendCommand: (command: any) => any,
 *   sendAudioChunk: (chunk: any) => void,
 *   sessionsSnapshot: () => any,
 *   selectWorkstream: (id: string) => any,
 *   createWorkstream: (label: any) => any,
 *   chooseWorkstreamCwd: (id: string) => any,
 *   agentsSnapshot: (id: string) => any,
 *   setWorkstreamAgent: (workstreamId: string, agent: any) => any,
 *   setAgentModel: (workstreamId: string, role: any, model: any) => any,
 *   installIrisAgents: () => any,
 *   installPipelinePrereqs: () => any,
 *   resolvePendingPoQuestion: (answers: any) => any,
 *   getPromptReviewMode: () => boolean,
 *   setPromptReviewMode: (enabled: boolean) => any,
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
 *   markCanvasEngaged: () => void,
 *   maybeStartCanvasMcp: () => void,
 *   resolveCanvasImageRequest: (id: any, image: any) => void,
 *   canvasStore: { getScene: () => any, setScene: (scene: any) => void },
 *   probeSecondBrainAvailability: () => boolean,
 *   notesVaultGraph: { start: () => void, stop: () => void, getGraph: () => Promise<any>, resolveNotePath: (id: string) => string | null },
 *   notesVaultDir: string,
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
    setSpeakerMuted,
    toggleListenMode,
    isListenModeEngaged,
    sendCommand,
    sendAudioChunk,
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    agentsSnapshot,
    setWorkstreamAgent,
    setAgentModel,
    installIrisAgents,
    installPipelinePrereqs,
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
    markCanvasEngaged,
    maybeStartCanvasMcp,
    resolveCanvasImageRequest,
    canvasStore,
    probeSecondBrainAvailability,
    notesVaultGraph,
    notesVaultDir,
  } = deps;

  ipcMain.handle("sidecar:start", () => startLive());
  ipcMain.handle("sidecar:stop", () => stopLive());
  ipcMain.handle("sidecar:status", () => getLiveStatus());
  // Listening mode's narrow bridge (design.md Decision 11): a toggle
  // request, and a query for boot/reload — no report-back channel. State
  // pushes to the renderer one-way over "listen-mode:state" from
  // setListenEngaged, never the reverse.
  ipcMain.on("listen-mode:toggle-request", () => toggleListenMode());
  ipcMain.handle("listen-mode:query", () => ({ engaged: isListenModeEngaged() }));
  ipcMain.handle("sidecar:command", (_event, command) => sendCommand(command));
  ipcMain.handle("sessions:get", () => sessionsSnapshot());
  ipcMain.handle("sessions:select", (_event, id) => selectWorkstream(String(id || "")));
  ipcMain.handle("sessions:new", (_event, label) => {
    const workstream = createWorkstream(label);
    return { status: "ok", session: { id: workstream.id, label: workstream.label }, ...sessionsSnapshot() };
  });
  ipcMain.handle("sessions:choose-cwd", (_event, id) => chooseWorkstreamCwd(String(id || "")));
  ipcMain.handle("agents:list", (_event, id) => agentsSnapshot(String(id || "")));
  ipcMain.handle("agents:select", (_event, payload) =>
    setWorkstreamAgent(String(payload?.workstreamId || ""), payload?.agent ?? null));
  ipcMain.handle("agents:install", () => installIrisAgents());
  ipcMain.handle("pipeline:install-prereqs", () => installPipelinePrereqs());
  ipcMain.handle("agents:set-model", (_event, payload) =>
    setAgentModel(String(payload?.workstreamId || ""), payload?.role, payload?.model));
  // Secondary answer path for the PO's pending AskUserQuestion — lets a
  // sighted user click an option directly instead of answering by voice.
  // Whichever path (this, or the Gemini answer_po_question tool) answers
  // first wins; the other becomes a no-op since the question is already resolved.
  ipcMain.handle("po:answer-question", (_event, answers) => resolvePendingPoQuestion(answers));
  // Renderer's boot-time read of the review-gate mode (see setPromptReviewMode
  // above) plus the UI's Approve/Edit/Cancel and mode-toggle paths. Only
  // Approve/Edit/Cancel have a voice counterpart (respond_to_task_review) —
  // the mode toggle below is UI-only, never model-writable — mirroring the
  // po:answer-question pattern for whichever channel resolves first.
  ipcMain.handle("prompt:status", () => ({ reviewMode: getPromptReviewMode() }));
  ipcMain.handle("prompt:resolve-review", (_event, payload) => resolvePromptReview(payload));
  ipcMain.handle("prompt:set-review-mode", (_event, payload) => setPromptReviewMode(Boolean(payload?.enabled)));
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
  // Drawing panel activation (hud-drawing-canvas design.md D4): the HUD
  // window is transparent/frameless/always-on-top, which on macOS commonly
  // does not receive key events without an explicit focus() — needed for
  // excalidraw's text tool, Delete, and tool shortcuts.
  ipcMain.on("canvas:activate", () => {
    getMainWindow()?.focus();
    // First-open signal for canvas-claude-mcp's sticky canvasEngaged gate
    // (design.md D6) — a no-op on every subsequent open/close of the panel.
    markCanvasEngaged();
    maybeStartCanvasMcp();
  });
  // Reply half of the main→renderer image-export request (design.md D3);
  // resolves the pending promise requestCanvasImage() created, if it hasn't
  // already been cleaned up by its own timeout.
  ipcMain.on("canvas:image-result", (_event, payload) => {
    resolveCanvasImageRequest(payload?.id, payload?.image);
  });
  // Scene-access seam (design.md D5): the in-memory cache updates
  // immediately on every push so `canvas:get-scene` is never behind the
  // debounced disk write; that debounced write is the only async part.
  ipcMain.on("canvas:scene", (_event, scene) => {
    if (scene && typeof scene === "object") canvasStore.setScene(scene);
  });
  ipcMain.handle("canvas:get-scene", () => canvasStore.getScene());
  // Native file-dialog fallback (design.md D5a) for when the renderer's File
  // System Access path is unavailable under file:// — feeds excalidraw's
  // own loadFromBlob / serializeAsJSON / exportToBlob on the renderer side.
  ipcMain.handle("canvas:native-open-file", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "Open drawing",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const content = fs.readFileSync(result.filePaths[0], "utf8");
    return { canceled: false, content };
  });
  ipcMain.handle("canvas:native-save-file", async (_event, payload) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: "Save drawing",
      defaultPath: payload?.suggestedName || "drawing.excalidraw",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, String(payload?.content ?? ""), "utf8");
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("canvas:native-export-image", async (_event, payload) => {
    const format = payload?.format === "svg" ? "svg" : "png";
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: "Export image",
      defaultPath: payload?.suggestedName || `drawing.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    // SVG exports as raw markup text; PNG as a base64 payload (no data: URL prefix).
    if (format === "svg") fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "utf8");
    else fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "base64");
    return { canceled: false, filePath: result.filePath };
  });
  // Second-brain galaxy view (second-brain-galaxy-view design.md D3/D7/D8):
  // renderer's boot-time/HUD-open availability pull — the live push half of
  // this rides the existing sidecar:event stream (secondbrain_availability),
  // not a new dedicated channel (design.md D7, L2).
  ipcMain.handle("secondbrain:availability", () => ({ available: probeSecondBrainAvailability() }));
  // Always a fresh scan (design.md D3) — re-checks availability inline so a
  // vault that vanished between the toggle showing and being clicked is
  // caught here too, not just on the next HUD-open re-check.
  ipcMain.handle("secondbrain:get-graph", async () => {
    const available = probeSecondBrainAvailability();
    if (!available) return { graph: { nodes: [], links: [] }, available };
    const graph = await notesVaultGraph.getGraph();
    return { graph, available };
  });
  // Start/stop the watcher exactly on galaxy toggle-on/off (design.md D3
  // M-2) — an always-on recursive watcher would rebuild constantly during
  // normal note-capture use for a view that's off by default. start() is
  // idempotent; stop() is safe to call even if never started.
  ipcMain.on("secondbrain:activate", () => {
    notesVaultGraph.start();
  });
  ipcMain.on("secondbrain:deactivate", () => {
    notesVaultGraph.stop();
  });
  // Read-by-node-id only, resolved against the single graph cache — never a
  // renderer-supplied filesystem path (design.md D8/L-1). Type/bound-check
  // the arg since an XSS-in-renderer could pass anything (L1), then assert
  // the resolved path (after following symlinks) is inside the vault
  // (H3) before reading — refuses a note symlinked outside the vault
  // (e.g. `secret.md -> ~/.ssh/id_rsa`).
  ipcMain.handle("secondbrain:read-note", (_event, id) => {
    if (typeof id !== "string" || id.length === 0 || id.length > 512) return { ok: false };
    const notePath = notesVaultGraph.resolveNotePath(id);
    if (!notePath) return { ok: false }; // ghost node, unknown id, or since-removed file
    let realNotePath;
    let realVaultDir;
    try {
      realNotePath = fs.realpathSync(notePath);
      realVaultDir = fs.realpathSync(notesVaultDir);
    } catch {
      return { ok: false };
    }
    const withinVault = realNotePath === realVaultDir || realNotePath.startsWith(realVaultDir + path.sep);
    if (!withinVault) return { ok: false };
    try {
      return { ok: true, content: fs.readFileSync(realNotePath, "utf8") };
    } catch {
      return { ok: false };
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
  ipcMain.handle("config:save-po-token", (_event, payload) => savePoToken(payload?.token));
  ipcMain.handle("config:remove-po-token", () => savePoToken("", { remove: true }));
  ipcMain.handle("config:test-gemini", (_event, payload) => testGeminiKey(payload?.key));
  ipcMain.handle("config:test-claude", () => checkClaudeHealth());
  // Renderer's boot-time read of the pipeline master switch (see design.md
  // decision 1/3) — cached, synchronous-feeling; live updates arrive over the
  // pipeline_availability sidecar event emitted whenever the value flips.
  ipcMain.handle("pipeline:status", () => ({ available: getPipelineAvailable() }));
  ipcMain.handle("config:preview-voice", (_event, payload) => previewVoice(payload || {}));
  ipcMain.on("iris:boot-done", () => greetGateFire());
  ipcMain.on("iris:ui-context", (_event, context) => {
    if (context && typeof context === "object") {
      setUiContextSnapshot(context);
    }
  });
  ipcMain.on("live:audio", (_event, chunk) => sendAudioChunk(chunk));
  ipcMain.on("iris:speaker-mute-state", (_event, muted) => {
    setSpeakerMuted(muted);
    updateTrayMenu();
  });
}
