import { describe, it, expect, vi } from "vitest";
import { createSystemAudioSelfTest, SELF_TEST_ARM_MS } from "./system-audio-self-test.mjs";

// A clock and a timer the test drives, so the bound is asserted rather than
// waited for. `advance` moves both together — a real deadline is enforced by
// whichever fires first, and both paths have to hold.
function makeClock() {
  let current = 1000;
  /** @type {Array<{ at: number, fn: () => void, cancelled: boolean }>} */
  const timers = [];
  return {
    now: () => current,
    setTimeout: /** @type {any} */ ((fn, ms) => {
      const timer = { at: current + ms, fn, cancelled: false };
      timers.push(timer);
      return timer;
    }),
    clearTimeout: /** @type {any} */ ((timer) => {
      if (timer) timer.cancelled = true;
    }),
    advance(ms) {
      current += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= current) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
    /** Move the clock without letting any timer fire — the bound must hold anyway. */
    advanceClockOnly(ms) {
      current += ms;
    },
  };
}

function makeSelfTest(clock = makeClock()) {
  return {
    clock,
    selfTest: createSystemAudioSelfTest({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    }),
  };
}

describe("system-audio self-test: one grant, not an interval", () => {
  it("is not armed before anything arms it", () => {
    const { selfTest } = makeSelfTest();
    expect(selfTest.isArmed()).toBe(false);
    expect(selfTest.consume({ frameId: 1 })).toBe(false);
  });

  it("grants exactly once and refuses the second request before re-arming", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    expect(selfTest.consume({ frameId: 1 })).toBe(true);
    expect(selfTest.consume({ frameId: 1 })).toBe(false);
    expect(selfTest.isArmed()).toBe(false);
  });

  it("grants again only after a fresh arm", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    expect(selfTest.consume({ frameId: 1 })).toBe(true);
    selfTest.arm({ frameId: 1 });
    expect(selfTest.consume({ frameId: 1 })).toBe(true);
  });
});

describe("system-audio self-test: the deadline", () => {
  it("expires an arming nothing used", () => {
    const { selfTest, clock } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    expect(selfTest.isArmed()).toBe(true);
    clock.advance(SELF_TEST_ARM_MS);
    expect(selfTest.isArmed()).toBe(false);
    expect(selfTest.consume({ frameId: 1 })).toBe(false);
  });

  // The timer is the mechanism, the deadline is the rule: a starved or faked
  // timer must not leave an arming usable past its window.
  it("expires on the clock even if the timer never fires", () => {
    const { selfTest, clock } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    clock.advanceClockOnly(SELF_TEST_ARM_MS + 1);
    expect(selfTest.isArmed()).toBe(false);
    expect(selfTest.consume({ frameId: 1 })).toBe(false);
  });

  it("does not extend the deadline when re-armed while already live", () => {
    const { selfTest, clock } = makeSelfTest();
    const first = selfTest.arm({ frameId: 1 });
    clock.advance(SELF_TEST_ARM_MS - 1000);
    const second = selfTest.arm({ frameId: 1 });
    expect(second.expiresAt).toBe(first.expiresAt);
    clock.advance(1000);
    expect(selfTest.isArmed()).toBe(false);
  });

  it("stays armed right up to the deadline", () => {
    const { selfTest, clock } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    clock.advance(SELF_TEST_ARM_MS - 1);
    expect(selfTest.isArmed()).toBe(true);
  });
});

describe("system-audio self-test: the frame that armed it", () => {
  it("records the arming frame", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 7 });
    expect(selfTest.armedFrameId()).toBe(7);
  });

  it("refuses a frame that did not arm the test", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 7 });
    expect(selfTest.consume({ frameId: 8 })).toBe(false);
  });

  // A foreign request must not be able to burn the arming the user just made,
  // or a second frame could deny the test by racing it.
  it("does not spend the arming on a refused frame", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 7 });
    selfTest.consume({ frameId: 8 });
    expect(selfTest.isArmed()).toBe(true);
    expect(selfTest.consume({ frameId: 7 })).toBe(true);
  });
});

describe("system-audio self-test: explicit disarm", () => {
  it("drops a live arming — the window went away, or the test finished", () => {
    const { selfTest } = makeSelfTest();
    selfTest.arm({ frameId: 1 });
    selfTest.disarm();
    expect(selfTest.isArmed()).toBe(false);
    expect(selfTest.consume({ frameId: 1 })).toBe(false);
  });

  it("is a no-op with nothing armed", () => {
    const { selfTest } = makeSelfTest();
    expect(() => selfTest.disarm()).not.toThrow();
    expect(selfTest.isArmed()).toBe(false);
  });

  it("cancels the pending timer so a later arming is not cut short by it", () => {
    const clearTimeout = vi.fn();
    const selfTest = createSystemAudioSelfTest({ clearTimeout, setTimeout: /** @type {any} */ (() => ({})) });
    selfTest.arm({ frameId: 1 });
    selfTest.disarm();
    expect(clearTimeout).toHaveBeenCalled();
  });
});
