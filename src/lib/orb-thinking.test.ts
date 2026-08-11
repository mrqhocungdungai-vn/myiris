import { describe, it, expect } from "vitest";
import {
  thinkingStep,
  INITIAL_THINKING_STATE,
  TALKING_LEVEL,
  SILENCE_MS,
  THINKING_TIMEOUT_MS,
  type ThinkingState,
} from "./orb-thinking";

const LOUD = TALKING_LEVEL + 0.1;
const QUIET = 0;

/** Feeds samples in order and returns whether the swirl was on after each. */
function feed(samples: Array<{ level: number; speaking?: boolean; now: number }>) {
  let state: ThinkingState = INITIAL_THINKING_STATE;
  return samples.map((sample) => {
    state = thinkingStep(state, { level: sample.level, speaking: sample.speaking ?? false, now: sample.now });
    return state.thinking;
  });
}

describe("thinkingStep", () => {
  it("does not think while nobody has said anything", () => {
    expect(feed([{ level: QUIET, now: 0 }, { level: QUIET, now: 10_000 }])).toEqual([false, false]);
  });

  it("does not think while the user is still talking", () => {
    expect(feed([{ level: LOUD, now: 0 }, { level: LOUD, now: 1000 }])).toEqual([false, false]);
  });

  // The core behavior: speech, then silence, opens the gap.
  it("starts thinking once the user goes quiet after talking", () => {
    const seen = feed([
      { level: LOUD, now: 0 },
      { level: QUIET, now: SILENCE_MS },
      { level: QUIET, now: SILENCE_MS + 1 },
    ]);
    // Strictly greater than SILENCE_MS, so the boundary sample is not enough.
    expect(seen).toEqual([false, false, true]);
  });

  // Too short a silence would read an ordinary mid-sentence pause as a
  // finished question.
  it("treats a pause shorter than the silence threshold as still talking", () => {
    const seen = feed([
      { level: LOUD, now: 0 },
      { level: QUIET, now: SILENCE_MS - 50 },
      { level: LOUD, now: SILENCE_MS },
      { level: QUIET, now: SILENCE_MS + 100 },
    ]);
    expect(seen.some(Boolean)).toBe(false);
  });

  // Iris speaking is what the gap was waiting for, so it ends it at once.
  it("stops thinking the moment Iris speaks", () => {
    const seen = feed([
      { level: LOUD, now: 0 },
      { level: QUIET, now: SILENCE_MS + 1 },
      { level: QUIET, speaking: true, now: SILENCE_MS + 100 },
    ]);
    expect(seen).toEqual([false, true, false]);
  });

  // An indicator that is always on says nothing.
  it("gives up after the timeout when no answer ever comes", () => {
    const seen = feed([
      { level: LOUD, now: 0 },
      { level: QUIET, now: SILENCE_MS + 1 },
      { level: QUIET, now: SILENCE_MS + 1 + THINKING_TIMEOUT_MS },
      { level: QUIET, now: SILENCE_MS + 2 + THINKING_TIMEOUT_MS },
    ]);
    expect(seen).toEqual([false, true, true, false]);
  });

  it("can think again after a timed-out gap once the user speaks again", () => {
    const base = SILENCE_MS + THINKING_TIMEOUT_MS + 10;
    const seen = feed([
      { level: LOUD, now: 0 },
      { level: QUIET, now: SILENCE_MS + 1 },
      { level: QUIET, now: base * 2 },
      { level: LOUD, now: base * 2 + 10 },
      { level: QUIET, now: base * 2 + 20 + SILENCE_MS },
    ]);
    expect(seen[1]).toBe(true);
    expect(seen[2]).toBe(false);
    expect(seen[4]).toBe(true);
  });

  it("does not mutate the state it is given", () => {
    const state = { ...INITIAL_THINKING_STATE, talking: true, lastLoudAt: 0 };
    thinkingStep(state, { level: QUIET, speaking: false, now: SILENCE_MS + 1 });
    expect(state).toEqual({ ...INITIAL_THINKING_STATE, talking: true, lastLoudAt: 0 });
  });
});
