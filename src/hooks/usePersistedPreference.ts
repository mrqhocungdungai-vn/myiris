import { useState } from "react";
import { readFlag, readChoice, writeFlag, writePreference } from "../lib/preferences";

// State that survives a restart, with its persistence attached.
//
// The pairing is the point. Each of these preferences used to be a `useState`
// initialized from a loader in one part of `App.tsx` and a toggle that wrote to
// storage in another, with nothing tying the two together — so a preference
// could be read from one key and written to a different one, or read and never
// written, and it would look correct at both sites. Reading and writing now
// come from one call that names the key once.
//
// Storage itself is best-effort (see `lib/preferences`): a failed write leaves
// the setting working for this session, and unreadable storage resolves to the
// stated default rather than throwing.

/**
 * A persisted boolean, with the three ways it legitimately changes.
 *
 * `[value, toggle, set, setTransient]`:
 *
 *   * `toggle` — the user flipped the control. Persists.
 *   * `set` — the value changed for a stated reason and should survive a
 *     restart. Persists. Used by ambient capture, which must also tell the
 *     main process.
 *   * `setTransient` — **deliberately does not persist.** Some of these flags
 *     are a stored *preference* and a live *enabled* state at once, and the two
 *     are allowed to diverge: stopping the voice session turns hand control off
 *     for the session, but the user still asked for hand control and must get
 *     it back on the next launch. Writing that stop through to storage would
 *     silently un-choose something the user chose.
 */
export function usePersistedFlag(
  key: string,
  whenAbsent: boolean,
): [boolean, () => void, (next: boolean) => void, (next: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key, whenAbsent));

  const set = (next: boolean) => {
    setValue(next);
    writeFlag(key, next);
  };

  // Toggling reads through the updater rather than closing over `value`, so
  // two toggles in one tick cannot both flip from the same stale value.
  const toggle = () =>
    setValue((current) => {
      writeFlag(key, !current);
      return !current;
    });

  return [value, toggle, set, setValue];
}

/** A persisted free-form choice — a device id — and a setter that stores it. */
export function usePersistedChoice(key: string, fallback: string): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readChoice(key, fallback));

  const set = (next: string) => {
    setValue(next);
    writePreference(key, next);
  };

  return [value, set];
}
