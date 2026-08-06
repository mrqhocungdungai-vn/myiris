// Which WebGL surfaces advance frames, and when. The rule is asymmetric on
// purpose (orb-expressions): the deck's surfaces pause when the deck window
// loses OS focus, but the HUD orb does not — the HUD is the always-on-top
// overlay a user keeps in view while working in another app, so pausing it on
// blur would pause it exactly when it is being looked at.
//
// The three call sites used to carry that asymmetry as three inline
// expressions with nothing checking they agreed. One resolver, one test table.
//
// Advancing frames is not the same as being drawn: a surface that is not
// advancing still renders on mount and on change (frameloop="demand").

export type OrbSurface = "deck-orb" | "hud-orb" | "backdrop";

export type SurfaceActivity = {
  /** Iris is awake — the session is running. */
  awake: boolean;
  /** The app window holds OS focus. */
  windowFocused: boolean;
};

export function surfaceAdvancesFrames(surface: OrbSurface, { awake, windowFocused }: SurfaceActivity): boolean {
  // Asleep stops every surface, with no exceptions — that is the baseline
  // main-thread-budget rule.
  if (!awake) return false;
  // The HUD orb is the ambient liveness indicator; focus does not gate it.
  if (surface === "hud-orb") return true;
  return windowFocused;
}
