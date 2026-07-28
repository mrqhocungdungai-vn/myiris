import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => {
  const handleCalls = new Map();
  const onCalls = new Map();
  return {
    default: {
      ipcMain: {
        handle: vi.fn((channel, fn) => handleCalls.set(channel, fn)),
        on: vi.fn((channel, fn) => onCalls.set(channel, fn)),
      },
      dialog: {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
      },
      __test: { handleCalls, onCalls },
    },
  };
});

import electronReal from "electron";
import { registerIpc } from "./ipc.mjs";

/** @type {any} */
const electron = electronReal;

// Mirrors the baseline recorded in openspec/changes/split-main-process-modules/baseline.md
// (task 1.2) — the acceptance evidence that the IPC surface is unchanged.
const EXPECTED_HANDLE = [
  "sidecar:start",
  "sidecar:stop",
  "sidecar:status",
  "listen-mode:query",
  "sidecar:command",
  "sessions:get",
  "sessions:select",
  "sessions:new",
  "sessions:choose-cwd",
  "agents:list",
  "agents:select",
  "agents:install",
  "pipeline:install-prereqs",
  "agents:set-model",
  "po:answer-question",
  "prompt:status",
  "prompt:resolve-review",
  "prompt:set-review-mode",
  "context-supplement:send",
  "hud:toggle",
  "canvas:get-scene",
  "canvas:native-open-file",
  "canvas:native-save-file",
  "canvas:native-export-image",
  "secondbrain:availability",
  "secondbrain:get-graph",
  "secondbrain:read-note",
  "config:get",
  "config:save",
  "config:save-po-token",
  "config:remove-po-token",
  "config:test-gemini",
  "config:test-claude",
  "pipeline:status",
  "config:preview-voice",
].sort();

const EXPECTED_ON = [
  "listen-mode:toggle-request",
  "hud:interactive",
  "canvas:activate",
  "canvas:image-result",
  "canvas:scene",
  "secondbrain:activate",
  "secondbrain:deactivate",
  "win:control",
  "iris:boot-done",
  "iris:ui-context",
  "live:audio",
  "iris:speaker-mute-state",
].sort();

function makeDeps(overrides = {}) {
  return {
    getMainWindow: vi.fn(() => ({ focus: vi.fn(), close: vi.fn(), minimize: vi.fn(), setIgnoreMouseEvents: vi.fn() })),
    getUiMode: vi.fn(() => "deck"),
    toggleHud: vi.fn(),
    updateTrayMenu: vi.fn(),
    startLive: vi.fn(),
    stopLive: vi.fn(),
    getLiveStatus: vi.fn(() => ({ running: false })),
    greetGateFire: vi.fn(),
    setSpeakerMuted: vi.fn(),
    toggleListenMode: vi.fn(),
    isListenModeEngaged: vi.fn(() => false),
    sendCommand: vi.fn(),
    sendAudioChunk: vi.fn(),
    sessionsSnapshot: vi.fn(() => ({ sessions: [] })),
    selectWorkstream: vi.fn(),
    createWorkstream: vi.fn(() => ({ id: "1", label: "New" })),
    chooseWorkstreamCwd: vi.fn(),
    agentsSnapshot: vi.fn(),
    setWorkstreamAgent: vi.fn(),
    setAgentModel: vi.fn(),
    installIrisAgents: vi.fn(),
    installPipelinePrereqs: vi.fn(),
    resolvePendingPoQuestion: vi.fn(),
    getPromptReviewMode: vi.fn(() => true),
    setPromptReviewMode: vi.fn(),
    resolvePromptReview: vi.fn(),
    sendContextSupplement: vi.fn(),
    getFullConfig: vi.fn(),
    writeUserConfig: vi.fn(),
    savePoToken: vi.fn(),
    testGeminiKey: vi.fn(),
    previewVoice: vi.fn(),
    checkClaudeHealth: vi.fn(),
    getPipelineAvailable: vi.fn(() => true),
    setUiContextSnapshot: vi.fn(),
    markCanvasEngaged: vi.fn(),
    maybeStartCanvasMcp: vi.fn(),
    resolveCanvasImageRequest: vi.fn(),
    canvasStore: { getScene: vi.fn(), setScene: vi.fn() },
    probeSecondBrainAvailability: vi.fn(() => true),
    notesVaultGraph: { start: vi.fn(), stop: vi.fn(), getGraph: vi.fn(), resolveNotePath: vi.fn() },
    notesVaultDir: "/fake/vault",
    ...overrides,
  };
}

beforeEach(() => {
  electron.__test.handleCalls.clear();
  electron.__test.onCalls.clear();
});

describe("ipc: registration surface", () => {
  it("registers exactly the expected handle channels and no others", () => {
    registerIpc(makeDeps());
    expect([...electron.__test.handleCalls.keys()].sort()).toEqual(EXPECTED_HANDLE);
  });

  it("registers exactly the expected on (fire-and-forget) channels and no others", () => {
    registerIpc(makeDeps());
    expect([...electron.__test.onCalls.keys()].sort()).toEqual(EXPECTED_ON);
  });

  it("registers no channel as both handle and on", () => {
    registerIpc(makeDeps());
    const handleChannels = new Set(electron.__test.handleCalls.keys());
    const onChannels = new Set(electron.__test.onCalls.keys());
    for (const channel of handleChannels) expect(onChannels.has(channel)).toBe(false);
  });
});

describe("ipc: handlers marshal and delegate", () => {
  it("sidecar:start delegates to startLive", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.handleCalls.get("sidecar:start")();
    expect(deps.startLive).toHaveBeenCalled();
  });

  it("listen-mode:toggle-request delegates to toggleListenMode", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.onCalls.get("listen-mode:toggle-request")();
    expect(deps.toggleListenMode).toHaveBeenCalled();
  });

  it("listen-mode:query reports the injected engagement accessor", () => {
    const deps = makeDeps({ isListenModeEngaged: vi.fn(() => true) });
    registerIpc(deps);
    expect(electron.__test.handleCalls.get("listen-mode:query")()).toEqual({ engaged: true });
  });

  it("canvas:activate focuses the window, marks canvas engaged, and tries to start the MCP", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.onCalls.get("canvas:activate")();
    expect(deps.getMainWindow).toHaveBeenCalled();
    expect(deps.markCanvasEngaged).toHaveBeenCalled();
    expect(deps.maybeStartCanvasMcp).toHaveBeenCalled();
  });

  it("canvas:image-result resolves via the injected resolver, not a locally-held map", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.onCalls.get("canvas:image-result")(null, { id: "abc", image: "data:..." });
    expect(deps.resolveCanvasImageRequest).toHaveBeenCalledWith("abc", "data:...");
  });

  it("hud:toggle toggles, refreshes the tray, and reports the new mode", () => {
    const deps = makeDeps({ getUiMode: vi.fn(() => "hud") });
    registerIpc(deps);
    const result = electron.__test.handleCalls.get("hud:toggle")();
    expect(deps.toggleHud).toHaveBeenCalled();
    expect(deps.updateTrayMenu).toHaveBeenCalled();
    expect(result).toEqual({ mode: "hud" });
  });

  it("secondbrain:get-graph returns an empty graph without reading the vault when unavailable", async () => {
    const deps = makeDeps({ probeSecondBrainAvailability: vi.fn(() => false) });
    registerIpc(deps);
    const result = await electron.__test.handleCalls.get("secondbrain:get-graph")();
    expect(result).toEqual({ graph: { nodes: [], links: [] }, available: false });
    expect(deps.notesVaultGraph.getGraph).not.toHaveBeenCalled();
  });

  it("secondbrain:read-note rejects a malformed id without touching the graph", () => {
    const deps = makeDeps();
    registerIpc(deps);
    expect(electron.__test.handleCalls.get("secondbrain:read-note")(null, "")).toEqual({ ok: false });
    expect(electron.__test.handleCalls.get("secondbrain:read-note")(null, 42)).toEqual({ ok: false });
    expect(deps.notesVaultGraph.resolveNotePath).not.toHaveBeenCalled();
  });

  it("win:control closes or minimizes the injected window", () => {
    const win = { close: vi.fn(), minimize: vi.fn(), focus: vi.fn(), setIgnoreMouseEvents: vi.fn() };
    const deps = makeDeps({ getMainWindow: vi.fn(() => win) });
    registerIpc(deps);
    electron.__test.onCalls.get("win:control")(null, "close");
    expect(win.close).toHaveBeenCalled();
    electron.__test.onCalls.get("win:control")(null, "minimize");
    expect(win.minimize).toHaveBeenCalled();
  });

  it("iris:speaker-mute-state sets the mute flag and refreshes the tray", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.onCalls.get("iris:speaker-mute-state")(null, true);
    expect(deps.setSpeakerMuted).toHaveBeenCalledWith(true);
    expect(deps.updateTrayMenu).toHaveBeenCalled();
  });
});
