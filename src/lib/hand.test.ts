// BUG F: the hand-tracking loop must skip setState when nothing semantic
// changed — semanticEquals is the pure gate extracted from useHandControl.ts,
// see openspec/changes/bound-hand-and-orb-render-cost/design.md D1.
import { describe, it, expect } from "vitest";
import { semanticEquals, smoothPoint } from "./hand";
import type { HandState } from "../hooks/useHandControl";

function makeState(overrides: Partial<HandState> = {}): HandState {
  return {
    active: true,
    present: true,
    point: { x: 10, y: 20 },
    gesture: "Pointing_Up",
    gestureScore: 0.9,
    pointing: true,
    openPalm: false,
    fist: false,
    pinchDistance: 0.2,
    hands: [
      {
        id: "single",
        point: { x: 10, y: 20 },
        landmarks: [],
        gesture: "Pointing_Up",
        gestureScore: 0.9,
        pointing: true,
        openPalm: false,
        fist: false,
        pinchDistance: 0.2,
      },
    ],
    ...overrides,
  };
}

describe("semanticEquals", () => {
  it("treats two states as equal when only point/landmarks/pinchDistance/gestureScore differ", () => {
    const a = makeState();
    const b = makeState({
      point: { x: 11, y: 21 },
      gestureScore: 0.4,
      pinchDistance: 0.05,
      hands: [{ ...makeState().hands[0], point: { x: 11, y: 21 }, gestureScore: 0.4, pinchDistance: 0.05 }],
    });
    expect(semanticEquals(a, b)).toBe(true);
  });

  it("treats states as different when presence changes", () => {
    const a = makeState({ present: true });
    const b = makeState({ present: false, hands: [] });
    expect(semanticEquals(a, b)).toBe(false);
  });

  it("treats states as different when a semantic gesture flag changes", () => {
    const a = makeState();
    const b = makeState({ pointing: false, fist: true, gesture: "Closed_Fist" });
    expect(semanticEquals(a, b)).toBe(false);
  });

  it("treats states as different when hand count changes", () => {
    const a = makeState();
    const b = makeState({ hands: [...makeState().hands, { ...makeState().hands[0], id: "right" }] });
    expect(semanticEquals(a, b)).toBe(false);
  });

  it("treats states as different when a hand id changes", () => {
    const a = makeState();
    const b = makeState({ hands: [{ ...makeState().hands[0], id: "right" }] });
    expect(semanticEquals(a, b)).toBe(false);
  });
});

// two-hand-gestures: "Every tracked hand's point SHALL be smoothed" — the
// EMA step, extracted so each hand's smoothing can be verified independently
// of a camera or of any other hand's history.
describe("smoothPoint", () => {
  it("converges toward the target over repeated frames", () => {
    let point = { x: 0, y: 0 };
    const target = { x: 100, y: 100 };
    for (let i = 0; i < 20; i++) point = smoothPoint(point, target, 0.5);
    expect(point.x).toBeCloseTo(100, 3);
    expect(point.y).toBeCloseTo(100, 3);
  });

  it("moves only a fraction of the way there on a single frame, per alpha", () => {
    const next = smoothPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5);
    expect(next.x).toBe(5);
  });

  it("smooths each hand independently — one hand's history never leaks into another's", () => {
    const handA = smoothPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5);
    const handB = smoothPoint({ x: 50, y: 50 }, { x: 60, y: 60 }, 0.5);
    expect(handA).toEqual({ x: 5, y: 0 });
    expect(handB).toEqual({ x: 55, y: 55 });
  });

  it("a cleared entry (previous null) seeds from the current position, not the previous one", () => {
    // A hand that left and returned has no smoothing history — the no-hand
    // transition clears its map entry — so its first frame back must be the
    // raw target, not an ease-in from wherever it was last seen.
    const next = smoothPoint(null, { x: 500, y: 500 }, 0.5);
    expect(next).toEqual({ x: 500, y: 500 });
  });
});
