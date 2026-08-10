import { describe, it, expect, vi } from "vitest";
import { createListenWindow, formatDuration } from "./listen-window.mjs";

// A fake clock and a fake timer, so the five-minute bound is asserted in
// microseconds and without Electron (design D2). `setTimer` records the delay it
// was asked for, which is how "the deadline was never re-armed" is checked: a
// window that extended itself would have to have armed a second timer.
function fakeClock(startAt = 1_000_000) {
  let current = startAt;
  /** @type {Array<{ fn: () => void, dueAt: number, cancelled: boolean }>} */
  const timers = [];
  return {
    now: () => current,
    setTimer: vi.fn((fn, ms) => {
      const timer = { fn, dueAt: current + ms, cancelled: false };
      timers.push(timer);
      return timer;
    }),
    clearTimer: vi.fn((timer) => {
      if (timer) timer.cancelled = true;
    }),
    /** Advances the clock, firing whatever fell due on the way. */
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
    timers,
  };
}

const LENGTH_MS = 5 * 60_000;

function make(overrides = {}) {
  const clock = fakeClock();
  const onExpire = vi.fn();
  const window = createListenWindow({
    lengthMs: LENGTH_MS,
    onExpire,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  });
  return { window, clock, onExpire };
}

describe("listen-window: the deadline", () => {
  it("expires at exactly lengthMs, and not a millisecond before", () => {
    const { window, clock, onExpire } = make();
    window.open();
    clock.advance(LENGTH_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(window.isOpen()).toBe(true);
    clock.advance(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(window.isOpen()).toBe(false);
  });

  it("sets an absolute deadline measured from open()", () => {
    const { window, clock } = make();
    const openedAt = clock.now();
    expect(window.deadlineAt()).toBe(null);
    expect(window.open()).toBe(openedAt + LENGTH_MS);
    expect(window.deadlineAt()).toBe(openedAt + LENGTH_MS);
  });

  // The failure this whole bound exists to prevent: a mode held engaged for
  // hours because someone kept talking. Nothing Iris hears touches the window,
  // so there is nothing to re-arm it — asserted by the deadline being the one
  // open() set after a full window's worth of elapsed time, and by no second
  // timer having been armed.
  it("does not move the deadline while the window runs", () => {
    const { window, clock, onExpire } = make();
    window.open();
    const deadline = window.deadlineAt();
    for (let elapsed = 0; elapsed < LENGTH_MS; elapsed += 30_000) {
      clock.advance(30_000);
      expect(window.deadlineAt() ?? deadline).toBe(deadline);
    }
    expect(clock.setTimer).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("cancels the expiry when it is closed before the deadline", () => {
    const { window, clock, onExpire } = make();
    window.open();
    clock.advance(60_000);
    window.close();
    expect(window.isOpen()).toBe(false);
    expect(window.deadlineAt()).toBe(null);
    clock.advance(LENGTH_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("gives a full-length window when it is opened again after expiring", () => {
    const { window, clock, onExpire } = make();
    window.open();
    clock.advance(LENGTH_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);

    clock.advance(120_000);
    const reopenedAt = clock.now();
    window.open();
    expect(window.deadlineAt()).toBe(reopenedAt + LENGTH_MS);
    clock.advance(LENGTH_MS - 1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("replaces a running window rather than extending it when opened again", () => {
    const { window, clock, onExpire } = make();
    window.open();
    clock.advance(60_000);
    const reopenedAt = clock.now();
    window.open();
    expect(window.deadlineAt()).toBe(reopenedAt + LENGTH_MS);
    // The first window's timer was cancelled, so the replaced deadline cannot
    // fire an expiry of its own.
    clock.advance(LENGTH_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("counts remainingMs down and floors it at zero", () => {
    const { window, clock } = make();
    expect(window.remainingMs()).toBe(0);
    window.open();
    expect(window.remainingMs()).toBe(LENGTH_MS);
    clock.advance(60_000);
    expect(window.remainingMs()).toBe(LENGTH_MS - 60_000);
    clock.advance(LENGTH_MS);
    expect(window.remainingMs()).toBe(0);
  });

  // The expiry callback disengages the mode, and the mode's writer closes the
  // window on its way out — so onExpire re-enters close(). One expiry has to
  // stay one expiry.
  it("survives an onExpire that closes the window re-entrantly", () => {
    const clock = fakeClock();
    /** @type {any} */
    let window;
    const onExpire = vi.fn(() => window.close());
    window = createListenWindow({
      lengthMs: LENGTH_MS,
      onExpire,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    window.open();
    clock.advance(LENGTH_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(window.isOpen()).toBe(false);
    expect(window.remainingMs()).toBe(0);
  });

  // Reading how long is left must never end the engagement — that would make
  // Iris audible in a room the user silenced her for, from a getter.
  it("does not expire from a read that notices a passed deadline", () => {
    const clock = fakeClock();
    const onExpire = vi.fn();
    const window = createListenWindow({
      lengthMs: LENGTH_MS,
      onExpire,
      now: clock.now,
      // A timer that never fires: the deadline has passed and nothing ran.
      setTimer: () => ({ unref: () => {} }),
      clearTimer: () => {},
    });
    window.open();
    clock.advance(LENGTH_MS + 60_000);
    expect(window.remainingMs()).toBe(0);
    expect(window.isOpen()).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("unrefs its timer so a running window cannot delay a quit", () => {
    const unref = vi.fn();
    const { window } = make({ setTimer: () => ({ unref }) });
    window.open();
    expect(unref).toHaveBeenCalled();
  });
});

describe("listen-window: formatDuration", () => {
  it("reads as a span a person would say", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(47_000)).toBe("47s");
    expect(formatDuration(18 * 60_000 + 42_000)).toBe("18m 42s");
    expect(formatDuration(3_600_000 + 4 * 60_000 + 12_000)).toBe("1h 04m 12s");
  });

  it("never reports a negative span", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});
