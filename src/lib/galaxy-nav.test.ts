import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  nearestNodeAt,
  dwellStep,
  INITIAL_DWELL_STATE,
  driveFor,
  INITIAL_POSE_DRIVE_STATE,
  orbitStep,
  radiusStep,
  focusNeighborhood,
  type DwellState,
  type GalaxyNavNode,
} from "./galaxy-nav";
import type { HandState } from "../hooks/useHandControl";

// Real PerspectiveCamera + updateMatrixWorld — no WebGL context needed
// (design.md D4b), looking from (0,0,10) toward the origin.
function makeCamera() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const RECT = { left: 0, top: 0, width: 800, height: 600 };
const CENTER = { x: RECT.width / 2, y: RECT.height / 2 };

describe("nearestNodeAt", () => {
  it("targets a node in front of the camera", () => {
    const camera = makeCamera();
    const front: GalaxyNavNode = { id: "front", title: "Front", x: 0, y: 0, z: 0 };
    expect(nearestNodeAt([front], camera, RECT, CENTER, 100)?.id).toBe("front");
  });

  it("excludes a node behind the camera even when it would project in-viewport", () => {
    const camera = makeCamera();
    const behind: GalaxyNavNode = { id: "behind", title: "Behind", x: 0, y: 0, z: 20 };
    expect(nearestNodeAt([behind], camera, RECT, CENTER, 1000)).toBeNull();
  });

  it("excludes a node exactly at the camera (NaN projection)", () => {
    const camera = makeCamera();
    const atCamera: GalaxyNavNode = { id: "at-camera", title: "At camera", x: 0, y: 0, z: 10 };
    expect(nearestNodeAt([atCamera], camera, RECT, CENTER, 1000)).toBeNull();
  });

  it("skips ghost nodes and position-less nodes", () => {
    const camera = makeCamera();
    const ghost: GalaxyNavNode = { id: "ghost", title: "Ghost", x: 0, y: 0, z: 0, ghost: true };
    const noPos: GalaxyNavNode = { id: "no-pos", title: "No position" };
    expect(nearestNodeAt([ghost, noPos], camera, RECT, CENTER, 1000)).toBeNull();
  });

  it("applies the container rect offset", () => {
    const camera = makeCamera();
    const node: GalaxyNavNode = { id: "n", title: "N", x: 0, y: 0, z: 0 };
    const offsetRect = { left: 200, top: 100, width: 800, height: 600 };
    const centerInOffsetRect = { x: 200 + 400, y: 100 + 300 };
    expect(nearestNodeAt([node], camera, offsetRect, centerInOffsetRect, 5)?.id).toBe("n");
    // Same screen point, but without the offset applied the node's true
    // (offset) screen position is far from it.
    expect(nearestNodeAt([node], camera, RECT, centerInOffsetRect, 5)).toBeNull();
  });

  it("keeps a marginally-closer challenger from stealing the incumbent (dead band)", () => {
    const camera = makeCamera();
    const incumbent: GalaxyNavNode = { id: "incumbent", title: "Incumbent", x: -0.07, y: 0, z: 0 };
    const challenger: GalaxyNavNode = { id: "challenger", title: "Challenger", x: 0.02, y: 0, z: 0 };
    const result = nearestNodeAt([incumbent, challenger], camera, RECT, CENTER, 100, "incumbent");
    expect(result?.id).toBe("incumbent");
  });

  it("still switches to a challenger that clearly beats the incumbent", () => {
    const camera = makeCamera();
    const incumbent: GalaxyNavNode = { id: "incumbent", title: "Incumbent", x: -0.5, y: 0, z: 0 };
    const challenger: GalaxyNavNode = { id: "challenger", title: "Challenger", x: 0.02, y: 0, z: 0 };
    const result = nearestNodeAt([incumbent, challenger], camera, RECT, CENTER, 100, "incumbent");
    expect(result?.id).toBe("challenger");
  });
});

describe("dwellStep", () => {
  const NODE: GalaxyNavNode = { id: "note-1", title: "Note", x: 0, y: 0, z: 0 };
  const HOLD_MS = 300;

  // Steps dwellStep in 10ms increments (pending-hold + dwell-hold both take
  // several steps) until it fires, or throws if it never does.
  function chargeToFire(initial: DwellState, node: GalaxyNavNode, startT: number) {
    let state = initial;
    let t = startT;
    for (let i = 0; i < 200; i++) {
      const result = dwellStep(state, node, t, HOLD_MS);
      state = result.state;
      if (result.fire) return { state, t };
      t += 10;
    }
    throw new Error("dwellStep never fired");
  }

  it("fires exactly once after holding long enough and not again while still targeted", () => {
    const { state: firedState, t: firedAt } = chargeToFire(INITIAL_DWELL_STATE, NODE, 0);
    const later = dwellStep(firedState, NODE, firedAt + 1000, HOLD_MS);
    expect(later.fire).toBe(false);
    expect(later.target).toBe("note-1");
  });

  it("requires leaving and re-acquiring the target before it can fire again", () => {
    const { state: firedState, t: firedAt } = chargeToFire(INITIAL_DWELL_STATE, NODE, 0);

    // Hand leaves (no candidate) — state resets.
    const left = dwellStep(firedState, null, firedAt + 10, HOLD_MS).state;
    expect(left.target).toBeNull();

    // Re-acquiring must charge the dwell again, not fire immediately.
    const reacquireStart = dwellStep(left, NODE, firedAt + 20, HOLD_MS);
    expect(reacquireStart.fire).toBe(false);

    const { t: secondFireAt } = chargeToFire(left, NODE, firedAt + 20);
    expect(secondFireAt).toBeGreaterThan(firedAt);
  });

  it("does not commit a jittering candidate before the pending hold elapses", () => {
    const other: GalaxyNavNode = { id: "note-2", title: "Other", x: 1, y: 0, z: 0 };
    let state = INITIAL_DWELL_STATE;
    // Flip the candidate every frame, always resetting the pending timer —
    // neither ever accumulates enough hold time to be committed as target.
    for (let t = 0; t < 500; t += 10) {
      const candidate = t % 20 === 0 ? NODE : other;
      state = dwellStep(state, candidate, t, HOLD_MS).state;
    }
    expect(state.target).toBeNull();
  });
});

describe("driveFor", () => {
  function makeHand(overrides: Partial<HandState> = {}): HandState {
    return {
      active: true,
      present: true,
      point: { x: 0, y: 0 },
      gesture: "None",
      gestureScore: 1,
      pointing: false,
      openPalm: false,
      fist: false,
      pinchDistance: 0.2,
      hands: [
        {
          id: "single",
          point: { x: 0, y: 0 },
          landmarks: [],
          gesture: "None",
          gestureScore: 1,
          pointing: false,
          openPalm: false,
          fist: false,
          pinchDistance: 0.2,
        },
      ],
      ...overrides,
    };
  }

  it("returns dwell for Pointing_Up", () => {
    expect(driveFor(makeHand({ pointing: true })).drive).toBe("dwell");
  });

  it("returns orbit for Closed_Fist", () => {
    expect(driveFor(makeHand({ fist: true })).drive).toBe("orbit");
  });

  it("returns null for an open palm, two palms, and a resting/unrecognized hand", () => {
    expect(driveFor(makeHand({ openPalm: true, pinchDistance: 0.02 })).drive).toBeNull();
    expect(
      driveFor(
        makeHand({
          openPalm: true,
          hands: [makeHand().hands[0], makeHand().hands[0]],
        }),
      ).drive,
    ).toBeNull();
    expect(driveFor(makeHand({ pinchDistance: 0.5 })).drive).toBeNull();
  });

  // Steps driveFor forward in 10ms increments, holding a pinch engaged, until
  // it crosses into zoom — mirrors dwellStep's own chargeToFire helper above.
  function holdPinchToZoom(pinchDistance = 0.05) {
    let state = INITIAL_POSE_DRIVE_STATE;
    for (let t = 0; t <= 2000; t += 10) {
      const step = driveFor(makeHand({ pinchDistance }), state, t);
      state = step.state;
      if (step.drive === "zoom") return { drive: step.drive, state, t };
    }
    throw new Error("pinch never crossed into zoom");
  }

  // design.md D3 of shared-focus: "the camera SHALL NOT move" and "no zoom is
  // emitted" while a pinch is still being discriminated as a possible tap.
  it("drives nothing while a pinch is still being discriminated, and never newly engages from a mid-range distance", () => {
    const engaging = driveFor(makeHand({ pinchDistance: 0.05 }), INITIAL_POSE_DRIVE_STATE, 0);
    expect(engaging.drive).toBeNull();
    const stillDiscriminating = driveFor(makeHand({ pinchDistance: 0.05 }), engaging.state, 50);
    expect(stillDiscriminating.drive).toBeNull();
    // A mid-range distance (between the engage and release thresholds) does
    // not newly engage anything from rest.
    expect(driveFor(makeHand({ pinchDistance: 0.13 }), INITIAL_POSE_DRIVE_STATE, 0).drive).toBeNull();
  });

  it("no zoom is emitted during the whole discrimination window", () => {
    let state = INITIAL_POSE_DRIVE_STATE;
    for (let t = 0; t < 250; t += 10) {
      const step = driveFor(makeHand({ pinchDistance: 0.05 }), state, t);
      expect(step.drive).not.toBe("zoom");
      state = step.state;
    }
  });

  it("a pinch released quickly (inside the window) yields a tap for exactly one frame", () => {
    let state = driveFor(makeHand({ pinchDistance: 0.05 }), INITIAL_POSE_DRIVE_STATE, 0).state;
    state = driveFor(makeHand({ pinchDistance: 0.05 }), state, 50).state;
    const released = driveFor(makeHand({ pinchDistance: 0.3 }), state, 80);
    expect(released.drive).toBe("tap");
    // Not sticky: the very next frame, even mid-release, is not a tap again.
    const next = driveFor(makeHand({ pinchDistance: 0.3 }), released.state, 90);
    expect(next.drive).not.toBe("tap");
  });

  it("a pinch held past the window yields zoom and never a tap", () => {
    expect(holdPinchToZoom().drive).toBe("zoom");
  });

  it("releasing a zoom never fires a tap, however slowly the release happens", () => {
    let { state } = holdPinchToZoom();
    // Hold well past the window, so this pinch has unambiguously become a zoom.
    for (let i = 0; i < 5; i++) state = driveFor(makeHand({ pinchDistance: 0.05 }), state, 1000 + i * 10).state;
    let last: ReturnType<typeof driveFor> = { drive: "zoom", state };
    for (let i = 0; i < 10; i++) {
      last = driveFor(makeHand({ pinchDistance: 0.3 }), last.state, 2000 + i * 10);
      expect(last.drive).not.toBe("tap");
    }
    expect(last.drive).toBeNull(); // the sustained release ended the zoom, not a tap
  });

  it("a pinch drifting while Pointing_Up yields neither a zoom nor a tap", () => {
    let state = INITIAL_POSE_DRIVE_STATE;
    for (let t = 0; t < 500; t += 10) {
      const pinchDistance = t % 20 === 0 ? 0.05 : 0.3; // drifts across the engage threshold as a side effect of the pose
      const step = driveFor(makeHand({ pointing: true, pinchDistance }), state, t);
      expect(step.drive).toBe("dwell");
      state = step.state;
    }
  });

  it("survives a single noisy frame above the release threshold instead of dropping the drive", () => {
    let step: ReturnType<typeof driveFor> = holdPinchToZoom();
    expect(step.drive).toBe("zoom");

    // Raw pinchDistance has no source-level debounce (unlike the canned
    // fist/pointing gestures) — one tremor frame past PINCH_RELEASE must
    // not wipe the seeded zoom reference.
    step = driveFor(makeHand({ pinchDistance: 0.3 }), step.state, 3000);
    expect(step.drive).toBe("zoom");

    // Recovering below the release threshold clears the release streak.
    step = driveFor(makeHand({ pinchDistance: 0.13 }), step.state, 3010);
    expect(step.drive).toBe("zoom");
  });

  it("disengages zoom only after a sustained release, not a single frame", () => {
    let step: ReturnType<typeof driveFor> = holdPinchToZoom();
    expect(step.drive).toBe("zoom");

    for (let i = 0; i < 10; i++) {
      step = driveFor(makeHand({ pinchDistance: 0.3 }), step.state, 3000 + i * 10);
    }
    expect(step.drive).toBeNull();
  });

  // design.md D3 of shared-focus: "A zoom's reference SHALL be seeded when
  // the hold window elapses, not when the pinch first engaged, so the
  // discrimination window contributes no accumulated delta." A caller that
  // seeded at engage time instead would carry forward however much the pinch
  // distance drifted while merely being discriminated as a possible tap,
  // producing a camera jump the instant zoom took over.
  it("seeding the zoom reference on the elapse frame (not the engage frame) produces no radius jump, however much the pinch drifted while discriminating", () => {
    let state = INITIAL_POSE_DRIVE_STATE;
    const startRadius = 100;

    // A real hand's pinch distance is not perfectly still while held during
    // the discrimination window — it drifts a little, all comfortably inside
    // TAP_MAX_MS (250ms in galaxy-nav.ts).
    const drifting = [0.05, 0.04, 0.06, 0.05, 0.03];
    for (let i = 0; i < drifting.length; i++) {
      const step = driveFor(makeHand({ pinchDistance: drifting[i] }), state, i * 10);
      state = step.state;
      expect(step.drive).not.toBe("zoom"); // still discriminating
    }

    // The window elapses on this frame (t=250 >= TAP_MAX_MS since it engaged
    // at t=0) — seeding happens HERE, using this frame's live pinch distance,
    // never the one recorded back when the pinch first engaged.
    const elapsePinchDistance = 0.05;
    const elapseStep = driveFor(makeHand({ pinchDistance: elapsePinchDistance }), state, 250);
    expect(elapseStep.drive).toBe("zoom");
    const zoomReference = { pinch: elapsePinchDistance, radius: startRadius };

    // The delta on this very frame is measured against the reference that
    // was just seeded from it, so it is zero — the radius does not jump.
    const radiusOnTakeover = radiusStep(zoomReference.radius, elapsePinchDistance - zoomReference.pinch, 600, 15, 2500);
    expect(radiusOnTakeover).toBe(startRadius);
  });
});

describe("orbitStep", () => {
  it("applies a relative delta and clamps the polar angle away from the poles", () => {
    const start = { radius: 100, phi: Math.PI / 2, theta: 0 };
    const next = orbitStep(start, { x: 10, y: 0 }, 0.01);
    expect(next.theta).toBeCloseTo(start.theta - 0.1, 5);
    expect(next.radius).toBe(100);

    const nearPole = orbitStep({ radius: 100, phi: 0.01, theta: 0 }, { x: 0, y: 100 }, 1);
    expect(nearPole.phi).toBeGreaterThan(0);
  });
});

describe("radiusStep", () => {
  it("clamps at both the min and max bounds", () => {
    expect(radiusStep(50, -1000, 1, 10, 500)).toBe(10);
    expect(radiusStep(50, 1000, 1, 10, 500)).toBe(500);
    expect(radiusStep(50, 5, 1, 10, 500)).toBe(55);
  });
});

describe("focusNeighborhood", () => {
  it("returns an empty set when nothing is focused (no filtering)", () => {
    const result = focusNeighborhood([], [{ source: "a", target: "b" }]);
    expect(result.size).toBe(0);
  });

  it("includes the focused ids plus every direct (one-hop) neighbor, in either direction", () => {
    const links = [
      { source: "a", target: "b" }, // a -> b, a focused
      { source: "c", target: "a" }, // c -> a, reverse direction into the focus
      { source: "b", target: "d" }, // b -> d, two hops from a — must NOT be included
    ];
    const result = focusNeighborhood(["a"], links);
    expect(result).toEqual(new Set(["a", "b", "c"]));
    expect(result.has("d")).toBe(false);
  });

  it("does not cascade to a second hop regardless of link array order", () => {
    // Same topology as above (a -> b -> d), but b -> d listed BEFORE a -> b.
    // A naive single pass that grows its own membership set while iterating
    // would let "d" leak in here, since by the time it reaches "b -> d" a
    // buggy implementation might already have added "b".
    const linksReversed = [
      { source: "b", target: "d" },
      { source: "a", target: "b" },
    ];
    const result = focusNeighborhood(["a"], linksReversed);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("unions neighbors across multiple focused ids", () => {
    const links = [
      { source: "a", target: "x" },
      { source: "b", target: "y" },
    ];
    const result = focusNeighborhood(["a", "b"], links);
    expect(result).toEqual(new Set(["a", "b", "x", "y"]));
  });

  it("a focused id with no links resolves to just itself", () => {
    const result = focusNeighborhood(["lonely"], [{ source: "a", target: "b" }]);
    expect(result).toEqual(new Set(["lonely"]));
  });
});
