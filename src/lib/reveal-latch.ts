// "Force this panel open while X is happening, then put it back."
//
// The Comms panel is revealed while listen-only mode is engaged and restored
// when it disengages (design.md D7). The rule is small and easy to get subtly
// wrong in three ways, so it is stated here rather than inline:
//
//   * It applies **on the transition only**. Re-applying it every render would
//     re-force the panel open after the user closed it by hand, which the spec
//     explicitly does not want — "a manual toggle in between is respected".
//   * The value it restores is the one from **just before** the reveal, not the
//     default. Someone who had Comms open before engaging must not find it shut
//     afterwards.
//   * A second engage while already engaged must **not** overwrite the recorded
//     value with the forced-open `true`, or the panel can never be restored.
//
// Pure and caller-threaded: the caller holds the state and passes it back in,
// so a latch that is never stepped is untouched by construction.

export type RevealLatch = {
  /** Whether the reveal is currently applied. */
  revealed: boolean;
  /** What the panel was showing just before the reveal began. */
  prior: boolean;
};

export const INITIAL_REVEAL_LATCH: RevealLatch = { revealed: false, prior: false };

/**
 * Advances the latch for one change of `active`.
 *
 * Returns `open` only when the panel should actually be written — `null` means
 * leave it alone, which is what makes repeated calls with an unchanged `active`
 * free.
 */
export function revealStep(
  latch: RevealLatch,
  active: boolean,
  currentlyOpen: boolean,
): { latch: RevealLatch; open: boolean | null } {
  if (active && !latch.revealed) {
    return { latch: { revealed: true, prior: currentlyOpen }, open: true };
  }
  if (!active && latch.revealed) {
    return { latch: { revealed: false, prior: false }, open: latch.prior };
  }
  // Already in the requested regime — nothing to write, nothing to record.
  return { latch, open: null };
}
