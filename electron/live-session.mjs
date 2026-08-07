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
// "listen-only:state". Ephemeral per session: reset to disengaged by an
// EXPLICIT stop and by nothing else — never by a transport-level event — and
// never persisted to configuration.
//
// Listen-only mode is now Iris's MEETING mode (listen-mode-hears-system-
// audio): engaging it additionally captures the audio the machine is playing,
// makes Iris completely silent, and retains what she hears to its own vault
// area. The transport is still never touched on either transition — the two
// in-band requests below are conversation content, not configuration, and the
// silence guarantee is the client discarding replies, not the model obeying.
import { GoogleGenAI } from "@google/genai";
import { poBillingStatus } from "./po-session.mjs";
import { buildLiveConfig } from "./live-config.mjs";
import { LISTEN_ONLY_ENGAGE_REQUEST, LISTEN_ONLY_DISENGAGE_REQUEST, meetingRecordNote } from "./gemini-prompts.mjs";
import { formatDuration } from "./meeting-capture.mjs";

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
 *   systemAudioEnabled?: () => boolean,
 *   systemAudioGain?: () => number,
 *   onListenOnlyChange?: (engaged: boolean) => void,
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
  // The system-audio half of the mode (listen-mode-hears-system-audio D8).
  // Read through injected getters rather than process.env so this module stays
  // as testable as the rest of it. Both are pushed to the renderer with the
  // mode state so the capture graph never has to read them a second time —
  // and so the renderer never attempts a capture the escape hatch disabled.
  systemAudioEnabled = () => false,
  systemAudioGain = () => 0.7,
  // Meeting retention's lifecycle (D7): driven by the MODE, not by the
  // ambient-capture preference, so it starts on engage and flushes-and-stops
  // on disengage regardless of what that preference says.
  onListenOnlyChange = () => {},
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

  // The resolved system-audio configuration, pushed alongside the mode state
  // so the renderer's capture graph reads one authority instead of two.
  function listenOnlyStatePayload() {
    return {
      engaged: listenOnlyEngaged,
      systemAudio: systemAudioEnabled(),
      systemAudioGain: systemAudioGain(),
    };
  }

  // Asks the model, in-band on the live session, to stay quiet (or to resume).
  // `sendClientContent` with `turnComplete: false` ADDS conversation content
  // without closing a turn, so the model is never asked to generate —
  // `sendRealtimeInput` would provoke exactly the reply this is trying to
  // prevent. Nothing about the transport or the session config is touched.
  //
  // Skipped entirely under the escape hatch: that path must behave exactly as
  // it did before this change, in-band traffic included.
  function sendInBandNote(text, label) {
    if (!systemAudioEnabled()) return;
    if (!liveSession) return;
    try {
      liveSession.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      });
    } catch (error) {
      // Best-effort, never a guarantee — a send that fails must not stop the
      // mode from engaging, because discarding at the client is what actually
      // keeps Iris silent, and the record exists on disk either way.
      console.warn(`[IRIS][listen-only] could not send the in-band ${label}:`, error?.message || error);
    }
  }

  function requestModelSilence(engaged) {
    sendInBandNote(engaged ? LISTEN_ONLY_ENGAGE_REQUEST : LISTEN_ONLY_DISENGAGE_REQUEST, "silence request");
  }

  /**
   * Tells the voice layer WHICH record the engagement just produced, so a
   * later "summarize that meeting" can name the right file instead of the
   * whole folder. Sent after the write settles — the path does not exist
   * before then — and skipped entirely when nothing was heard.
   * @param {{ relativePath: string, startedAt: Date, endedAt: Date } | null} record
   */
  function announceMeetingRecord(record) {
    // Traced either way: "no record" and "announcement broken" produce the
    // same silence on screen, and telling them apart from the outside was
    // impossible until this line existed.
    console.log("[IRIS][listen-only] meeting record:", record?.relativePath ?? "(none — nothing was heard)");
    if (!record?.relativePath) return;
    if (!systemAudioEnabled()) return;
    sendInBandNote(meetingRecordNote(record), "meeting-record note");
    // And the same fact to the user, as the ONE entry the conversation panel
    // gets for the whole engagement. The verbatim deliberately never goes
    // there (renderer-bridge.mjs): the panel is a conversation, the record is
    // a file, and this line is the seam between them — it is what the user
    // points at when they ask Iris to summarise the meeting, and what she
    // hands a verb.
    emitEvent({
      type: "transcript",
      speaker: "heard",
      text:
        `Listened for ${formatDuration(record.endedAt.getTime() - record.startedAt.getTime())} ` +
        `and saved everything to ${record.relativePath}`,
    });
  }

  // Pushes state one way, main -> renderer, and never the reverse (design.md
  // D3) — a renderer that reported this back would be a second writer for
  // state it does not own.
  function setListenOnlyEngaged(engaged) {
    if (listenOnlyEngaged === engaged) return;
    listenOnlyEngaged = engaged;
    emitToRenderer("listen-only:state", listenOnlyStatePayload());
    requestModelSilence(engaged);
    onListenOnlyChange(engaged);
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
    // A session re-established while the mode is engaged must not greet
    // (listen-only-mode spec: "no reply is spoken aloud when the session is
    // later re-established"). Discarding at the client would already swallow
    // it, but asking for a greeting nobody can hear is pure cost — and after
    // the reconnect-exhaustion fix below, a wake into an engaged mode is now
    // a reachable state rather than an impossible one.
    if (listenOnlyEngaged) return;
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
    // The in-band silence request lives in the CONVERSATION, so a session that
    // could not be resumed starts without it. Re-stating it on every connect
    // while the mode is engaged is the same cost reduction, applied to the same
    // state — never a reconfiguration, and never a reason the mode itself
    // changes.
    if (listenOnlyEngaged) requestModelSilence(true);
  }

  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      liveStatus = { running: false, pid: null };
      // Listen-only mode is deliberately NOT reset here (listen-mode-hears-
      // system-audio D4). It used to be, and that meant a network blip during
      // a meeting restored Iris's voice: she would start speaking aloud into a
      // room the user had silenced her for, at a moment when they are not
      // looking at the screen. A transport failure is not a reason to become
      // audible — only an explicit stop clears the mode. Ambient capture still
      // stops on the same terms it does for an explicit sleep: no further
      // reconnect is coming, so the mic is genuinely not listening.
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

  // The renderer window closed while the mode was engaged. Everything the mode
  // owns lives behind that renderer — the capture graph, the loopback stream,
  // the mixed audio the session is fed — so leaving the mode "engaged" with
  // nothing behind it would claim a meeting is being recorded when nothing is
  // reaching Iris at all. Disengaging here flushes the meeting record through
  // the same path an explicit disengage takes. This is not a transport event:
  // it is the mode's own machinery going away.
  function handleRendererGone() {
    if (!listenOnlyEngaged) return;
    setListenOnlyEngaged(false);
  }

  // The renderer could not acquire the system-audio capture AT ALL as the mode
  // was engaged. This is the one failure that does not end in "still engaged"
  // (listen-mode-hears-system-audio D4): the asymmetry is deliberate, and it
  // is the design's most load-bearing choice. Refusing to engage costs the
  // user a retry, with Iris's voice never having been taken away. Disengaging
  // mid-meeting — which is what a capture that fails LATER must never do —
  // makes Iris audible in a room where the user engaged the mode specifically
  // so she would not be, at a moment when they are not looking at the screen.
  //
  // Still main's decision: the renderer reports a fact and this module acts on
  // it, so mode state keeps exactly one writer.
  function handleSystemAudioUnavailable(reason) {
    if (!listenOnlyEngaged) return;
    emitEvent({
      type: "log",
      level: "error",
      message: `Listen-only mode could not capture this machine's audio (${reason || "unknown error"}), so it was not engaged.`,
    });
    setListenOnlyEngaged(false);
  }

  return {
    GreetGate,
    getLiveSession,
    getLiveStatus,
    getListenOnlyEngaged,
    listenOnlyStatePayload,
    handleRendererGone,
    handleSystemAudioUnavailable,
    announceMeetingRecord,
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
