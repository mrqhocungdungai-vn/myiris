// Single authoritative gesture-context resolver (second-brain-gesture-nav
// design.md D9). The precedence D7 declares was, before this change,
// re-derived independently at every gesture-loop call site with disagreeing
// spellings. Adopted only in the code this change touches (the galaxy
// gesture loop, the `handAction` indicator) — the three shipped deck rAF
// loops keep their own existing guards untouched (deliberate, see D9's
// known-debt note); this is not a drop-in replacement for those.

export type GestureContext = "reader" | "secondBrain" | "drawing" | "history" | "deck";

export function resolveGestureContext({
  readerOpen,
  secondBrainActive,
  drawingActive,
  historyOpen,
}: {
  readerOpen: boolean;
  secondBrainActive: boolean;
  drawingActive: boolean;
  historyOpen: boolean;
}): GestureContext {
  if (readerOpen) return "reader";
  if (secondBrainActive) return "secondBrain";
  if (drawingActive) return "drawing";
  if (historyOpen) return "history";
  return "deck";
}

// The orb's fist-rotate / pinch-scale binding is live only on the deck: in
// the Glass HUD the orb is a small floating puck, not the stage, so the
// gesture surface belongs to the HUD's content instead (scope-orb-gesture-
// out-of-hud design.md D1). Shared by the orb rAF loop and the `handAction`
// indicator so the two conditions can't drift apart again.
export function orbGestureEngaged({
  handControl,
  handPresent,
  uiMode,
  readerOpen,
  drawingActive,
  secondBrainActive,
}: {
  handControl: boolean;
  handPresent: boolean;
  uiMode: "deck" | "hud";
  readerOpen: boolean;
  drawingActive: boolean;
  secondBrainActive: boolean;
}): boolean {
  return (
    uiMode === "deck" && handControl && handPresent && !readerOpen && !drawingActive && !secondBrainActive
  );
}
