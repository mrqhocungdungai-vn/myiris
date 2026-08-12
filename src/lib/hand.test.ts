// BUG F: the hand-tracking loop must skip setState when nothing semantic
// changed — semanticEquals is the pure gate extracted from useHandControl.ts,
// see openspec/changes/bound-hand-and-orb-render-cost/design.md D1.
import { describe, it, expect } from "vitest";
import { HAND_PRESENCE_TIMEOUT_MS, handIdentity, handPresenceExpired, semanticEquals, smoothPoint } from "./hand";
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

// The bug this replaced: identity changed when the NUMBER of hands changed, so
// raising a second hand renamed the first and handed it a previous session's
// smoothing history and stabilized pose. That transition is intrinsic to
// reeling in — you aim with one open palm to lock a note, then add the second
// hand — and only incidental to the two-palm zoom, which is raised from
// nothing. Which is exactly the asymmetry that was reported.
describe("handIdentity", () => {
  it("does not rename a hand when another joins", () => {
    const alone = handIdentity("Right", true);
    const withCompanionOnItsLeft = handIdentity("Right", false);

    expect(alone).toBe(withCompanionOnItsLeft);
  });

  it("keeps two hands apart", () => {
    expect(handIdentity("Left", true)).not.toBe(handIdentity("Right", false));
  });

  it("stays count-independent without a label", () => {
    // A lone hand is leftmost, so it is `x0` — the same name it keeps when a
    // hand joins on its right. The old scheme called it `"single"` and then
    // renamed it.
    expect(handIdentity(null, true)).toBe("x0");
    expect(handIdentity(undefined, true)).toBe("x0");
    expect(handIdentity(null, false)).toBe("x1");
    expect(handIdentity(null, true)).not.toBe(handIdentity(null, false));
  });

  it("never collides a label with a positional fallback", () => {
    expect(handIdentity("x0", true)).not.toBe(handIdentity(null, true));
  });
});

// A published `present: true` is a latch: the reticles mount off it, while
// their position is written per frame from a ref. So the state has to be able
// to end itself when the frames that justified it stop arriving — a stalled or
// ended camera track, a throw out of the recognizer, a sleeping tab — or the
// circles stay frozen on screen over a live picture of no hand.
describe("handPresenceExpired", () => {
  it("retires a presence no frame has renewed", () => {
    expect(handPresenceExpired(true, 1_000, 1_000 + HAND_PRESENCE_TIMEOUT_MS + 1)).toBe(true);
  });

  it("survives ordinary dropped frames", () => {
    // Two missed frames at camera rate is nothing a running tracker does not do.
    expect(handPresenceExpired(true, 1_000, 1_066)).toBe(false);
  });

  it("does not fire exactly at the timeout", () => {
    expect(handPresenceExpired(true, 1_000, 1_000 + HAND_PRESENCE_TIMEOUT_MS)).toBe(false);
  });

  it("says nothing when no hand is published", () => {
    // Nothing to retire, however long ago the last hand was: with no presence
    // standing, firing here would republish the empty state every frame — the
    // per-frame work the semantic gate exists to avoid.
    expect(handPresenceExpired(false, 0, 10_000)).toBe(false);
  });

  it("takes the timeout as a parameter rather than reading a clock", () => {
    expect(handPresenceExpired(true, 0, 50, 40)).toBe(true);
    expect(handPresenceExpired(true, 0, 50, 60)).toBe(false);
  });
});
