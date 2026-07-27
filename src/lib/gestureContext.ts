// Single authoritative gesture-context resolver (second-brain-gesture-nav
// design.md D9). The precedence D7 declares was, before this change,
// re-derived independently at every gesture-loop call site with disagreeing
// spellings. Adopted only in the code this change touches (the galaxy
// gesture loop, the `handAction` indicator) — the three shipped deck rAF
// loops keep their own existing guards untouched (deliberate, see D9's
// known-debt note); this is not a drop-in replacement for those.

export type GestureContext = "reader" | "galaxy" | "drawing" | "history" | "deck";

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
  if (secondBrainActive) return "galaxy";
  if (drawingActive) return "drawing";
  if (historyOpen) return "history";
  return "deck";
}
