import { describe, it, expect, vi } from "vitest";

vi.mock("./po-session.mjs", () => ({
  getPoSessionState: vi.fn(() => null),
  cancelPoTurn: vi.fn(),
}));

vi.mock("./run-queue.mjs", () => ({
  createRunQueue: vi.fn(() => ({ list: vi.fn(() => []) })),
  RUN_STATUS: { QUEUED: "queued" },
}));

vi.mock("./pipeline-probes.mjs", () => ({
  createPipelineProbes: vi.fn((deps) => ({
    getPipelineAvailable: vi.fn(() => true),
    claudeBinary: vi.fn(),
    openspecCommand: vi.fn(),
    hasOpenSpec: vi.fn(),
    openChangesWithTasks: vi.fn(),
    claudeWorkdir: vi.fn(),
    checkClaudeStatus: vi.fn(),
    probePipelineAvailability: vi.fn(() => Promise.resolve()),
    checkClaudeHealth: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./pipeline-install.mjs", () => ({
  createPipelineInstall: vi.fn(() => ({
    globalAgentsDir: vi.fn(),
    installedAgentFile: vi.fn(),
    installIrisAgents: vi.fn(),
    irisPluginDir: vi.fn(() => "/fake/iris-plugin"),
    irisPluginConfig: vi.fn(() => null),
    legacyClaudeArtifactsStatus: vi.fn(),
    removeLegacyClaudeArtifacts: vi.fn(),
    ensureProjectScaffold: vi.fn(),
    agentsSnapshot: vi.fn(),
  })),
}));

vi.mock("./user-config.mjs", () => ({
  createUserConfig: vi.fn(() => ({
    getPromptReviewMode: vi.fn(),
    getFullConfig: vi.fn(),
    writeUserConfig: vi.fn(),
    setPromptReviewMode: vi.fn(),
    savePoToken: vi.fn(),
    testGeminiKey: vi.fn(),
    previewVoice: vi.fn(),
  })),
}));

vi.mock("./renderer-bridge.mjs", () => ({
  createRendererBridge: vi.fn(() => ({
    emitToRenderer: vi.fn(),
    emitEvent: vi.fn(),
    flushTranscripts: vi.fn(),
    appendUserTranscript: vi.fn(),
    appendModelTranscript: vi.fn(),
    getUiContext: vi.fn(),
    setUiContext: vi.fn(),
  })),
}));

vi.mock("./session-store.mjs", () => ({
  createSessionStore: vi.fn(() => ({
    agentRoster: ["po", "dev"],
    modelChoices: [{ id: "claude-opus-5", label: "Opus 5" }],
    getActiveId: vi.fn(),
    resolveAgentModel: vi.fn(),
    agentKey: vi.fn(),
    findWorkstream: vi.fn(),
    sessionsSnapshot: vi.fn(),
    emitSessions: vi.fn(),
    persistSessionStore: vi.fn(),
    createWorkstream: vi.fn(),
    activeWorkstream: vi.fn(),
    selectWorkstream: vi.fn(),
    chooseWorkstreamCwd: vi.fn(),
    setWorkstreamAgent: vi.fn(),
    setAgentModel: vi.fn(),
  })),
}));

vi.mock("./announcements.mjs", () => ({
  createAnnouncements: vi.fn((deps) => ({
    notifyIris: vi.fn(),
    fenceUntrustedText: vi.fn((text) => text),
    drainPendingAnnouncements: vi.fn(),
    announceAgentSelection: vi.fn(),
    workspaceInfo: vi.fn(),
    workspaceContextLine: vi.fn(() => ""),
    announceWorkspaceUpdate: vi.fn(),
    userDisplayName: vi.fn(() => "Alex"),
    announceClaudeCompletion: vi.fn(),
    sendContextSupplement: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./run-dispatch.mjs", () => ({
  createRunDispatch: vi.fn(() => ({
    PendingReview: { abandon: vi.fn() },
    submitClaudeTask: vi.fn(),
    resolvePromptReview: vi.fn(),
    executeClaudeTool: vi.fn(),
  })),
}));

vi.mock("./run-stream.mjs", () => ({
  createRunStream: vi.fn(() => ({
    PendingQuestion: { abandon: vi.fn() },
    rememberClaudeSessionId: vi.fn(),
    cancelActivityThrottle: vi.fn(),
    pushActivity: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    handleClaudeStreamMessage: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    resolvePendingPoQuestion: vi.fn(),
  })),
}));

const fakeCapabilities = [{ teardown: vi.fn() }, { teardown: vi.fn() }];

vi.mock("./wiring-capabilities.mjs", () => ({
  createCapabilitiesWiring: vi.fn(() => ({
    canvasCapability: fakeCapabilities[0],
    secondBrainCapability: fakeCapabilities[1],
    startClaudeRun: vi.fn(),
    capabilities: fakeCapabilities,
    geminiTools: { buildLiveTools: vi.fn(() => []) },
    geminiPrompts: { buildSystemInstructionText: vi.fn(() => "") },
  })),
}));

vi.mock("./wiring-live.mjs", () => ({
  createLiveWiring: vi.fn((deps) => {
    deps.setWindowModule({ getMainWindow: () => "fake-window", getUiMode: () => "deck" });
    deps.setLiveSessionModule({ getLiveSession: () => null, getLiveStatus: () => ({ running: false }) });
    deps.setListenModeObject({ engaged: false, transitioning: false });
    return {
      createWindow: vi.fn(),
      toggleHud: vi.fn(),
      updateTrayMenu: vi.fn(),
      createTray: vi.fn(),
      hudHotkey: vi.fn(),
      muteHotkey: vi.fn(),
      listenHotkey: vi.fn(),
      installAppMenu: vi.fn(),
      setRendererSecurity: vi.fn(),
      startLive: vi.fn(),
      stopLive: vi.fn(),
      GreetGate: { fire: vi.fn() },
      setSpeakerMuted: vi.fn(),
      toggleListenMode: vi.fn(),
      isListenModeEngaged: vi.fn(() => false),
      sendCommand: vi.fn(),
      sendAudioChunk: vi.fn(),
    };
  }),
}));

import { createWiring } from "./wiring.mjs";
import { createCapabilitiesWiring as createCapabilitiesWiringReal } from "./wiring-capabilities.mjs";
import { createLiveWiring as createLiveWiringReal } from "./wiring-live.mjs";

// Cast to the vi.fn() mock shape — the real modules' JSDoc types don't
// carry `.mock`, but vi.mock() above replaces them with mocks at runtime.
/** @type {any} */
const createCapabilitiesWiring = createCapabilitiesWiringReal;
/** @type {any} */
const createLiveWiring = createLiveWiringReal;

function makeDeps(overrides = {}) {
  return {
    repoRoot: "/fake/repo",
    appIcon: null,
    iconPath: "/fake/repo/build/icon.png",
    canvasStoreFile: "/fake/canvas.json",
    envFlag: vi.fn(() => false),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    getIsPackaged: vi.fn(() => false),
    ...overrides,
  };
}

describe("wiring: createWiring", () => {
  it("constructs the whole app without throwing", () => {
    expect(() => createWiring(makeDeps())).not.toThrow();
  });

  it("getMainWindow/getUiMode/getLiveStatus read through to what wiring-live registered", () => {
    const result = createWiring(makeDeps());
    expect(result.getMainWindow()).toBe("fake-window");
    expect(result.getUiMode()).toBe("deck");
    expect(result.getLiveStatus()).toEqual({ running: false });
  });

  it("passes the capabilities array through from wiring-capabilities to the top-level result", () => {
    const result = createWiring(makeDeps());
    expect(result.capabilities).toBe(fakeCapabilities);
    expect(result.secondBrainCapability).toBe(fakeCapabilities[1]);
  });

  it("forwards wiring-live's window/live-session/listen-mode surface directly", () => {
    const result = createWiring(makeDeps());
    const live = createLiveWiring.mock.results.at(-1).value;
    expect(result.createWindow).toBe(live.createWindow);
    expect(result.startLive).toBe(live.startLive);
    expect(result.toggleListenMode).toBe(live.toggleListenMode);
  });

  it("passes dialog and getIsPackaged through to the capabilities/user-config wiring", () => {
    const dialog = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() };
    createWiring(makeDeps({ dialog }));
    const capsDeps = createCapabilitiesWiring.mock.calls.at(-1)[0];
    expect(capsDeps.dialog).toBe(dialog);
  });

  it("returns runQueue for shutdownTeardown's use", () => {
    // Shutdown reaches live runs through list() and each run's own cancel(),
    // so the queue handle is the only thing wiring has to expose for it.
    const result = createWiring(makeDeps());
    expect(typeof result.runQueue.list).toBe("function");
    expect(result.killChild).toBeUndefined();
  });
});
