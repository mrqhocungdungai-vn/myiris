import * as THREE from "three";
import { nearestNodeAt, type GalaxyNavNode, type ScreenRect } from "./galaxy-nav";

// The galaxy's orbit anchor (galaxy-note-reachable-by-hand design.md D1-D5):
// the single point every camera path — hand and mouse alike — turns and dollies
// around. Pure policy, no React, no DOM, no live `3d-force-graph` instance; the
// camera drive is a thin driver over it, exactly as it already is over
// `galaxy-nav.ts`.
//
// `centerRef` previously carried two jobs at once — the graph's centroid AND
// the point the camera turned around — which is why orbiting always circled the
// middle of the ball and why a fist thrown after a mouse pan silently threw the
// pan away. Splitting them is the whole substance of this module.

export type Vec3 = { x: number; y: number; z: number };

/**
 * Three variants, and each one is required by something (design.md D1):
 *
 * - `centroid` — the default, so a freshly-opened galaxy behaves exactly as it
 *   did before an anchor existed, and so backing out has somewhere to return to.
 * - `node` — stores an **id**, never a copied position: a position captured at
 *   anchor time is wrong the instant the force layout nudges the node, and a
 *   node deleted by a live vault refresh must degrade to the centroid rather
 *   than to a phantom point in space. Same reasoning `second-brain-focus`
 *   already applies to selections.
 * - `point` — an arbitrary world position. `TrackballControls` implements
 *   panning by mutating `this.target` in place (`_panCamera`), so a mouse pan
 *   produces a point that is neither the centroid nor any node. Without a
 *   variant that can hold it, "a pan sets the anchor rather than being
 *   overwritten by it" is unrepresentable.
 */
export type GalaxyAnchor =
  | { kind: "centroid" }
  | { kind: "node"; id: string }
  | { kind: "point"; position: Vec3 };

export const CENTROID_ANCHOR: GalaxyAnchor = { kind: "centroid" };

/** Just enough of the live position map to resolve a node anchor against. */
export type AnchorPositions = {
  get(id: string): { x?: number; y?: number; z?: number } | undefined;
};

/**
 * The anchor's world position at the moment of use.
 *
 * A `node` anchor whose id no longer resolves — deleted by a vault refresh, or
 * not yet given a position by the simulation — falls back to the centroid
 * (design.md D1). Resolving late and failing soft is what lets the anchor hold
 * an id rather than a stale copy of a position.
 */
export function resolveAnchor(anchor: GalaxyAnchor, positions: AnchorPositions, centroid: Vec3): Vec3 {
  if (anchor.kind === "point") return { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z };
  if (anchor.kind === "node") {
    const node = positions.get(anchor.id);
    if (node && node.x !== undefined) return { x: node.x, y: node.y ?? 0, z: node.z ?? 0 };
    return { x: centroid.x, y: centroid.y, z: centroid.z };
  }
  return { x: centroid.x, y: centroid.y, z: centroid.z };
}

/** Whether two anchors name the same thing — the "did this engage actually move the anchor" test (design.md D4b). */
export function anchorsEqual(a: GalaxyAnchor, b: GalaxyAnchor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.id === b.id;
  if (a.kind === "point" && b.kind === "point") {
    return a.position.x === b.position.x && a.position.y === b.position.y && a.position.z === b.position.z;
  }
  return true;
}

/**
 * The anchor a camera drive would take hold of with its sight at `point`
 * (design.md D2, generalised by D14).
 *
 * `point` is the sight — where the user's hands are, in window pixels — not the
 * centre of the screen. A centre-pinned sight can only be aimed by first flying
 * the camera until the target is in the middle, which is the hardest part of the
 * task demanded before the easy part is allowed to start.
 *
 * This is `nearestNodeAt`, reused rather than a raycast deliberately: a raycast
 * answers "what does the ray hit", so a node beside the sight would be ignored
 * while one the ray happens to graze would win. The spec says *near* the sight.
 *
 * Passing `current` as the incumbent is not incidental: the dead-band head start
 * it earns is what stops the anchor flapping between two neighbours as the sight
 * drifts across a dense region.
 *
 * With nothing in range the CURRENT anchor is returned unchanged — aiming at
 * empty space must not throw the view back to the middle of the vault.
 */
export function pickAnchorAt(
  nodes: Iterable<GalaxyNavNode>,
  camera: THREE.Camera,
  rect: ScreenRect,
  point: { x: number; y: number },
  current: GalaxyAnchor,
  thresholdPx: number,
): GalaxyAnchor {
  const incumbentId = current.kind === "node" ? current.id : null;
  const node = nearestNodeAt(nodes, camera, rect, point, thresholdPx, incumbentId);
  if (!node) return current;
  if (incumbentId === node.id) return current;
  return { kind: "node", id: node.id };
}

/** The centre of `rect` in window pixels — the sight's fallback when no hand is in frame. */
export function rectCentre(rect: ScreenRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Reused across frames, like `galaxy-nav.ts`'s own scratch — this runs inside
// the gesture loop, which must not allocate per frame.
const rayScratch = new THREE.Vector3();
const dirScratch = new THREE.Vector3();
const forwardScratch = new THREE.Vector3();
const offsetScratch = new THREE.Vector3();

/**
 * The world point under the sight, at the same viewing depth as `depthPoint`
 * (galaxy-note-reachable-by-hand design.md D15).
 *
 * This is what makes the sight a pivot even where there is no note: casting a ray
 * through the sight pixel and crossing it with the plane through the current
 * pivot, perpendicular to the view. Turn the camera with the sight over empty
 * space and it turns around *that* spot, at the distance it was already working
 * at — not around whatever the anchor happened to be left on.
 *
 * Falls back to `depthPoint` unchanged in the degenerate cases (a ray parallel to
 * the view plane, or a pivot behind the camera), which cannot arise for a sight
 * inside the viewport but must not produce NaN if they ever do.
 */
export function sightPivotPoint(
  camera: THREE.Camera,
  rect: ScreenRect,
  point: { x: number; y: number },
  depthPoint: Vec3,
): Vec3 {
  const fallback = { x: depthPoint.x, y: depthPoint.y, z: depthPoint.z };
  const ndcX = ((point.x - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((point.y - rect.top) / rect.height) * 2 - 1);
  rayScratch.set(ndcX, ndcY, 0.5).unproject(camera);
  dirScratch.copy(rayScratch).sub(camera.position);
  if (dirScratch.lengthSq() === 0) return fallback;
  dirScratch.normalize();
  camera.getWorldDirection(forwardScratch);
  const denominator = dirScratch.dot(forwardScratch);
  if (Math.abs(denominator) < 1e-6) return fallback;
  offsetScratch.set(depthPoint.x, depthPoint.y, depthPoint.z).sub(camera.position);
  const distance = offsetScratch.dot(forwardScratch) / denominator;
  if (!(distance > 0)) return fallback;
  return {
    x: camera.position.x + dirScratch.x * distance,
    y: camera.position.y + dirScratch.y * distance,
    z: camera.position.z + dirScratch.z * distance,
  };
}

/**
 * The pivot a camera drive engaging right now would turn around: **whatever the
 * sight is on**, always (design.md D15).
 *
 * A node within `thresholdPx` wins, because snapping to a note is what makes
 * "dolly all the way in and arrive at that note" work. With nothing near enough
 * the pivot is the point under the sight at the current working depth — NOT the
 * anchor left over from before.
 *
 * That last part is the whole difference from `pickAnchorAt`. Keeping the old
 * anchor when the sight is over empty space means the camera turns around
 * something the user is not pointing at and cannot see — most visibly the note
 * they last opened, which then follows them around as an invisible pivot. The
 * rule is one sentence with no exception: you turn around the mark.
 */
export function pickPivotAt(
  nodes: Iterable<GalaxyNavNode>,
  camera: THREE.Camera,
  rect: ScreenRect,
  point: { x: number; y: number },
  current: GalaxyAnchor,
  thresholdPx: number,
  currentPosition: Vec3,
): GalaxyAnchor {
  const incumbentId = current.kind === "node" ? current.id : null;
  const node = nearestNodeAt(nodes, camera, rect, point, thresholdPx, incumbentId);
  if (node) return incumbentId === node.id ? current : { kind: "node", id: node.id };
  return { kind: "point", position: sightPivotPoint(camera, rect, point, currentPosition) };
}

// How far out counts as "framing the whole graph" — a multiple of the graph's
// own extent rather than an absolute world distance, so it behaves the same for
// a twelve-note vault and a five-hundred-note one (design.md D5).
export const RELEASE_EXTENT_MULTIPLE = 2;

/**
 * Whether the camera has backed far enough out that the anchor should return to
 * the centroid, so closing the hands is the way back to the overview.
 *
 * The second clause is load-bearing, not defensive (design.md D5): a vault
 * whose bounding radius exceeds about half `maxRadius` can never dolly out far
 * enough to reach the multiple, so the release would be unreachable on exactly
 * the large vaults that need it most. Reaching the furthest the camera can go
 * counts as having backed out.
 */
export function shouldReleaseAnchor(radius: number, graphBoundingRadius: number, maxRadius: number): boolean {
  if (graphBoundingRadius > 0 && radius >= graphBoundingRadius * RELEASE_EXTENT_MULTIPLE) return true;
  return radius >= maxRadius;
}

// Roughly how long the aim takes to arrive on a newly-anchored node. The lerp
// below is exponential rather than linear, so this is expressed as the time to
// cover 95% of the distance — which is what "the aim glides onto it" means in
// practice.
export const ANCHOR_EASE_MS = 180;
const EASE_TAU_MS = ANCHOR_EASE_MS / Math.log(20);
// Below this many world units apart, the ease snaps. An exponential approach
// never actually arrives, and a displayed anchor that is forever a hair off the
// target would keep the camera writing every frame with nothing moving.
const EASE_SNAP_EPSILON = 0.01;

/**
 * The eased LOOK-AT point (design.md D3).
 *
 * This must never feed the camera's POSITION. `writeCameraFromSpherical`
 * computes `position = anchor + offset(spherical)`, and the spherical is seeded
 * against the *target* anchor at engage — so feeding it a lerping anchor would
 * write the camera to `oldAnchor + (camPos - targetAnchor)` on the first frame,
 * a lurch of exactly `oldAnchor - targetAnchor` that then decays. Separating the
 * orbit origin (target anchor, fixed at engage) from the look-at point (this
 * value, easing) is what lets "re-anchoring never moves the camera" and "a
 * change of aim is eased" both hold, rather than being traded off.
 *
 * The ease lives here rather than being handed to `cameraPosition(..., 180)`
 * because the gesture loop's next frame calls `cameraPosition(..., 0)`, which
 * ends any tween in flight unconditionally.
 */
export function easeAnchor(displayed: Vec3, target: Vec3, dtMs: number): Vec3 {
  if (dtMs <= 0) return { x: displayed.x, y: displayed.y, z: displayed.z };
  const dx = target.x - displayed.x;
  const dy = target.y - displayed.y;
  const dz = target.z - displayed.z;
  if (Math.hypot(dx, dy, dz) <= EASE_SNAP_EPSILON) return { x: target.x, y: target.y, z: target.z };
  // Frame-rate independent: a 32 ms frame advances exactly as far as two 16 ms
  // ones, so the ease does not run at a different speed on a loaded machine.
  const alpha = 1 - Math.exp(-dtMs / EASE_TAU_MS);
  return { x: displayed.x + dx * alpha, y: displayed.y + dy * alpha, z: displayed.z + dz * alpha };
}
