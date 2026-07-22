import type { HandState, TrackedHand } from "../hooks/useHandControl";

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
