import { describe, it, expect, vi } from "vitest";

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
    getListenOnlyEngaged: vi.fn(() => false),
    toggleListenOnly: vi.fn(),
    getUserStopped: vi.fn(() => false),
    setResumptionHandle: vi.fn(),
    logClaudeBillingPathOnce: vi.fn(),
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
    listenHotkey: vi.fn(() => "Alt+L"),
    wakeHotkey: vi.fn(() => "Alt+Shift+W"),
    sleepHotkey: vi.fn(() => "Alt+Shift+S"),
    requestWake: vi.fn(),
    requestSleep: vi.fn(),
    notifyWakeReady: vi.fn(),
    installAppMenu: vi.fn(),
    __deps: deps,
  })),
}));

import { createLiveMessages as createLiveMessagesReal } from "./live-messages.mjs";
import { createLiveSession as createLiveSessionReal } from "./live-session.mjs";
import { createWindowModule as createWindowModuleReal } from "./window.mjs";
import { createLiveWiring } from "./wiring-live.mjs";

// Cast to the vi.fn() mock shape — the real modules' JSDoc types don't
// carry `.mock`, but vi.mock() above replaces them with mocks at runtime.
/** @type {any} */
const createLiveMessages = createLiveMessagesReal;
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
      buildSystemInstructionText: vi.fn(() => ""),
    },
    secondBrainCapability: {
      stopVaultGraphWatch: vi.fn(),
      probeSecondBrainAvailability: vi.fn(() => false),
      setAmbientCaptureAwake: vi.fn(() => Promise.resolve()),
      syncAmbientCaptureState: vi.fn(() => Promise.resolve()),
    },
    setWindowModule: vi.fn(),
    setLiveSessionModule: vi.fn(),
    ...overrides,
  };
}

describe("wiring-live: createLiveWiring", () => {
  it("constructs live-messages, live-session, and window without throwing", () => {
    expect(() => createLiveWiring(makeDeps())).not.toThrow();
  });

  it("constructs live-messages before live-session, and live-session before window", () => {
    createLiveWiring(makeDeps());
    const liveMessagesOrder = createLiveMessages.mock.invocationCallOrder.at(-1);
    const liveSessionOrder = createLiveSession.mock.invocationCallOrder.at(-1);
    const windowOrder = createWindowModule.mock.invocationCallOrder.at(-1);
    expect(liveMessagesOrder).toBeLessThan(liveSessionOrder);
    expect(liveSessionOrder).toBeLessThan(windowOrder);
  });

  it("registers the constructed window and live-session modules back via the injected setters", () => {
    const setWindowModule = vi.fn();
    const setLiveSessionModule = vi.fn();
    createLiveWiring(makeDeps({ setWindowModule, setLiveSessionModule }));
    expect(setWindowModule).toHaveBeenCalledTimes(1);
    expect(setLiveSessionModule).toHaveBeenCalledTimes(1);
  });

  it("wires live-messages' isListenOnlyEngaged through to live-session's own state", () => {
    createLiveWiring(makeDeps());
    const liveMessagesDeps = createLiveMessages.mock.calls.at(-1)[0];
    const liveSessionInstance = createLiveSession.mock.results.at(-1).value;
    liveSessionInstance.getListenOnlyEngaged.mockReturnValue(true);
    expect(liveMessagesDeps.isListenOnlyEngaged()).toBe(true);
  });

  it("wires window's isListenOnlyEngaged/toggleListenOnly through to live-session", () => {
    createLiveWiring(makeDeps());
    const windowDeps = createWindowModule.mock.calls.at(-1)[0];
    const liveSessionInstance = createLiveSession.mock.results.at(-1).value;
    liveSessionInstance.getListenOnlyEngaged.mockReturnValue(true);
    expect(windowDeps.isListenOnlyEngaged()).toBe(true);
    windowDeps.toggleListenOnly();
    expect(liveSessionInstance.toggleListenOnly).toHaveBeenCalled();
  });

  // ambient-session-capture: ambient capture reads the mode itself, so this
  // wiring hands nothing over — it exists to make the yield happen at the mode's
  // own edge rather than at whatever unrelated flip comes next.
  it("re-syncs ambient capture on every listen-only transition, in both directions", () => {
    const deps = makeDeps();
    createLiveWiring(deps);
    const { onListenOnlyChange } = createLiveSession.mock.calls.at(-1)[0];
    onListenOnlyChange(true);
    onListenOnlyChange(false);
    expect(deps.secondBrainCapability.syncAmbientCaptureState).toHaveBeenCalledTimes(2);
  });

  // The listening window's length is resolved in main, on the same terms the
  // system-audio values are (listen-window-is-bounded D5) — the bound itself
  // reads no configuration.
  it("hands live-session a resolved window length rather than letting it read the environment", () => {
    createLiveWiring(makeDeps());
    const { listenWindowMs } = createLiveSession.mock.calls.at(-1)[0];
    expect(typeof listenWindowMs).toBe("function");
    expect(listenWindowMs()).toBeGreaterThan(0);
  });

  it("fires logClaudeBillingPathOnce during construction", () => {
    createLiveWiring(makeDeps());
    const liveSessionInstance = createLiveSession.mock.results.at(-1).value;
    expect(liveSessionInstance.logClaudeBillingPathOnce).toHaveBeenCalled();
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
        "listenHotkey",
        "wakeHotkey",
        "sleepHotkey",
        "requestWake",
        "requestSleep",
        "notifyWakeReady",
        "installAppMenu",
        "setRendererSecurity",
        "startLive",
        "stopLive",
        "GreetGate",
        "toggleListenOnly",
        "handleSystemAudioUnavailable",
        "isListenOnlyEngaged",
        "listenOnlyStatePayload",
        "sendCommand",
        "sendAudioChunk",
      ].sort(),
    );
  });
});
