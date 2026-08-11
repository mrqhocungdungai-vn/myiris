import { useEffect, useState } from "react";
import { usePersistedFlag } from "./usePersistedPreference";
import { readFlag, AMBIENT_CAPTURE_STORAGE_KEY } from "../lib/preferences";

// Ambient session capture, as the renderer sees it.
//
// Three values with **three different authorities**, which is the whole reason
// this is a domain rather than three flags:
//
//   * `enabled` — the user's persisted *preference*. This renderer-held value
//     is only ever what main was last told; it is not a claim about what is
//     happening.
//   * `live` — whether retention is **actually** happening. Main is the sole
//     authority (design D1): the preference being on is necessary and not
//     sufficient, since Iris must also be awake and listening, and listen-only
//     mode stands the capture aside entirely.
//   * `forcedOff` — `IRIS_AMBIENT_CAPTURE=off` (design D3). The toggle is not
//     offered at all.
//
// Conflating the first two is the mistake this shape prevents: a toggle that
// only flipped local state would read "on" while nothing was being retained.

export type AmbientCapture = {
  enabled: boolean;
  live: boolean;
  forcedOff: boolean;
  toggle: () => void;
  /** The indicator's stop affordance — the same action as switching the settings toggle off. */
  stop: () => void;
};

export function useAmbientCapture({ hasBridge }: { hasBridge: boolean }): AmbientCapture {
  const [enabled, , setStored] = usePersistedFlag(AMBIENT_CAPTURE_STORAGE_KEY, false);
  const [live, setLive] = useState(false);
  const [forcedOff, setForcedOff] = useState(false);

  // Pushes the persisted preference to main at boot — main defaults to off on
  // every launch (design D1) and stays off until this arrives — then queries
  // the current live/forcedOff state and subscribes to every later transition.
  useEffect(() => {
    if (!hasBridge) return;
    // Reads storage rather than the state above so this cannot depend on
    // render order; both resolve to the same value at mount.
    window.iris.setAmbientCaptureEnabled(readFlag(AMBIENT_CAPTURE_STORAGE_KEY, false));
    window.iris.getAmbientCaptureState().then((state) => {
      setLive(state.live);
      setForcedOff(state.forcedOff);
    });
    return window.iris.onAmbientCaptureState(({ live: next }) => setLive(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  // Persists the preference AND tells main, on every change — main is the one
  // thing that decides whether retention is actually live, so a change that
  // only flipped local state would show "on" while nothing was retained.
  function set(next: boolean) {
    setStored(next);
    if (hasBridge) window.iris.setAmbientCaptureEnabled(next);
  }

  return {
    enabled,
    live,
    forcedOff,
    toggle: () => set(!enabled),
    stop: () => set(false),
  };
}
