// Barge-in, checked through the real message handler.
//
// `wiring-live.test.mjs` mocks live-messages, so it can prove the modules were
// constructed in the right order and nothing more. The chain that matters here
// runs the other way: Gemini reports an interruption, live-messages decides
// what that means, and the run layer ends the turn. A mocked live-messages
// cannot see any of it — the same blind spot that let three wiring bugs ship
// in this change.
//
// So this mocks only the boundaries live-messages talks OUT to (the live
// session, the window) and uses the real one in between.
import { describe, it, expect, vi } from "vitest";

vi.mock("./live-session.mjs", () => ({
  createLiveSession: vi.fn((deps) => ({
    GreetGate: { fire: vi.fn() },
    getLiveSession: vi.fn(() => null),
    getLiveStatus: vi.fn(() => ({ running: true })),
    getListenOnlyEngaged: vi.fn(() => false),
    toggleListenOnly: vi.fn(),
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
  createWindowModule: vi.fn(() => ({
    getMainWindow: vi.fn(() => null),
    getUiMode: vi.fn(() => "hud"),
    createWindow: vi.fn(),
    enterHud: vi.fn(),
    exitHud: vi.fn(),
    toggleHud: vi.fn(),
    updateTrayMenu: vi.fn(),
    createTray: vi.fn(),
    installAppMenu: vi.fn(),
    setRendererSecurity: vi.fn(),
    requestWake: vi.fn(),
    requestSleep: vi.fn(),
    notifyWakeReady: vi.fn(),
    hudHotkey: vi.fn(),
    listenHotkey: vi.fn(),
    wakeHotkey: vi.fn(),
    sleepHotkey: vi.fn(),
    handleSystemAudioUnavailable: vi.fn(),
    listenOnlyStatePayload: vi.fn(),
    probeSecondBrainAvailability: vi.fn(),
  })),
  DEFAULT_HUD_HOTKEY: "Alt+Space",
}));

/** @type {any} */
const { createLiveSession } = await import("./live-session.mjs");
const { createLiveWiring } = await import("./wiring-live.mjs");

function build(overrides = {}) {
  const interruptResidentTurns = vi.fn(() => ["turn-1"]);
  createLiveWiring({
    repoRoot: "/fake/repo",
    appIcon: null,
    iconPath: "/fake/repo/build/icon.png",
    envFlag: vi.fn(() => false),
    recordLog: vi.fn(),
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
    interruptResidentTurns,
    geminiTools: { buildLiveTools: vi.fn(() => []) },
    geminiPrompts: { buildSystemInstructionText: vi.fn(() => "") },
    secondBrainCapability: {
      stopVaultGraphWatch: vi.fn(),
      probeSecondBrainAvailability: vi.fn(() => false),
      setAmbientCaptureAwake: vi.fn(() => Promise.resolve()),
      setMeetingCaptureEngaged: vi.fn(() => Promise.resolve()),
      appendMeetingFragment: vi.fn(),
      closeMeetingUtterance: vi.fn(),
    },
    setWindowModule: vi.fn(),
    setLiveSessionModule: vi.fn(),
    ...overrides,
  });
  // The real handler, as live-session receives it.
  const { handleLiveMessage } = createLiveSession.mock.calls.at(-1)[0];
  return { handleLiveMessage, interruptResidentTurns };
}

describe("barge-in, through the real message handler", () => {
  it("ends the turn that is talking when the user speaks over it", () => {
    const { handleLiveMessage, interruptResidentTurns } = build();

    handleLiveMessage({ serverContent: { interrupted: true } });

    expect(interruptResidentTurns).toHaveBeenCalledTimes(1);
  });

  it("does not end anything on an ordinary turn boundary", () => {
    // turnComplete is Iris finishing normally. Treating that as an
    // interruption would cancel the turn every time she stopped speaking.
    const { handleLiveMessage, interruptResidentTurns } = build();

    handleLiveMessage({ serverContent: { turnComplete: true } });

    expect(interruptResidentTurns).not.toHaveBeenCalled();
  });

  it("does not end anything when the user is merely being transcribed", () => {
    const { handleLiveMessage, interruptResidentTurns } = build();

    handleLiveMessage({ serverContent: { inputTranscription: { text: "and another box" } } });

    expect(interruptResidentTurns).not.toHaveBeenCalled();
  });
});
