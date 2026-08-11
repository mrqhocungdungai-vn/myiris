import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenUsageCapability, EMIT_THROTTLE_MS } from "./token-usage.mjs";

// The ledger writes one diagnostic line per counted run. Silenced here — this
// file is about the capability's lifecycle, not about what it logs.
let logSpy;
beforeEach(() => {
  vi.useFakeTimers();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  logSpy.mockRestore();
});

/** @param {{ window?: any }} [options] */
function make({ window = { isDestroyed: () => false } } = {}) {
  const emitToRenderer = vi.fn();
  const capability = createTokenUsageCapability({ emitToRenderer, getMainWindow: () => window });
  return { capability, emitToRenderer };
}

function handlerFor(capability, channel) {
  const entry = capability.ipcHandlers.find((h) => h.channel === channel);
  if (!entry) throw new Error(`no handler for ${channel}`);
  return entry;
}

function run(runId, tokens) {
  return { run_id: runId, status: "completed", usage: { usage: { input_tokens: tokens } } };
}

describe("token-usage capability", () => {
  it("coalesces a burst of records into one emit", () => {
    const { capability, emitToRenderer } = make();
    for (let i = 0; i < 20; i += 1) capability.recordGeminiUsage({ totalTokenCount: 100 + i });
    capability.recordClaudeRun(run("r1", 500));
    // Nothing has gone out yet — the throttle fires on the trailing edge.
    expect(emitToRenderer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(EMIT_THROTTLE_MS);
    expect(emitToRenderer).toHaveBeenCalledTimes(1);
    const [channel, payload] = emitToRenderer.mock.calls[0];
    expect(channel).toBe("token-usage:update");
    // The emit carries the CURRENT snapshot, not the state at the first record.
    expect(payload.gemini.total).toBe(119);
    expect(payload.claude.total).toBe(500);
  });

  it("drops the emit when the window is gone, and keeps counting anyway", () => {
    const { capability, emitToRenderer } = make({ window: { isDestroyed: () => true } });
    capability.recordGeminiUsage({ totalTokenCount: 100 });
    vi.advanceTimersByTime(EMIT_THROTTLE_MS);
    expect(emitToRenderer).not.toHaveBeenCalled();
    // Counting is never gated on anything displaying it (design D6).
    expect(capability.snapshot().gemini.total).toBe(100);
  });

  it("drops the emit when there is no window at all", () => {
    const emitToRenderer = vi.fn();
    const capability = createTokenUsageCapability({ emitToRenderer, getMainWindow: () => null });
    capability.recordGeminiUsage({ totalTokenCount: 100 });
    vi.advanceTimersByTime(EMIT_THROTTLE_MS);
    expect(emitToRenderer).not.toHaveBeenCalled();
  });

  it("answers the snapshot handle with the current figures, with no push having happened", () => {
    const { capability, emitToRenderer } = make();
    capability.recordGeminiUsage({ totalTokenCount: 4_200 });
    // This is the case that makes the display gate harmless: a panel opened
    // after an hour of conversation must show the hour, not a fresh start.
    const snapshot = handlerFor(capability, "token-usage:snapshot").fn();
    expect(snapshot.gemini.total).toBe(4_200);
    expect(emitToRenderer).not.toHaveBeenCalled();
  });

  it("declares the snapshot as a handle and the subscribe as a send", () => {
    const { capability } = make();
    expect(handlerFor(capability, "token-usage:snapshot").kind).toBe("handle");
    expect(handlerFor(capability, "token-usage:subscribe").kind).toBe("on");
    // No prompt fragment and no tool declaration — the account may not reach a
    // model's surface at all.
    expect(capability.toolDeclarations).toEqual([]);
    expect(capability.promptFragment).toBeUndefined();
  });

  it("leaves no timer armed after teardown", () => {
    const { capability, emitToRenderer } = make();
    capability.recordGeminiUsage({ totalTokenCount: 100 });
    capability.teardown();
    vi.advanceTimersByTime(EMIT_THROTTLE_MS * 4);
    expect(emitToRenderer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
