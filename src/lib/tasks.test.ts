// BUG D: an empty terminal result must replace the activity log shown
// during a run, not fall back to it. resolveMergedString is the pure merge
// decision extracted from the App.tsx reducer — see
// openspec/changes/show-real-result-not-activity-log/design.md D1.
import { describe, it, expect } from "vitest";
import { TERMINAL, readTaskUsage, resolveMergedString, usageSummary } from "./tasks";

describe("resolveMergedString", () => {
  it("replaces the existing value with a non-empty incoming string", () => {
    expect(resolveMergedString("result", "old activity")).toBe("result");
  });

  it("replaces the existing value with an empty incoming string", () => {
    expect(resolveMergedString("", "old activity")).toBe("");
  });

  it("keeps the existing value when the field is absent", () => {
    expect(resolveMergedString(undefined, "old activity")).toBe("old activity");
  });

  it("falls back to empty when both the field and existing value are absent", () => {
    expect(resolveMergedString(undefined, undefined)).toBe("");
  });
});

describe("readTaskUsage", () => {
  it("reads the cost and turn figures off an update", () => {
    expect(readTaskUsage({ cost_usd: 0.42, num_turns: 7 })).toEqual({ costUsd: 0.42, numTurns: 7 });
  });

  // Every update before the run's result lands carries no usage. Returning a
  // blank object there would wipe a figure already on the card.
  it("returns null when the update carries no figures at all", () => {
    for (const value of [null, undefined, {}, { cost_usd: null, num_turns: null }, "nope"]) {
      expect(readTaskUsage(value)).toBeNull();
    }
  });

  it("keeps whichever figure is present", () => {
    expect(readTaskUsage({ num_turns: 3 })).toEqual({ costUsd: null, numTurns: 3 });
  });
});

describe("usageSummary", () => {
  it("reads as metadata, cost then turns", () => {
    expect(usageSummary({ costUsd: 0.7781, numTurns: 29 })).toBe("$0.78 · 29 turns");
    expect(usageSummary({ costUsd: 1, numTurns: 1 })).toBe("$1.00 · 1 turn");
  });

  // "$0.00" reads as free rather than as very cheap.
  it("never rounds a real cost down to nothing", () => {
    expect(usageSummary({ costUsd: 0.004, numTurns: 2 })).toBe("<$0.01 · 2 turns");
    expect(usageSummary({ costUsd: 0, numTurns: 2 })).toBe("$0.00 · 2 turns");
  });

  it("is empty when there is nothing recorded to show", () => {
    expect(usageSummary(null)).toBe("");
    expect(usageSummary(undefined)).toBe("");
  });
});

describe("TERMINAL", () => {
  // A ceiling termination is over — the deck must stop showing it as working.
  it("counts a ceiling termination as terminal", () => {
    expect(TERMINAL.has("limited")).toBe(true);
  });
});
