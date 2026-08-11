import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => {
  const handleCalls = new Map();
  const onCalls = new Map();
  const mediaAccessStatus = { microphone: "granted", camera: "not-determined" };
  return {
    default: {
      ipcMain: {
        handle: vi.fn((channel, fn) => handleCalls.set(channel, fn)),
        on: vi.fn((channel, fn) => onCalls.set(channel, fn)),
      },
      systemPreferences: {
        getMediaAccessStatus: vi.fn((name) => mediaAccessStatus[name]),
        askForMediaAccess: vi.fn(() => Promise.resolve(true)),
      },
      shell: { openExternal: vi.fn(() => Promise.resolve()) },
      __test: { handleCalls, onCalls, mediaAccessStatus },
    },
  };
});

import electronReal from "electron";
import { registerIpc } from "./ipc.mjs";

/** @type {any} */
const electron = electronReal;

// Mirrors the CORE subset of the baseline recorded in
// openspec/changes/split-main-process-modules/baseline.md (task 1.2) — the
// 12 canvas:*/secondbrain:* channels moved to the capability modules
// (task 5.1/5.2) and are registered here only via the capabilities-iteration
// composition, covered separately below.
const EXPECTED_HANDLE = [
  "sidecar:start",
  "sidecar:stop",
  "sidecar:status",
  "listen-only:query",
  "sidecar:command",
  "sessions:get",
  "sessions:select",
  "sessions:new",
  "sessions:choose-cwd",
  "verbs:list",
  "pipeline:legacy-artifacts",
  "pipeline:remove-legacy-artifacts",
  "verbs:set-model",
  "claude:answer-question",
  "prompt:status",
  "prompt:resolve-review",
  "prompt:set-review-mode",
  "context-supplement:send",
  "hud:toggle",
  "config:get",
  "config:save",
  "config:save-claude-token",
  "config:remove-claude-token",
  "config:test-gemini",
  "config:test-claude",
  "pipeline:status",
  "config:preview-voice",
  "permissions:query",
  "permissions:request",
  "permissions:open-settings",
  "system-audio-self-test:arm",
].sort();

const EXPECTED_ON = [
  "system-audio-self-test:disarm",
  "listen-only:system-audio-unavailable",
  "listen-only:toggle-request",
  "hud:interactive",
  "win:control",
  "iris:boot-done",
  "iris:wake-ready",
  "iris:ui-context",
  "live:audio",
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
    notifyWakeReady: vi.fn(),
    toggleListenOnly: vi.fn(),
    isListenOnlyEngaged: vi.fn(() => false),
    sendCommand: vi.fn(),
    sendAudioChunk: vi.fn(),
    sessionsSnapshot: vi.fn(() => ({ sessions: [] })),
    selectWorkstream: vi.fn(),
    createWorkstream: vi.fn(() => ({ id: "1", label: "New" })),
    chooseWorkstreamCwd: vi.fn(),
    verbsSnapshot: vi.fn(),
    setVerbModel: vi.fn(),
    legacyClaudeArtifactsStatus: vi.fn(),
    removeLegacyClaudeArtifacts: vi.fn(),
    resolvePendingClaudeQuestion: vi.fn(),
    getPromptReviewMode: vi.fn(() => "verb"),
    setPromptReviewMode: vi.fn(),
    resolvePromptReview: vi.fn(),
    sendContextSupplement: vi.fn(),
    getFullConfig: vi.fn(),
    writeUserConfig: vi.fn(),
    saveClaudeToken: vi.fn(),
    testGeminiKey: vi.fn(),
    previewVoice: vi.fn(),
    checkClaudeHealth: vi.fn(),
    getPipelineAvailable: vi.fn(() => true),
    setUiContextSnapshot: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  electron.__test.handleCalls.clear();
  electron.__test.onCalls.clear();
});

describe("ipc: registration surface", () => {
  it("registers exactly the expected core handle channels and no others", () => {
    registerIpc(makeDeps());
    expect([...electron.__test.handleCalls.keys()].sort()).toEqual(EXPECTED_HANDLE);
  });

  it("registers exactly the expected core on (fire-and-forget) channels and no others", () => {
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

  it("listen-only:toggle-request delegates to toggleListenOnly", () => {
    const deps = makeDeps();
    registerIpc(deps);
    electron.__test.onCalls.get("listen-only:toggle-request")();
    expect(deps.toggleListenOnly).toHaveBeenCalled();
  });

  it("listen-only:query reports the injected engagement accessor", () => {
    const deps = makeDeps({ isListenOnlyEngaged: vi.fn(() => true) });
    registerIpc(deps);
    expect(electron.__test.handleCalls.get("listen-only:query")()).toEqual({ engaged: true });
  });

  it("hud:toggle toggles, refreshes the tray, and reports the new mode", () => {
    const deps = makeDeps({ getUiMode: vi.fn(() => "hud") });
    registerIpc(deps);
    const result = electron.__test.handleCalls.get("hud:toggle")();
    expect(deps.toggleHud).toHaveBeenCalled();
    expect(deps.updateTrayMenu).toHaveBeenCalled();
    expect(result).toEqual({ mode: "hud" });
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

});

// setup-panel-reports-real-permissions 1.5/2.11. These channels hold no logic
// of their own — they make the Electron call and marshal through
// os-permissions.mjs, which is where the mapping is asserted.
describe("ipc: OS permission reporting", () => {
  it("permissions:query answers with the OS's own state, mapped, plus every settings location", async () => {
    registerIpc(makeDeps());
    const result = await electron.__test.handleCalls.get("permissions:query")();
    expect(electron.systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith("microphone");
    expect(result.states).toEqual({ microphone: "granted", camera: "not-determined" });
    expect(result.locations.microphone.writtenPath).toContain("Microphone");
    // System audio has no readable state but does have a location — the
    // self-test's failing verdicts route there.
    expect(result.states["system-audio"]).toBeUndefined();
    expect(result.locations["system-audio"]).not.toBeNull();
  });

  // The renderer's user agent reports a frozen macOS major, so the version the
  // system-audio floor is checked against has to come from main.
  it("permissions:query carries the OS version main reads, not one the renderer guesses", async () => {
    registerIpc(makeDeps());
    const result = await electron.__test.handleCalls.get("permissions:query")();
    expect("osVersion" in result).toBe(true);
  });

  it("permissions:request prompts through askForMediaAccess and re-reads the OS state", async () => {
    registerIpc(makeDeps());
    electron.__test.mediaAccessStatus.camera = "granted";
    const result = await electron.__test.handleCalls.get("permissions:request")(null, "camera");
    expect(electron.systemPreferences.askForMediaAccess).toHaveBeenCalledWith("camera");
    expect(result).toEqual({ state: "granted", prompted: true });
    electron.__test.mediaAccessStatus.camera = "not-determined";
  });

  it("permissions:request raises no prompt for a permission the platform cannot be asked about", async () => {
    registerIpc(makeDeps());
    electron.systemPreferences.askForMediaAccess.mockClear();
    const result = await electron.__test.handleCalls.get("permissions:request")(null, "system-audio");
    expect(electron.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    expect(result.prompted).toBe(false);
  });

  it("permissions:open-settings opens the pane and carries the written path back", async () => {
    registerIpc(makeDeps());
    const result = await electron.__test.handleCalls.get("permissions:open-settings")(null, "system-audio");
    expect(electron.shell.openExternal).toHaveBeenCalledWith(expect.stringContaining("Privacy_ScreenCapture"));
    expect(result.opened).toBe(true);
    expect(result.writtenPath).toContain("System Audio");
  });

  it("permissions:open-settings opens nothing for a permission it does not know", async () => {
    registerIpc(makeDeps());
    electron.shell.openExternal.mockClear();
    const result = await electron.__test.handleCalls.get("permissions:open-settings")(null, "bluetooth");
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
    expect(result).toEqual({ opened: false });
  });

  it("arms the self-test for the frame that asked, and disarms on request", () => {
    const armSystemAudioSelfTest = vi.fn(() => ({ armed: true }));
    const disarmSystemAudioSelfTest = vi.fn();
    registerIpc(makeDeps({ armSystemAudioSelfTest, disarmSystemAudioSelfTest }));
    const sender = { id: 3 };
    expect(electron.__test.handleCalls.get("system-audio-self-test:arm")({ sender })).toEqual({ armed: true });
    expect(armSystemAudioSelfTest).toHaveBeenCalledWith(sender);
    electron.__test.onCalls.get("system-audio-self-test:disarm")();
    expect(disarmSystemAudioSelfTest).toHaveBeenCalled();
  });
});

describe("ipc: capability composition (design.md D10)", () => {
  it("registers a capability's ipcHandlers by iteration, using its declared kind", () => {
    const fooHandle = vi.fn(() => "foo-result");
    const barOn = vi.fn();
    const capabilities = [
      {
        ipcHandlers: [
          { channel: "capability:foo", kind: "handle", fn: fooHandle },
          { channel: "capability:bar", kind: "on", fn: barOn },
        ],
      },
    ];
    registerIpc(makeDeps({ capabilities }));
    expect(electron.__test.handleCalls.get("capability:foo")()).toBe("foo-result");
    electron.__test.onCalls.get("capability:bar")();
    expect(barOn).toHaveBeenCalled();
  });

  it("registers channels from multiple capabilities without collision", () => {
    const capabilities = [
      { ipcHandlers: [{ channel: "capability:a", kind: "handle", fn: vi.fn() }] },
      { ipcHandlers: [{ channel: "capability:b", kind: "on", fn: vi.fn() }] },
    ];
    registerIpc(makeDeps({ capabilities }));
    expect(electron.__test.handleCalls.has("capability:a")).toBe(true);
    expect(electron.__test.onCalls.has("capability:b")).toBe(true);
  });

  it("tolerates a capability with no ipcHandlers field", () => {
    expect(() => registerIpc(makeDeps({ capabilities: [{}] }))).not.toThrow();
  });

  it("tolerates no capabilities being registered at all", () => {
    expect(() => registerIpc(makeDeps())).not.toThrow();
  });
});
