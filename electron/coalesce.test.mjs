import { describe, it, expect, vi } from "vitest";
import { createTrailingThrottle } from "./coalesce.mjs";

describe("createTrailingThrottle", () => {
  it("coalesces a burst of schedule calls into one trailing call with the last args", () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const { schedule } = createTrailingThrottle((...args) => calls.push(args), 150);

      schedule("a");
      schedule("b");
      schedule("c");
      expect(calls).toEqual([]);

      vi.advanceTimersByTime(150);
      expect(calls).toEqual([["c"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires once per interval across successive intervals", () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const { schedule } = createTrailingThrottle((...args) => calls.push(args), 150);

      schedule("first");
      vi.advanceTimersByTime(150);
      expect(calls).toEqual([["first"]]);

      schedule("second");
      vi.advanceTimersByTime(150);
      expect(calls).toEqual([["first"], ["second"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel before the trailing edge suppresses the call; a later schedule still works", () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const { schedule, cancel } = createTrailingThrottle((...args) => calls.push(args), 150);

      schedule("a");
      cancel();
      vi.advanceTimersByTime(150);
      expect(calls).toEqual([]);

      schedule("b");
      vi.advanceTimersByTime(150);
      expect(calls).toEqual([["b"]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
