import { describe, it, expect, vi } from "vitest";
import { createAmbientCapture } from "./ambient-capture.mjs";

// Ambient capture retains the user's conversations, so *when it is live* is a
// consent question, not a performance one. Two independent gates and two
// override conditions decide it, and every one of them must be able to say no
// on its own.

function makeCapture(over = {}) {
  const emitted = [];
  const flushes = [];
  const capture = createAmbientCapture({
    sessionsDir: "/tmp/sessions",
    flushIntervalMs: 30_000,
    recentUtterances: () => [{ text: "hello", at: 1 }],
    isListenOnlyEngaged: () => false,
    emitEvent: () => {},
    emitToRenderer: (channel, payload) => emitted.push({ channel, payload }),
    forcedOff: () => false,
    ...over,
  });
  return { capture, emitted, flushes };
}

describe("the live gates", () => {
  it("is not live until both the preference and wakefulness say yes", async () => {
    const { capture } = makeCapture();
    expect(capture.isLive()).toBe(false);
    await capture.setPreference(true);
    expect(capture.isLive()).toBe(false);
    await capture.setAwake(true);
    expect(capture.isLive()).toBe(true);
  });

  it("stops the moment either gate closes", async () => {
    const { capture } = makeCapture();
    await capture.setPreference(true);
    await capture.setAwake(true);
    await capture.setAwake(false);
    expect(capture.isLive()).toBe(false);
    await capture.setAwake(true);
    await capture.setPreference(false);
    expect(capture.isLive()).toBe(false);
  });

  // Listen-only widens what Iris hears to whatever the machine plays —
  // remote participants, a video, people who never agreed to anything. That
  // span is retained by nobody, which is the correct outcome.
  it("stands aside for the whole span listen-only mode is engaged", async () => {
    let engaged = false;
    const { capture } = makeCapture({ isListenOnlyEngaged: () => engaged });
    await capture.setPreference(true);
    await capture.setAwake(true);
    expect(capture.isLive()).toBe(true);
    engaged = true;
    expect(capture.isLive()).toBe(false);
  });

  // The env escape hatch outranks the user's own preference.
  it("stays off when forced off, whatever the user chose", async () => {
    const { capture } = makeCapture({ forcedOff: () => true });
    await capture.setPreference(true);
    await capture.setAwake(true);
    expect(capture.isLive()).toBe(false);
    expect(capture.isForcedOff()).toBe(true);
  });

  it("still reports the preference the user set while forced off", async () => {
    const { capture } = makeCapture({ forcedOff: () => true });
    await capture.setPreference(true);
    expect(capture.isPreferenceEnabled()).toBe(true);
  });
});

describe("transitions", () => {
  it("announces each real flip to the renderer exactly once", async () => {
    const { capture, emitted } = makeCapture();
    await capture.setPreference(true);
    await capture.setAwake(true);
    expect(emitted.filter((e) => e.channel === "ambient-capture:state")).toEqual([
      { channel: "ambient-capture:state", payload: { live: true } },
    ]);
    await capture.setAwake(false);
    expect(emitted.filter((e) => e.channel === "ambient-capture:state").map((e) => e.payload.live)).toEqual([
      true,
      false,
    ]);
  });

  // Repeated calls with the same inputs — the renderer re-sending its
  // preference, a second onAwake while already awake — must never reset the
  // watermark or re-flush.
  it("does nothing when the resolved state has not actually changed", async () => {
    const { capture, emitted } = makeCapture();
    await capture.setPreference(true);
    await capture.setAwake(true);
    const after = emitted.length;
    await capture.setAwake(true);
    await capture.setPreference(true);
    await capture.sync();
    expect(emitted.length).toBe(after);
  });

  it("is idempotent while off, too", async () => {
    const { capture, emitted } = makeCapture();
    await capture.setPreference(false);
    await capture.setAwake(false);
    expect(emitted).toEqual([]);
  });
});

describe("timers", () => {
  it("stops cleanly even when it was never started", () => {
    const { capture } = makeCapture();
    expect(() => capture.stopTimer()).not.toThrow();
  });

  it("does not leave a timer running after going not-live", async () => {
    vi.useFakeTimers();
    try {
      const { capture } = makeCapture();
      await capture.setPreference(true);
      await capture.setAwake(true);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await capture.setAwake(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The two IPC channels now live beside the state they touch, so a handler and
// its state cannot drift apart. They are declared by this module, and the
// capability spreads them into its own list.
describe("ipc handlers", () => {
  it("declares both channels with the right kind", () => {
    const { capture } = makeCapture();
    const byChannel = Object.fromEntries(capture.ipcHandlers.map((h) => [h.channel, h]));
    // A preference push is fire-and-forget; the query is a request/response.
    expect(byChannel["ambient-capture:set-enabled"].kind).toBe("on");
    expect(byChannel["ambient-capture:query"].kind).toBe("handle");
  });

  it("reports enabled, live and forcedOff together", () => {
    const { capture } = makeCapture({ forcedOff: () => true });
    const query = capture.ipcHandlers.find((h) => h.channel === "ambient-capture:query");
    expect(query.fn()).toEqual({ enabled: false, live: false, forcedOff: true });
  });

  it("turns the preference on through the handler, not around it", async () => {
    const { capture, emitted } = makeCapture();
    const setEnabled = capture.ipcHandlers.find((h) => h.channel === "ambient-capture:set-enabled");
    setEnabled.fn(null, { enabled: true });
    await capture.setAwake(true);
    expect(capture.isPreferenceEnabled()).toBe(true);
    expect(capture.isLive()).toBe(true);
    expect(emitted.some((e) => e.channel === "ambient-capture:state")).toBe(true);
  });

  // A malformed payload must not enable retention.
  it("coerces a missing or malformed payload to off", () => {
    const { capture } = makeCapture();
    const setEnabled = capture.ipcHandlers.find((h) => h.channel === "ambient-capture:set-enabled");
    setEnabled.fn(null, undefined);
    expect(capture.isPreferenceEnabled()).toBe(false);
    setEnabled.fn(null, { enabled: "yes" });
    expect(capture.isPreferenceEnabled()).toBe(true);
  });
});
