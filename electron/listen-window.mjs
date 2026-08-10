// The bound on how long listen-only mode stays engaged (listen-window-is-
// bounded D2/D3): one absolute deadline, opened when the mode engages and
// closed when it ends, whichever of the two ends it.
//
// Electron-free, no `process.env`, no I/O — the resolved length arrives as a
// number, so `user-config.mjs` stays the only thing that reads configuration.
// Modelled on `system-audio-self-test.mjs`, which holds its own absolute
// deadline the same way and for the same stated reason: the bound is then a
// plain assertion over a fake clock rather than behaviour you can only observe
// by booting Electron and waiting.
//
// Nothing here knows what expiry MEANS. It calls `onExpire` once and lets the
// session decide, which is what keeps `setListenOnlyEngaged` the single writer
// for the mode (D4) — a window that disengaged the mode itself would be a
// second authority for one piece of state.

/**
 * @param {{
 *   lengthMs: number,
 *   onExpire: () => void,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (timer: any) => void,
 * }} deps
 */
export function createListenWindow({
  lengthMs,
  onExpire,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
}) {
  /** @type {{ deadlineAt: number, timer: any } | null} */
  let open_ = null;

  function clear() {
    if (!open_) return;
    clearTimer(open_.timer);
    open_ = null;
  }

  function expire() {
    if (!open_) return;
    // State first, callback second. `onExpire` routes through
    // setListenOnlyEngaged(false), which closes the window on its way out — so
    // by the time it runs there must be nothing left to close, or the same
    // expiry would be handled twice.
    clear();
    onExpire();
  }

  return {
    /**
     * Starts a window of the configured length, measured from NOW.
     *
     * Only the mode engaging calls this. Nothing Iris hears does, which is the
     * whole point of the bound: a window re-armed by speech would be held open
     * for as long as anyone keeps talking, and continuous speech is precisely
     * what this mode is pointed at. Opening while one is already open replaces
     * it rather than extending it — the mode's writer only ever calls this on a
     * real transition, so this is a fallback that stays a bound either way.
     */
    open() {
      clear();
      const deadlineAt = now() + lengthMs;
      open_ = { deadlineAt, timer: setTimer(expire, lengthMs) };
      // A five-minute window must never become a five-minute quit delay.
      open_.timer?.unref?.();
      return deadlineAt;
    },

    /**
     * Ends the window without expiring it: the user toggled the mode off, the
     * session stopped, or the expiry itself is already in flight. `onExpire` is
     * not called, so no second disengage fires at the original deadline.
     */
    close: clear,

    /** Whether a window is running. Reads the deadline, not just the timer. */
    isOpen() {
      return open_ !== null && now() < open_.deadlineAt;
    },

    /**
     * How long is left, floored at zero, and zero when no window is open.
     *
     * Deliberately side-effect-free, unlike the self-test's reads: a stale
     * deadline noticed here is NOT expired on the spot, because expiry makes
     * Iris audible again in a room where the user silenced her. That decision
     * belongs to the timer and to nothing else — a reader asking how much time
     * is left must not be able to end the engagement.
     */
    remainingMs() {
      if (!open_) return 0;
      return Math.max(0, open_.deadlineAt - now());
    },

    /** The absolute deadline, or null. Pushed to the renderer so it can count down (D6). */
    deadlineAt() {
      return open_ ? open_.deadlineAt : null;
    },
  };
}

/** A span as "1h 04m 12s" / "18m 42s" / "47s" — read by a person, not parsed. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}
