// The Gemini Live connection lifecycle: connect/reconnect, the welcome
// greeting, outbound audio/text/command send paths, and the main-owned
// listen-only mode state. Split out of electron/main.mjs
// (split-main-process-modules): Electron-free — every cross-module effect
// (the renderer bridge, pipeline probes, announcements, the window tray) is
// injected.
//
// Split from a single 492-line live-session.mjs (over the 450-line ceiling)
// into this module plus live-messages.mjs, which owns the server-message
// and tool-call handlers — see that module's header comment. This module
// takes live-messages' handleLiveMessage as an injected dependency for the
// Live connection's onmessage callback.
//
// Listen-only mode (replace-listening-mode-with-listen-only design.md D3):
// main is the sole owner of this state — the tray item and the global
// hotkey act on toggleListenOnly() directly rather than dispatching to the
// renderer, and the renderer only displays what main pushes over
// "listen-only:state". Ephemeral per session: reset to disengaged on every
// transition to not-running (explicit stop, or reconnect attempts
// exhausted), and never persisted to configuration.
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
 *   buildSystemInstructionText: () => string,
 *   handleLiveMessage: (message: any) => void,
 *   onAwake?: () => void,
 *   onAsleep?: () => void,
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
  buildSystemInstructionText,
  handleLiveMessage,
  // Ambient session capture (ambient-memory): capture follows the
  // microphone, so it has to know when Iris is actually awake and listening
  // — never a heuristic read off some other state, the same discipline the
  // park gate in run-dispatch.mjs already applies. Deliberately narrow:
  // "awake" fires on a real connection (onopen), "asleep" fires only where a
  // reconnect is NOT about to recover it (an explicit stop, or reconnect
  // attempts exhausted) — a transient ~10-minute session-refresh reconnect is
  // not a user-perceived sleep and must not flicker the retention indicator.
  onAwake = () => {},
  onAsleep = () => {},
}) {
  let liveSession = null;
  let ai = null;
  let liveStatus = { running: false, pid: null };
  // Main-owned listen-only state (design.md D3) — never mutated by the
  // renderer, which only executes the audio drop this flag decides.
  let listenOnlyEngaged = false;
  // Gemini Live closes each WebSocket connection after ~10 minutes. With
  // sessionResumption enabled the server hands us refresh handles; on close we
  // reconnect with the latest handle so the conversation continues seamlessly
  // instead of dropping Iris back to the "press the wake shortcut" sleep screen.
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

  function getListenOnlyEngaged() {
    return listenOnlyEngaged;
  }

  // Pushes state one way, main -> renderer, and never the reverse (design.md
  // D3) — a renderer that reported this back would be a second writer for
  // state it does not own.
  function setListenOnlyEngaged(engaged) {
    if (listenOnlyEngaged === engaged) return;
    listenOnlyEngaged = engaged;
    emitToRenderer("listen-only:state", { engaged });
    updateTrayMenu();
  }

  // The single entry point every control surface (renderer, tray, hotkey)
  // calls directly — no `emitToRenderer` dispatch, so the mode stays
  // reachable with no window open. A no-op while asleep, so a wake always
  // starts audible (spec "Toggling while asleep does nothing").
  function toggleListenOnly() {
    if (!liveStatus.running) return;
    setListenOnlyEngaged(!listenOnlyEngaged);
  }

  // Read by ipc.mjs/window.mjs so a wake always starts audible.
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
    await connectLive({ isReconnect: false });
    return { running: true, pid: process.pid };
  }

  async function connectLive({ isReconnect }) {
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
      config: buildLiveConfig({
        resumeHandle: resumptionHandle,
        tools: buildLiveTools(),
        systemInstruction: buildSystemInstructionText(),
        voice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
      }),
      callbacks: {
        onopen() {
          reconnectAttempts = 0;
          liveStatus = { running: true, pid: process.pid };
          emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec" } });
          emitEvent({ type: "gemini_status", status: "connected", model });
          emitEvent({ type: "audio_state", state: "listening" });
          updateTrayMenu();
          onAwake();
          // The resumed session keeps its context; greeting again mid-conversation
          // every ~10 minutes would be jarring.
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

          if (userStopped) {
            liveStatus = { running: false, pid: null };
            emitEvent({ type: "gemini_status", status: "offline" });
            emitEvent({ type: "audio_state", state: "idle" });
            emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
            updateTrayMenu();
            return;
          }

          scheduleReconnect(event?.reason || "connection closed");
        },
      },
    });
    // Send AFTER connect resolves: onopen can fire before liveSession is
    // assigned, so draining inside onopen would no-op (mirrors previewVoice).
    drainPendingAnnouncements();
  }

  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      liveStatus = { running: false, pid: null };
      // A server-initiated teardown — reconnect attempts exhausted — is a
      // transition to not-running, so listen-only mode resets here too
      // (spec "Listen-only mode is ephemeral per session"), and ambient
      // capture stops on the same terms it does for an explicit sleep — no
      // further reconnect is coming, so the mic is genuinely not listening.
      setListenOnlyEngaged(false);
      onAsleep();
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
      connectLive({ isReconnect: true }).catch((error) => {
        liveSession = null;
        scheduleReconnect(error?.message || String(error));
      });
    }, delay);
  }

  async function stopLive() {
    // Explicit stop is a transition to not-running — listen-only mode
    // resets here too (spec "Listen-only mode is ephemeral per session"),
    // and ambient capture stops and flushes on the same terms (called
    // directly, not left to onclose, since liveSession may already be null).
    setListenOnlyEngaged(false);
    onAsleep();
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
    getListenOnlyEngaged,
    toggleListenOnly,
    getUserStopped,
    setResumptionHandle,
    logPoBillingPathOnce,
    startLive,
    connectLive,
    scheduleReconnect,
    stopLive,
  };
}
