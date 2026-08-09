// The second half of the composition root's wiring — split out of
// wiring.mjs (itself split out of main.mjs) purely because the whole
// wiring block together exceeded the 450-line ceiling once every module
// existed; design.md's Risks section explicitly permits this kind of
// extraction. This half wires the Live session and the window/HUD/tray —
// two modules with a mutual dependency (live-session needs the tray's
// updateTrayMenu; window needs live-session's status and listen-only
// state), which is exactly why they stay together in one file. Electron-free
// itself: called from wiring.mjs, which is itself called from main.mjs — one
// of the four modules allowed to import Electron directly.
import { createWindowModule } from "./window.mjs";
import { createLiveSession } from "./live-session.mjs";
import { createLiveMessages } from "./live-messages.mjs";
import { systemAudioEnabled, systemAudioGain } from "./user-config.mjs";

/**
 * @param {{
 *   repoRoot: string,
 *   appIcon: any,
 *   iconPath: string,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   emitEvent: (event: any) => void,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   flushTranscripts: () => void,
 *   appendUserTranscript: (text: string) => void,
 *   appendModelTranscript: (text: string) => void,
 *   drainPendingAnnouncements: () => void,
 *   checkClaudeStatus: () => any,
 *   probePipelineAvailability: () => Promise<any>,
 *   userDisplayName: () => string,
 *   executeClaudeTool: (call: any) => any,
 *   submitClaudeTask: (args: any) => any,
 *   interruptResidentTurns?: () => string[],
 *   geminiTools: { buildLiveTools: () => any[] },
 *   geminiPrompts: { buildSystemInstructionText: () => string },
 *   secondBrainCapability: {
 *     stopVaultGraphWatch: () => void,
 *     probeSecondBrainAvailability: () => boolean,
 *     setAmbientCaptureAwake: (awake: boolean) => Promise<void>,
 *     setMeetingCaptureEngaged: (engaged: boolean) => Promise<any>,
 *     appendMeetingFragment: (text: string) => void,
 *     closeMeetingUtterance: () => void,
 *   },
 *   setWindowModule: (mod: any) => void,
 *   setLiveSessionModule: (mod: any) => void,
 *   recordLog?: (record: { level: string, src: string, msg: string, [key: string]: any }) => void,
 * }} deps
 */
export function createLiveWiring({
  repoRoot,
  appIcon,
  iconPath,
  // diagnostic-logging: handed straight to the window module, which is where
  // the renderer's faults are captured. Nothing here reads it.
  recordLog = () => {},
  envFlag,
  emitEvent,
  emitToRenderer,
  flushTranscripts,
  appendUserTranscript,
  appendModelTranscript,
  drainPendingAnnouncements,
  checkClaudeStatus,
  probePipelineAvailability,
  userDisplayName,
  executeClaudeTool,
  submitClaudeTask,
  interruptResidentTurns = () => [],
  geminiTools,
  geminiPrompts,
  secondBrainCapability,
  setWindowModule,
  setLiveSessionModule,
}) {
  // windowModule (constructed further down) owns mainWindow/uiMode/tray;
  // liveSessionModule (constructed further down) owns liveSession/liveStatus/
  // listenOnlyEngaged. Both are local to this phase so the internal thunks
  // below (liveMessages) can reference them directly; wiring.mjs learns
  // about them only through the setWindowModule/setLiveSessionModule
  // setters, for its own getMainWindow/getUiMode/getLiveSession/getLiveStatus
  // wrapper functions and whatever main.mjs needs directly.
  let windowModule;
  let liveSessionModule;

  const liveMessages = createLiveMessages({
    getLiveSession: () => liveSessionModule.getLiveSession(),
    setResumptionHandle: (handle) => liveSessionModule.setResumptionHandle(handle),
    emitEvent,
    emitToRenderer,
    flushTranscripts,
    appendUserTranscript,
    appendModelTranscript,
    executeClaudeTool,
    submitClaudeTask,
    isListenOnlyEngaged: () => liveSessionModule.getListenOnlyEngaged(),
    // Meeting retention's feed (listen-mode-hears-system-audio D7) — the raw
    // transcription fragments, deliberately not the bounded utterance ring.
    // Both are no-ops unless the mode is engaged, which the capture itself
    // decides; nothing here needs to know the mode.
    onInputTranscription: (text) => secondBrainCapability.appendMeetingFragment(text),
    onUtteranceBoundary: () => secondBrainCapability.closeMeetingUtterance(),
    // Barge-in reaches the run layer here (the-canvas-becomes-a-conversation
    // D6). Scoped to resident turns by run-queue itself: interrupting Iris
    // mid-sentence says something about the conversation the user is in, not
    // about an unrelated job that happens to be running.
    onUserInterrupted: () => interruptResidentTurns(),
  });
  const { handleLiveMessage, sendAudioChunk, sendCommand } = liveMessages;

  liveSessionModule = createLiveSession({
    emitEvent,
    emitToRenderer,
    flushTranscripts,
    drainPendingAnnouncements,
    checkClaudeStatus,
    probePipelineAvailability,
    userDisplayName,
    // Deferred: windowModule (constructed further down this file, after
    // liveSessionModule) owns updateTrayMenu. Only called once the app is
    // running, well after windowModule is assigned.
    updateTrayMenu: () => windowModule.updateTrayMenu(),
    buildLiveTools: () => geminiTools.buildLiveTools(),
    buildSystemInstructionText: () => geminiPrompts.buildSystemInstructionText(),
    handleLiveMessage,
    // Ambient session capture (ambient-memory): capture follows the
    // microphone, so it is main's own wake/sleep transitions — never the
    // renderer — that decide whether it is live.
    onAwake: () => secondBrainCapability.setAmbientCaptureAwake(true),
    onAsleep: () => secondBrainCapability.setAmbientCaptureAwake(false),
    // The system-audio half of the mode (listen-mode-hears-system-audio D8):
    // main resolves both values and pushes them with the mode state, so the
    // renderer's capture graph never reads the environment a second time.
    systemAudioEnabled,
    systemAudioGain,
    // Meeting retention is driven by the MODE, so its lifecycle hangs off the
    // one place every control surface already funnels through — not off the
    // ambient-capture preference, which governs a different area under a
    // different consent.
    onListenOnlyChange: (engaged) => {
      if (!systemAudioEnabled()) return;
      // Awaited before announcing: the record's path does not exist until the
      // final flush and the closing span have settled, so telling the voice
      // layer where it is has to follow the write rather than race it.
      // Fire-and-forget from the toggle's point of view — a retention write is
      // never allowed to hold up the mode changing.
      secondBrainCapability
        .setMeetingCaptureEngaged(engaged)
        .then((record) => liveSessionModule.announceMeetingRecord(record))
        // Logged, never swallowed. A bare `.catch(() => {})` here would hide
        // the whole announcement — the user would disengage, see nothing, and
        // have no way to tell a broken announcement from an engagement that
        // heard nothing. That failure shape has already cost this change four
        // separate rounds of diagnosis.
        .catch((error) => {
          console.error("[IRIS][listen-only] meeting record announcement failed:", error?.stack || error);
        });
    },
  });
  const {
    GreetGate,
    getListenOnlyEngaged,
    listenOnlyStatePayload,
    handleRendererGone,
    handleSystemAudioUnavailable,
    toggleListenOnly,
    logPoBillingPathOnce,
    startLive,
    stopLive,
  } = liveSessionModule;
  logPoBillingPathOnce();
  setLiveSessionModule(liveSessionModule);

  // rendererSecurity is installed inside main.mjs's app.whenReady(), after
  // wiring.mjs's whole createWiring() call returns — assigned here via
  // setRendererSecurity() so windowModule's getAppDevUrl thunk (which needs
  // rendererSecurity.appDevUrl, and is only ever called once createWindow()
  // runs, well after that assignment) can close over it.
  let rendererSecurity;
  function setRendererSecurity(rs) {
    rendererSecurity = rs;
  }

  windowModule = createWindowModule({
    repoRoot,
    appIcon,
    iconPath,
    recordLog,
    getAppDevUrl: () => rendererSecurity.appDevUrl,
    envFlag,
    emitToRenderer,
    stopVaultGraphWatch: () => secondBrainCapability.stopVaultGraphWatch(),
    probeSecondBrainAvailability: () => secondBrainCapability.probeSecondBrainAvailability(),
    getLiveStatus: () => liveSessionModule.getLiveStatus(),
    isListenOnlyEngaged: () => getListenOnlyEngaged(),
    toggleListenOnly: () => toggleListenOnly(),
    // Everything listen-only mode owns lives behind the renderer — the capture
    // graph and the mixed stream both die with the window, so a mode left
    // "engaged" behind a closed window would claim a meeting is being recorded
    // while nothing reaches Iris at all (listen-mode-hears-system-audio 4.7).
    onRendererGone: () => handleRendererGone(),
  });
  const {
    createWindow,
    toggleHud,
    updateTrayMenu,
    createTray,
    hudHotkey,
    listenHotkey,
    wakeHotkey,
    sleepHotkey,
    requestWake,
    requestSleep,
    notifyWakeReady,
    installAppMenu,
  } = windowModule;
  setWindowModule(windowModule);

  return {
    createWindow,
    toggleHud,
    updateTrayMenu,
    createTray,
    hudHotkey,
    listenHotkey,
    wakeHotkey,
    sleepHotkey,
    requestWake,
    requestSleep,
    notifyWakeReady,
    installAppMenu,
    setRendererSecurity,
    startLive,
    stopLive,
    GreetGate,
    toggleListenOnly,
    isListenOnlyEngaged: () => getListenOnlyEngaged(),
    listenOnlyStatePayload,
    handleSystemAudioUnavailable,
    sendCommand,
    sendAudioChunk,
  };
}
