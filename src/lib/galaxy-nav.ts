import * as THREE from "three";
import type { HandPoint, HandState, TrackedHand } from "../hooks/useHandControl";

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

export type GalaxyLinkRef = { source: string; target: string };

/**
 * The focused ids plus every node exactly one link away from them, in either
 * direction — a declutter aid for a large galaxy (second-brain-focus
 * follow-on): as the vault grows the graph converges into a dense mass, so
 * whatever ISN'T reachable from the current focus in one hop can be dimmed
 * rather than changing what data is fetched, simulated, or positioned.
 *
 * Deliberately one hop, computed against the ORIGINAL focus set rather than
 * the growing result — checking membership against a set that is itself
 * being extended mid-loop would let a 2-hop (or further) node sneak in
 * whenever link order happened to visit its 1-hop bridge first.
 *
 * Returns an empty set when nothing is focused, which callers should read as
 * "no filtering" (dim nothing) rather than "everything is irrelevant".
 */
export function focusNeighborhood(focusIds: Iterable<string>, links: Iterable<GalaxyLinkRef>): Set<string> {
  const focus = new Set(focusIds);
  const relevant = new Set(focus);
  if (focus.size === 0) return relevant;
  for (const link of links) {
    if (focus.has(link.source)) relevant.add(link.target);
    if (focus.has(link.target)) relevant.add(link.source);
  }
  return relevant;
}

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

export type GalaxyDrive = "dwell" | "inspect" | "orbit" | "zoom" | null;

type DriveHand = Pick<HandState, "pointing" | "fist" | "hands">;

// MediaPipe's canned class for the two-finger pose. Reaching it through the
// raw `gesture` name rather than a `TrackedHand` boolean is deliberate: the
// booleans exist for the three poses the whole app shares, and adding a
// fourth would put a galaxy-only binding into the hand layer every surface
// reads. `useHandControl` already gates every published pose on 3 consecutive
// frames above a 0.55 score, so this arrives pre-debounced.
const INSPECT_GESTURE = "Victory";

/**
 * The tracked hand making the inspect pose, or null.
 *
 * Resolved per hand rather than from `HandState`'s primary-hand fields for a
 * concrete reason (design.md D4): `choosePrimary` prefers *pointing* hands, so
 * a `Victory` hand competing with any other hand in frame can lose primacy —
 * and the caller needs this hand's own `point` to hit-test with, not the
 * primary's. Same pattern the two-palm zoom already uses for its distance.
 */
export function inspectingHand(hand: Pick<HandState, "hands">): TrackedHand | null {
  return hand.hands.find((item) => item.gesture === INSPECT_GESTURE) ?? null;
}

/**
 * Partitions the frame's hand pose into exactly one galaxy drive, with no
 * overlap (design.md D5, revised D20): two open palms (the general
 * two-hand-gestures rule, "scale the layer that owns the gesture surface")
 * -> zoom, `Victory` -> inspect (reveal a node's link cluster while held;
 * commits to nothing), `Pointing_Up` -> dwell targeting only, and anything
 * `Closed_Fist` -> orbit, and anything else — an unrecognized pose, or a hand
 * merely resting in frame — -> null.
 *
 * `Closed_Fist` turns the camera around the LOCKED note (D25). D20 deleted
 * this drive, correctly for what it then was: it turned around whatever the
 * anchor happened to be, which is drift rather than navigation. Turning around
 * a note the user deliberately chose is a different gesture wearing the same
 * pose — and with an open palm now carrying the aim, a fist can turn the view
 * without also re-aiming it, which is what made the old one unusable.
 * A pinch still has no meaning of its own: a tight pinch reads as
 * `Closed_Fist` and orbits like any other fist.
 *
 * Zoom is tested first and so wins over a `Victory` hand: it is the two-hand
 * rule, which must outrank whatever either hand looks like individually.
 * Inspect is tested before dwell so a `Victory` hand reveals even while the
 * primary hand is pointing — the poses name different intents toward the same
 * node, and the one the user is deliberately making is the one that wins.
 *
 * Only `dwell` and `inspect` point at a node, and a hand that drives nothing
 * shows nothing (second-brain-gesture-nav: "A hand that drives nothing SHALL
 * also show nothing"). An earlier pass highlighted under any non-camera pose on
 * the grounds that a highlight is feedback rather than an action; in use that
 * lit one cluster after another as a hand drifted, reading as the view
 * twitching at the hand rather than answering a question.
 *
 * Stateless (design.md D5): no drive needs to remember anything across frames
 * — a hand cannot be two poses at once, so each frame's poses alone decide.
 */
export function driveFor(hand: DriveHand): GalaxyDrive {
  if (hand.hands.filter((h) => h.openPalm).length >= 2) return "zoom";
  // A fist holding while the other palm moves reels in on the locked note
  // (D26). Tested BEFORE the fist-alone orbit, since it is the more specific
  // pose pair — a fist with no palm beside it still turns the view.
  if (reelsToLock(hand)) return "zoom";
  if (inspectingHand(hand)) return "inspect";
  if (hand.pointing) return "dwell";
  if (hand.fist) return "orbit";
  return null;
}

// Where the bottom third of the frame starts (galaxy-note-reachable-by-hand
// design.md D6).
const LOWERED_HAND_FRACTION = 2 / 3;

/**
 * Whether a hand has dropped low enough that it must not drive the camera.
 *
 * Mid-air gesture control is physically tiring, so a user resting their arm is
 * routine rather than an edge case — and the pose a hand falls into on the way
 * down is not chosen deliberately. Without this, lowering a tired arm drags the
 * camera across the graph, losing the view the user worked to reach and
 * teaching them that putting their arm down is unsafe.
 *
 * `viewportHeight` is the WINDOW's height, not a container rect's:
 * `HandPoint` is already in window pixels, so any other frame of reference
 * would put the threshold in the wrong place the moment the galaxy is not
 * full-bleed.
 *
 * A predicate rather than a drive state (design.md D6) — the caller collapses
 * the drive to null with it, so every consequence already specified for a
 * released drive follows with no new code.
 */
export function isHandLowered(point: HandPoint | null, viewportHeight: number): boolean {
  if (!point || viewportHeight <= 0) return false;
  return point.y >= viewportHeight * LOWERED_HAND_FRACTION;
}

/**
 * Where the user is **aiming**, in window pixels — or `null` when they are not
 * aiming (galaxy-note-reachable-by-hand design.md D24, narrowed by D25).
 *
 * **An OPEN PALM aims. Nothing else does.** Each pose now has exactly one job:
 * an open palm chooses, a fist turns the camera, `Pointing_Up` opens, `Victory`
 * reveals, and two open palms zoom. D24 let a single hand aim in any pose,
 * which was fine while a fist meant nothing — but a fist drives the camera
 * again (D25), and a fist that also aimed would re-target on the very motion
 * that is turning the view. That is the D14 coupling in a new place, and the
 * rule that prevents it is the same one: a pose that drives the camera must not
 * also aim it.
 *
 * **Two open palms zoom rather than aim**, so this returns null then. Real
 * palms part asymmetrically, so a midpoint carried as the aim made every zoom a
 * slight re-aim; while both are up there is deliberately no aim point at all.
 *
 * Where more than one hand could aim, the **rightmost on screen** wins. The
 * preview is mirrored (`1 - x` in `useHandControl`), which is what makes it read
 * as a mirror, so the hand furthest right on screen is the user's right hand.
 * That is derived from the geometry rather than from MediaPipe's own
 * handedness label, whose meaning depends on whether the input is treated as
 * already mirrored — a convention that cannot be confirmed without the camera.
 *
 * Returns `null` with no open palm in frame. There is deliberately no fallback
 * to the centre of the view: "nothing is being aimed at" is a state the caller
 * must be able to see, since it is what makes an un-targeted zoom run down the
 * middle of the screen instead of at a note the user never chose.
 */
export function aimPoint(hand: Pick<HandState, "hands">): HandPoint | null {
  const palms = hand.hands.filter((item) => item.openPalm);
  if (palms.length !== 1) return null;
  // A fist means the camera is being driven — turning (fist alone) or reeling
  // in on the locked note (fist + palm, D26). Either way the open palm is part
  // of that drive, not an aim: the rule "a pose that drives the camera may not
  // also aim it" extends to "while ANY hand drives it, nothing aims".
  if (hand.hands.some((item) => item.fist)) return null;
  return palms[0].point;
}

/**
 * Whether this frame's pose pair reels in on the LOCKED note rather than
 * zooming the middle of the view (galaxy-note-reachable-by-hand design.md D26).
 *
 * A fist holding while the other palm moves. The metaphor is grabbing the note
 * and pulling yourself toward it, and the reason it is a distinct pose pair
 * rather than "two palms, but targeted when something is locked" is that the
 * user can then SEE which zoom they are getting. Mode carried in the hands is
 * checkable; mode carried in hidden state is not — and the hidden version had a
 * failure the visible one cannot have: with two open palms, one hand's pose
 * flickering off for a few frames left a single palm in frame, which reads as
 * aiming, which could re-lock onto a different note mid-zoom.
 */
export function reelsToLock(hand: Pick<HandState, "hands">): boolean {
  return hand.hands.some((item) => item.fist) && hand.hands.some((item) => item.openPalm);
}

/**
 * The span the zoom drives read, in window pixels — between the two open palms,
 * or between the fist and the palm when reeling in (design.md D26). One
 * measurement for both pose pairs, so they can never disagree about what
 * "distance" means.
 */
export function zoomSpan(hand: Pick<HandState, "hands">): number | null {
  const palms = hand.hands.filter((item) => item.openPalm);
  if (palms.length >= 2) return handDistance(palms[0].point, palms[1].point);
  const fist = hand.hands.find((item) => item.fist);
  if (fist && palms.length === 1) return handDistance(fist.point, palms[0].point);
  return null;
}

/**
 * The hand a single-hand drive should read, preferring the user's RIGHT hand
 * when both are in frame (design.md D25).
 *
 * Rightmost on screen, for the mirroring reason above. Used by the drives that
 * act on one hand's movement — so that resting the other hand in frame cannot
 * silently hand the camera to it.
 */
export function preferredHand(hands: TrackedHand[]): TrackedHand | null {
  if (hands.length === 0) return null;
  return hands.reduce((best, hand) => (hand.point.x > best.point.x ? hand : best), hands[0]);
}

export type Spherical = { radius: number; phi: number; theta: number };

// Keeps the camera off the poles, where azimuth (theta) becomes degenerate.
const POLAR_EPSILON = 0.001;

/**
 * Relative orbit step (design.md D3/D4, restored by D25): the caller seeds
 * `spherical` fresh on every drive (re)engage from the live camera and applies
 * only the delta from that reference each frame, so engaging a fist never snaps
 * the camera.
 *
 * The orbit turns around the **locked note** now, which is what makes it worth
 * having where D20's version was not: turning around a thing you chose is
 * navigation, turning around whatever the anchor happened to be was drift.
 */
export function orbitStep(spherical: Spherical, delta: { x: number; y: number }, sensitivity: number): Spherical {
  const theta = spherical.theta - delta.x * sensitivity;
  const phi = Math.max(POLAR_EPSILON, Math.min(Math.PI - POLAR_EPSILON, spherical.phi - delta.y * sensitivity));
  return { radius: spherical.radius, phi, theta };
}

/**
 * The distance between two tracked hands' points, in the same window-pixel
 * space `HandPoint` already uses — the one measurement the zoom drive and
 * its tests both read, so they can never disagree about what "distance"
 * means (design.md D3/D4).
 */
export function handDistance(a: HandPoint, b: HandPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ReaderCore's own 80px floor (design.md D3) — engaging with the hands
// nearly touching cannot produce a runaway ratio.
export const MIN_ZOOM_HAND_DISTANCE_PX = 80;

/**
 * Multiplicative zoom law (design.md D3), replacing the additive
 * `radiusStep`: `radius = clamp(min, max, refRadius * refDist / curDist)`.
 * Spreading the hands (`curDist` grows past `refDist`) shrinks the radius —
 * the camera gets closer, the same direction spreading enlarges a reader.
 * Closing them grows it. `k = 1.0`, so this is a single multiply-divide
 * with no exponent and no extra tuning constant.
 *
 * Both `refDist` and `curDist` are floored at `MIN_ZOOM_HAND_DISTANCE_PX` before
 * dividing — the output clamp would eventually catch a division by ~0
 * regardless, but flooring the input keeps the function total rather than
 * relying on that clamp to absorb it.
 */
export function zoomRadius({
  refRadius,
  refDist,
  curDist,
  min,
  max,
}: {
  refRadius: number;
  refDist: number;
  curDist: number;
  min: number;
  max: number;
}): number {
  const flooredRef = Math.max(MIN_ZOOM_HAND_DISTANCE_PX, refDist);
  const flooredCur = Math.max(MIN_ZOOM_HAND_DISTANCE_PX, curDist);
  return Math.max(min, Math.min(max, (refRadius * flooredRef) / flooredCur));
}

// Roughly how long the camera's DISPLAYED radius takes to catch up to
// whatever `zoomRadius` computes as this frame's target — expressed as time
// to cover 95% of the gap, the same convention `ANCHOR_EASE_MS` uses in
// galaxy-anchor.ts (design.md D19). Not measured against tracked hand data —
// chosen shorter than `ANCHOR_EASE_MS` (180) because radius is the signal the
// user is actively, continuously steering in real time, unlike the look-at
// point, which is secondary feedback; revisit from the next manual pass.
export const ZOOM_EASE_MS = 120;
const ZOOM_EASE_TAU_MS = ZOOM_EASE_MS / Math.log(20);
// Below this many world units apart, the ease snaps — matching
// `easeAnchor`'s own reasoning: an exponential approach never actually
// arrives, and a displayed radius forever a hair off the target would keep
// writing the camera every frame with nothing visibly moving.
const ZOOM_EASE_SNAP_EPSILON = 0.01;

/**
 * The eased DISPLAYED radius (design.md D19) — `easeAnchor`'s treatment of
 * the look-at point, applied to the other half of the camera write.
 *
 * `zoomRadius` is a memoryless ratio law: every frame it maps the raw,
 * instantaneous two-palm distance straight to an absolute radius, so any
 * tracking noise in that distance reaches the output with full gain, frame
 * after frame — structurally unlike `orbitStep`, which only nudges an
 * accumulated angle by a small bounded increment regardless of how noisy the
 * instantaneous delta is. Feeding `zoomRadius`'s result through this instead
 * of applying it directly gives the radius the same kind of memory orbit's
 * law already has for free: one noisy frame moves the camera only a little
 * rather than replacing its distance outright.
 */
export function easeRadius(displayed: number, target: number, dtMs: number): number {
  if (dtMs <= 0) return displayed;
  const delta = target - displayed;
  if (Math.abs(delta) <= ZOOM_EASE_SNAP_EPSILON) return target;
  const alpha = 1 - Math.exp(-dtMs / ZOOM_EASE_TAU_MS);
  return displayed + delta * alpha;
}
