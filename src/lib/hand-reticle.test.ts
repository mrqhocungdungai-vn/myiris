// The floating cursors are a FIXED pair of nodes whose visibility each frame
// decides — the shape that makes it impossible either to strand a cursor after
// the hand is gone or to strew the screen with one cursor per identity the
// tracker briefly reported. These are the two questions the component asks of
// every frame, kept pure so they can be asked without a camera.
import { describe, it, expect } from "vitest";
import { RETICLE_SLOTS, reticleClassName, reticleSlots } from "./hand-reticle";
import type { HandState, TrackedHand } from "../hooks/useHandControl";

function trackedHand(overrides: Partial<TrackedHand> = {}): TrackedHand {
  return {
    id: "hand:Right",
    point: { x: 10, y: 20 },
    wristPoint: { x: 10, y: 40 },
    landmarks: [],
    gesture: "Pointing_Up",
    gestureScore: 0.9,
    pointing: true,
    openPalm: false,
    thumbUp: false,
    fist: false,
    pinchDistance: 0.1,
    ...overrides,
  };
}

function handState(overrides: Partial<HandState> = {}): HandState {
  return {
    active: true,
    present: true,
    point: { x: 10, y: 20 },
    wristPoint: { x: 10, y: 40 },
    gesture: "Pointing_Up",
    gestureScore: 0.9,
    pointing: true,
    openPalm: false,
    thumbUp: false,
    fist: false,
    pinchDistance: 0.1,
    hands: [trackedHand()],
    ...overrides,
  };
}

describe("reticleSlots", () => {
  it("always answers for every slot, however many hands are tracked", () => {
    // The count is what makes the nodes fixed: a caller can never be told to
    // create or destroy one.
    expect(reticleSlots(handState()).length).toBe(RETICLE_SLOTS);
    expect(reticleSlots(handState({ hands: [] })).length).toBe(RETICLE_SLOTS);
    expect(
      reticleSlots(handState({ hands: [trackedHand(), trackedHand({ id: "hand:Left" })] })).length,
    ).toBe(RETICLE_SLOTS);
  });

  it("empties every slot the moment presence ends", () => {
    const slots = reticleSlots(handState({ present: false }));

    expect(slots.every((slot) => slot.hand === null)).toBe(true);
  });

  it("fills one slot per tracked hand and leaves the rest empty", () => {
    const slots = reticleSlots(handState());

    expect(slots[0].hand?.id).toBe("hand:Right");
    expect(slots[1].hand).toBeNull();
  });

  it("keeps drawing a primary point that arrived without a per-hand list", () => {
    const slots = reticleSlots(handState({ hands: [] }));

    expect(slots[0].hand?.point).toEqual({ x: 10, y: 20 });
  });

  it("never asks for more slots than there are", () => {
    // A third hand cannot appear (`numHands: 2`), but if one ever did it must
    // not become a node with nowhere to live.
    const three = [trackedHand(), trackedHand({ id: "hand:Left" }), trackedHand({ id: "x1" })];

    expect(reticleSlots(handState({ hands: three })).length).toBe(RETICLE_SLOTS);
  });
});

describe("reticleClassName", () => {
  it("marks the second slot as secondary and the first as primary", () => {
    expect(reticleClassName(0, trackedHand(), false)).not.toContain("secondary");
    expect(reticleClassName(1, trackedHand(), false)).toContain("secondary");
  });

  it("names the pose the hand is actually making", () => {
    expect(reticleClassName(0, trackedHand({ pointing: true }), false)).toContain("pointing");
    expect(reticleClassName(0, trackedHand({ pointing: false, openPalm: true }), false)).toContain("open");
    expect(reticleClassName(0, trackedHand({ pointing: false, fist: true }), false)).toContain("fist");
  });

  it("charges the dwell ring on the primary hand only", () => {
    expect(reticleClassName(0, trackedHand(), true)).toContain("dwell");
    expect(reticleClassName(1, trackedHand(), true)).not.toContain("dwell");
  });

  it("carries no pose at all for an empty slot", () => {
    // The node stays in the document while hidden, so a leftover pose class
    // would be the state it reappeared in.
    const className = reticleClassName(0, null, true);

    expect(className).toBe("hand-reticle");
  });
});
