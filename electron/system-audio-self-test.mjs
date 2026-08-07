// The arming behind the Permissions step's system-audio self-test
// (setup-panel-reports-real-permissions D5; renderer-content-security: "The
// self-test SHALL arm exactly one grant").
//
// Electron-free on purpose. This is the security-relevant half of the
// self-test — that the arming ends on its own bound, that a repeat arm does
// not extend it, that a vanished renderer ends it, that it authorises exactly
// one grant — and all of it is a plain assertion here rather than behavior
// only observable by driving a real Electron session. renderer-security.mjs
// composes it and consults `consume()` in the display-media handler.

/**
 * How long an arming stays usable, measured from the FIRST `arm()`.
 *
 * Derived, not picked. The verdict comes from `watchCaptureLiveness`, which
 * needs `LIVENESS_PROBE_INTERVAL_MS` × `LIVENESS_PROBE_TICKS` = 750ms × 6 =
 * 4.5s of probing before it will say "silent". The deadline has to cover
 * acquisition plus that window with margin, and must not be so long that a
 * stale authorisation lingers. If those constants change in
 * `src/lib/system-audio.ts`, this changes with them.
 */
export const SELF_TEST_ARM_MS = 6000;

/**
 * @param {{
 *   now?: () => number,
 *   setTimeout?: typeof globalThis.setTimeout,
 *   clearTimeout?: typeof globalThis.clearTimeout,
 *   armMs?: number,
 * }} [deps]
 */
export function createSystemAudioSelfTest({
  now = () => Date.now(),
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
  armMs = SELF_TEST_ARM_MS,
} = {}) {
  /** @type {{ frameId: unknown, expiresAt: number, timer: any } | null} */
  let arming = null;

  function disarm() {
    if (!arming) return;
    clearTimer(arming.timer);
    arming = null;
  }

  function expireIfDue() {
    // The timer is the mechanism; the deadline is the rule. A fake or starved
    // timer must not turn into an arming that outlives its window, so every
    // read checks the clock too.
    if (arming && now() >= arming.expiresAt) disarm();
  }

  return {
    /**
     * Authorises exactly one system-audio grant, to `frameId` only.
     *
     * Re-arming while an arming is already live is a no-op: the deadline stays
     * the one the first `arm()` set. A renderer that could push the deadline
     * out could hold the capture surface open indefinitely, which is the thing
     * an absolute bound exists to prevent.
     *
     * @param {{ frameId?: unknown }} [options]
     */
    arm({ frameId = null } = {}) {
      expireIfDue();
      if (arming) return { armed: true, expiresAt: arming.expiresAt };
      const expiresAt = now() + armMs;
      arming = {
        frameId,
        expiresAt,
        timer: setTimer(() => {
          arming = null;
        }, armMs),
      };
      // Some timer implementations keep the process alive; this one must not.
      arming.timer?.unref?.();
      return { armed: true, expiresAt };
    },

    /**
     * Spends the arming on one grant.
     *
     * Returns true at most once per `arm()`. An interval-shaped predicate would
     * grant every request made inside it, so a faulty or hijacked renderer
     * could hold several concurrent loopback captures while each individual
     * grant still looked correct — the shape right and the quantity wrong.
     *
     * @param {{ frameId?: unknown }} [options] the frame ASKING, checked
     *   against the frame that armed. Omitted means "don't check" only for
     *   callers that have no frame identity to offer; renderer-security.mjs
     *   always passes one.
     */
    consume({ frameId } = {}) {
      expireIfDue();
      if (!arming) return false;
      if (frameId !== undefined && arming.frameId !== null && arming.frameId !== frameId) {
        // Not our frame. The arming is NOT spent — a foreign request must not
        // be able to burn the arming the user just made.
        return false;
      }
      disarm();
      return true;
    },

    /** Whether an arming is currently live. Never a substitute for consuming it. */
    isArmed() {
      expireIfDue();
      return arming !== null;
    },

    /** The frame that armed the live arming, or null. */
    armedFrameId() {
      expireIfDue();
      return arming ? arming.frameId : null;
    },

    /**
     * Drops the arming: the user cancelled, the test finished, or the window
     * that armed it reloaded, closed, or lost its render process.
     */
    disarm,
  };
}
