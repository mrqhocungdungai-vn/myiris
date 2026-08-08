import { describe, it, expect } from "vitest";
import {
  LOG_STRIP_LINES,
  levelRank,
  levelTone,
  logClock,
  stripThreshold,
  visibleLogLines,
} from "./activity-log";
import type { LogLine } from "../types";

function line(level: string, message: string, timestamp = 0): LogLine {
  return { id: `${level}-${message}-${timestamp}`, level, message, timestamp };
}

/** A store in `pushLog`'s order: newest FIRST. */
function store(...levels: string[]): LogLine[] {
  return levels.map((level, index) => line(level, `m${index}`, index));
}

describe("levelRank", () => {
  it("orders the levels the app emits", () => {
    expect(levelRank("info")).toBeLessThan(levelRank("warn"));
    expect(levelRank("warn")).toBeLessThan(levelRank("error"));
  });

  it("is case-insensitive, since the level arrives off the wire", () => {
    expect(levelRank("WARN")).toBe(levelRank("warn"));
    expect(levelRank("Error")).toBe(levelRank("error"));
  });

  it("ranks an unknown level as routine, not as beneath everything", () => {
    // The failure this prevents: a level added later being silently invisible
    // in every build, with the only symptom an absence nobody can see.
    expect(levelRank("trace")).toBe(levelRank("info"));
    expect(levelRank("")).toBe(levelRank("info"));
  });
});

describe("stripThreshold", () => {
  it("shows routine progress in development", () => {
    expect(levelRank("info")).toBeGreaterThanOrEqual(stripThreshold(true));
  });

  it("hides routine progress in production, and keeps what warrants attention", () => {
    expect(levelRank("info")).toBeLessThan(stripThreshold(false));
    expect(levelRank("warn")).toBeGreaterThanOrEqual(stripThreshold(false));
    expect(levelRank("error")).toBeGreaterThanOrEqual(stripThreshold(false));
  });

  it("hides debug in both — nothing emits it, and it is not this change's job to", () => {
    expect(levelRank("debug")).toBeLessThan(stripThreshold(true));
    expect(levelRank("debug")).toBeLessThan(stripThreshold(false));
  });
});

describe("visibleLogLines", () => {
  it("draws every level in development", () => {
    const drawn = visibleLogLines(store("error", "warn", "info"), true);
    expect(drawn.map((l) => l.level)).toEqual(["info", "warn", "error"]);
  });

  it("draws only what warrants attention in production", () => {
    const drawn = visibleLogLines(store("error", "info", "warn", "info"), false);
    expect(drawn.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("hides without dropping — the store is untouched", () => {
    const source = store("error", "info", "warn");
    const before = source.length;
    visibleLogLines(source, false);
    expect(source).toHaveLength(before);
    expect(source.map((l) => l.level)).toEqual(["error", "info", "warn"]);
  });

  it("flips the ordering: the store is newest-first, the strip newest-last", () => {
    // m0 is the newest in the store; it must be drawn last.
    const drawn = visibleLogLines(store("info", "info", "info"), true);
    expect(drawn.map((l) => l.message)).toEqual(["m2", "m1", "m0"]);
  });

  it("caps at the band's line count, keeping the newest", () => {
    const drawn = visibleLogLines(store(...Array(20).fill("info")), true);
    expect(drawn).toHaveLength(LOG_STRIP_LINES);
    // Newest-last, and the newest of all (m0) is the final line.
    expect(drawn[drawn.length - 1].message).toBe("m0");
    expect(drawn[0].message).toBe(`m${LOG_STRIP_LINES - 1}`);
  });

  it("finds the newest survivors past a wall of hidden entries", () => {
    // Production, with recent routine chatter burying the warnings.
    const source = [...store(...Array(30).fill("info")), line("warn", "old-warn", 99)];
    const drawn = visibleLogLines(source, false);
    expect(drawn.map((l) => l.message)).toEqual(["old-warn"]);
  });

  it("returns fewer than the cap when there are fewer to draw", () => {
    expect(visibleLogLines(store("warn"), true)).toHaveLength(1);
  });

  it("returns nothing for an empty store, and for one entirely below the threshold", () => {
    expect(visibleLogLines([], true)).toEqual([]);
    expect(visibleLogLines(store("info", "info"), false)).toEqual([]);
  });

  it("returns nothing when asked for no lines", () => {
    expect(visibleLogLines(store("error"), true, 0)).toEqual([]);
  });
});

describe("levelTone", () => {
  it("gives warnings and errors their own tones and everything else the routine one", () => {
    expect(levelTone("info")).toBe("routine");
    expect(levelTone("debug")).toBe("routine");
    expect(levelTone("trace")).toBe("routine");
    expect(levelTone("warn")).toBe("warn");
    expect(levelTone("error")).toBe("error");
  });
});

describe("logClock", () => {
  it("is fixed width, so nothing after it can shift", () => {
    const widths = new Set(
      [0, 1, 9, 10, 59, 60, 3600, 86_399_000].map((ms) => logClock(ms, new Date(2026, 0, 1, 1, 2, 3)).length),
    );
    expect(widths).toEqual(new Set([8]));
  });

  it("zero-pads every field", () => {
    expect(logClock(0, new Date(2026, 0, 1, 9, 5, 7))).toBe("09:05:07");
    expect(logClock(0, new Date(2026, 0, 1, 23, 59, 59))).toBe("23:59:59");
  });
});
