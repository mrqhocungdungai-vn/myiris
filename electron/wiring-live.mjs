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
 *   geminiTools: { buildLiveTools: () => any[] },
 *   geminiPrompts: { buildSystemInstructionText: () => string },
 *   secondBrainCapability: { stopVaultGraphWatch: () => void, probeSecondBrainAvailability: () => boolean },
 *   setWindowModule: (mod: any) => void,
 *   setLiveSessionModule: (mod: any) => void,
 * }} deps
 */
export function createLiveWiring({
  repoRoot,
  appIcon,
  iconPath,
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
  });
  const {
    GreetGate,
    getListenOnlyEngaged,
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
    getAppDevUrl: () => rendererSecurity.appDevUrl,
    envFlag,
    emitToRenderer,
    stopVaultGraphWatch: () => secondBrainCapability.stopVaultGraphWatch(),
    probeSecondBrainAvailability: () => secondBrainCapability.probeSecondBrainAvailability(),
    getLiveStatus: () => liveSessionModule.getLiveStatus(),
    isListenOnlyEngaged: () => getListenOnlyEngaged(),
    toggleListenOnly: () => toggleListenOnly(),
  });
  const {
    createWindow,
    toggleHud,
    updateTrayMenu,
    createTray,
    hudHotkey,
    listenHotkey,
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
    installAppMenu,
    setRendererSecurity,
    startLive,
    stopLive,
    GreetGate,
    toggleListenOnly,
    isListenOnlyEngaged: () => getListenOnlyEngaged(),
    sendCommand,
    sendAudioChunk,
  };
}
