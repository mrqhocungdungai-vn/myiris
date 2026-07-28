import { describe, it, expect, vi } from "vitest";

const fakeListenMode = { engaged: false, transitioning: false };

vi.mock("./listen-mode.mjs", () => ({
  createListenMode: vi.fn((deps) => ({
    ListenMode: fakeListenMode,
    setListenEngaged: vi.fn(),
    clearListenRotationTimer: vi.fn(),
    resetListenModeSilently: vi.fn(),
    notifyTurnComplete: vi.fn(),
    notifyFreshResumptionHandle: vi.fn(),
    notifyLiveClosed: vi.fn(),
    runListenRotation: vi.fn(),
    toggleListenMode: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./live-messages.mjs", () => ({
  createLiveMessages: vi.fn((deps) => ({
    handleToolCall: vi.fn(),
    handleLiveMessage: vi.fn(),
    sendAudioChunk: vi.fn(),
    sendCommand: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./live-session.mjs", () => ({
  createLiveSession: vi.fn((deps) => ({
    GreetGate: { fire: vi.fn() },
    getLiveSession: vi.fn(() => null),
    getLiveStatus: vi.fn(() => ({ running: false })),
    getSpeakerMuted: vi.fn(() => false),
    setSpeakerMuted: vi.fn(),
    getUserStopped: vi.fn(() => false),
    setResumptionHandle: vi.fn(),
    logPoBillingPathOnce: vi.fn(),
    startLive: vi.fn(),
    connectLive: vi.fn(),
    scheduleReconnect: vi.fn(),
    stopLive: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./window.mjs", () => ({
  createWindowModule: vi.fn((deps) => ({
    getMainWindow: vi.fn(() => null),
    getUiMode: vi.fn(() => "deck"),
    createWindow: vi.fn(),
    enterHud: vi.fn(),
    exitHud: vi.fn(),
    toggleHud: vi.fn(),
    updateTrayMenu: vi.fn(),
    createTray: vi.fn(),
    hudHotkey: vi.fn(() => "Alt+Space"),
    muteHotkey: vi.fn(() => "Alt+M"),
    listenHotkey: vi.fn(() => "Alt+L"),
    installAppMenu: vi.fn(),
    __deps: deps,
  })),
}));

import { createListenMode as createListenModeReal } from "./listen-mode.mjs";
import { createLiveSession as createLiveSessionReal } from "./live-session.mjs";
import { createWindowModule as createWindowModuleReal } from "./window.mjs";
import { createLiveWiring } from "./wiring-live.mjs";

// Cast to the vi.fn() mock shape — the real modules' JSDoc types don't
// carry `.mock`, but vi.mock() above replaces them with mocks at runtime.
/** @type {any} */
const createListenMode = createListenModeReal;
/** @type {any} */
const createLiveSession = createLiveSessionReal;
/** @type {any} */
const createWindowModule = createWindowModuleReal;

function makeDeps(overrides = {}) {
  return {
    repoRoot: "/fake/repo",
    appIcon: null,
    iconPath: "/fake/repo/build/icon.png",
    envFlag: vi.fn(() => false),
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    flushTranscripts: vi.fn(),
    appendUserTranscript: vi.fn(),
    appendModelTranscript: vi.fn(),
    drainPendingAnnouncements: vi.fn(),
    checkClaudeStatus: vi.fn(),
    probePipelineAvailability: vi.fn(() => Promise.resolve()),
    userDisplayName: vi.fn(() => "Alex"),
    executeClaudeTool: vi.fn(),
    submitClaudeTask: vi.fn(),
    geminiTools: { buildLiveTools: vi.fn(() => []) },
    geminiPrompts: {
      buildListenSystemInstructionText: vi.fn(() => ""),
      buildSystemInstructionText: vi.fn(() => ""),
      buildListenEntryConfirmationPrompt: vi.fn(() => ""),
      buildListenExitSynthesisPrompt: vi.fn(() => ""),
    },
    secondBrainCapability: { stopVaultGraphWatch: vi.fn(), probeSecondBrainAvailability: vi.fn(() => false) },
    setWindowModule: vi.fn(),
    setLiveSessionModule: vi.fn(),
    setListenModeObject: vi.fn(),
    ...overrides,
  };
}

describe("wiring-live: createLiveWiring", () => {
  it("constructs listen-mode, live-messages, live-session, and window without throwing", () => {
    expect(() => createLiveWiring(makeDeps())).not.toThrow();
  });

  it("constructs listen-mode first, then live-session last, matching the three-way dependency order", () => {
    createLiveWiring(makeDeps());
    const listenModeOrder = createListenMode.mock.invocationCallOrder.at(-1);
    const liveSessionOrder = createLiveSession.mock.invocationCallOrder.at(-1);
    const windowOrder = createWindowModule.mock.invocationCallOrder.at(-1);
    expect(listenModeOrder).toBeLessThan(liveSessionOrder);
    expect(liveSessionOrder).toBeLessThan(windowOrder);
  });

  it("registers the constructed window and live-session modules back via the injected setters", () => {
    const setWindowModule = vi.fn();
    const setLiveSessionModule = vi.fn();
    const setListenModeObject = vi.fn();
    createLiveWiring(makeDeps({ setWindowModule, setLiveSessionModule, setListenModeObject }));
    expect(setWindowModule).toHaveBeenCalledTimes(1);
    expect(setLiveSessionModule).toHaveBeenCalledTimes(1);
    expect(setListenModeObject).toHaveBeenCalledWith(fakeListenMode);
  });

  it("fires logPoBillingPathOnce during construction", () => {
    createLiveWiring(makeDeps());
    const liveSessionInstance = createLiveSession.mock.results.at(-1).value;
    expect(liveSessionInstance.logPoBillingPathOnce).toHaveBeenCalled();
  });

  it("returns setRendererSecurity, and window.mjs's getAppDevUrl thunk reads through it", () => {
    const result = createLiveWiring(makeDeps());
    expect(typeof result.setRendererSecurity).toBe("function");
    const windowDeps = createWindowModule.mock.calls.at(-1)[0];
    expect(() => windowDeps.getAppDevUrl()).toThrow(); // rendererSecurity not set yet
    result.setRendererSecurity({ appDevUrl: "http://127.0.0.1:5173" });
    expect(windowDeps.getAppDevUrl()).toBe("http://127.0.0.1:5173");
  });

  it("returns the expected top-level interface", () => {
    const result = createLiveWiring(makeDeps());
    expect(Object.keys(result).sort()).toEqual(
      [
        "createWindow",
        "toggleHud",
        "updateTrayMenu",
        "createTray",
        "hudHotkey",
        "muteHotkey",
        "listenHotkey",
        "installAppMenu",
        "setRendererSecurity",
        "startLive",
        "stopLive",
        "GreetGate",
        "setSpeakerMuted",
        "toggleListenMode",
        "isListenModeEngaged",
        "sendCommand",
        "sendAudioChunk",
      ].sort(),
    );
  });
});
