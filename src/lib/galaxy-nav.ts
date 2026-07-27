import * as THREE from "three";
import type { HandState } from "../hooks/useHandControl";

// Pure policy for the second-brain galaxy's gesture layer (second-brain-
// gesture-nav design.md D1-D4b): node hit-testing, the dwell state machine,
// the hand-pose partition, and the camera-step math. No React, no DOM, no
// live `3d-force-graph` instance — GalaxyCanvas's rAF loop is a thin driver
// that feeds this module the frame's inputs and applies its outputs.

export type GalaxyNavNode = {
  id: string;
  title: string;
  x?: number;
  y?: number;
  z?: number;
  ghost?: boolean;
};

export type ScreenRect = { left: number; top: number; width: number; height: number };

// A candidate must beat the current target by more than this many pixels
// before nearestNodeAt even offers it as a switch (design.md M14) — repaint
// is O(n) with per-node material dispose/allocate, so a result that flips
// every frame in a dense cluster would mean up to 60 full digests/sec.
const DEAD_BAND_PX = 14;

// Reused across nodes and frames (design.md D1/M-2) — a per-node-per-frame
// `new THREE.Vector3()` would be 60·n allocations/sec of steady GC pressure.
const scratch = new THREE.Vector3();

/**
 * Projects candidate node positions against `camera` and returns the node
 * nearest `point` (in window pixels) within `thresholdPx`, or null.
 *
 * Front-of-camera guard (design.md D1/H1): `graph2ScreenCoords` does no
 * visibility test — a node behind the camera still projects to finite
 * in-viewport pixels — so a node is only eligible when its projected NDC z
 * satisfies `-1 <= z <= 1`. Stated as an accept range, not a reject range: a
 * point exactly at the camera projects to NaN/NaN/-Infinity, and every NaN
 * comparison is false, so only the accept form excludes it (L15).
 *
 * `incumbentId` (the currently-committed dwell target, if any) gets a
 * DEAD_BAND_PX head start over other in-range nodes so a marginally-closer
 * neighbor doesn't steal the target every frame in a dense cluster.
 */
export function nearestNodeAt(
  nodes: Iterable<GalaxyNavNode>,
  camera: THREE.Camera,
  rect: ScreenRect,
  point: { x: number; y: number },
  thresholdPx: number,
  incumbentId: string | null = null,
): GalaxyNavNode | null {
  let best: GalaxyNavNode | null = null;
  let bestDistance = Infinity;
  let incumbent: GalaxyNavNode | null = null;
  let incumbentDistance = Infinity;

  for (const node of nodes) {
    if (node.ghost || node.x === undefined) continue;
    scratch.set(node.x, node.y ?? 0, node.z ?? 0).project(camera);
    if (!(scratch.z >= -1 && scratch.z <= 1)) continue;
    const x = rect.left + ((scratch.x + 1) * rect.width) / 2;
    const y = rect.top + ((1 - scratch.y) * rect.height) / 2;
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance > thresholdPx) continue;
    if (node.id === incumbentId) {
      incumbent = node;
      incumbentDistance = distance;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }

  if (best && incumbent && best.id !== incumbent.id && incumbentDistance - bestDistance < DEAD_BAND_PX) {
    return incumbent;
  }
  return best;
}

export type DwellState = {
  target: string | null;
  targetTitle: string | null;
  since: number;
  fired: boolean;
  pendingId: string | null;
  pendingTitle: string | null;
  pendingSince: number;
};

export const INITIAL_DWELL_STATE: DwellState = {
  target: null,
  targetTitle: null,
  since: 0,
  fired: false,
  pendingId: null,
  pendingTitle: null,
  pendingSince: 0,
};

// A candidate that differs from the committed target must hold for this long
// before it is promoted (design.md M14's "hold for a few consecutive
// frames"), on top of nearestNodeAt's own spatial dead-band above.
const PENDING_HOLD_MS = 120;

/**
 * The 300ms-dwell-to-open contract (design.md D2): `candidate` (this frame's
 * nearestNodeAt result) must be held for `holdMs` before firing once; the
 * same target cannot fire again until it is left (candidate becomes null or
 * a different id) and re-acquired. The caller simply does not call this
 * while the gesture loop is suspended (reader open, HUD asleep) — state is
 * an ordinary object the caller threads through, so a suspended loop that
 * calls it zero times leaves it untouched by construction (design.md L17).
 */
export function dwellStep(
  state: DwellState,
  candidate: GalaxyNavNode | null,
  now: number,
  holdMs: number,
): { state: DwellState; target: string | null; fire: boolean } {
  if (!candidate) {
    return { state: INITIAL_DWELL_STATE, target: null, fire: false };
  }

  if (candidate.id === state.target) {
    if (!state.fired && now - state.since >= holdMs) {
      const next: DwellState = { ...state, fired: true };
      return { state: next, target: state.target, fire: true };
    }
    return { state, target: state.target, fire: false };
  }

  if (candidate.id === state.pendingId) {
    if (now - state.pendingSince >= PENDING_HOLD_MS) {
      const next: DwellState = {
        target: candidate.id,
        targetTitle: candidate.title,
        since: now,
        fired: false,
        pendingId: null,
        pendingTitle: null,
        pendingSince: 0,
      };
      return { state: next, target: candidate.id, fire: false };
    }
    return { state, target: state.target, fire: false };
  }

  const next: DwellState = { ...state, pendingId: candidate.id, pendingTitle: candidate.title, pendingSince: now };
  return { state: next, target: state.target, fire: false };
}

export type GalaxyDrive = "dwell" | "orbit" | "zoom" | null;

export type PoseDriveState = { zooming: boolean; releaseStreak: number };

export const INITIAL_POSE_DRIVE_STATE: PoseDriveState = { zooming: false, releaseStreak: 0 };

// Explicit pinch predicate with hysteresis (design.md D4/H3): MediaPipe
// publishes no pinch class, only a continuous pinchDistance, so treating
// zoom as the leftover `else` branch would let an open palm, an unrecognized
// pose, or a hand merely resting in frame dolly the camera. Engage below the
// tighter threshold, release only above the looser one, so a hand hovering
// at the boundary doesn't chatter between zoom and no-drive.
const PINCH_ENGAGE = 0.1;
const PINCH_RELEASE = 0.16;

// `Pointing_Up`/`Closed_Fist` are already debounced at the source
// (useHandControl's stabilizeGesture requires 3 consecutive matching frames
// before a canned gesture takes effect) — but pinchDistance is a raw
// continuous signal with no such debounce, so a single noisy frame above
// PINCH_RELEASE (hand tremor mid-pinch) must not immediately drop the
// drive; it would wipe the seeded reference (radius/spherical) and make any
// real pinch motion look like it does nothing, since every reset re-seeds
// at whatever position the hand happens to be at. Require several
// consecutive above-release frames before actually disengaging.
const RELEASE_STREAK_TO_DISENGAGE = 5;

type DriveHand = Pick<HandState, "pointing" | "fist" | "openPalm" | "pinchDistance" | "hands">;

/**
 * Partitions the frame's hand pose into exactly one galaxy drive, with no
 * overlap (design.md D4): `Pointing_Up` -> dwell targeting only, `Closed_Fist`
 * -> orbit only, an explicitly-detected pinch -> zoom only, anything else
 * (open palm, two open palms, an unrecognized pose, a resting hand) -> null.
 */
export function driveFor(
  hand: DriveHand,
  state: PoseDriveState = INITIAL_POSE_DRIVE_STATE,
): { drive: GalaxyDrive; state: PoseDriveState } {
  if (hand.pointing) return { drive: "dwell", state: INITIAL_POSE_DRIVE_STATE };
  if (hand.fist) return { drive: "orbit", state: INITIAL_POSE_DRIVE_STATE };

  const pinchEligible = hand.hands.length === 1 && !hand.openPalm;
  if (!pinchEligible) return { drive: null, state: INITIAL_POSE_DRIVE_STATE };

  if (!state.zooming) {
    return hand.pinchDistance < PINCH_ENGAGE
      ? { drive: "zoom", state: { zooming: true, releaseStreak: 0 } }
      : { drive: null, state: INITIAL_POSE_DRIVE_STATE };
  }

  if (hand.pinchDistance < PINCH_RELEASE) return { drive: "zoom", state: { zooming: true, releaseStreak: 0 } };
  const releaseStreak = state.releaseStreak + 1;
  if (releaseStreak < RELEASE_STREAK_TO_DISENGAGE) return { drive: "zoom", state: { zooming: true, releaseStreak } };
  return { drive: null, state: INITIAL_POSE_DRIVE_STATE };
}

export type Spherical = { radius: number; phi: number; theta: number };

// Keeps the camera off the poles, where azimuth (theta) becomes degenerate.
const POLAR_EPSILON = 0.001;

/**
 * Relative orbit step (design.md D3/D4): the caller seeds `spherical` fresh
 * on every drive (re)engage (from the live camera, per M13) and applies only
 * the delta from that reference each frame, so engaging a fist never snaps
 * the camera.
 */
export function orbitStep(spherical: Spherical, delta: { x: number; y: number }, sensitivity: number): Spherical {
  const theta = spherical.theta - delta.x * sensitivity;
  const phi = Math.max(POLAR_EPSILON, Math.min(Math.PI - POLAR_EPSILON, spherical.phi - delta.y * sensitivity));
  return { radius: spherical.radius, phi, theta };
}

/**
 * Relative zoom step (design.md D4): `pinchDelta` is the change in pinch
 * distance since the reference seeded on engage (positive = fingers
 * spreading = zoom out), clamped so the camera can neither pass through the
 * orbit center nor fly away.
 */
export function radiusStep(radius: number, pinchDelta: number, sensitivity: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, radius + pinchDelta * sensitivity));
}
