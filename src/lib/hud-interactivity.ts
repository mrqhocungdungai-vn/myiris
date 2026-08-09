// Who owns the mouse while the Glass HUD is up — the decision, on its own,
// with no DOM and no IPC in it (the-canvas-stops-fighting-back, task 1.5).
//
// The HUD window covers the whole display and is click-through by default
// (`setIgnoreMouseEvents`), so "is the window interactive right now" is a
// single window-wide boolean that has to be re-decided as the pointer moves.
// Deciding it wrong in either direction is user-visible: too eager and every
// click on the desktop underneath is swallowed by a transparent window sitting
// above the menu bar; too timid and the HUD's own controls stop responding.
//
// There are exactly two regimes, and which one applies is not a matter of
// degree:
//
//   * No exclusive layer open. The HUD is a few small islands on glass. The
//     pointer's position decides, island by island, and everything else on the
//     screen belongs to whatever application is underneath.
//
//   * An exclusive fullscreen layer open (the drawing surface, or the
//     second-brain galaxy). The layer IS the screen. Asking "is the pointer
//     over it" has one answer everywhere, so the boolean is simply held on for
//     as long as the layer is open.
//
// This module used to also carry a per-gesture latch, for when the drawing
// panel was a bounded 84vw x 84vh rectangle and a drag could cross its edge.
// The surface is fullscreen now, so there is no edge to cross and the latch
// could never change an outcome. It was removed rather than left as a
// no-op — an unused rule reads as a rule that applies.

/** Selector for everything that opts back into the pointer in HUD mode.
 *  Mirrors the `pointer-events: auto` list in `src/styles/hud.css` — the two
 *  must agree, because `elementFromPoint` only returns what CSS let through.
 *  `.excalidraw-modal-container` and the eye-dropper backdrop are excalidraw
 *  UI portalled OUT of the surface's subtree into `document.body`; without
 *  them the export dialog, the command palette and the colour picker render
 *  and cannot be clicked. */
export const HUD_INTERACTIVE_SELECTOR =
  ".hud-hit, .reader-backdrop, .history-backdrop, .match-backdrop, .setup-backdrop, .boot, .excalidraw-modal-container, .excalidraw-eye-dropper-backdrop";

/**
 * Whether the HUD window should accept the mouse.
 *
 * `overInteractiveTarget` is the caller's hit-test result (`elementFromPoint`
 * matched against HUD_INTERACTIVE_SELECTOR) — kept as an input rather than
 * done here so this stays a pure decision.
 */
export function resolveHudInteractive(input: {
  exclusiveLayerActive: boolean;
  overInteractiveTarget: boolean;
}): boolean {
  // A fullscreen layer owns the pointer for as long as it is open. This is
  // also the reason such a layer must always carry a way out that a mouse can
  // reach — while it is up, no click reaches anything else on the machine.
  if (input.exclusiveLayerActive) return true;
  return input.overInteractiveTarget;
}

/** DOM adapter for the hit-test half — the one impure line, kept out of the
 *  decision above so the decision is testable without a document. */
export function isHudInteractiveTarget(el: Element | null): boolean {
  return el?.closest?.(HUD_INTERACTIVE_SELECTOR) != null;
}
