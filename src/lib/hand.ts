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
    a.fist === b.fist &&
    a.hands.length === b.hands.length &&
    a.hands.every((hand, index) => sameHand(hand, b.hands[index]))
  );
}
