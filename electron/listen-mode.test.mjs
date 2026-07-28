import { describe, it, expect, vi } from "vitest";
import { createListenMode } from "./listen-mode.mjs";

function makeLiveSession() {
  return { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), close: vi.fn() };
}

function make(overrides = {}) {
  let liveSession = makeLiveSession();
  const deps = {
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    updateTrayMenu: vi.fn(),
    getLiveSession: () => liveSession,
    getLiveStatus: () => ({ running: true }),
    getUserStopped: () => false,
    connectLive: vi.fn(async () => {}),
    scheduleReconnect: vi.fn(),
    buildListenEntryConfirmationPrompt: () => "confirm entry",
    buildListenExitSynthesisPrompt: (segment) => `synthesis: ${segment}`,
    ...overrides,
  };
  const listenMode = createListenMode(deps);
  return { listenMode, deps, setLiveSession: (s) => { liveSession = s; } };
}

describe("listen-mode: toggleListenMode", () => {
  it("does nothing while asleep (not running)", () => {
    const { listenMode } = make({ getLiveStatus: () => ({ running: false }) });
    listenMode.toggleListenMode();
    expect(listenMode.ListenMode.engaged).toBe(false);
    expect(listenMode.ListenMode.transitioning).toBe(false);
  });

  it("does nothing during a transition", () => {
    const { listenMode } = make();
    listenMode.ListenMode.transitioning = true;
    listenMode.toggleListenMode();
    // No enter/exit was kicked off — transitioning stays exactly as set.
    expect(listenMode.ListenMode.transitioning).toBe(true);
  });
});

describe("listen-mode: enterListenMode (via toggleListenMode — the only public entry point)", () => {
  it("engages, sends activityStart, and arms the rotation timer", async () => {
    vi.useFakeTimers();
    try {
      const connectLive = vi.fn(async () => {});
      const session = makeLiveSession();
      const { listenMode } = make({ connectLive, getLiveSession: () => session });

      listenMode.toggleListenMode();
      // enterListenMode awaits waitForLiveClose() first — resolve it via the
      // live-close event bus, exactly as onclose would.
      await vi.waitFor(() => expect(connectLive).not.toHaveBeenCalled());
      listenMode.notifyLiveClosed();
      await vi.waitFor(() => expect(connectLive).toHaveBeenCalledWith({ isReconnect: true, mode: "listen" }));
      // driveTurnAndWaitForCompletion waits for turnComplete or a timeout.
      listenMode.notifyTurnComplete();
      await vi.waitFor(() => expect(listenMode.ListenMode.engaged).toBe(true));
      expect(session.sendRealtimeInput).toHaveBeenCalledWith({ activityStart: {} });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not engage twice on a second toggle while already engaging", async () => {
    const connectLive = vi.fn(async () => new Promise(() => {})); // never resolves
    const { listenMode } = make({ connectLive });
    listenMode.toggleListenMode();
    expect(listenMode.ListenMode.transitioning).toBe(true);
    listenMode.toggleListenMode(); // second call, transitioning is true — no-op
    expect(connectLive).not.toHaveBeenCalled(); // still waiting on waitForLiveClose
  });
});

describe("listen-mode: runListenRotation", () => {
  async function engage(listenMode, connectLive) {
    listenMode.toggleListenMode();
    listenMode.notifyLiveClosed();
    await vi.waitFor(() => expect(connectLive).toHaveBeenCalled());
    listenMode.notifyTurnComplete();
    await vi.waitFor(() => expect(listenMode.ListenMode.engaged).toBe(true));
  }

  it("rotates: runs the boundary, reconnects in listen mode, and re-arms", async () => {
    vi.useFakeTimers();
    try {
      const connectLive = vi.fn(async () => {});
      const { listenMode } = make({ connectLive });
      await engage(listenMode, connectLive);
      connectLive.mockClear();

      // Fire the rotation timer (armed for listenChunkMs, default 8 minutes).
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
      // The rotation boundary awaits runBoundary(); satisfy it via the event bus.
      listenMode.notifyTurnComplete();
      await Promise.resolve();
      await Promise.resolve();
      listenMode.notifyFreshResumptionHandle("fresh-handle");
      listenMode.notifyLiveClosed();
      await vi.waitFor(() => expect(connectLive).toHaveBeenCalledWith({ isReconnect: true, mode: "listen" }));
      expect(listenMode.ListenMode.engaged).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not satisfy a fresh boundary with a resumption handle notified before the boundary began (stale-handle case)", async () => {
    vi.useFakeTimers();
    try {
      const connectLive = vi.fn(async () => {});
      const { listenMode } = make({ connectLive });
      await engage(listenMode, connectLive);
      connectLive.mockClear();

      // A handle arrives BEFORE the rotation boundary starts (e.g. leftover
      // from a prior turn) — this must not be treated as this boundary's
      // fresh handle. The event bus's onFreshResumptionHandle subscribes only
      // after the boundary begins, so an earlier notify simply has no
      // listener yet and is structurally impossible to "leak" forward.
      listenMode.notifyFreshResumptionHandle("stale-handle-before-boundary");

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
      // The boundary is now waiting on a FRESH turnComplete + handle pair;
      // it must not have resolved from the stale notify above.
      expect(connectLive).not.toHaveBeenCalled();

      listenMode.notifyTurnComplete();
      await Promise.resolve();
      await Promise.resolve();
      listenMode.notifyFreshResumptionHandle("real-handle");
      listenMode.notifyLiveClosed();
      await vi.waitFor(() => expect(connectLive).toHaveBeenCalledWith({ isReconnect: true, mode: "listen" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the ordinary reconnect and preserves the segment when the listen-mode reconnect itself fails", async () => {
    vi.useFakeTimers();
    try {
      const connectLive = vi.fn(async () => {});
      const scheduleReconnect = vi.fn();
      const { listenMode } = make({ connectLive, scheduleReconnect });
      await engage(listenMode, connectLive);
      listenMode.ListenMode.segmentRecord = "captured chunk";
      connectLive.mockClear();
      connectLive.mockImplementationOnce(async () => {
        throw new Error("reconnect failed");
      });

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
      listenMode.notifyTurnComplete();
      await Promise.resolve();
      await Promise.resolve();
      listenMode.notifyFreshResumptionHandle("handle");
      listenMode.notifyLiveClosed();

      await vi.waitFor(() => expect(scheduleReconnect).toHaveBeenCalledWith("reconnect failed"));
      expect(listenMode.ListenMode.engaged).toBe(false);
      expect(listenMode.ListenMode.synthesizeOnNextConverseConnect).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listen-mode: exitListenMode (via toggleListenMode)", () => {
  it("exits, delivers the exit synthesis, and disengages", async () => {
    vi.useFakeTimers();
    try {
      const connectLive = vi.fn(async () => {});
      const session = makeLiveSession();
      const { listenMode } = make({ connectLive, getLiveSession: () => session });
      await (async () => {
        listenMode.toggleListenMode();
        listenMode.notifyLiveClosed();
        await vi.waitFor(() => expect(connectLive).toHaveBeenCalled());
        listenMode.notifyTurnComplete();
        await vi.waitFor(() => expect(listenMode.ListenMode.engaged).toBe(true));
      })();
      connectLive.mockClear();
      session.sendClientContent.mockClear();

      listenMode.ListenMode.segmentRecord = "what was said";
      listenMode.toggleListenMode(); // now engaged -> exits
      listenMode.notifyTurnComplete();
      await Promise.resolve();
      await Promise.resolve();
      listenMode.notifyFreshResumptionHandle("handle");
      listenMode.notifyLiveClosed();
      await vi.waitFor(() => expect(connectLive).toHaveBeenCalledWith({ isReconnect: true, mode: "converse" }));
      await vi.waitFor(() => expect(listenMode.ListenMode.engaged).toBe(false));
      expect(session.sendClientContent).toHaveBeenCalledWith(
        expect.objectContaining({ turns: [{ role: "user", parts: [{ text: "synthesis: what was said" }] }] }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listen-mode: resetListenModeSilently", () => {
  it("clears all state and disengages without running a boundary", () => {
    const { listenMode } = make();
    listenMode.ListenMode.engaged = true;
    listenMode.ListenMode.segmentRecord = "leftover";
    listenMode.ListenMode.synthesizeOnNextConverseConnect = true;
    listenMode.resetListenModeSilently();
    expect(listenMode.ListenMode.engaged).toBe(false);
    expect(listenMode.ListenMode.segmentRecord).toBe("");
    expect(listenMode.ListenMode.synthesizeOnNextConverseConnect).toBe(false);
    expect(listenMode.ListenMode.transitioning).toBe(false);
    expect(listenMode.ListenMode.boundaryInFlight).toBe(false);
  });
});

describe("listen-mode: setListenEngaged", () => {
  it("emits listen-mode:state and updates the tray only on an actual change", () => {
    const emitToRenderer = vi.fn();
    const updateTrayMenu = vi.fn();
    const { listenMode } = make({ emitToRenderer, updateTrayMenu });
    listenMode.setListenEngaged(true);
    expect(emitToRenderer).toHaveBeenCalledWith("listen-mode:state", { engaged: true });
    expect(updateTrayMenu).toHaveBeenCalledTimes(1);

    emitToRenderer.mockClear();
    updateTrayMenu.mockClear();
    listenMode.setListenEngaged(true); // no change
    expect(emitToRenderer).not.toHaveBeenCalled();
    expect(updateTrayMenu).not.toHaveBeenCalled();
  });
});
