import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  CENTROID_ANCHOR,
  anchorsEqual,
  easeAnchor,
  pickAnchorAtCenter,
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

describe("pickAnchorAtCenter", () => {
  it("takes the node nearest the centre of the screen", () => {
    const camera = makeCamera();
    const centre: GalaxyNavNode = { id: "centre", title: "Centre", x: 0, y: 0, z: 0 };
    const result = pickAnchorAtCenter([centre], camera, RECT, CENTROID_ANCHOR, 100);
    expect(result).toEqual({ kind: "node", id: "centre" });
  });

  it("keeps the current anchor when nothing is in range — a grab over empty space", () => {
    const camera = makeCamera();
    const far: GalaxyNavNode = { id: "far", title: "Far", x: 8, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "held" };
    expect(pickAnchorAtCenter([far], camera, RECT, current, 5)).toBe(current);
  });

  it("keeps the current anchor over an empty graph", () => {
    const camera = makeCamera();
    expect(pickAnchorAtCenter([], camera, RECT, CENTROID_ANCHOR, 100)).toBe(CENTROID_ANCHOR);
  });

  it("gives the incumbent a dead-band head start, so the anchor does not flap between neighbours", () => {
    const camera = makeCamera();
    // Both project within the threshold; `challenger` is marginally nearer the
    // centre, but not by more than nearestNodeAt's dead band.
    const incumbent: GalaxyNavNode = { id: "incumbent", title: "Incumbent", x: 0.05, y: 0, z: 0 };
    const challenger: GalaxyNavNode = { id: "challenger", title: "Challenger", x: 0.02, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "incumbent" };
    expect(pickAnchorAtCenter([incumbent, challenger], camera, RECT, current, 100)).toBe(current);
  });

  it("returns the same anchor object when the pick has not changed, so the caller can tell nothing moved", () => {
    const camera = makeCamera();
    const centre: GalaxyNavNode = { id: "centre", title: "Centre", x: 0, y: 0, z: 0 };
    const current: GalaxyAnchor = { kind: "node", id: "centre" };
    expect(pickAnchorAtCenter([centre], camera, RECT, current, 100)).toBe(current);
  });

  it("queries the centre of the rect, not the origin of the window", () => {
    const camera = makeCamera();
    const node: GalaxyNavNode = { id: "n", title: "N", x: 0, y: 0, z: 0 };
    const offsetRect = { left: 200, top: 100, width: 800, height: 600 };
    expect(pickAnchorAtCenter([node], camera, offsetRect, CENTROID_ANCHOR, 5)).toEqual({ kind: "node", id: "n" });
  });
});

describe("shouldReleaseAnchor", () => {
  const EXTENT = 100;
  const MAX = 2500;

  it("holds the anchor while the camera is inside the graph's extent multiple", () => {
    expect(shouldReleaseAnchor(EXTENT * RELEASE_EXTENT_MULTIPLE - 1, EXTENT, MAX)).toBe(false);
  });

  it("releases past the extent multiple", () => {
    expect(shouldReleaseAnchor(EXTENT * RELEASE_EXTENT_MULTIPLE, EXTENT, MAX)).toBe(true);
  });

  it("releases at the dolly clamp even when the extent multiple is unreachable", () => {
    // A vault whose bounding radius exceeds half the clamp can never dolly out
    // to 2x its extent — without this clause the release would be unreachable
    // on exactly the large vaults that need it most (design.md D5).
    const hugeExtent = MAX;
    expect(shouldReleaseAnchor(MAX, hugeExtent, MAX)).toBe(true);
    expect(shouldReleaseAnchor(MAX - 1, hugeExtent, MAX)).toBe(false);
  });

  it("falls back to the clamp alone when the graph has no measurable extent", () => {
    expect(shouldReleaseAnchor(1, 0, MAX)).toBe(false);
    expect(shouldReleaseAnchor(MAX, 0, MAX)).toBe(true);
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
