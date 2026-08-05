import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  nearestNodeAt,
  dwellStep,
  INITIAL_DWELL_STATE,
  driveFor,
  orbitStep,
  handDistance,
  zoomRadius,
  focusNeighborhood,
  type DwellState,
  type GalaxyNavNode,
} from "./galaxy-nav";
import type { HandState, TrackedHand } from "../hooks/useHandControl";

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
  function makeTrackedHand(overrides: Partial<TrackedHand> = {}): TrackedHand {
    return {
      id: "single",
      point: { x: 0, y: 0 },
      landmarks: [],
      gesture: "None",
      gestureScore: 1,
      pointing: false,
      openPalm: false,
      fist: false,
      pinchDistance: 0.2,
      ...overrides,
    };
  }

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
      hands: [makeTrackedHand()],
      ...overrides,
    };
  }

  it("returns zoom for two open palms", () => {
    const hands = [makeTrackedHand({ id: "left", openPalm: true }), makeTrackedHand({ id: "right", openPalm: true })];
    expect(driveFor(makeHand({ openPalm: true, hands }))).toBe("zoom");
  });

  it("returns dwell for Pointing_Up", () => {
    expect(driveFor(makeHand({ pointing: true, hands: [makeTrackedHand({ pointing: true })] }))).toBe("dwell");
  });

  it("returns orbit for Closed_Fist", () => {
    expect(driveFor(makeHand({ fist: true, hands: [makeTrackedHand({ fist: true })] }))).toBe("orbit");
  });

  it("returns null for a single open palm, an unrecognized gesture, and a resting hand", () => {
    expect(driveFor(makeHand({ openPalm: true, hands: [makeTrackedHand({ openPalm: true })] }))).toBeNull();
    expect(driveFor(makeHand())).toBeNull(); // "None" gesture, resting/unrecognized
  });

  // The pinch has no meaning in the galaxy at all (proposal.md "What
  // Changes"): whatever canned class the recognizer assigns a pinched hand
  // is what drives it — a tight pinch reads as Closed_Fist and orbits like
  // any other fist; anything else it might read as drives nothing. Never a
  // zoom, at any thumb-index distance.
  it("a pinch drives whatever its canned class says, never a zoom", () => {
    const pinchedFist = makeTrackedHand({ fist: true, pinchDistance: 0.02 });
    expect(driveFor(makeHand({ fist: true, hands: [pinchedFist] }))).toBe("orbit");

    const pinchedRest = makeTrackedHand({ pinchDistance: 0.02 });
    expect(driveFor(makeHand({ hands: [pinchedRest] }))).toBeNull();

    const looselyPinchedRest = makeTrackedHand({ pinchDistance: 0.15 });
    expect(driveFor(makeHand({ hands: [looselyPinchedRest] }))).toBeNull();
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

describe("handDistance", () => {
  it("measures the hypotenuse between two hand points", () => {
    expect(handDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("is symmetric", () => {
    const a = { x: 12, y: 40 };
    const b = { x: 100, y: 5 };
    expect(handDistance(a, b)).toBe(handDistance(b, a));
  });
});

describe("zoomRadius", () => {
  it("shrinks the radius when the hands spread apart (curDist > refDist)", () => {
    const next = zoomRadius({ refRadius: 100, refDist: 200, curDist: 400, min: 10, max: 1000 });
    expect(next).toBeLessThan(100);
  });

  it("grows the radius when the hands close together (curDist < refDist)", () => {
    const next = zoomRadius({ refRadius: 100, refDist: 200, curDist: 100, min: 10, max: 1000 });
    expect(next).toBeGreaterThan(100);
  });

  it("produces no change when curDist equals refDist", () => {
    expect(zoomRadius({ refRadius: 250, refDist: 150, curDist: 150, min: 10, max: 1000 })).toBe(250);
  });

  it("clamps at both the min and max bounds", () => {
    expect(zoomRadius({ refRadius: 100, refDist: 200, curDist: 100000, min: 10, max: 1000 })).toBe(10);
    expect(zoomRadius({ refRadius: 100000, refDist: 200, curDist: 100, min: 10, max: 1000 })).toBe(1000);
  });

  it("floors refDist and curDist so hands nearly touching still produce a finite result", () => {
    // Both well under the 80px floor, so both clamp to it — the ratio is 1
    // and the radius is unchanged, rather than a division blowing it up.
    const next = zoomRadius({ refRadius: 100, refDist: 1, curDist: 1, min: 10, max: 100000 });
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBe(100);
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
