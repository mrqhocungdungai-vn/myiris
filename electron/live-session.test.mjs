import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLiveSession } from "./live-session.mjs";

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn(function GoogleGenAIMock() {
      return { live: { connect: vi.fn() } };
    }),
  };
});

/** @returns {Promise<any>} */
async function getMockedGoogleGenAI() {
  return (await import("@google/genai")).GoogleGenAI;
}

/** @param {(config: any) => Promise<any>} connectImpl */
function fakeGoogleGenAIImpl(connectImpl) {
  return function GoogleGenAIFake() {
    return { live: { connect: vi.fn(connectImpl) } };
  };
}

function make(overrides = {}) {
  return createLiveSession({
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    flushTranscripts: vi.fn(),
    drainPendingAnnouncements: vi.fn(),
    checkClaudeStatus: vi.fn(async () => ({ reachable: true })),
    probePipelineAvailability: vi.fn(async () => ({})),
    userDisplayName: () => "Alex",
    updateTrayMenu: vi.fn(),
    buildLiveTools: () => [],
    buildSystemInstructionText: () => "converse instructions",
    handleLiveMessage: vi.fn(),
    ...overrides,
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GEMINI_API_KEY = "fake-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("live-session: startLive/connectLive", () => {
  it("throws when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const emitEvent = vi.fn();
    const live = make({ emitEvent });
    await expect(live.connectLive({ isReconnect: false })).rejects.toThrow("GEMINI_API_KEY is not set");
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "fatal" }));
  });

  it("is a no-op if a live session is already connected", async () => {
    const probePipelineAvailability = vi.fn(async () => ({}));
    const live = make({ probePipelineAvailability });
    // Fake a connected session by calling connectLive once with a working mock.
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async () => ({ sendRealtimeInput: vi.fn(), sendClientContent: vi.fn() })),
    );
    await live.startLive();
    expect(live.getLiveSession()).toBeTruthy();

    probePipelineAvailability.mockClear();
    await live.startLive();
    expect(probePipelineAvailability).not.toHaveBeenCalled();
  });

  it("builds the config with no mode parameter — one configuration, no realtimeInputConfig", async () => {
    /** @type {any} */
    let capturedConfig;
    const live = make();
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        capturedConfig = args.config;
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn() };
      }),
    );
    await live.startLive();
    expect(capturedConfig).not.toHaveProperty("realtimeInputConfig");
    expect(capturedConfig.responseModalities).toEqual(["AUDIO"]);
  });
});

describe("live-session: scheduleReconnect (via connectLive's onclose)", () => {
  /** @returns {(opts: any) => Promise<any>} */
  function makeConnectingSession({ live, onCloseCapture }) {
    return async (_opts) => {
      const GoogleGenAI = await getMockedGoogleGenAI();
      GoogleGenAI.mockImplementationOnce(
        fakeGoogleGenAIImpl(async (config) => {
          onCloseCapture(config.callbacks);
          return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
        }),
      );
      return live.connectLive(_opts);
    };
  }

  it("backs off exponentially and gives up after MAX_RECONNECT_ATTEMPTS, going offline", async () => {
    vi.useFakeTimers();
    try {
      const emitEvent = vi.fn();
      /** @type {any} */
      let callbacks;
      const live = make({ emitEvent });
      const connect = makeConnectingSession({ live, onCloseCapture: (cb) => { callbacks = cb; } });
      await connect({ isReconnect: false });

      // MAX_RECONNECT_ATTEMPTS is 5, and scheduleReconnect only gives up once
      // the count exceeds it (`> 5`, not `>= 5`) — so attempts 1-5 each
      // schedule another reconnect, and it's the 6th onclose that gives up.
      for (let attempt = 1; attempt <= 6; attempt++) {
        callbacks.onclose({ code: 1006, reason: "network drop" });
        // Re-arm the mock BEFORE advancing timers — the reconnect timer
        // fires synchronously inside advanceTimersByTimeAsync and immediately
        // calls `new GoogleGenAI()`, unless this was the final attempt
        // (which gives up rather than scheduling another reconnect).
        if (attempt < 6) {
          const GoogleGenAI = await getMockedGoogleGenAI();
          GoogleGenAI.mockImplementationOnce(
            fakeGoogleGenAIImpl(async (config) => {
              callbacks = config.callbacks;
              return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
            }),
          );
        }
        if (attempt <= 5) {
          const expectedDelay = Math.min(500 * 2 ** (attempt - 1), 8000);
          await vi.advanceTimersByTimeAsync(expectedDelay);
        }
      }

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "fatal", message: expect.stringContaining("reconnect failed after 5 attempts") }),
      );
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "gemini_status", status: "offline" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule a reconnect twice if onclose fires while a timer is already pending", async () => {
    vi.useFakeTimers();
    try {
      const live = make();
      /** @type {any} */
      let callbacks;
      const connect = makeConnectingSession({ live, onCloseCapture: (cb) => { callbacks = cb; } });
      await connect({ isReconnect: false });

      callbacks.onclose({ code: 1006, reason: "first" });
      const connectSpyBefore = (await getMockedGoogleGenAI()).mock.calls.length;
      // A second onclose before the timer fires must not double-schedule.
      callbacks.onclose({ code: 1006, reason: "second" });
      await vi.advanceTimersByTimeAsync(600);
      const connectSpyAfter = (await getMockedGoogleGenAI()).mock.calls.length;
      expect(connectSpyAfter).toBe(connectSpyBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("live-session: listen-only mode ownership (design.md D3)", () => {
  it("toggleListenOnly flips the state and pushes it to the renderer plus the tray", async () => {
    const emitToRenderer = vi.fn();
    const updateTrayMenu = vi.fn();
    const live = make({ emitToRenderer, updateTrayMenu });
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn() };
      }),
    );
    await live.startLive();
    emitToRenderer.mockClear();
    updateTrayMenu.mockClear();

    expect(live.getListenOnlyEngaged()).toBe(false);
    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(true);
    expect(emitToRenderer).toHaveBeenCalledWith("listen-only:state", { engaged: true });
    expect(updateTrayMenu).toHaveBeenCalled();

    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("neither engaging nor disengaging triggers a connect, disconnect, or config rebuild", async () => {
    const live = make();
    const GoogleGenAI = await getMockedGoogleGenAI();
    const close = vi.fn();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close };
      }),
    );
    await live.startLive();
    const connectCallsBefore = GoogleGenAI.mock.calls.length;

    live.toggleListenOnly();
    live.toggleListenOnly();

    expect(GoogleGenAI.mock.calls.length).toBe(connectCallsBefore);
    expect(close).not.toHaveBeenCalled();
  });

  it("toggling while asleep is a no-op", () => {
    const live = make();
    expect(live.getLiveStatus().running).toBe(false);
    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("resets to disengaged on an explicit stop", async () => {
    const live = make();
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
      }),
    );
    await live.startLive();
    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(true);

    await live.stopLive();
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("resets to disengaged once reconnect attempts are exhausted (server-initiated teardown)", async () => {
    vi.useFakeTimers();
    try {
      /** @type {any} */
      let callbacks;
      const live = make();
      const GoogleGenAI = await getMockedGoogleGenAI();
      GoogleGenAI.mockImplementationOnce(
        fakeGoogleGenAIImpl(async (config) => {
          callbacks = config.callbacks;
          callbacks.onopen();
          return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
        }),
      );
      await live.startLive();
      live.toggleListenOnly();
      expect(live.getListenOnlyEngaged()).toBe(true);

      for (let attempt = 1; attempt <= 6; attempt++) {
        callbacks.onclose({ code: 1006, reason: "network drop" });
        if (attempt < 6) {
          const g = await getMockedGoogleGenAI();
          g.mockImplementationOnce(
            fakeGoogleGenAIImpl(async (config) => {
              callbacks = config.callbacks;
              return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
            }),
          );
        }
        if (attempt <= 5) {
          const expectedDelay = Math.min(500 * 2 ** (attempt - 1), 8000);
          await vi.advanceTimersByTimeAsync(expectedDelay);
        }
      }

      expect(live.getListenOnlyEngaged()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("live-session: stopLive", () => {
  it("marks the session as user-stopped and resets listen-only mode", async () => {
    const live = make();
    const result = await live.stopLive();
    expect(result.running).toBe(false);
    expect(live.getListenOnlyEngaged()).toBe(false);
    expect(live.getLiveSession()).toBeNull();
  });
});
