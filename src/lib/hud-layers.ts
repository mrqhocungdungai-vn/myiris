// Which fullscreen HUD layer is up, and the two rules that govern it.
//
// There are two exclusive layers — the drawing surface and the second-brain
// galaxy — and **at most one is ever open** (design.md D5 of
// second-brain-galaxy-view). Like the reader slot, that rule lived as two
// toggles each remembering to clear the other, with nothing stating it.
//
// Holding one slot instead of two booleans makes it true by construction:
// opening one *is* closing the other, because there is only one place a layer
// can be.
//
// The second rule is that both layers are **HUD-only** (glass-hud-mode design
// D7). Every exit path — button, hotkey, tray — must clear the layer, or it is
// left mounted (and interactivity-latching, or for the galaxy snapping back on)
// the next time the HUD is entered.

export type HudLayer = "drawing" | "galaxy" | null;

/** Toggling a layer opens it and closes whatever else was open. */
export function toggleLayer(current: HudLayer, layer: Exclude<HudLayer, null>): HudLayer {
  return current === layer ? null : layer;
}

/** Leaving the HUD closes any layer: both are HUD-only. */
export function layerAfterLeavingHud(): HudLayer {
  return null;
}

export function isDrawing(layer: HudLayer): boolean {
  return layer === "drawing";
}

export function isGalaxy(layer: HudLayer): boolean {
  return layer === "galaxy";
}

/** True while any exclusive layer owns the screen — several gesture bindings read this. */
export function layerActive(layer: HudLayer): boolean {
  return layer !== null;
}
