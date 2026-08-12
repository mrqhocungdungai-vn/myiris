import type { HandState, TrackedHand } from "../hooks/useHandControl";

// What the floating gesture cursors are, decided as data rather than as JSX.
//
// The reticles used to MOUNT off React state and MOVE off a per-frame ref, so
// their existence and their position answered to two different clocks. Every
// defect they have ever had came from that split: a cursor left standing after
// the hand was gone, and cursors accumulating across the screen as a hand was
// waved — one per identity the tracker briefly reported, each one a React
// element whose removal depended on a render that had to happen for it.
//
// So there is now a FIXED pair of nodes (the tracker runs `numHands: 2`), and
// every frame answers the only two questions that remain: is slot i showing a
// hand, and which one. Nothing mounts, nothing unmounts, nothing can be left
// behind. This module is that answer, pure and testable — the component is
// left with the DOM writes alone.

/** The tracker's own ceiling (`numHands: 2`), which is what fixes the slot count. */
export const RETICLE_SLOTS = 2;

export type ReticleSlot = {
  /** Null when this slot has no hand this frame — the node is hidden, never removed. */
  hand: TrackedHand | null;
};

/**
 * The hands to draw this frame, one entry per slot.
 *
 * The synthetic entry for a primary point with no `hands` array is kept from
 * the original component: a published state can carry a point while the
 * per-hand list is empty, and a cursor that vanished in that case would read
 * as tracking loss.
 */
export function reticleSlots(state: HandState): ReticleSlot[] {
  const hands: (TrackedHand | null)[] = state.present
    ? state.hands.length
      ? state.hands.slice(0, RETICLE_SLOTS)
      : state.point
        ? [{ ...(state as unknown as TrackedHand), id: "hand-0", point: state.point }]
        : []
    : [];
  return Array.from({ length: RETICLE_SLOTS }, (_, index) => ({ hand: hands[index] ?? null }));
}

/**
 * The class list for a slot. Written every frame from the live data, so the
 * cursor's shape follows the pose at tracking rate rather than at the rate the
 * semantic state happens to be published.
 */
export function reticleClassName(index: number, hand: TrackedHand | null, dwelling: boolean): string {
  const parts = ["hand-reticle"];
  if (index > 0) parts.push("secondary");
  if (!hand) return parts.join(" ");
  if (index === 0 && dwelling) parts.push("dwell");
  if (hand.pointing) parts.push("pointing");
  if (hand.openPalm) parts.push("open");
  if (hand.fist) parts.push("fist");
  return parts.join(" ");
}
