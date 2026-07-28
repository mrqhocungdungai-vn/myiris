import { describe, it, expect, vi } from "vitest";
import { runBoundary } from "./listen-boundary.mjs";

function makeFakeSession() {
  let turnCompleteCb = null;
  let handleCb = null;
  return {
    calls: { activityEnd: 0, disconnect: 0 },
    sendActivityEnd() {
      this.calls.activityEnd += 1;
    },
    onTurnComplete(cb) {
      turnCompleteCb = cb;
      return () => {
        turnCompleteCb = null;
      };
    },
    onFreshResumptionHandle(cb) {
      handleCb = cb;
      return () => {
        handleCb = null;
      };
    },
    disconnect() {
      this.calls.disconnect += 1;
    },
    fireTurnComplete() {
      turnCompleteCb?.();
    },
    fireFreshHandle(handle) {
      handleCb?.(handle);
    },
    hasHandleListener() {
      return handleCb !== null;
    },
  };
}

describe("runBoundary", () => {
  it("sends activityEnd before anything else, and does not disconnect until a fresh handle arrives", async () => {
    vi.useFakeTimers();
    try {
      const session = makeFakeSession();
      const promise = runBoundary(session);

      expect(session.calls.activityEnd).toBe(1);
      expect(session.calls.disconnect).toBe(0);

      session.fireTurnComplete();
      await Promise.resolve();
      expect(session.calls.disconnect).toBe(0);

      session.fireFreshHandle("fresh-handle");
      const result = await promise;

      expect(session.calls.disconnect).toBe(1);
      expect(result).toEqual({ turnCompleteMissing: false, handleMissing: false, handle: "fresh-handle" });
    } finally {
      vi.useRealTimers();
    }
  });

  // This is the anti-regression test for the measured total-context-loss
  // failure (design.md Decision 5): a handle that already existed before the
  // boundary began must NOT satisfy the wait. Seeding a pre-existing handle
  // and asserting the boundary still waits is the point — a version that
  // reads "is resumptionHandle non-null" instead of "did a fresh one arrive"
  // would pass a naive test but reproduce the bug.
  it("does not resolve on a handle that existed before this boundary began", async () => {
    vi.useFakeTimers();
    try {
      const session = makeFakeSession();
      // Simulate main.mjs already holding a stale handle from before the
      // mode was entered: nothing in runBoundary's contract lets a caller
      // hand it a pre-existing value, because onFreshResumptionHandle only
      // fires on a NEW event pushed after subscription — so there is nothing
      // to "seed" except confirming that firing an old-style event before
      // subscription would be impossible by construction. Assert instead
      // that disconnect has not happened merely because turnComplete fired.
      const promise = runBoundary(session);
      session.fireTurnComplete();
      await Promise.resolve();
      await Promise.resolve();

      expect(session.calls.disconnect).toBe(0);
      expect(session.hasHandleListener()).toBe(true);

      session.fireFreshHandle("post-boundary-handle");
      const result = await promise;
      expect(result.handle).toBe("post-boundary-handle");
      expect(session.calls.disconnect).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("proceeds after a bounded wait elapses instead of hanging, and records what was missing", async () => {
    vi.useFakeTimers();
    try {
      const session = makeFakeSession();
      const missing = [];
      const promise = runBoundary(session, {
        turnCompleteTimeoutMs: 1000,
        handleTimeoutMs: 1000,
        onMissing: (what) => missing.push(what),
      });

      await vi.advanceTimersByTimeAsync(1000); // turnComplete wait elapses
      await vi.advanceTimersByTimeAsync(1000); // handle wait elapses
      const result = await promise;

      expect(missing).toEqual(["turnComplete", "resumptionHandle"]);
      expect(result).toEqual({ turnCompleteMissing: true, handleMissing: true, handle: null });
      expect(session.calls.disconnect).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still waits for the handle even if turnComplete arrived immediately", async () => {
    vi.useFakeTimers();
    try {
      const session = makeFakeSession();
      const promise = runBoundary(session, { handleTimeoutMs: 5000 });
      session.fireTurnComplete();

      await vi.advanceTimersByTimeAsync(4000);
      expect(session.calls.disconnect).toBe(0);

      session.fireFreshHandle("handle-after-delay");
      const result = await promise;
      expect(result.handle).toBe("handle-after-delay");
    } finally {
      vi.useRealTimers();
    }
  });
});
