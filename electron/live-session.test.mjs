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
    expect(emitToRenderer).toHaveBeenCalledWith("listen-only:state", {
      engaged: true,
      systemAudio: false,
      systemAudioGain: 0.7,
      // The window's own bound rides the same push (listen-window-is-bounded
      // D6) — one authority for the mode, one more field on it.
      deadlineAt: expect.any(Number),
      windowMs: 5 * 60_000,
    });
    expect(updateTrayMenu).toHaveBeenCalled();

    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  // The boundary the transcript filter reads. Stamped on the single writer for
  // the transition, so the user's own toggle and the window expiring set it
  // identically — and stamped even when the window heard nothing, which is the
  // case an inferred transcript edge would miss.
  it("stamps the listening-window boundary on disengage, not on engage", async () => {
    const markListenWindowEnded = vi.fn();
    const live = make({ markListenWindowEnded });
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn() };
      }),
    );
    await live.startLive();

    live.toggleListenOnly();
    expect(markListenWindowEnded).not.toHaveBeenCalled();
    live.toggleListenOnly();
    expect(markListenWindowEnded).toHaveBeenCalledTimes(1);
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

  it("stays ENGAGED once reconnect attempts are exhausted — a network blip must not restore the voice", async () => {
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

      // The behaviour change (listen-mode-hears-system-audio D4): this used to
      // disengage, which un-suppresses audio — Iris would start speaking aloud
      // into the room after a network drop, at the moment the user is least
      // likely to be looking at the screen.
      expect(live.getListenOnlyEngaged()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// listen-mode-hears-system-audio §2/§3. Three things have to hold at once: the transport is never touched, the model
// is ASKED to stay quiet without being asked to speak, and none of it happens
// under the escape hatch.
describe("live-session: the in-band silence request (listen-mode-hears-system-audio D3)", () => {
  async function engagedSession(overrides = {}) {
    const session = {
      sendRealtimeInput: vi.fn(),
      sendClientContent: vi.fn(),
      close: vi.fn(),
    };
    const live = make({ systemAudioEnabled: () => true, systemAudioGain: () => 0.5, ...overrides });
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return session;
      }),
    );
    await live.startLive();
    return { live, session, GoogleGenAI };
  }

  it("sends the request with sendClientContent and turnComplete false — never sendRealtimeInput", async () => {
    const { live, session } = await engagedSession();
    session.sendRealtimeInput.mockClear();

    live.toggleListenOnly();

    expect(session.sendClientContent).toHaveBeenCalledTimes(1);
    const sent = session.sendClientContent.mock.calls[0][0];
    // turnComplete:false ADDS conversation content without closing a turn, so
    // the model is never asked to generate. sendRealtimeInput expects a reply
    // and would provoke exactly the turn this is trying to prevent.
    expect(sent.turnComplete).toBe(false);
    expect(sent.turns[0].parts[0].text).toContain("SYSTEM_EVENT_LISTEN_ONLY_ENGAGED");
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it("sends the disengage request on the way back out", async () => {
    const { live, session } = await engagedSession();
    live.toggleListenOnly();
    session.sendClientContent.mockClear();
    session.sendRealtimeInput.mockClear();

    live.toggleListenOnly();

    const sent = session.sendClientContent.mock.calls[0][0];
    expect(sent.turns[0].parts[0].text).toContain("SYSTEM_EVENT_LISTEN_ONLY_DISENGAGED");
    // Unchanged by iris-answers-from-the-open-folder, and the reason that change
    // needed no mechanism (D4): the note that now sends Iris to the prepared
    // folder still travels as conversation content on the SAME in-band path,
    // still without asking for a reply. What it says changed; how it arrives
    // did not.
    expect(sent.turnComplete).toBe(false);
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it("neither transition reconnects or rebuilds the session config", async () => {
    const { live, session, GoogleGenAI } = await engagedSession();
    const connectsBefore = GoogleGenAI.mock.calls.length;

    live.toggleListenOnly();
    live.toggleListenOnly();

    expect(GoogleGenAI.mock.calls.length).toBe(connectsBefore);
    expect(session.close).not.toHaveBeenCalled();
  });

  it("sends nothing at all under the IRIS_SYSTEM_AUDIO escape hatch", async () => {
    const { live, session } = await engagedSession({ systemAudioEnabled: () => false });

    live.toggleListenOnly();
    live.toggleListenOnly();

    expect(session.sendClientContent).not.toHaveBeenCalled();
  });

  it("does not let a failed send stop the mode from engaging", async () => {
    const { live, session } = await engagedSession();
    session.sendClientContent.mockImplementation(() => {
      throw new Error("socket closed");
    });

    live.toggleListenOnly();

    // Discarding at the client is the guarantee; the request is only a cost
    // reduction, so its failure must never be the mode's failure.
    expect(live.getListenOnlyEngaged()).toBe(true);
  });

  it("re-states the request on a reconnect, since the conversation may not have survived", async () => {
    const { live, session } = await engagedSession();
    live.toggleListenOnly();
    session.sendClientContent.mockClear();

    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return session;
      }),
    );
    await live.connectLive({ isReconnect: true });

    expect(session.sendClientContent.mock.calls[0][0].turns[0].parts[0].text).toContain(
      "SYSTEM_EVENT_LISTEN_ONLY_ENGAGED",
    );
  });

  it("speaks no welcome greeting while the mode is engaged", async () => {
    const { live, session } = await engagedSession();
    live.toggleListenOnly();
    session.sendRealtimeInput.mockClear();

    live.GreetGate.arm();
    live.GreetGate.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it("reports every transition on one hook, and releases the mode when the renderer goes away", async () => {
    const onListenOnlyChange = vi.fn();
    const { live } = await engagedSession({ onListenOnlyChange });

    live.toggleListenOnly();
    expect(onListenOnlyChange).toHaveBeenLastCalledWith(true);

    live.handleRendererGone();
    expect(live.getListenOnlyEngaged()).toBe(false);
    expect(onListenOnlyChange).toHaveBeenLastCalledWith(false);
  });

  it("disengages when the capture could not be acquired at all, and only then", async () => {
    const { live } = await engagedSession();

    // Not engaged: nothing to undo, and nothing to report.
    live.handleSystemAudioUnavailable("NotAllowedError");
    expect(live.getListenOnlyEngaged()).toBe(false);

    live.toggleListenOnly();
    live.handleSystemAudioUnavailable("NotAllowedError");
    expect(live.getListenOnlyEngaged()).toBe(false);
  });
});

// listen-window-is-bounded. The claim under test is not "a timer fires" — it is
// that expiry and the user's toggle are ONE path, so everything hanging off the
// writer happens for both and cannot drift apart.
describe("live-session: the bounded listening window", () => {
  const WINDOW_MS = 5 * 60_000;

  // The same fake clock shape listen-window.test.mjs uses, injected as one
  // object so the five-minute deadline is driven in microseconds.
  function fakeClock(startAt = 1_000_000) {
    let current = startAt;
    /** @type {Array<{ fn: () => void, dueAt: number, cancelled: boolean }>} */
    const timers = [];
    return {
      now: () => current,
      setTimer: (fn, ms) => {
        const timer = { fn, dueAt: current + ms, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => {
        if (timer) timer.cancelled = true;
      },
      advance(ms) {
        current += ms;
        // A copy: firing a timer may cancel or add one, and mutating the list
        // being iterated is how a fake clock quietly drops a timer.
        for (const timer of timers.slice()) {
          if (!timer.cancelled && timer.dueAt <= current) {
            timer.cancelled = true;
            timer.fn();
          }
        }
      },
    };
  }

  async function engagedSession(overrides = {}) {
    const clock = fakeClock();
    const session = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
    const deps = {
      emitEvent: vi.fn(),
      emitToRenderer: vi.fn(),
      updateTrayMenu: vi.fn(),
      onListenOnlyChange: vi.fn(),
      systemAudioEnabled: () => true,
      listenWindowMs: () => WINDOW_MS,
      listenWindowClock: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      ...overrides,
    };
    const live = make(deps);
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return session;
      }),
    );
    await live.startLive();
    return { live, session, clock, deps };
  }

  it("opens a window with the configured length when the mode engages", async () => {
    const { live, clock, deps } = await engagedSession();
    deps.emitToRenderer.mockClear();

    live.toggleListenOnly();

    expect(live.listenOnlyStatePayload()).toMatchObject({
      engaged: true,
      deadlineAt: clock.now() + WINDOW_MS,
      windowMs: WINDOW_MS,
    });
    expect(deps.emitToRenderer).toHaveBeenCalledWith(
      "listen-only:state",
      expect.objectContaining({ deadlineAt: clock.now() + WINDOW_MS }),
    );
  });

  // The point of the whole change: at the deadline the mode ends by itself, and
  // it ends the same way the user's toggle ends it.
  it("disengages at the deadline through the same path as a manual toggle", async () => {
    const { live, session, clock, deps } = await engagedSession();
    live.toggleListenOnly();
    deps.emitToRenderer.mockClear();
    deps.updateTrayMenu.mockClear();
    session.sendClientContent.mockClear();

    clock.advance(WINDOW_MS - 1);
    expect(live.getListenOnlyEngaged()).toBe(true);

    clock.advance(1);
    expect(live.getListenOnlyEngaged()).toBe(false);
    // Every consumer of the writer, observed: the renderer push, the in-band
    // note that ends the silence request, the transition hook, and the tray.
    expect(deps.emitToRenderer).toHaveBeenCalledWith(
      "listen-only:state",
      expect.objectContaining({ engaged: false, deadlineAt: null }),
    );
    expect(session.sendClientContent.mock.calls[0][0].turns[0].parts[0].text).toContain(
      "SYSTEM_EVENT_LISTEN_ONLY_DISENGAGED",
    );
    expect(deps.onListenOnlyChange).toHaveBeenLastCalledWith(false);
    expect(deps.updateTrayMenu).toHaveBeenCalled();
  });

  it("does not move the deadline for anything Iris hears", async () => {
    const { live, clock } = await engagedSession();
    live.toggleListenOnly();
    const { deadlineAt } = live.listenOnlyStatePayload();

    // Continuous speech is what this mode is pointed at, and it reaches the
    // session through live-messages — never through the window. There is no
    // input here that could re-arm it, which is the assertion.
    clock.advance(WINDOW_MS - 1000);
    expect(live.listenOnlyStatePayload().deadlineAt).toBe(deadlineAt);
    expect(live.getListenOnlyEngaged()).toBe(true);
    clock.advance(1000);
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("cancels the expiry on a manual disengage, so nothing fires at the original deadline", async () => {
    const { live, clock, deps } = await engagedSession();
    live.toggleListenOnly();
    clock.advance(60_000);
    live.toggleListenOnly();
    expect(live.getListenOnlyEngaged()).toBe(false);
    deps.emitToRenderer.mockClear();

    clock.advance(WINDOW_MS * 2);
    // No second disengage, and no push claiming one happened.
    expect(deps.emitToRenderer).not.toHaveBeenCalled();
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("gives a full window to a mode re-engaged after one expired", async () => {
    const { live, clock } = await engagedSession();
    live.toggleListenOnly();
    clock.advance(WINDOW_MS);
    expect(live.getListenOnlyEngaged()).toBe(false);

    clock.advance(120_000);
    live.toggleListenOnly();
    expect(live.listenOnlyStatePayload().deadlineAt).toBe(clock.now() + WINDOW_MS);
  });

  it("closes the window when the session is stopped, so no deadline outlives it", async () => {
    const { live, clock, deps } = await engagedSession();
    live.toggleListenOnly();
    await live.stopLive();
    expect(live.getListenOnlyEngaged()).toBe(false);
    expect(live.listenOnlyStatePayload().deadlineAt).toBe(null);
    deps.emitToRenderer.mockClear();

    // A later wake does not inherit a running deadline.
    clock.advance(WINDOW_MS * 2);
    expect(deps.emitToRenderer).not.toHaveBeenCalled();
  });

  // Iris is silent while engaged, so she cannot say how long she listened. The
  // conversation panel gets exactly one entry, and it names the span rather than
  // a record, because no record is written.
  it("leaves ONE entry behind stating how long she listened", async () => {
    const emitEvent = vi.fn();
    const { live, clock } = await engagedSession({ emitEvent });
    live.toggleListenOnly();
    clock.advance(90_000);
    emitEvent.mockClear();

    live.toggleListenOnly();

    const transcripts = emitEvent.mock.calls.map(([event]) => event).filter((event) => event.type === "transcript");
    expect(transcripts).toEqual([{ type: "transcript", speaker: "heard", text: "Listened for 1m 30s" }]);
    expect(transcripts[0].text).not.toMatch(/inbox|saved/i);
  });

  it("reports the full length when the window itself ended the engagement", async () => {
    const emitEvent = vi.fn();
    const { live, clock } = await engagedSession({ emitEvent });
    live.toggleListenOnly();
    emitEvent.mockClear();

    clock.advance(WINDOW_MS);

    expect(emitEvent).toHaveBeenCalledWith({ type: "transcript", speaker: "heard", text: "Listened for 5m 00s" });
  });

  // The bound belongs to the mode, not to the capture (spec: "The bound applies
  // with system audio disabled").
  it("still bounds the engagement under the IRIS_SYSTEM_AUDIO escape hatch", async () => {
    const { live, clock } = await engagedSession({ systemAudioEnabled: () => false });
    live.toggleListenOnly();
    expect(live.listenOnlyStatePayload().deadlineAt).toBe(clock.now() + WINDOW_MS);

    clock.advance(WINDOW_MS);
    expect(live.getListenOnlyEngaged()).toBe(false);
  });

  it("honours the length main resolved for it, rather than a length of its own", async () => {
    const { live, clock } = await engagedSession({ listenWindowMs: () => 90_000 });
    live.toggleListenOnly();
    expect(live.listenOnlyStatePayload().windowMs).toBe(90_000);

    clock.advance(89_999);
    expect(live.getListenOnlyEngaged()).toBe(true);
    clock.advance(1);
    expect(live.getListenOnlyEngaged()).toBe(false);
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

// ambient-memory: capture follows the microphone, so these two callbacks are
// the ONLY signal ambient session capture gets about whether Iris is
// actually listening — never a heuristic read off some other state.
describe("live-session: onAwake/onAsleep (ambient session capture)", () => {
  it("calls onAwake on a real connection", async () => {
    const onAwake = vi.fn();
    const onAsleep = vi.fn();
    const live = make({ onAwake, onAsleep });
    const GoogleGenAI = await getMockedGoogleGenAI();
    GoogleGenAI.mockImplementationOnce(
      fakeGoogleGenAIImpl(async (args) => {
        args.callbacks.onopen();
        return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn() };
      }),
    );
    await live.startLive();
    expect(onAwake).toHaveBeenCalledTimes(1);
    expect(onAsleep).not.toHaveBeenCalled();
  });

  it("calls onAsleep on an explicit stop, even with no session ever having connected", async () => {
    const onAwake = vi.fn();
    const onAsleep = vi.fn();
    const live = make({ onAwake, onAsleep });
    await live.stopLive();
    expect(onAsleep).toHaveBeenCalledTimes(1);
    expect(onAwake).not.toHaveBeenCalled();
  });

  it("does not call onAsleep on a transient disconnect that goes on to reconnect", async () => {
    vi.useFakeTimers();
    try {
      const onAwake = vi.fn();
      const onAsleep = vi.fn();
      /** @type {any} */
      let callbacks;
      const live = make({ onAwake, onAsleep });
      const connect = async (_opts) => {
        const GoogleGenAI = await getMockedGoogleGenAI();
        GoogleGenAI.mockImplementationOnce(
          fakeGoogleGenAIImpl(async (config) => {
            callbacks = config.callbacks;
            callbacks.onopen();
            return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
          }),
        );
        return live.connectLive(_opts);
      };
      await connect({ isReconnect: false });
      onAwake.mockClear();

      callbacks.onclose({ code: 1006, reason: "network drop" });
      const GoogleGenAI = await getMockedGoogleGenAI();
      GoogleGenAI.mockImplementationOnce(
        fakeGoogleGenAIImpl(async (config) => {
          callbacks = config.callbacks;
          callbacks.onopen();
          return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
        }),
      );
      await vi.advanceTimersByTimeAsync(500);

      expect(onAsleep).not.toHaveBeenCalled();
      expect(onAwake).toHaveBeenCalledTimes(1); // the reconnect's own onopen
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onAsleep once reconnect attempts are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const onAsleep = vi.fn();
      /** @type {any} */
      let callbacks;
      const live = make({ onAsleep });
      const GoogleGenAI = await getMockedGoogleGenAI();
      GoogleGenAI.mockImplementationOnce(
        fakeGoogleGenAIImpl(async (config) => {
          callbacks = config.callbacks;
          callbacks.onopen();
          return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
        }),
      );
      await live.startLive();

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

      expect(onAsleep).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The startup line naming which credential a run will bill against. Asserted by
// BRANCH, not just by "it was called": the message used to read "will bill
// against the Claude subscription" whenever any credential was present, so an
// API-key-only user was told they were on a subscription they had not bought.
// wiring-live.test.mjs checks the call happens; nothing checked what it said.
describe("live-session: which credential the startup log names", () => {
  /** @param {Record<string, string>} env */
  function logWith(env) {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, env);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      make().logClaudeBillingPathOnce();
      return {
        logged: log.mock.calls.map(([line]) => String(line)).join("\n"),
        warned: warn.mock.calls.map(([line]) => String(line)).join("\n"),
      };
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  }

  it("names the subscription when a subscription token is set", () => {
    const { logged, warned } = logWith({ CLAUDE_CODE_OAUTH_TOKEN: "tok" });
    expect(logged).toContain("[IRIS][claude-auth]");
    expect(logged).toMatch(/bill against the Claude subscription/);
    expect(warned).toBe("");
  });

  // The credential that pays outranks the one that does not: a subscription
  // token present means the API key is stripped from the worker environment
  // (worker-env.mjs), so the log must say subscription, not per-token.
  it("still names the subscription when both credentials are set", () => {
    const { logged } = logWith({ CLAUDE_CODE_OAUTH_TOKEN: "tok", ANTHROPIC_API_KEY: "sk-test" });
    expect(logged).toMatch(/bill against the Claude subscription/);
    expect(logged).not.toMatch(/per token/);
  });

  // The branch that did not exist: an API key IS a working credential, and
  // reporting it as a subscription was a false account of what the user pays.
  it("names metered billing when only an API key is set", () => {
    const { logged, warned } = logWith({ ANTHROPIC_API_KEY: "sk-test" });
    expect(logged).toMatch(/bill per token against ANTHROPIC_API_KEY/);
    expect(logged).not.toMatch(/bill against the Claude subscription/);
    expect(warned).toBe("");
  });

  // No credential is the honest chat-only state: it warns, and says both ways
  // out rather than only the subscription one.
  it("warns with both remedies when there is no credential at all", () => {
    const { logged, warned } = logWith({});
    expect(logged).toBe("");
    expect(warned).toContain("[IRIS][claude-auth]");
    expect(warned).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(warned).toMatch(/ANTHROPIC_API_KEY/);
    // Voice conversation does not need a Claude credential, and a warning that
    // implied otherwise would read as the whole app being broken.
    expect(warned).toMatch(/Voice conversation is unaffected/);
  });
});
