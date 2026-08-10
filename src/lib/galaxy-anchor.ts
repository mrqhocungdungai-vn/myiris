import * as THREE from "three";
import { type GalaxyNavNode, type ScreenRect } from "./galaxy-nav";

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

// How close two nodes have to project before they count as OVERLAPPING on
// screen, which is the only situation where depth is allowed to decide between
// them (design.md D20). Sized to a node's own dot plus a little margin.
const OCCLUSION_PX = 28;
// The head start the current target gets in `pickZoomTarget`. Wider than
// `nearestNodeAt`'s own DEAD_BAND_PX (14) on purpose: this picker can flip on
// DEPTH, which the user cannot see directly, so it needs more hysteresis than
// one that only ever flips on the screen distance they can.
const ZOOM_INCUMBENT_BIAS_PX = 30;
// The same head start, for the DEPTH comparison. Applied as a factor on the
// squared camera distance (0.8 here is roughly "11% nearer in a straight
// line"), because a screen-pixel bias buys the incumbent nothing once two
// nodes overlap and the tie is settled on depth instead — which is exactly
// the comparison the user cannot see, and so the one that most needs
// hysteresis.
const ZOOM_INCUMBENT_DEPTH_FACTOR = 0.8;


const pickScratch = new THREE.Vector3();

/**
 * The note a two-palm zoom would fly to (galaxy-note-reachable-by-hand
 * design.md D20) — **always a note, never a point in space**.
 *
 * This is the whole substance of what the zoom is for. Dollying toward an
 * arbitrary point between notes is what made the zoom feel aimless: the user's
 * goal is never "get closer to that emptiness", it is "get to that note so I
 * can dwell on it". So the sight always marks a note, and spreading the palms
 * always travels toward one.
 *
 * **Depth breaks ties only between nodes that OVERLAP on screen.** Ranking
 * purely by screen distance (what `nearestNodeAt` does, correctly, for the
 * dwell) picks a node on the far side of the ball that happens to project
 * beside the sight — a note the user cannot even see, because a nearer one is
 * drawn over it. But ranking by depth outright is worse in the opposite
 * direction: at overview distance every node is within the threshold, so
 * "front-most" resolves to an arbitrary dot on the near face rather than the
 * one aimed at. Depth is invisible to the user *except* through occlusion, so
 * it may only decide between things that visually cover each other.
 *
 * With nothing in range the CURRENT anchor is kept — aiming at empty space
 * must not make the mark run away to some distant note the user never aimed at,
 * and keeping it is also what lets them pinch back out without re-aiming.
 */
export function pickZoomTarget(
  nodes: Iterable<GalaxyNavNode>,
  camera: THREE.Camera,
  rect: ScreenRect,
  point: { x: number; y: number },
  current: GalaxyAnchor,
  thresholdPx: number,
): GalaxyAnchor {
  const incumbentId = current.kind === "node" ? current.id : null;
  let bestId: string | null = null;
  let bestD = Infinity;
  let bestZ = Infinity;

  for (const node of nodes) {
    if (node.ghost || node.x === undefined) continue;
    pickScratch.set(node.x, node.y ?? 0, node.z ?? 0);
    const isIncumbent = node.id === incumbentId;
    const rawDepth = pickScratch.distanceToSquared(camera.position);
    const depth = isIncumbent ? rawDepth * ZOOM_INCUMBENT_DEPTH_FACTOR : rawDepth;
    pickScratch.project(camera);
    // Same front-of-camera guard, and same accept-range form, as
    // `nearestNodeAt` — a node exactly at the camera projects to NaN, and every
    // NaN comparison is false, so only the accept form excludes it.
    if (!(pickScratch.z >= -1 && pickScratch.z <= 1)) continue;
    const x = rect.left + ((pickScratch.x + 1) * rect.width) / 2;
    const y = rect.top + ((1 - pickScratch.y) * rect.height) / 2;
    const raw = Math.hypot(x - point.x, y - point.y);
    const d = isIncumbent ? Math.max(0, raw - ZOOM_INCUMBENT_BIAS_PX) : raw;
    if (d > thresholdPx) continue;

    if (bestId === null) {
      bestId = node.id;
      bestD = d;
      bestZ = depth;
      continue;
    }
    const nearSight = d <= OCCLUSION_PX;
    const bestNearSight = bestD <= OCCLUSION_PX;
    // Anything under the sight beats anything merely beside it; between two
    // both under it, the nearer one wins because it is the one drawn on top.
    const wins = nearSight !== bestNearSight ? nearSight : nearSight ? depth < bestZ : d < bestD;
    if (wins) {
      bestId = node.id;
      bestD = d;
      bestZ = depth;
    }
  }

  if (bestId === null) return current;
  return bestId === incumbentId ? current : { kind: "node", id: bestId };
}

/**
 * How long a NEW note has to stay under the sight before the camera commits to
 * it (design.md D23). Mirrors `dwellStep`'s pending-hold, for the same reason
 * in a different place: every other guard here is spatial — a pixel bias, a
 * depth factor — and spatial hysteresis cannot tell a hand deliberately moving
 * to another note from a hand wobbling between two of them in a dense cloud.
 * Only time can.
 *
 * Tunable, and deliberately the one number to change if this still reads as
 * twitchy (or as sluggish): the acquiring mark makes the wait visible, which is
 * what lets it be this long without feeling like lag.
 */
export const ZOOM_LOCK_HOLD_MS = 1500;

export type ZoomLockState = {
  /** The note the camera is committed to. */
  lockedId: string | null;
  /** A different note currently charging toward a lock. */
  pendingId: string | null;
  pendingSince: number;
};

export const INITIAL_ZOOM_LOCK: ZoomLockState = { lockedId: null, pendingId: null, pendingSince: 0 };

/**
 * Whether the zoom's target may change yet (design.md D23) — the temporal half
 * of the lock, run every frame against the throttled picker's latest candidate.
 *
 * The asymmetry is the whole point, and it is the same one `dwellStep` uses:
 *
 * - **Acquiring** a target when there is none is FREE. Nothing is being taken
 *   away, so making the user wait would be delay for its own sake.
 * - **Switching** away from a locked note costs `holdMs` of the sight staying
 *   on the new one. That is what stops the camera being dragged from note to
 *   note by a hand crossing a dense region, which is what "it keeps jumping"
 *   actually is.
 * - **Losing** the candidate entirely (the sight over empty space) keeps the
 *   lock and abandons any charge, so drifting off a note mid-charge does not
 *   quietly commit to it later.
 *
 * `progress` is 0..1 over the charge, so the mark can show it: an invisible
 * wait reads as the feature being broken, a visible one reads as the feature
 * working.
 */
export function zoomLockStep(
  state: ZoomLockState,
  candidateId: string | null,
  now: number,
  holdMs: number,
): { state: ZoomLockState; lockedId: string | null; acquiringId: string | null; progress: number } {
  if (candidateId === null) {
    const next = state.pendingId === null ? state : { ...state, pendingId: null, pendingSince: 0 };
    return { state: next, lockedId: state.lockedId, acquiringId: null, progress: 0 };
  }

  if (candidateId === state.lockedId) {
    const next = state.pendingId === null ? state : { ...state, pendingId: null, pendingSince: 0 };
    return { state: next, lockedId: state.lockedId, acquiringId: null, progress: 0 };
  }

  // Nothing is locked yet — take it immediately.
  if (state.lockedId === null) {
    const next: ZoomLockState = { lockedId: candidateId, pendingId: null, pendingSince: 0 };
    return { state: next, lockedId: candidateId, acquiringId: null, progress: 0 };
  }

  if (candidateId === state.pendingId) {
    const elapsed = now - state.pendingSince;
    if (elapsed >= holdMs) {
      const next: ZoomLockState = { lockedId: candidateId, pendingId: null, pendingSince: 0 };
      return { state: next, lockedId: candidateId, acquiringId: null, progress: 1 };
    }
    return {
      state,
      lockedId: state.lockedId,
      acquiringId: candidateId,
      progress: holdMs > 0 ? Math.max(0, Math.min(1, elapsed / holdMs)) : 1,
    };
  }

  const next: ZoomLockState = { ...state, pendingId: candidateId, pendingSince: now };
  return { state: next, lockedId: state.lockedId, acquiringId: candidateId, progress: 0 };
}

// Reused across frames — this runs inside the gesture loop, which must not
// allocate per frame.
const forwardScratch = new THREE.Vector3();

/**
 * The world point at the CENTRE of the view, `distance` in front of the camera
 * (galaxy-note-reachable-by-hand design.md D24).
 *
 * What an un-targeted zoom turns around: with no note locked, spreading the
 * hands simply moves in and out along the axis the camera is already looking
 * down, which is the plain reading of "just zoom in and out at the middle of
 * the screen". Anchoring to the graph's centroid instead would drift the view
 * sideways whenever the centroid was off-centre, which after any travel it
 * usually is.
 *
 * Safe to recompute while the camera moves, unlike the sight-derived pivot D20
 * deleted: the camera looks AT this point, so re-deriving it returns the same
 * point — a fixed point of its own feedback rather than one that walks.
 */
export function viewCentrePoint(camera: THREE.Camera, distance: number): Vec3 {
  camera.getWorldDirection(forwardScratch);
  return {
    x: camera.position.x + forwardScratch.x * distance,
    y: camera.position.y + forwardScratch.y * distance,
    z: camera.position.z + forwardScratch.z * distance,
  };
}

/** The centre of `rect` in window pixels — the sight's fallback when no hand is in frame. */
export function rectCentre(rect: ScreenRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// How far out counts as "framing the whole graph" — a multiple of the graph's
// own extent rather than an absolute world distance, so it behaves the same for
// a twelve-note vault and a five-hundred-note one (design.md D5).
export const RELEASE_EXTENT_MULTIPLE = 2;

/**
 * Whether the camera has backed far enough out that the anchor should return to
 * the centroid, so closing the hands is the way back to the overview — which
 * only applies while NOTHING is locked.
 *
 * The second clause is load-bearing, not defensive (design.md D5): a vault
 * whose bounding radius exceeds about half `maxRadius` can never dolly out far
 * enough to reach the multiple, so the release would be unreachable on exactly
 * the large vaults that need it most. Reaching the furthest the camera can go
 * counts as having backed out.
 */
export function shouldReleaseAnchor(
  radius: number,
  graphBoundingRadius: number,
  maxRadius: number,
  locked: boolean,
): boolean {
  // A LOCK OUTRANKS THE ZOOM, and this is where that is decided rather than at
  // the call site, so it is a property of the rule instead of a habit of one
  // caller. Backing out used to drop the lock, which let the most ordinary
  // navigation gesture destroy the user's choice without being about it: lock a
  // note, spread the palms to see where it sits, and past twice the graph's
  // extent the lock, its ring, and the zoom's target all vanished at once.
  // Changing a choice should take an act of choosing — aiming at another note.
  if (locked) return false;
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
