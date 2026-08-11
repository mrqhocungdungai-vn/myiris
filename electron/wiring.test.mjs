import { describe, it, expect, vi } from "vitest";

vi.mock("./stateful-session.mjs", () => ({
  getStatefulSessionState: vi.fn(() => null),
  cancelStatefulTurn: vi.fn(),
}));

vi.mock("./run-queue.mjs", () => ({
  createRunQueue: vi.fn(() => ({ list: vi.fn(() => []), submit: vi.fn() })),
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
    verbsSnapshot: vi.fn(),
  })),
}));

vi.mock("./user-config.mjs", () => ({
  createUserConfig: vi.fn(() => ({
    getPromptReviewMode: vi.fn(),
    getFullConfig: vi.fn(),
    writeUserConfig: vi.fn(),
    setPromptReviewMode: vi.fn(),
    saveClaudeToken: vi.fn(),
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
    drainPendingAnnouncements: vi.fn(),
    announceAgentSelection: vi.fn(),
    workspaceInfo: vi.fn(),
    workspaceContextLine: vi.fn(() => ""),
    announceWorkspaceUpdate: vi.fn(),
    userDisplayName: vi.fn(() => "Alex"),
    announceClaudeCompletion: vi.fn(),
    // The verbatim read-back path. Absent from this mock until now, which is
    // itself the finding: no test here had ever finalized a verb that takes it,
    // so the branch choosing between the two was never exercised.
    announceVerbatimResult: vi.fn(),
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
    resolvePendingClaudeQuestion: vi.fn(),
  })),
}));

const fakeCapabilities = [{ teardown: vi.fn() }, { teardown: vi.fn(), captureRunOutcome: vi.fn(), notesInboxDir: "/fake/inbox" }];

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
    return {
      createWindow: vi.fn(),
      toggleHud: vi.fn(),
      updateTrayMenu: vi.fn(),
      createTray: vi.fn(),
      hudHotkey: vi.fn(),
      listenHotkey: vi.fn(),
      wakeHotkey: vi.fn(),
      sleepHotkey: vi.fn(),
      requestWake: vi.fn(),
      requestSleep: vi.fn(),
      notifyWakeReady: vi.fn(),
      installAppMenu: vi.fn(),
      setRendererSecurity: vi.fn(),
      startLive: vi.fn(),
      stopLive: vi.fn(),
      GreetGate: { fire: vi.fn() },
      toggleListenOnly: vi.fn(),
      isListenOnlyEngaged: vi.fn(() => false),
      sendCommand: vi.fn(),
      sendAudioChunk: vi.fn(),
    };
  }),
}));

import { createRunQueue as createRunQueueReal } from "./run-queue.mjs";
import { createAnnouncements as createAnnouncementsReal } from "./announcements.mjs";
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

  // D5: capture is a plain file append on the queue's own finalize path. It must
  // not start a run, spend tokens, or hold the execution slot — bookkeeping can
  // never be allowed to delay the user's next request.
  describe("every finished run is recorded in the second brain", () => {
    function finalizeWith(run) {
      fakeCapabilities[1].captureRunOutcome.mockClear();
      createWiring(makeDeps());
      const queueDeps = /** @type {any} */ (createRunQueueReal).mock.calls.at(-1)[0];
      queueDeps.onFinalized(run);
      return fakeCapabilities[1].captureRunOutcome;
    }

    it("records a success", () => {
      const capture = finalizeWith({ run_id: "r1", verb: "execute", status: "completed", started_at: 1, output: "ok" });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].status).toBe("completed");
    });

    it("records a failure, a cancellation, a ceiling, and an unanswered question on the same terms", () => {
      for (const status of ["failed", "error", "cancelled", "limited", "unanswered"]) {
        const capture = finalizeWith({ run_id: "r1", verb: "execute", status, started_at: 1, output: "x" });
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls[0][0].status).toBe(status);
      }
    });

    it("starts no run of its own and takes no execution slot", () => {
      createWiring(makeDeps());
      const queueDeps = /** @type {any} */ (createRunQueueReal).mock.calls.at(-1)[0];
      const queue = /** @type {any} */ (createRunQueueReal).mock.results.at(-1).value;
      queueDeps.onFinalized({ run_id: "r1", verb: "execute", status: "completed", started_at: 1, output: "ok" });
      expect(queue.submit).not.toHaveBeenCalled();
    });
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

  it("forwards wiring-live's window/live-session/listen-only surface directly", () => {
    const result = createWiring(makeDeps());
    const live = createLiveWiring.mock.results.at(-1).value;
    expect(result.createWindow).toBe(live.createWindow);
    expect(result.startLive).toBe(live.startLive);
    expect(result.toggleListenOnly).toBe(live.toggleListenOnly);
    expect(result.isListenOnlyEngaged).toBe(live.isListenOnlyEngaged);
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

// How a result is SPOKEN is declared by the verb (`spokenResult`), and this is
// where that declaration is honoured or quietly ignored. The user asked for
// the canvas conversation's answers to be read out in full — "so both they and
// Claude understand" — and a summary here would be a different product.
describe("wiring: which announcement path a finished run takes", () => {
  function finalize(run) {
    createWiring(makeDeps());
    const announcements = /** @type {any} */ (createAnnouncementsReal).mock.results.at(-1).value;
    announcements.announceVerbatimResult.mockClear();
    announcements.announceClaudeCompletion.mockClear();
    const queueDeps = /** @type {any} */ (createRunQueueReal).mock.calls.at(-1)[0];
    queueDeps.onFinalized(run);
    return announcements;
  }

  it("reads a canvas result out in full, never as a summary", () => {
    const announcements = finalize({
      run_id: "r1",
      verb: "shape_on_canvas",
      status: "completed",
      started_at: 1,
      output: "Those two boxes are doing the same job; I merged them.",
    });

    expect(announcements.announceVerbatimResult).toHaveBeenCalledTimes(1);
    expect(announcements.announceClaudeCompletion).not.toHaveBeenCalled();
    expect(announcements.announceVerbatimResult.mock.calls[0][0].output).toContain("I merged them.");
  });

  it("reads a note back in full too — the other verb that declares it", () => {
    const announcements = finalize({
      run_id: "r1",
      verb: "work_on_note",
      status: "completed",
      started_at: 1,
      output: "Paragraph one is about the deadline.",
    });

    expect(announcements.announceVerbatimResult).toHaveBeenCalledTimes(1);
    expect(announcements.announceClaudeCompletion).not.toHaveBeenCalled();
  });

  it("still summarizes unattended work", () => {
    // The user did not watch this happen, so a precis is the right shape. This
    // is what keeps the change from being a general "stop summarizing" switch.
    const announcements = finalize({
      run_id: "r1",
      verb: "execute",
      status: "completed",
      started_at: 1,
      output: "Refactored the parser.",
    });

    expect(announcements.announceClaudeCompletion).toHaveBeenCalledTimes(1);
    expect(announcements.announceVerbatimResult).not.toHaveBeenCalled();
  });

  it("announces nothing at all for a run that never started", () => {
    const announcements = finalize({ run_id: "r1", verb: "shape_on_canvas", status: "failed", output: "x" });

    expect(announcements.announceVerbatimResult).not.toHaveBeenCalled();
    expect(announcements.announceClaudeCompletion).not.toHaveBeenCalled();
  });
});
