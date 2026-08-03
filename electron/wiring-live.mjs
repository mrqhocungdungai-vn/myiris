// The second half of the composition root's wiring — split out of
// wiring.mjs (itself split out of main.mjs) purely because the whole
// wiring block together exceeded the 450-line ceiling once every module
// existed; design.md's Risks section explicitly permits this kind of
// extraction. This half wires the Live session, listening mode, and the
// window/HUD/tray — three modules with a genuine three-way mutual
// dependency on each other (see the comment at their construction below),
// which is exactly why they stay together in one file rather than being
// split further. Electron-free itself: called from wiring.mjs, which is
// itself called from main.mjs — one of the four modules allowed to import
// Electron directly.
import { createWindowModule } from "./window.mjs";
import { createLiveSession } from "./live-session.mjs";
import { createLiveMessages } from "./live-messages.mjs";
import { createListenMode } from "./listen-mode.mjs";

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
 *   geminiPrompts: { buildListenSystemInstructionText: () => string, buildSystemInstructionText: () => string, buildListenEntryConfirmationPrompt: () => string, buildListenExitSynthesisPrompt: (segment: any) => string },
 *   secondBrainCapability: { stopVaultGraphWatch: () => void, probeSecondBrainAvailability: () => boolean },
 *   setWindowModule: (mod: any) => void,
 *   setLiveSessionModule: (mod: any) => void,
 *   setListenModeObject: (obj: any) => void,
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
  setListenModeObject,
}) {
  // windowModule (constructed further down) owns mainWindow/uiMode/tray;
  // liveSessionModule (constructed further down) owns liveSession/liveStatus/
  // speakerMuted. Both are local to this phase so the internal thunks below
  // (listenModeModule, liveMessages) can reference them directly; wiring.mjs
  // learns about them only through the setWindowModule/setLiveSessionModule
  // setters, for its own getMainWindow/getUiMode/getLiveSession/getLiveStatus
  // wrapper functions and whatever main.mjs needs directly.
  let windowModule;
  let liveSessionModule;

  // listenModeModule, liveMessages, and liveSessionModule form a three-way
  // mutual dependency (listen-mode needs live-session's connect/schedule/
  // getters; live-session and live-messages need listen-mode's ListenMode
  // object and transition functions; live-messages and live-session need
  // each other's handleLiveMessage/getLiveSession). Constructed in this
  // order — listen-mode first, with thunks deferring to liveSessionModule
  // (assigned later, only ever called at runtime) — so every direct
  // (non-thunked) reference always points at an already-constructed module.
  const listenModeModule = createListenMode({
    emitEvent,
    emitToRenderer,
    updateTrayMenu: () => windowModule.updateTrayMenu(),
    getLiveSession: () => liveSessionModule.getLiveSession(),
    getLiveStatus: () => liveSessionModule.getLiveStatus(),
    getUserStopped: () => liveSessionModule.getUserStopped(),
    connectLive: (opts) => liveSessionModule.connectLive(opts),
    scheduleReconnect: (reason) => liveSessionModule.scheduleReconnect(reason),
    buildListenEntryConfirmationPrompt: () => geminiPrompts.buildListenEntryConfirmationPrompt(),
    buildListenExitSynthesisPrompt: (segment) => geminiPrompts.buildListenExitSynthesisPrompt(segment),
  });
  const {
    ListenMode,
    setListenEngaged,
    clearListenRotationTimer,
    resetListenModeSilently,
    notifyTurnComplete,
    notifyFreshResumptionHandle,
    notifyLiveClosed,
    runListenRotation,
    toggleListenMode,
  } = listenModeModule;
  setListenModeObject(ListenMode);

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
    listenMode: ListenMode,
    notifyFreshResumptionHandle,
    notifyTurnComplete,
    runListenRotation,
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
    buildListenSystemInstructionText: () => geminiPrompts.buildListenSystemInstructionText(),
    buildSystemInstructionText: () => geminiPrompts.buildSystemInstructionText(),
    buildListenExitSynthesisPrompt: (segment) => geminiPrompts.buildListenExitSynthesisPrompt(segment),
    listenMode: ListenMode,
    clearListenRotationTimer,
    setListenEngaged,
    notifyLiveClosed,
    resetListenModeSilently,
    handleLiveMessage,
  });
  const {
    GreetGate,
    getSpeakerMuted,
    setSpeakerMuted,
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
    getSpeakerMuted: () => getSpeakerMuted(),
    isListenModeEngaged: () => ListenMode.engaged,
    toggleListenMode: () => toggleListenMode(),
  });
  const {
    createWindow,
    toggleHud,
    updateTrayMenu,
    createTray,
    hudHotkey,
    muteHotkey,
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
    muteHotkey,
    listenHotkey,
    installAppMenu,
    setRendererSecurity,
    startLive,
    stopLive,
    GreetGate,
    setSpeakerMuted,
    toggleListenMode,
    isListenModeEngaged: () => ListenMode.engaged,
    sendCommand,
    sendAudioChunk,
  };
}
