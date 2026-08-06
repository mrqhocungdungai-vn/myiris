// Decides when the boot intro is on screen, and when its completion is worth
// reporting to main. The intro is triggered by the *rising edge of the session
// running* — an event with exactly one occurrence per start — never by a
// predicate over (running, connected). Those two facts arrive as separate IPC
// messages, so any predicate over both observes intermediate combinations that
// no single main-process moment intended: a reconnect (running, not connected)
// and a shutdown (offline reported before not-running) both read as a start.
//
// Pure, and free of React so it is unit-testable as an ordered transition
// sequence, which is how the orderings above are awkward to stage in a live app.

export type BootGateState = {
  /** Whether the session was running as of the previous observation. */
  running: boolean;
  /** Whether the intro is currently on screen. */
  introVisible: boolean;
};

export type SessionSignals = {
  running: boolean;
  connected: boolean;
};

export type BootGateStep = {
  introVisible: boolean;
  /** True on the single transition that completes an intro that actually played. */
  reportBootDone: boolean;
};

export function stepBootGate(previous: BootGateState, next: SessionSignals): BootGateStep {
  // Not running: nothing to cover, and a teardown mid-intro clears it without
  // reporting a completion — an intro that was cut short has no boot to report.
  if (!next.running) return { introVisible: false, reportBootDone: false };

  // Rising edge — the one genuine start. A session that comes up already
  // connected has nothing to cover, so the intro is skipped outright rather
  // than shown for a frame and dismissed.
  if (!previous.running) {
    return { introVisible: !next.connected, reportBootDone: false };
  }

  // Still running: the only transition that matters is the intro's own end.
  if (previous.introVisible && next.connected) {
    return { introVisible: false, reportBootDone: true };
  }

  // Everything else — a reconnect, a status blip — leaves visibility untouched.
  return { introVisible: previous.introVisible, reportBootDone: false };
}
