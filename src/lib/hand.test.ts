// BUG F: the hand-tracking loop must skip setState when nothing semantic
// changed — semanticEquals is the pure gate extracted from useHandControl.ts,
// see openspec/changes/bound-hand-and-orb-render-cost/design.md D1.
import { describe, it, expect } from "vitest";
import { semanticEquals } from "./hand";
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
