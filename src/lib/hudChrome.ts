// What counts as HUD chrome, declared once (hud-panels-stay-hand-reachable-
// under-galaxy design.md D1/D2).
//
// The Glass HUD's islands — the review/question stack, the tasks column, the
// comms/camera column, and the orb cluster — are painted ABOVE a coexisting
// layer (the second-brain galaxy, the drawing panel), where they stay visible
// and mouse-clickable. `hud.css` gives them their stacking off this same class,
// so an island is chrome, therefore it paints above the layer, therefore the
// hand can reach it: one declaration, both consequences. Naming the islands
// again here — as the gesture loop used to, with a lone `.hud-controls`
// exemption — is what let the stacking and the gesture rule drift apart.
//
// This module answers "what is under the hand". `gestureContext.ts` answers
// "which context owns the hand". They are consulted together and change for
// different reasons, so they stay apart.
export const HUD_CHROME_CLASS = "hud-chrome";

const HUD_CHROME_SELECTOR = `.${HUD_CHROME_CLASS}`;

/** Whether `el` is a piece of HUD chrome, or lives inside one. */
export function isHudChrome(el: Element | null): boolean {
  return el?.closest(HUD_CHROME_SELECTOR) != null;
}

/**
 * Whether the topmost element at a viewport point is HUD chrome. For callers
 * that hold a hand point rather than an already-resolved element — the galaxy's
 * gesture loop hit-tests nodes by projected screen coordinates and never touches
 * the DOM otherwise.
 */
export function hudChromeAtPoint(x: number, y: number): boolean {
  return isHudChrome(document.elementFromPoint(x, y));
}
