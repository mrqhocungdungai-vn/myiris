// The composition root's dependency-injection wiring — constructs every
// core module and capability with its injected collaborators, resolving the
// forward-reference/thunk cycles design.md's D6/Risks identify. Split out of
// electron/main.mjs because the module-construction block alone exceeded the
// 450-line ceiling once every module existed — explicitly anticipated and
// permitted by design.md's Risks section ("if wiring alone exceeds ~250,
// extract a wiring.mjs that main.mjs calls — not a failure"). Further split
// into wiring-capabilities.mjs and wiring-live.mjs for the same reason; see
// their headers. Electron-free itself: `dialog` and the packaged-check are
// received injected from main.mjs, one of the four modules allowed to
// import Electron directly, like any other domain module.
import { getPoSessionState, cancelPoTurn } from "./po-session.mjs";
import { createRunQueue, RUN_STATUS } from "./run-queue.mjs";
import { createPipelineProbes } from "./pipeline-probes.mjs";
import { createPipelineInstall } from "./pipeline-install.mjs";
import { createUserConfig } from "./user-config.mjs";
import { createRendererBridge } from "./renderer-bridge.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createAnnouncements } from "./announcements.mjs";
import { createRunDispatch } from "./run-dispatch.mjs";
import { createRunStream } from "./run-stream.mjs";
import { createCapabilitiesWiring } from "./wiring-capabilities.mjs";
import { createLiveWiring } from "./wiring-live.mjs";

/**
 * @param {{
 *   repoRoot: string,
 *   appIcon: any,
 *   iconPath: string,
 *   canvasStoreFile: string,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
 *   getIsPackaged: () => boolean,
 * }} deps
 */
export function createWiring({ repoRoot, appIcon, iconPath, canvasStoreFile, envFlag, dialog, getIsPackaged }) {
  // windowModule and liveSessionModule are constructed in wiring-live.mjs
  // (this phase's own module-scope bindings, needed by consumers here that
  // exist before that phase runs — rendererBridge, sessionStoreModule,
  // canvasCapability, userConfig, announcements) — registered back here via
  // the setWindowModule/setLiveSessionModule setters passed into
  // createLiveWiring below.
  let windowModule;
  function getMainWindow() {
    return windowModule.getMainWindow();
  }
  function getUiMode() {
    return windowModule.getUiMode();
  }
  function setWindowModule(mod) {
    windowModule = mod;
  }
  let liveSessionModule;
  function getLiveSession() {
    return liveSessionModule.getLiveSession();
  }
  function getLiveStatus() {
    return liveSessionModule.getLiveStatus();
  }
  function setLiveSessionModule(mod) {
    liveSessionModule = mod;
  }

  const rendererBridge = createRendererBridge({ getMainWindow: () => getMainWindow() });
  const {
    emitToRenderer,
    emitEvent,
    flushTranscripts,
    appendUserTranscript,
    appendModelTranscript,
    getUiContext: getUiContextSnapshot,
    setUiContext: setUiContextSnapshot,
  } = rendererBridge;

  // canvasCapability and secondBrainCapability (constructed further down,
  // once pipelineProbes/pipelineInstall exist for them to read from) own the
  // canvas and second-brain state and logic now — declared here only so
  // pipelineProbes below can reach them through a thunk (they don't exist
  // yet at its construction time; same forward-reference shape as
  // windowModule/liveSessionModule above).
  let canvasCapability;
  let secondBrainCapability;

  // One task at a time, globally — see electron/run-queue.mjs. startClaudeRun
  // comes from wiring-capabilities.mjs's runExec, constructed later in this
  // function — referencing it directly here would see it before
  // initialization, so every such collaborator is called through a thunk,
  // deferred until runQueue actually dispatches a run (design.md D6: "ESM
  // circular imports resolving to undefined" is the single highest-risk step in
  // the whole split).
  const runQueue = createRunQueue({
    startRun: (run) => startClaudeRun(run),
    // Ends an active run's transport, whichever shape it has. A DEV run carries
    // its own `cancel` (the AbortController for its query); a PO turn is ended
    // through its resident session, looked up by workstream. Never touches the
    // slot itself — the slot releases when the transport settles and finalizes
    // the run (design.md D1/D2).
    cancelRun: (run) => {
      if (run.cancel) {
        run.cancel();
        return;
      }
      const state = getPoSessionState(run.workstream_id);
      if (state) cancelPoTurn(state);
    },
    emit: (event) => emitEvent(event),
    onFinalized: (run) => {
      // Discard any pending trailing activity emit so it cannot fire after
      // finalize's terminal update (the real result) and overwrite it with
      // the activity log (design.md D3 of coalesce-activity-updates). Runs
      // unconditionally: only a started run could have armed the throttle,
      // but the started_at gate below is for the announcement, not this.
      // Deferred through runStream (constructed further down this wiring
      // block) rather than a direct reference — same late-binding reason as
      // startRun/emit above.
      runStream.cancelActivityThrottle();
      // A run that never started (rejected at a gate before dispatch, e.g. a
      // missing agent) has no result worth speaking — the exact rule
      // run-queue.mjs's queued-cancel path already applies ("a queued run
      // never started, so there is no announcement to make"), generalized here.
      if (!run.started_at) return;
      announceClaudeCompletion({
        runId: run.run_id,
        task: run.task,
        status: run.status,
        output: String(run.output || "").slice(0, 2500),
      });
    },
  });

  // Role pipeline: PO (grills the request, proposes an OpenSpec change) and
  // DEV (implements the open change's tasks, headless) form the build
  // pipeline PO → DEV, gated on the `claude` binary being detected (see
  // pipelineAvailable/probePipelineAvailability below; chat-only otherwise).
  const AGENT_PREFIX = "iris-";
  const AGENT_LABELS = { po: "PO", dev: "DEV" };
  // Roles removed when the pipeline was collapsed to PO → DEV (and later when
  // STUDY was removed for the community release); their installed agent files
  // are cleaned up on install.
  const RETIRED_AGENTS = ["ba", "test", "devops", "study"];

  const sessionStoreModule = createSessionStore({
    emitEvent,
    agentLabels: AGENT_LABELS,
    announceWorkspaceUpdate: () => announceWorkspaceUpdate(),
    announceAgentSelection: (workstream) => announceAgentSelection(workstream),
    abandonPendingQuestion: (workstreamId) => PendingQuestion.abandon(workstreamId),
    abandonPendingReview: (workstreamId) => PendingReview.abandon(workstreamId),
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    getMainWindow: () => getMainWindow(),
  });
  const {
    agentRoster: AGENT_ROSTER,
    modelChoices: MODEL_CHOICES,
    getActiveId: getActiveWorkstreamId,
    resolveAgentModel,
    agentKey,
    findWorkstream,
    sessionsSnapshot,
    emitSessions,
    persistSessionStore,
    createWorkstream,
    activeWorkstream,
    selectWorkstream,
    chooseWorkstreamCwd,
    setWorkstreamAgent,
    setAgentModel,
  } = sessionStoreModule;

  // ListenMode (the object live-wiring's listenModeModule owns) doesn't
  // exist yet at this point — createLiveWiring runs later in this same
  // function, after everything below needs to be constructed. Same
  // forward-reference shape as windowModule/liveSessionModule above:
  // wiring-live.mjs calls setListenModeObject() once the real object exists,
  // only ever read here after the app is fully wired and running.
  let listenModeAccessor = { engaged: false, transitioning: false };
  function isListenModeSuppressing() {
    return listenModeAccessor.engaged || listenModeAccessor.transitioning;
  }
  function setListenModeObject(obj) {
    listenModeAccessor = obj;
  }

  const announcements = createAnnouncements({
    getLiveSession: () => getLiveSession(),
    isListenModeSuppressing: () => isListenModeSuppressing(),
    emitEvent,
    agentLabels: AGENT_LABELS,
    agentKey,
    findWorkstream,
    getActiveWorkstreamId,
    runStatus: RUN_STATUS,
  });
  const {
    notifyIris,
    fenceUntrustedText,
    drainPendingAnnouncements,
    announceAgentSelection,
    workspaceInfo,
    workspaceContextLine,
    announceWorkspaceUpdate,
    userDisplayName,
    announceClaudeCompletion,
    sendContextSupplement,
  } = announcements;

  const pipelineProbes = createPipelineProbes({
    emitEvent,
    // Deferred: canvasCapability/secondBrainCapability (constructed further
    // down this wiring block, after pipelineInstall) are the actual owners of
    // these two now — only called once the app is running, well after both
    // are assigned.
    maybeStartCanvasMcp: () => canvasCapability.maybeStartCanvasMcp(),
    checkNotesSkillsStatus: () => secondBrainCapability.checkNotesSkillsStatus(),
    // Deferred like the two above: pipelineInstall is constructed further down,
    // because it needs hasOpenSpec/openspecCommand from this module.
    irisPluginDir: () => pipelineInstall.irisPluginDir(),
  });
  const {
    getPipelineAvailable,
    claudeBinary,
    openspecCommand,
    hasOpenSpec,
    openChangesWithTasks,
    claudeWorkdir,
    checkClaudeStatus,
    probePipelineAvailability,
    checkClaudeHealth,
  } = pipelineProbes;

  const userConfig = createUserConfig({
    repoRoot,
    getIsPackaged,
    emitEvent,
    emitToRenderer,
    getLiveSession: () => getLiveSession(),
    runQueue,
    // Saving or clearing a Claude credential moves the pipeline gate, so the
    // flag has to be re-read right after. pipelineProbes is constructed further
    // up this block, but the thunk keeps this consistent with every other
    // cross-module call here.
    probePipelineAvailability: () => probePipelineAvailability(),
  });
  const {
    getPromptReviewMode,
    getFullConfig,
    writeUserConfig,
    setPromptReviewMode,
    savePoToken,
    testGeminiKey,
    previewVoice,
  } = userConfig;

  const runStream = createRunStream({
    runQueue,
    emitEvent,
    notifyIris,
    findWorkstream,
    agentKey,
    persistSessionStore,
    emitSessions,
  });
  const {
    PendingQuestion,
    rememberClaudeSessionId,
    pushActivity,
    pushToolStart,
    pushToolEnd,
    handleClaudeStreamMessage,
    askUserQuestionViaVoice,
    resolvePendingPoQuestion,
  } = runStream;

  const runDispatch = createRunDispatch({
    runQueue,
    emitEvent,
    emitToRenderer,
    notifyIris,
    findWorkstream,
    activeWorkstream,
    createWorkstream,
    setAgentModel,
    agentRoster: AGENT_ROSTER,
    agentLabels: AGENT_LABELS,
    modelChoices: MODEL_CHOICES,
    getPromptReviewMode,
    getPipelineAvailable,
    checkClaudeStatus,
    workspaceInfo,
    getUiContextSnapshot,
    resolvePendingPoQuestion,
  });
  const {
    PendingReview,
    submitClaudeTask,
    resolvePromptReview,
    executeClaudeTool,
  } = runDispatch;

  const pipelineInstall = createPipelineInstall({
    repoRoot,
    emitEvent,
    agentRoster: AGENT_ROSTER,
    agentPrefix: AGENT_PREFIX,
    agentLabels: AGENT_LABELS,
    retiredAgents: RETIRED_AGENTS,
    hasOpenSpec,
    openspecCommand,
    findWorkstream,
    getActiveWorkstreamId,
    resolveAgentModel,
  });
  const {
    resolveAgentDefinition,
    irisPluginConfig,
    legacyClaudeArtifactsStatus,
    removeLegacyClaudeArtifacts,
    ensureProjectScaffold,
    agentsSnapshot,
  } = pipelineInstall;

  // Canvas capability, second-brain capability, run-exec, and the Gemini
  // tool/prompt modules that compose each capability's contribution — see
  // wiring-capabilities.mjs (split out for the same line-count reason this
  // file was split from main.mjs). Assigned to the forward-declared
  // bindings pipelineProbes already holds a thunk to.
  const caps = createCapabilitiesWiring({
    canvasStoreFile,
    emitToRenderer,
    emitEvent,
    getMainWindow: () => getMainWindow(),
    getPipelineAvailable: () => getPipelineAvailable(),
    userDisplayName,
    dialog,
    irisPluginDir: () => pipelineInstall.irisPluginDir(),
    runQueue,
    findWorkstream,
    persistSessionStore,
    agentKey,
    resolveAgentModel,
    agentLabels: AGENT_LABELS,
    agentPrefix: AGENT_PREFIX,
    claudeWorkdir,
    claudeBinary,
    resolveAgentDefinition,
    irisPluginConfig,
    ensureProjectScaffold,
    openChangesWithTasks,
    handleClaudeStreamMessage,
    pushActivity,
    rememberClaudeSessionId,
    pushToolStart,
    pushToolEnd,
    askUserQuestionViaVoice,
    modelChoices: MODEL_CHOICES,
    envFlag,
    workspaceContextLine,
    fenceUntrustedText,
  });
  canvasCapability = caps.canvasCapability;
  secondBrainCapability = caps.secondBrainCapability;
  const { startClaudeRun, geminiTools, geminiPrompts } = caps;
  const CAPABILITIES = caps.capabilities;

  // The Live session, listening mode, and window/HUD/tray — split into
  // wiring-live.mjs for the same line-count reason this file was split from
  // main.mjs. See its header for why these three stay together in one file
  // (a genuine three-way mutual dependency).
  const live = createLiveWiring({
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
  });

  return {
    // Renderer bridge
    emitToRenderer,
    emitEvent,
    setUiContextSnapshot,
    // Window
    getMainWindow,
    getUiMode,
    createWindow: live.createWindow,
    toggleHud: live.toggleHud,
    updateTrayMenu: live.updateTrayMenu,
    createTray: live.createTray,
    hudHotkey: live.hudHotkey,
    muteHotkey: live.muteHotkey,
    listenHotkey: live.listenHotkey,
    installAppMenu: live.installAppMenu,
    setRendererSecurity: live.setRendererSecurity,
    // Live session / listening mode
    startLive: live.startLive,
    stopLive: live.stopLive,
    getLiveStatus,
    GreetGate: live.GreetGate,
    setSpeakerMuted: live.setSpeakerMuted,
    toggleListenMode: live.toggleListenMode,
    isListenModeEngaged: live.isListenModeEngaged,
    sendCommand: live.sendCommand,
    sendAudioChunk: live.sendAudioChunk,
    // Sessions / agents
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    agentsSnapshot,
    setWorkstreamAgent,
    setAgentModel,
      legacyClaudeArtifactsStatus,
    removeLegacyClaudeArtifacts,
    resolvePendingPoQuestion,
    // Config / prompt review
    getPromptReviewMode,
    setPromptReviewMode,
    resolvePromptReview,
    sendContextSupplement,
    getFullConfig,
    writeUserConfig,
    savePoToken,
    testGeminiKey,
    previewVoice,
    checkClaudeHealth,
    getPipelineAvailable,
    probePipelineAvailability,
    // Run pipeline (for shutdownTeardown)
    runQueue,
    // Capabilities
    secondBrainCapability,
    capabilities: CAPABILITIES,
  };
}
