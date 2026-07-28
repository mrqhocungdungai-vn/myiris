// Listening mode: the engaged/transitioning/boundary state machine, its
// rotation timer, the one-shot event bus the boundary sequence subscribes
// to, and the enter/exit/rotation sequences themselves. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — the Live
// session, the renderer bridge, the window tray, and Gemini prompt text are
// all injected.
//
// Owns the ListenMode object (with the named transitions task 4.5 added to
// it, back when it still lived in main.mjs) as private state now — nothing
// outside this module reaches its fields directly; live-session.mjs and
// live-messages.mjs receive it as an injected reference, exactly as they
// did before this move, so their own code is unchanged by this commit.
import { runBoundary } from "./listen-boundary.mjs";
import { envNumber } from "./user-config.mjs";

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   updateTrayMenu: () => void,
 *   getLiveSession: () => any,
 *   getLiveStatus: () => { running: boolean },
 *   getUserStopped: () => boolean,
 *   connectLive: (opts: { isReconnect: boolean, mode?: string }) => Promise<void>,
 *   scheduleReconnect: (reason: string) => void,
 *   buildListenEntryConfirmationPrompt: () => string,
 *   buildListenExitSynthesisPrompt: (segment: string) => string,
 * }} deps
 */
export function createListenMode({
  emitEvent,
  emitToRenderer,
  updateTrayMenu,
  getLiveSession,
  getLiveStatus,
  getUserStopped,
  connectLive,
  scheduleReconnect,
  buildListenEntryConfirmationPrompt,
  buildListenExitSynthesisPrompt,
}) {
  // Main is the sole owner of this state (design.md D11): the tray item and
  // the global hotkey act on it directly rather than dispatching to the
  // renderer, and the renderer only displays what main pushes. Ephemeral per
  // session: reset to disengaged on any transition to not-running (stopLive,
  // or an unexpected onclose), and never persisted to configuration.
  const ListenMode = {
    engaged: false,
    // Guards every entry point (renderer/tray/hotkey/rotation timer/goAway)
    // against reentrancy while an enter/exit/rotation sequence is mid-flight —
    // spec "Mode transitions are atomic". Also gates notifyIris's
    // deliverability check, since the moment right after a deliberate
    // reconnect but before the mode is marked engaged is still not a safe
    // window to inject an announcement into.
    transitioning: false,
    rotationTimer: null,
    // Set immediately before WE close the session ourselves (entering,
    // exiting, or rotating) so `onclose` can tell a deliberate close from an
    // unexpected one (design.md Decision 12) — consumed and cleared by that
    // same onclose call.
    deliberateReconnect: false,
    // True for the lifetime of a boundary's forced turn — gates suppression
    // in handleLiveMessage. Every boundary turn (rotation or exit alike) is
    // neither heard nor shown (spec "Every boundary turn is neither heard nor
    // shown").
    boundaryInFlight: false,
    // Each chunk's input transcription, kept only for the life of the
    // listening session (spec "Segment records live in process memory only").
    segmentRecord: "",
    // Set when an unexpected disconnect ends the mode while a chunk may still
    // be uncommitted — tells the next converse connect to speak a recovery
    // synthesis once it is back up (design.md Decision 10 / tasks.md 4.7).
    synthesizeOnNextConverseConnect: false,

    // Named transitions (split-main-process-modules task 4.5, design.md D11):
    // live-session.mjs/live-messages.mjs call these instead of writing this
    // object's fields directly. Reads stay reads, through the boolean
    // accessors below.
    isEngaged() {
      return this.engaged;
    },
    isTransitioning() {
      return this.transitioning;
    },
    isBoundaryInFlight() {
      return this.boundaryInFlight;
    },

    // Consumes a deliberate-reconnect marker a listening-mode sequence set
    // before closing the socket itself — true means the just-observed close
    // was ours, not a failure, and the caller should skip the failure path.
    consumeDeliberateReconnect() {
      if (!this.deliberateReconnect) return false;
      this.deliberateReconnect = false;
      return true;
    },

    // If the current chunk captured anything, mark it for the recovery
    // synthesis the next converse connect delivers; otherwise there is
    // nothing to recover, so drop it.
    captureSegmentForSynthesis() {
      if (this.segmentRecord.trim()) {
        this.synthesizeOnNextConverseConnect = true;
      } else {
        this.segmentRecord = "";
      }
    },

    // Ends an in-progress transition/boundary abruptly — an unexpected
    // disconnect while listening mode was engaged or mid-transition — and
    // decides whether the current segment survives for recovery synthesis.
    settleBoundary() {
      this.transitioning = false;
      this.boundaryInFlight = false;
      this.captureSegmentForSynthesis();
    },

    // Consumes the pending recovery-synthesis segment, if any: returns the
    // captured text and clears both fields, or returns null if none is
    // pending.
    consumeSynthesisSegment() {
      if (!this.synthesizeOnNextConverseConnect) return null;
      this.synthesizeOnNextConverseConnect = false;
      const segment = this.segmentRecord;
      this.segmentRecord = "";
      return segment;
    },

    // Appends transcribed input to the current chunk's in-memory recovery
    // record — accumulated whenever the mode is engaged.
    appendToSegment(text) {
      this.segmentRecord += text;
    },
  };

  function listenChunkMs() {
    return envNumber("IRIS_LISTEN_CHUNK_MS", 8 * 60 * 1000, { min: 60 * 1000, max: 30 * 60 * 1000 });
  }

  // Pushes state one way, main -> renderer, and never the reverse (design.md
  // D11) — a renderer that reported this back would be a second writer for
  // state it does not own, overwriting the authoritative value on a reload
  // while a chunk was still open.
  function setListenEngaged(engaged) {
    if (ListenMode.engaged === engaged) return;
    ListenMode.engaged = engaged;
    emitToRenderer("listen-mode:state", { engaged });
    updateTrayMenu();
  }

  function clearListenRotationTimer() {
    if (ListenMode.rotationTimer) {
      clearTimeout(ListenMode.rotationTimer);
      ListenMode.rotationTimer = null;
    }
  }

  function armListenRotationTimer() {
    clearListenRotationTimer();
    ListenMode.rotationTimer = setTimeout(() => {
      ListenMode.rotationTimer = null;
      runListenRotation().catch((error) => {
        emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation failed: ${error.message}` });
      });
    }, listenChunkMs());
  }

  // Resets every piece of listening-mode state to disengaged without running
  // any boundary — used when committing would accomplish nothing observable:
  // sleep and app quit (tasks.md 4.6), where the resumption handle does not
  // outlive the process and no synthesis could be heard anyway.
  function resetListenModeSilently() {
    clearListenRotationTimer();
    ListenMode.transitioning = false;
    ListenMode.boundaryInFlight = false;
    ListenMode.deliberateReconnect = false;
    ListenMode.segmentRecord = "";
    ListenMode.synthesizeOnNextConverseConnect = false;
    setListenEngaged(false);
  }

  // One-shot event bus feeding the boundary sequence (listen-boundary.mjs) and
  // the entry-confirmation wait: subscribing here rather than reading a cached
  // value is what makes handle-freshness structural (design.md Decision 5) — a
  // handle from before a boundary began was never pushed to a listener that
  // didn't exist yet, so it cannot satisfy that boundary's wait.
  let turnCompleteListeners = [];
  let freshHandleListeners = [];
  let liveCloseListeners = [];

  function notifyTurnComplete() {
    const listeners = turnCompleteListeners;
    turnCompleteListeners = [];
    listeners.forEach((cb) => cb());
  }
  function onTurnComplete(cb) {
    turnCompleteListeners.push(cb);
    return () => {
      turnCompleteListeners = turnCompleteListeners.filter((listener) => listener !== cb);
    };
  }
  function notifyFreshResumptionHandle(handle) {
    const listeners = freshHandleListeners;
    freshHandleListeners = [];
    listeners.forEach((cb) => cb(handle));
  }
  function onFreshResumptionHandle(cb) {
    freshHandleListeners.push(cb);
    return () => {
      freshHandleListeners = freshHandleListeners.filter((listener) => listener !== cb);
    };
  }
  function notifyLiveClosed() {
    const listeners = liveCloseListeners;
    liveCloseListeners = [];
    listeners.forEach((cb) => cb());
  }
  function waitForLiveClose() {
    return new Promise((resolve) => liveCloseListeners.push(resolve));
  }

  // Shared by every deliberate transition (enter/exit/rotation): marks the
  // close as ours so `onclose` skips the failure-reconnect path and the
  // offline teardown (design.md Decision 12), then closes — or, if the
  // session is already gone, resolves the close-wait directly since no
  // `onclose` will fire to do it.
  function closeLiveSessionDeliberately() {
    ListenMode.deliberateReconnect = true;
    const session = getLiveSession();
    if (session) {
      try {
        session.close();
      } catch {
        /* ignore close races */
      }
    } else {
      notifyLiveClosed();
    }
  }

  // The session-like driver `runBoundary` (listen-boundary.mjs) needs — a thin
  // adapter over the real liveSession and the event bus above. Built fresh per
  // boundary since `liveSession` may be reassigned between boundaries.
  function makeBoundarySession() {
    return {
      sendActivityEnd: () => getLiveSession()?.sendRealtimeInput({ activityEnd: {} }),
      onTurnComplete,
      onFreshResumptionHandle,
      disconnect: closeLiveSessionDeliberately,
    };
  }

  // Drives one turn via sendClientContent (the measured-working way to drive a
  // turn under AAD-off — design.md Decision 4; NOT sendRealtimeInput({text}),
  // whose behavior in this configuration is unmeasured) and resolves once it
  // completes or a bounded wait elapses. Used for the entry confirmation,
  // which must finish before the first activity opens (spec "The confirmation
  // does not swallow the user's first words").
  function driveTurnAndWaitForCompletion(text, timeoutMs = 8000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      const unsubscribe = onTurnComplete(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
      getLiveSession()?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
    });
  }

  // Each of enter/exit/rotation is a deliberate reconnect (design.md Decision
  // 12): close the current session ourselves, marking the close as ours so
  // `onclose` skips the failure-reconnect path, then reconnect carrying
  // whatever resumption handle is current — via `{ isReconnect: true }` so
  // `GreetGate` does not re-fire the welcome greeting on every toggle and
  // rotation.

  async function enterListenMode() {
    if (!getLiveStatus().running || ListenMode.transitioning || ListenMode.engaged) return;
    ListenMode.transitioning = true;
    try {
      const closed = waitForLiveClose();
      closeLiveSessionDeliberately();
      await closed;
      if (getUserStopped()) return;

      try {
        await connectLive({ isReconnect: true, mode: "listen" });
      } catch (error) {
        // A failed transition leaves a coherent state (spec "A failed
        // transition leaves a coherent state") — never report engaged over a
        // session that is not listening.
        emitEvent({ type: "fatal", message: "Could not enter listening mode", error: error?.message || String(error) });
        try {
          await connectLive({ isReconnect: true, mode: "converse" });
        } catch (fallbackError) {
          scheduleReconnect(fallbackError?.message || String(fallbackError));
        }
        return;
      }
      if (getUserStopped()) return;

      ListenMode.segmentRecord = "";
      const confirmed = await driveTurnAndWaitForCompletion(buildListenEntryConfirmationPrompt());
      if (!confirmed) {
        emitEvent({
          type: "log",
          level: "warn",
          message: "Listening-mode entry confirmation did not complete within the bounded wait; opening the activity anyway.",
        });
      }
      if (getUserStopped()) return;

      // Opened only now, after the confirmation turn has completed, so the
      // confirmation cannot consume the user's opening words (spec "The
      // confirmation does not swallow the user's first words").
      getLiveSession()?.sendRealtimeInput({ activityStart: {} });
      setListenEngaged(true);
      armListenRotationTimer();
    } finally {
      ListenMode.transitioning = false;
    }
  }

  async function exitListenMode() {
    if (!ListenMode.engaged || ListenMode.transitioning) return;
    ListenMode.transitioning = true;
    clearListenRotationTimer();
    try {
      ListenMode.boundaryInFlight = true;
      const closed = waitForLiveClose();
      await runBoundary(makeBoundarySession(), {
        onMissing: (what) =>
          emitEvent({ type: "log", level: "warn", message: `Listening-mode exit boundary missing ${what}; proceeding.` }),
      });
      ListenMode.boundaryInFlight = false;
      await closed;
      if (getUserStopped()) return;

      try {
        await connectLive({ isReconnect: true, mode: "converse" });
      } catch (error) {
        setListenEngaged(false);
        scheduleReconnect(error?.message || String(error));
        return;
      }
      if (getUserStopped()) return;

      // The synthesis is driven only now, after the converse reconnect — never
      // at the boundary, where the listening instruction is still in force and
      // would collapse it to the same one-word acknowledgement a rotation gets
      // (spec "Ending listening mode commits what was heard and Iris speaks
      // its synthesis").
      setListenEngaged(false);
      const segment = ListenMode.segmentRecord;
      ListenMode.segmentRecord = "";
      getLiveSession()?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: buildListenExitSynthesisPrompt(segment) }] }],
        turnComplete: true,
      });
    } finally {
      ListenMode.transitioning = false;
    }
  }

  async function runListenRotation() {
    if (!ListenMode.engaged || ListenMode.transitioning) return;
    ListenMode.transitioning = true;
    clearListenRotationTimer();
    try {
      ListenMode.boundaryInFlight = true;
      const closed = waitForLiveClose();
      await runBoundary(makeBoundarySession(), {
        onMissing: (what) =>
          emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation boundary missing ${what}; proceeding.` }),
      });
      ListenMode.boundaryInFlight = false;
      await closed;
      if (getUserStopped()) return;

      try {
        await connectLive({ isReconnect: true, mode: "listen" });
      } catch (error) {
        // The deliberate path itself broke down — fall back to the ordinary
        // failure-reconnect (always converse) and treat this the same as an
        // unexpected disconnect: the mode ends, with the segment record as
        // the recovery path.
        setListenEngaged(false);
        if (ListenMode.segmentRecord.trim()) ListenMode.synthesizeOnNextConverseConnect = true;
        scheduleReconnect(error?.message || String(error));
        return;
      }
      if (getUserStopped()) return;

      getLiveSession()?.sendRealtimeInput({ activityStart: {} });
      armListenRotationTimer();
    } finally {
      ListenMode.transitioning = false;
    }
  }

  // The single entry point every control surface (renderer, tray, hotkey)
  // calls directly — no `emitToRenderer` dispatch, so the mode stays reachable
  // with no window open (design.md Decision 11).
  function toggleListenMode() {
    if (!getLiveStatus().running) return; // no-op while asleep (spec "Toggling while asleep does nothing")
    if (ListenMode.transitioning) return; // spec "A toggle during a transition is ignored"
    if (ListenMode.engaged) {
      exitListenMode().catch((error) => {
        emitEvent({ type: "log", level: "warn", message: `Ending listening mode failed: ${error.message}` });
      });
    } else {
      enterListenMode().catch((error) => {
        emitEvent({ type: "log", level: "warn", message: `Entering listening mode failed: ${error.message}` });
      });
    }
  }

  return {
    ListenMode,
    setListenEngaged,
    clearListenRotationTimer,
    resetListenModeSilently,
    notifyTurnComplete,
    onTurnComplete,
    notifyFreshResumptionHandle,
    onFreshResumptionHandle,
    notifyLiveClosed,
    // Called externally by live-messages.mjs's goAway handler, which rotates
    // immediately rather than waiting for the ordinary chunk timer.
    runListenRotation,
    toggleListenMode,
  };
}
