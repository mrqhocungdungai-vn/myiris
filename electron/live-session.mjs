// The Gemini Live connection lifecycle: connect/reconnect, the welcome
// greeting, and outbound audio/text/command send paths. Split out of
// electron/main.mjs (split-main-process-modules): Electron-free — every
// cross-module effect (the renderer bridge, pipeline probes, announcements,
// the window tray, and listening mode) is injected.
//
// Split from a single 492-line live-session.mjs (over the 450-line ceiling)
// into this module plus live-messages.mjs, which owns the server-message
// and tool-call handlers — see that module's header comment. This module
// takes live-messages' handleLiveMessage as an injected dependency for the
// Live connection's onmessage callback.
//
// Task 4.4 moves this block verbatim, including raw reads/writes of the
// injected `listenMode` object's fields (engaged, transitioning,
// deliberateReconnect, segmentRecord, synthesizeOnNextConverseConnect) —
// task 4.5 converts those into named transitions once listen-mode.mjs
// exists to own them (design.md D11).
import { GoogleGenAI } from "@google/genai";
import { poBillingStatus } from "./po-session.mjs";
import { buildLiveConfig } from "./live-config.mjs";

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   flushTranscripts: () => void,
 *   drainPendingAnnouncements: () => void,
 *   checkClaudeStatus: () => Promise<any>,
 *   probePipelineAvailability: () => Promise<any>,
 *   userDisplayName: () => string,
 *   updateTrayMenu: () => void,
 *   buildLiveTools: () => any[],
 *   buildListenSystemInstructionText: () => string,
 *   buildSystemInstructionText: () => string,
 *   buildListenExitSynthesisPrompt: (segment: string) => string,
 *   listenMode: any,
 *   clearListenRotationTimer: () => void,
 *   setListenEngaged: (engaged: boolean) => void,
 *   notifyLiveClosed: () => void,
 *   resetListenModeSilently: () => void,
 *   handleLiveMessage: (message: any) => void,
 * }} deps
 */
export function createLiveSession({
  emitEvent,
  emitToRenderer,
  flushTranscripts,
  drainPendingAnnouncements,
  checkClaudeStatus,
  probePipelineAvailability,
  userDisplayName,
  updateTrayMenu,
  buildLiveTools,
  buildListenSystemInstructionText,
  buildSystemInstructionText,
  buildListenExitSynthesisPrompt,
  listenMode,
  clearListenRotationTimer,
  setListenEngaged,
  notifyLiveClosed,
  resetListenModeSilently,
  handleLiveMessage,
}) {
  let liveSession = null;
  let ai = null;
  let liveStatus = { running: false, pid: null };
  // Mirror of the renderer's speaker-mute state, reported via
  // iris:speaker-mute-state — main never mutates audio, it only tracks this to
  // keep the tray label accurate (see openspec/changes/speaker-mute design D4).
  let speakerMuted = false;
  // Gemini Live closes each WebSocket connection after ~10 minutes. With
  // sessionResumption enabled the server hands us refresh handles; on close we
  // reconnect with the latest handle so the conversation continues seamlessly
  // instead of dropping Iris back to the "Press W to wake" sleep screen.
  let resumptionHandle = null;
  let userStopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function getLiveSession() {
    return liveSession;
  }

  function getLiveStatus() {
    return liveStatus;
  }

  function getSpeakerMuted() {
    return speakerMuted;
  }

  function setSpeakerMuted(muted) {
    speakerMuted = Boolean(muted);
  }

  // Read by the listening-mode sequences (still in main.mjs, moving to
  // listen-mode.mjs in task 4.6) to bail out of their own transitions once
  // the user has explicitly gone to sleep.
  function getUserStopped() {
    return userStopped;
  }

  // Written by live-messages.mjs's handleLiveMessage on a
  // sessionResumptionUpdate — that handler lives in the sibling module, but
  // resumptionHandle is this module's state (it's what connectLive's next
  // reconnect resumes from).
  function setResumptionHandle(handle) {
    resumptionHandle = handle;
  }

  function logPoBillingPathOnce() {
    const billing = poBillingStatus();
    if (billing.ok) {
      console.log("[IRIS][po-auth] PO session will bill against the Claude subscription (CLAUDE_CODE_OAUTH_TOKEN set).");
    } else {
      console.warn(
        "[IRIS][po-auth] No CLAUDE_CODE_OAUTH_TOKEN found. PO turns will fail until you run `claude setup-token` " +
          "and set CLAUDE_CODE_OAUTH_TOKEN (see .env.example). DEV is unaffected.",
      );
    }
  }

  // Defers the SYSTEM_EVENT_SESSION_START greeting until the renderer's boot
  // animation reports iris:boot-done, so Iris never talks over it (design.md
  // D6). Reset on every non-reconnect wake; a fallback timer greets anyway if
  // boot-done is somehow never signaled.
  const GreetGate = {
    done: true,
    timer: null,
    arm() {
      this.done = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.fire(), 8000);
    },
    fire() {
      if (this.done) return;
      this.done = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      sendWelcomeGreeting();
    },
  };

  function buildLiveConfigForMode(mode, resumeHandle) {
    return buildLiveConfig({
      mode,
      resumeHandle,
      tools: buildLiveTools(),
      systemInstruction: mode === "listen" ? buildListenSystemInstructionText() : buildSystemInstructionText(),
      voice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
    });
  }

  function sendWelcomeGreeting() {
    (async () => {
      let reachable = false;
      try {
        const status = await checkClaudeStatus();
        reachable = Boolean(status.reachable);
      } catch {
        reachable = false;
      }
      if (!liveSession) return;

      const claudeLine = reachable
        ? "Claude is online and all channels are connected, so we're good to go."
        : "I'm still bringing Claude online, channels are connecting now.";

      const greeting =
        `SYSTEM_EVENT_SESSION_START: The session just started. Proactively greet ${userDisplayName()} out loud right now in a warm, concise way (1-2 sentences). ` +
        `Say something like: Hi ${userDisplayName()}, welcome back. ${claudeLine} Then ask what they have in mind. ` +
        "Speak this greeting immediately without waiting for the user to talk first.";

      liveSession.sendRealtimeInput({ text: greeting });
    })();
  }

  async function startLive() {
    if (liveSession) return liveStatus;
    userStopped = false;
    resumptionHandle = null;
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    await connectLive({ isReconnect: false, mode: "converse" });
    return { running: true, pid: process.pid };
  }

  async function connectLive({ isReconnect, mode = "converse" }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      emitEvent({ type: "fatal", message: "GEMINI_API_KEY is not set." });
      throw new Error("GEMINI_API_KEY is not set");
    }

    // Re-probed on every (re)connect, not just at boot — see design.md decision
    // 1. Live tool declarations are fixed per session, so this is the only point
    // where a just-installed Claude CLI can actually take effect.
    await probePipelineAvailability();

    const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
    ai = new GoogleGenAI({ apiKey });
    emitEvent({ type: "sidecar_status", status: { running: true, model, mode: "webrtc-aec" } });
    emitEvent({ type: "gemini_status", status: "connecting", model });

    liveSession = await ai.live.connect({
      model,
      config: buildLiveConfigForMode(mode, resumptionHandle),
      callbacks: {
        onopen() {
          reconnectAttempts = 0;
          liveStatus = { running: true, pid: process.pid };
          emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec" } });
          emitEvent({ type: "gemini_status", status: "connected", model });
          emitEvent({ type: "audio_state", state: "listening" });
          updateTrayMenu();
          // The resumed session keeps its context; greeting again mid-conversation
          // every ~10 minutes would be jarring. Every listening-mode reconnect
          // (enter/exit/rotation) also passes isReconnect:true for the same
          // reason (design.md Decision 12) — toggling never re-greets.
          if (!isReconnect) GreetGate.arm();
        },
        onmessage(message) {
          handleLiveMessage(message);
        },
        onerror(error) {
          emitEvent({ type: "fatal", message: "Gemini Live error", error: error?.message || String(error) });
        },
        onclose(event) {
          console.error("[IRIS][close] code=", event?.code, "reason=", event?.reason || "(none)");
          flushTranscripts();
          liveSession = null;
          notifyLiveClosed();

          // A deliberate transition (entering/exiting/rotating listening mode)
          // closed this socket itself — skip the failure-reconnect path and
          // the offline teardown entirely (design.md Decision 12); the
          // sequence that called closeLiveSessionDeliberately() drives the
          // reconnect explicitly.
          if (listenMode.consumeDeliberateReconnect()) {
            return;
          }

          if (userStopped) {
            liveStatus = { running: false, pid: null };
            emitEvent({ type: "gemini_status", status: "offline" });
            emitEvent({ type: "audio_state", state: "idle" });
            emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
            updateTrayMenu();
            return;
          }

          // An unexpected disconnect (machine slept, network dropped, server
          // terminated the connection) while listening mode was engaged or
          // mid-transition ends the mode rather than riding across the
          // reconnect (spec "An unexpected disconnect ends listening mode"):
          // reconnecting in listen configuration without a fresh
          // activityStart would silently discard every subsequent byte, and
          // reconnecting in converse configuration while still "engaged"
          // would leave the ear icon lit over a session that has stopped
          // listening. The failure-reconnect path below always targets
          // converse, so either way the mode must end here first.
          if (listenMode.isEngaged() || listenMode.isTransitioning()) {
            clearListenRotationTimer();
            listenMode.settleBoundary();
            setListenEngaged(false);
          }

          scheduleReconnect(event?.reason || "connection closed");
        },
      },
    });
    // Send AFTER connect resolves: onopen can fire before liveSession is
    // assigned, so draining inside onopen would no-op (mirrors previewVoice).
    // Skipped on a listen-config connect — the backlog is delivered on the
    // first connect that is not into listening mode (session-announcements
    // MODIFIED delta).
    if (mode !== "listen") {
      drainPendingAnnouncements();
      // Recovery synthesis after an unexpected disconnect ended the mode
      // (design.md Decision 10 / tasks.md 4.7) — fires at most once, only
      // once conversation is actually back up.
      const segment = listenMode.consumeSynthesisSegment();
      if (segment !== null) {
        liveSession?.sendClientContent({
          turns: [{ role: "user", parts: [{ text: buildListenExitSynthesisPrompt(segment) }] }],
          turnComplete: true,
        });
      }
    }
  }

  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      liveStatus = { running: false, pid: null };
      emitEvent({
        type: "fatal",
        message: `Gemini Live reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
        error: reason,
      });
      emitEvent({ type: "gemini_status", status: "offline" });
      emitEvent({ type: "audio_state", state: "idle" });
      emitEvent({ type: "sidecar_status", status: liveStatus, reason });
      return;
    }
    // Repeated failures suggest a stale resumption handle — drop it and let the
    // remaining attempts open a fresh session (context lost, but Iris stays up).
    if (reconnectAttempts >= 3) resumptionHandle = null;
    const delay = Math.min(500 * 2 ** (reconnectAttempts - 1), 8000);
    console.log(`[IRIS][reconnect] attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms (${reason})`);
    emitEvent({ type: "gemini_status", status: "connecting" });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Always converse: this is the failure path, and listening mode has
      // already been ended (if it was engaged) by the onclose branch above
      // before scheduleReconnect was ever called.
      connectLive({ isReconnect: true, mode: "converse" }).catch((error) => {
        liveSession = null;
        scheduleReconnect(error?.message || String(error));
      });
    }, delay);
  }

  async function stopLive() {
    // Sleep and app quit both route through here. Neither runs the exit
    // boundary (spec "A failed transition leaves a coherent state" / tasks.md
    // 4.6): the resumption handle does not outlive the process, quit runs
    // under a bounded teardown deadline, and at sleep the renderer's audio
    // pipeline is torn down before this fires — no synthesis could be heard.
    resetListenModeSilently();
    userStopped = true;
    resumptionHandle = null;
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (liveSession) {
      try { liveSession.close(); } catch { /* ignore close races */ }
    }
    liveSession = null;
    liveStatus = { running: false, pid: null };
    emitToRenderer("live:interrupt", {});
    emitEvent({ type: "gemini_status", status: "offline" });
    emitEvent({ type: "audio_state", state: "idle" });
    emitEvent({ type: "sidecar_status", status: liveStatus });
    updateTrayMenu();
    return liveStatus;
  }

  return {
    GreetGate,
    getLiveSession,
    getLiveStatus,
    getSpeakerMuted,
    setSpeakerMuted,
    getUserStopped,
    setResumptionHandle,
    logPoBillingPathOnce,
    startLive,
    connectLive,
    // Exposed because the listening-mode sequences (still in main.mjs, moving
    // to listen-mode.mjs in task 4.6) fall back to the ordinary failure-
    // reconnect path when their own converse-mode retry also fails.
    scheduleReconnect,
    stopLive,
  };
}
