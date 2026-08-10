import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  CENTROID_ANCHOR,
  anchorsEqual,
  easeAnchor,
  pickZoomTarget,
  zoomLockStep,
  INITIAL_ZOOM_LOCK,
  rectCentre,
  resolveAnchor,
  shouldReleaseAnchor,
  ANCHOR_EASE_MS,
  RELEASE_EXTENT_MULTIPLE,
  type GalaxyAnchor,
} from "./galaxy-anchor";
import type { GalaxyNavNode } from "./galaxy-nav";

// Real PerspectiveCamera + updateMatrixWorld — no WebGL context needed, the
// same pattern galaxy-nav.test.ts already uses.
function makeCamera() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const RECT = { left: 0, top: 0, width: 800, height: 600 };
const CENTROID = { x: 1, y: 2, z: 3 };

function positions(entries: Record<string, { x?: number; y?: number; z?: number }>) {
  return { get: (id: string) => entries[id] };
}

describe("resolveAnchor", () => {
  it("resolves the centroid variant to the centroid", () => {
    expect(resolveAnchor(CENTROID_ANCHOR, positions({}), CENTROID)).toEqual(CENTROID);
  });

  it("resolves a node anchor to that node's live position", () => {
    const anchor: GalaxyAnchor = { kind: "node", id: "a" };
    expect(resolveAnchor(anchor, positions({ a: { x: 10, y: 20, z: 30 } }), CENTROID)).toEqual({
      x: 10,
      y: 20,
      z: 30,
    });
  });

  it("falls back to the centroid when a node id no longer resolves", () => {
    const anchor: GalaxyAnchor = { kind: "node", id: "deleted" };
    expect(resolveAnchor(anchor, positions({}), CENTROID)).toEqual(CENTROID);
  });

  it("falls back to the centroid when the node has no position yet", () => {
    const anchor: GalaxyAnchor = { kind: "node", id: "a" };
    expect(resolveAnchor(anchor, positions({ a: {} }), CENTROID)).toEqual(CENTROID);
  });

  it("round-trips a point anchor — the variant a mouse pan needs", () => {
    const anchor: GalaxyAnchor = { kind: "point", position: { x: -4, y: 5.5, z: 6 } };
    expect(resolveAnchor(anchor, positions({}), CENTROID)).toEqual({ x: -4, y: 5.5, z: 6 });
  });

  it("copies rather than aliasing the point it resolves", () => {
    const anchor: GalaxyAnchor = { kind: "point", position: { x: 1, y: 1, z: 1 } };
    const resolved = resolveAnchor(anchor, positions({}), CENTROID);
    resolved.x = 99;
    expect(anchor.position.x).toBe(1);
  });
});

describe("anchorsEqual", () => {
  it("distinguishes variants, ids, and positions", () => {
    expect(anchorsEqual(CENTROID_ANCHOR, { kind: "centroid" })).toBe(true);
    expect(anchorsEqual({ kind: "node", id: "a" }, { kind: "node", id: "a" })).toBe(true);
    expect(anchorsEqual({ kind: "node", id: "a" }, { kind: "node", id: "b" })).toBe(false);
    expect(anchorsEqual({ kind: "node", id: "a" }, CENTROID_ANCHOR)).toBe(false);
    expect(
      anchorsEqual({ kind: "point", position: { x: 1, y: 2, z: 3 } }, { kind: "point", position: { x: 1, y: 2, z: 3 } }),
    ).toBe(true);
    expect(
      anchorsEqual({ kind: "point", position: { x: 1, y: 2, z: 3 } }, { kind: "point", position: { x: 1, y: 2, z: 4 } }),
    ).toBe(false);
  });
});

/** Where a node lands horizontally, in the same window pixels `pickZoomTarget` works in. */
function screenXOf(camera: THREE.Camera, node: GalaxyNavNode): number {
  const v = new THREE.Vector3(node.x, node.y ?? 0, node.z ?? 0).project(camera);
  return RECT.left + ((v.x + 1) * RECT.width) / 2;
}

describe("pickZoomTarget", () => {
  // The user's report: locking a note inside a dense cloud, seen from outside
  // it, made the target flicker through its neighbours. The movement causing it
  // is real — an unsteady hand travels tens of pixels — but at that distance
  // neighbours land tens of pixels apart too, so the sweep crosses notes the
  // user cannot resolve, let alone choose between. Screen separation is the
  // measure of "could this have been aimed at", and it scales itself.
  it("will not swap between neighbours that are inseparable on screen", () => {
    // Backed off outside the cloud, which is where the report came from.
    const camera = makeCamera();
    camera.position.set(0, 0, 40);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const held: GalaxyNavNode = { id: "held", title: "Held", x: 0, y: 0, z: 0 };
    // Far from the camera, so a whole world unit of separation is only a few
    // dozen pixels on screen.
    const neighbour: GalaxyNavNode = { id: "neighbour", title: "Neighbour", x: 5.2, y: 0, z: 0 };
    const held0 = screenXOf(camera, held);
    const neighbour0 = screenXOf(camera, neighbour);
    // Strictly between the old incumbent bias and the new separation rule, so
    // this test fails if the rule is removed rather than passing on the bias.
    const gap = Math.abs(neighbour0 - held0);
    // Strictly ABOVE what the incumbent bias and the occlusion rule already
    // block (~58px) and below the separation rule, so this test fails if the
    // rule is removed instead of passing on margins that predate it.
    expect(gap).toBeGreaterThan(58);
    expect(gap).toBeLessThan(120);

    // The sight sits right on the neighbour, and it still does not take it.
    const sight = { x: neighbour0, y: RECT.height / 2 };
    const current = { kind: "node", id: "held" } as const;
    expect(pickZoomTarget([held, neighbour], camera, RECT, sight, current, 400)).toEqual(current);
  });

  it("lets the same neighbour be chosen once the camera is close enough to tell them apart", () => {
    const close = makeCamera();
    close.position.set(0, 0, 1.6);
    close.updateMatrixWorld(true);
    close.updateProjectionMatrix();
    const held: GalaxyNavNode = { id: "held", title: "Held", x: 0, y: 0, z: 0 };
    const neighbour: GalaxyNavNode = { id: "neighbour", title: "Neighbour", x: 1, y: 0, z: 0 };
    const gap = Math.abs(screenXOf(close, neighbour) - screenXOf(close, held));
    expect(gap).toBeGreaterThan(120);

    const sight = { x: screenXOf(close, neighbour), y: RECT.height / 2 };
    expect(pickZoomTarget([held, neighbour], close, RECT, sight, { kind: "node", id: "held" }, 400)).toEqual({
      kind: "node",
      id: "neighbour",
    });
  });

  it("still switches to a note that is plainly somewhere else", () => {
    const camera = makeCamera();
    const held: GalaxyNavNode = { id: "held", title: "Held", x: 0, y: 0, z: 0 };
    const distant: GalaxyNavNode = { id: "distant", title: "Distant", x: 6, y: 0, z: 0 };
    expect(Math.abs(screenXOf(camera, distant) - screenXOf(camera, held))).toBeGreaterThan(120);
    const sight = { x: screenXOf(camera, distant), y: RECT.height / 2 };
    expect(pickZoomTarget([held, distant], camera, RECT, sight, { kind: "node", id: "held" }, 400)).toEqual({
      kind: "node",
      id: "distant",
    });
  });


  it("takes the node under the sight", () => {
    const camera = makeCamera();
    const centre: GalaxyNavNode = { id: "centre", title: "Centre", x: 0, y: 0, z: 0 };
    expect(pickZoomTarget([centre], camera, RECT, rectCentre(RECT), CENTROID_ANCHOR, 100)).toEqual({
      kind: "node",
      id: "centre",
    });
  });

  it("takes the node under the SIGHT, not the one at screen centre", () => {
    // D14's point, unchanged by D20: aiming must not require flying the camera
    // until the target is in the middle first.
    const camera = makeCamera();
    const atCentre: GalaxyNavNode = { id: "centre", title: "Centre", x: 0, y: 0, z: 0 };
    const offToTheSide: GalaxyNavNode = { id: "side", title: "Side", x: 2, y: 0, z: 0 };
    const sideSight = { x: RECT.width / 2 + 172, y: RECT.height / 2 };
    expect(pickZoomTarget([atCentre, offToTheSide], camera, RECT, sideSight, CENTROID_ANCHOR, 60)).toEqual({
      kind: "node",
      id: "side",
    });
  });

  // D20's core rule. The camera is at z=10 looking down -Z, so a SMALLER z is
  // further away: `far` sits behind `near` and is drawn under it.
  it("prefers the nearer of two nodes that overlap on screen — the one actually drawn on top", () => {
    const camera = makeCamera();
    const near: GalaxyNavNode = { id: "near", title: "Near", x: 0, y: 0, z: 0 };
    const far: GalaxyNavNode = { id: "far", title: "Far", x: 0, y: 0, z: -40 };
    expect(pickZoomTarget([far, near], camera, RECT, rectCentre(RECT), CENTROID_ANCHOR, 200)).toEqual({
      kind: "node",
      id: "near",
    });
  });

  // The other half of the same rule, and why "front-most wins" outright is
  // wrong: depth may only decide between nodes that visually cover each other.
  it("does NOT let a nearer node beside the sight beat the one under it", () => {
    const camera = makeCamera();
    const underSight: GalaxyNavNode = { id: "under", title: "Under", x: 0, y: 0, z: -40 };
    // Nearer the camera, but far enough across the screen to be a separate dot.
    const besideButNearer: GalaxyNavNode = { id: "beside", title: "Beside", x: 1.6, y: 0, z: 0 };
    expect(pickZoomTarget([besideButNearer, underSight], camera, RECT, rectCentre(RECT), CENTROID_ANCHOR, 300)).toEqual({
      kind: "node",
      id: "under",
    });
  });

  it("keeps the current anchor when nothing is in range, so the mark never runs away", () => {
    const camera = makeCamera();
    const far: GalaxyNavNode = { id: "far", title: "Far", x: 8, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "held" };
    expect(pickZoomTarget([far], camera, RECT, rectCentre(RECT), current, 5)).toBe(current);
  });

  it("keeps the current anchor over an empty graph", () => {
    const camera = makeCamera();
    expect(pickZoomTarget([], camera, RECT, rectCentre(RECT), CENTROID_ANCHOR, 100)).toBe(CENTROID_ANCHOR);
  });

  it("never returns a point pivot — the zoom always travels to a note (D20)", () => {
    const camera = makeCamera();
    const stale: GalaxyAnchor = { kind: "node", id: "last-opened" };
    const offCentre = { x: RECT.width / 2 + 120, y: RECT.height / 2 };
    expect(pickZoomTarget([], camera, RECT, offCentre, stale, 100).kind).not.toBe("point");
  });

  it("gives the incumbent a head start, so the target does not flap between neighbours", () => {
    const camera = makeCamera();
    const incumbent: GalaxyNavNode = { id: "incumbent", title: "Incumbent", x: 0.2, y: 0, z: 0 };
    const challenger: GalaxyNavNode = { id: "challenger", title: "Challenger", x: 0.02, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "incumbent" };
    expect(pickZoomTarget([incumbent, challenger], camera, RECT, rectCentre(RECT), current, 200)).toBe(current);
  });

  it("returns the same anchor object when the pick has not changed", () => {
    const camera = makeCamera();
    const centre: GalaxyNavNode = { id: "centre", title: "Centre", x: 0, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "centre" };
    expect(pickZoomTarget([centre], camera, RECT, rectCentre(RECT), current, 100)).toBe(current);
  });

  it("skips ghosts and excludes nodes behind the camera", () => {
    const camera = makeCamera();
    const ghost: GalaxyNavNode = { id: "ghost", title: "Ghost", x: 0, y: 0, z: 0, ghost: true };
    const behind: GalaxyNavNode = { id: "behind", title: "Behind", x: 0, y: 0, z: 20 };
    expect(pickZoomTarget([ghost, behind], camera, RECT, rectCentre(RECT), CENTROID_ANCHOR, 500)).toBe(CENTROID_ANCHOR);
  });
});

describe("zoomLockStep", () => {
  const HOLD = 1000;

  it("acquires instantly when nothing is locked yet — waiting would take nothing away", () => {
    const r = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD);
    expect(r.lockedId).toBe("a");
    expect(r.acquiringId).toBeNull();
  });

  it("does NOT switch to another note before the hold elapses", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    let last = zoomLockStep(state, "b", 10, HOLD);
    state = last.state;
    for (let t = 20; t < HOLD; t += 50) {
      last = zoomLockStep(state, "b", t, HOLD);
      state = last.state;
      expect(last.lockedId).toBe("a");
      expect(last.acquiringId).toBe("b");
    }
  });

  it("switches once the new note has been held for the full interval", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    state = zoomLockStep(state, "b", 10, HOLD).state;
    const fired = zoomLockStep(state, "b", 10 + HOLD, HOLD);
    expect(fired.lockedId).toBe("b");
    expect(fired.acquiringId).toBeNull();
  });

  // The actual complaint: a hand crossing a dense region brushes note after
  // note. None of them may take the camera.
  it("a candidate that keeps changing never switches the lock", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    let lockedId: string | null = "a";
    for (let t = 0; t < HOLD * 6; t += 100) {
      const flapping = t % 200 === 0 ? "b" : "c";
      const r = zoomLockStep(state, flapping, t, HOLD);
      state = r.state;
      lockedId = r.lockedId;
    }
    expect(lockedId).toBe("a");
  });

  it("abandons a charge when the sight leaves the note, rather than committing it later", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    state = zoomLockStep(state, "b", 0, HOLD).state;
    // Drift off onto empty space part-way through the charge.
    state = zoomLockStep(state, null, HOLD / 2, HOLD).state;
    // Coming straight back must start the charge over, not inherit the old one.
    const back = zoomLockStep(state, "b", HOLD / 2 + 10, HOLD);
    expect(back.lockedId).toBe("a");
    expect(back.progress).toBe(0);
  });

  it("keeps the lock while the sight is over empty space", () => {
    const state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    const r = zoomLockStep(state, null, 5000, HOLD);
    expect(r.lockedId).toBe("a");
    expect(r.acquiringId).toBeNull();
  });

  it("reports progress across the charge, so the mark can show the wait", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    state = zoomLockStep(state, "b", 0, HOLD).state;
    expect(zoomLockStep(state, "b", HOLD / 4, HOLD).progress).toBeCloseTo(0.25, 5);
    expect(zoomLockStep(state, "b", HOLD / 2, HOLD).progress).toBeCloseTo(0.5, 5);
    expect(zoomLockStep(state, "b", HOLD, HOLD).progress).toBe(1);
  });

  it("re-settling on the note already locked clears any charge and costs nothing", () => {
    let state = zoomLockStep(INITIAL_ZOOM_LOCK, "a", 0, HOLD).state;
    state = zoomLockStep(state, "b", 0, HOLD).state;
    const back = zoomLockStep(state, "a", 100, HOLD);
    expect(back.lockedId).toBe("a");
    expect(back.acquiringId).toBeNull();
    expect(back.state.pendingId).toBeNull();
  });
});

describe("shouldReleaseAnchor", () => {
  // The zoom must never take the lock away. Backing out used to drop it, so
  // spreading the palms to see where a note sits destroyed the choice of that
  // note — silently, in the middle of a gesture that was not about releasing.
  it("never releases while a note is locked, however far out the camera goes", () => {
    expect(shouldReleaseAnchor(EXTENT * RELEASE_EXTENT_MULTIPLE, EXTENT, MAX, true)).toBe(false);
    expect(shouldReleaseAnchor(MAX, EXTENT, MAX, true)).toBe(false);
    expect(shouldReleaseAnchor(MAX * 10, 0, MAX, true)).toBe(false);
  });

  const EXTENT = 100;
  const MAX = 2500;

  it("holds the anchor while the camera is inside the graph's extent multiple", () => {
    expect(shouldReleaseAnchor(EXTENT * RELEASE_EXTENT_MULTIPLE - 1, EXTENT, MAX, false)).toBe(false);
  });

  it("releases past the extent multiple", () => {
    expect(shouldReleaseAnchor(EXTENT * RELEASE_EXTENT_MULTIPLE, EXTENT, MAX, false)).toBe(true);
  });

  it("releases at the dolly clamp even when the extent multiple is unreachable", () => {
    // A vault whose bounding radius exceeds half the clamp can never dolly out
    // to 2x its extent — without this clause the release would be unreachable
    // on exactly the large vaults that need it most (design.md D5).
    const hugeExtent = MAX;
    expect(shouldReleaseAnchor(MAX, hugeExtent, MAX, false)).toBe(true);
    expect(shouldReleaseAnchor(MAX - 1, hugeExtent, MAX, false)).toBe(false);
  });

  it("falls back to the clamp alone when the graph has no measurable extent", () => {
    expect(shouldReleaseAnchor(1, 0, MAX, false)).toBe(false);
    expect(shouldReleaseAnchor(MAX, 0, MAX, false)).toBe(true);
  });
});

describe("easeAnchor", () => {
  const TARGET = { x: 10, y: 0, z: 0 };

  it("moves toward the target without arriving in one frame", () => {
    const next = easeAnchor({ x: 0, y: 0, z: 0 }, TARGET, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(TARGET.x);
  });

  it("converges onto the target over roughly the ease duration", () => {
    let displayed = { x: 0, y: 0, z: 0 };
    for (let elapsed = 0; elapsed < ANCHOR_EASE_MS; elapsed += 16) {
      displayed = easeAnchor(displayed, TARGET, 16);
    }
    expect(displayed.x).toBeGreaterThan(TARGET.x * 0.9);
    expect(displayed.x).toBeLessThanOrEqual(TARGET.x);
  });

  it("snaps once it is close enough, so it actually settles", () => {
    let displayed = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) displayed = easeAnchor(displayed, TARGET, 16);
    expect(displayed).toEqual(TARGET);
  });

  it("no-ops at the target", () => {
    expect(easeAnchor(TARGET, TARGET, 16)).toEqual(TARGET);
  });

  it("no-ops on a zero or negative frame delta", () => {
    expect(easeAnchor({ x: 0, y: 0, z: 0 }, TARGET, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is frame-rate independent — one long frame matches two short ones", () => {
    const oneLong = easeAnchor({ x: 0, y: 0, z: 0 }, TARGET, 32);
    const twoShort = easeAnchor(easeAnchor({ x: 0, y: 0, z: 0 }, TARGET, 16), TARGET, 16);
    expect(oneLong.x).toBeCloseTo(twoShort.x, 10);
  });
});
