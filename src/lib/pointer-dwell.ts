// The HUD's dwell-to-click state machine — hold a pointing hand on a control
// and it activates. The decision on its own, with no rAF, no DOM lookup and no
// React in it, so the timing and the fire-once rule can be tested directly.
//
// **Related but deliberately not shared with `galaxy-nav.ts`'s `dwellStep`.**
// The galaxy dwells on a graph node by id and adds a 120 ms pending-hold
// dead-band so a target does not flicker between neighbours; this dwells on a
// DOM element by identity and promotes a new target on the first frame. The two
// also differ on the boundary — the galaxy fires at `>= holdMs`, this at
// `> holdMs`. Those divergences are recorded here rather than silently
// unified: making them agree changes the feel of both surfaces and is a
// behavior change, not a refactor. See docs/research/README.md, Tier 0.3.

/** How long a target must be held before it activates. */
export const DWELL_HOLD_MS = 300;

/** What the loop is currently holding, if anything. `T` is the target's identity. */
export type DwellHold<T> = { target: T; startedAt: number; fired: boolean } | null;

export type DwellOutcome<T> = {
  /** The hold to carry into the next frame. */
  hold: DwellHold<T>;
  /** True while a target is being held — drives the reticle's "dwelling" ring. */
  active: boolean;
  /** True once this hold has activated, so it does not activate twice. */
  fired: boolean;
  /** True on the single frame the target should be activated. */
  fire: boolean;
};

/** Nothing is being held: every suspended path resolves here. */
export const DWELL_RELEASED: DwellOutcome<never> = {
  hold: null,
  active: false,
  fired: false,
  fire: false,
};

/**
 * Advances the dwell by one frame.
 *
 * `target` is whatever the frame resolved to — `null` when the loop is
 * suspended (no hand, hand control off, a reader open) or when the hand is not
 * over anything actionable. A `null` target **releases** the hold, so a hand
 * that leaves a control and comes back must hold it again from zero.
 *
 * `fire` is true on exactly one frame per acquisition: the hold records that it
 * fired and cannot fire again until it is released and re-acquired.
 */
export function dwellFrame<T>(hold: DwellHold<T>, target: T | null, now: number): DwellOutcome<T> {
  if (target === null) return DWELL_RELEASED as DwellOutcome<T>;

  // A different target — including the first one — starts the clock over.
  if (hold?.target !== target) {
    return { hold: { target, startedAt: now, fired: false }, active: true, fired: false, fire: false };
  }

  if (!hold.fired && now - hold.startedAt > DWELL_HOLD_MS) {
    return { hold: { ...hold, fired: true }, active: true, fired: true, fire: true };
  }

  return { hold, active: true, fired: hold.fired, fire: false };
}
