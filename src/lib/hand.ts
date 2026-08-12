import type { HandPoint, HandState, TrackedHand } from "../hooks/useHandControl";

// Per-hand EMA smoothing (two-hand-gestures: "Every tracked hand's point
// SHALL be smoothed"), extracted so it can be unit-tested without a camera.
// `previous` is null exactly on a hand's first frame (freshly seeded, or
// just cleared on the no-hand transition) — that frame passes `target`
// through untouched rather than easing in from a stale/absent position.
export function smoothPoint(previous: HandPoint | null, target: HandPoint, alpha: number): HandPoint {
  if (!previous) return target;
  return {
    x: previous.x + (target.x - previous.x) * alpha,
    y: previous.y + (target.y - previous.y) * alpha,
  };
}

function sameHand(a: TrackedHand, b: TrackedHand): boolean {
  return (
    a.id === b.id &&
    a.gesture === b.gesture &&
    a.pointing === b.pointing &&
    a.openPalm === b.openPalm &&
    a.thumbUp === b.thumbUp &&
    a.fist === b.fist
  );
}

// Compares only the fields the UI reacts to (presence, gesture class,
// per-hand semantic flags, hand count/ids) — excludes the continuously
// changing fields (point, landmarks, pinchDistance, gestureScore) so
// per-frame hand-tracking updates don't trigger a React re-render.
export function semanticEquals(a: HandState, b: HandState): boolean {
  return (
    a.active === b.active &&
    a.present === b.present &&
    a.gesture === b.gesture &&
    a.pointing === b.pointing &&
    a.openPalm === b.openPalm &&
    a.thumbUp === b.thumbUp &&
    a.fist === b.fist &&
    a.hands.length === b.hands.length &&
    a.hands.every((hand, index) => sameHand(hand, b.hands[index]))
  );
}

/**
 * The key every per-hand memory is stored under — the point EMA, the wrist
 * EMA, and the 3-frame gesture stabilizer.
 *
 * It MUST NOT depend on how many hands are in frame. The previous scheme named
 * a lone hand `"single"` and a pair `"left"`/`"right"`, so raising a second
 * hand renamed the first, and its memories were then read under a name a
 * PREVIOUS two-hand session had already written to. The hand's smoothed point
 * jumped to wherever it had been then, and the stabilizer replayed that
 * session's pose until three frames corrected it.
 *
 * `label` is the model's own handedness, which follows the physical hand.
 * The positional fallback is for frames that carry no label, and is still
 * count-independent: with one hand in frame it is leftmost, and so `x0`, which
 * is what it will also be when a hand joins on its right.
 */
export function handIdentity(label: string | null | undefined, isLeftmost: boolean): string {
  return label ? `hand:${label}` : isLeftmost ? "x0" : "x1";
}

/**
 * How long a published `present: true` may stand on the strength of a frame
 * that is no longer arriving, before the hand is declared gone.
 *
 * Presence used to be re-stated on EVERY frame, empty ones included, so it
 * could not outlive the loop that published it. Publishing only on the
 * transition into "no hand" made it a LATCH: the reticles mount off that one
 * fact, while their position is written per frame from a ref, so any path
 * where the loop stops producing frames — a stalled or ended camera track
 * (`readyState` drops and neither branch runs), a throw out of
 * `recognizeForVideo`, a tab that went to sleep mid-hold — leaves the circles
 * frozen on screen for good, with the camera visibly showing no hand.
 *
 * 400ms: MediaPipe publishes at camera rate (30fps here, so ~33ms a frame) and
 * a dropped frame or two is ordinary, while a quarter-second of nothing is not
 * anything a running tracker does. Short enough that a user who pulls their
 * hand away never sees a stranded cursor, long enough that a GC pause or a
 * heavy render frame cannot blink the reticles off a hand that is still there.
 */
export const HAND_PRESENCE_TIMEOUT_MS = 400;

/**
 * Whether a published presence has outlived the frames that justified it.
 *
 * `lastHandAt` is when a frame last actually carried a hand — NOT when the
 * loop last ran, which is the whole point: a loop spinning over a stalled
 * video keeps running while saying nothing, and it is exactly that state the
 * latch could not escape.
 */
export function handPresenceExpired(
  hadHand: boolean,
  lastHandAt: number,
  now: number,
  timeoutMs: number = HAND_PRESENCE_TIMEOUT_MS,
): boolean {
  if (!hadHand) return false;
  return now - lastHandAt > timeoutMs;
}
