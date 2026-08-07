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
import { createRunQueue, RUN_STATUS } from "./run-queue.mjs";
import { getPoSessionState } from "./po-session.mjs";
import { projectState } from "./verbs.mjs";
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
 *   openPathExternally?: (filePath: string) => Promise<any>,
 *   getIsPackaged: () => boolean,
 * }} deps
 */
export function createWiring({ repoRoot, appIcon, iconPath, canvasStoreFile, envFlag, dialog, openPathExternally, getIsPackaged }) {
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

  const rendererBridge = createRendererBridge({
    getMainWindow: () => getMainWindow(),
    // Read at flush time, long after liveSessionModule is assigned below.
    isOverheard: () => Boolean(liveSessionModule?.getListenOnlyEngaged()),
  });
  const {
    emitToRenderer,
    emitEvent,
    flushTranscripts,
    appendUserTranscript,
    appendModelTranscript,
    getRecentUtterances,
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
    // One path for both lifetimes: run-exec gives every run a `cancel`, whether
    // it is a one-shot DEV query (abort its controller) or a PO turn inside a
    // resident session (interrupt the turn, keep the session). Nothing here
    // needs to know which. Never touches the slot itself — the slot releases
    // when the transport settles and finalizes the run (design.md D1/D2).
    cancelRun: (run) => run.cancel?.(),
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
      // Every finished run is recorded in the second brain before anything is
      // announced (design.md D5). A plain file append: no run, no tokens, no
      // execution slot, and it happens for failures on the same terms as
      // successes. Deliberately NOT gated on started_at's sibling checks below —
      // wait, it is: a run rejected before it started has nothing to record
      // beyond the rejection, and the announcement gate above already filters
      // those out for exactly that reason.
      secondBrainCapability?.captureRunOutcome?.(run);
      // open-note-session 5.1: work_on_note's result is read back AS WRITTEN,
      // never through announceClaudeCompletion's 1-3 sentence summary
      // instruction — scoped to this one verb, not a general switch.
      if (run.verb === "work_on_note") {
        announceNoteWorkingResult({
          runId: run.run_id,
          task: run.task,
          status: run.status,
          output: String(run.output || "").slice(0, 8000),
          usage: run.usage ?? null,
        });
        return;
      }
      announceClaudeCompletion({
        runId: run.run_id,
        task: run.task,
        status: run.status,
        output: String(run.output || "").slice(0, 2500),
        verb: run.verb ?? null,
        usage: run.usage ?? null,
        decisions: run.decisions ?? null,
      });
    },
  });

  // The project-local persona override still lives at
  // <cwd>/.claude/agents/iris-<base>.md, so the prefix stays even though the
  // bundled personas dropped it. Everything gated on the `claude` binary being
  // detected (see pipelineAvailable/probePipelineAvailability below; chat-only
  // otherwise).
  const AGENT_PREFIX = "iris-";
  // Personas an older Iris installed into the user's ~/.claude — including the
  // PO/DEV pair this change replaced. Cleaned up on request, never silently.
  const RETIRED_AGENTS = ["ba", "test", "devops", "study", "po", "dev"];

  const sessionStoreModule = createSessionStore({
    emitEvent,
    announceWorkspaceUpdate: () => announceWorkspaceUpdate(),
    abandonPendingQuestion: (workstreamId) => PendingQuestion.abandon(workstreamId),
    abandonPendingReview: (workstreamId) => PendingReview.abandon(workstreamId),
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    getMainWindow: () => getMainWindow(),
  });
  const {
    modelChoices: MODEL_CHOICES,
    getActiveId: getActiveWorkstreamId,
    resolveVerbModel,
    sessionKeyFor,
    findWorkstream,
    sessionsSnapshot,
    emitSessions,
    persistSessionStore,
    createWorkstream,
    activeWorkstream,
    selectWorkstream,
    chooseWorkstreamCwd,
    rememberVerbUsed,
    setVerbModel,
  } = sessionStoreModule;

  const announcements = createAnnouncements({
    getLiveSession: () => getLiveSession(),
    emitEvent,
    findWorkstream,
    getActiveWorkstreamId,
    runStatus: RUN_STATUS,
  });
  const {
    notifyIris,
    drainPendingAnnouncements,
    workspaceInfo,
    workspaceContextLine,
    announceWorkspaceUpdate,
    userDisplayName,
    announceClaudeCompletion,
    announceNoteWorkingResult,
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
    sessionKeyFor,
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
    setVerbModel,
    modelChoices: MODEL_CHOICES,
    getPromptReviewMode,
    getPipelineAvailable,
    checkClaudeStatus,
    workspaceInfo,
    // The state `execute` forks on and Iris reads before choosing a verb.
    // pipelineProbes is constructed above; the thunk keeps this consistent with
    // every other cross-module call in this block.
    projectStateFor: (workstream) => projectState(workstream?.cwd ? openChangesWithTasks(workstream.cwd) : []),
    // Phase scoping for the review gate (design.md D6): a stateful verb parks
    // only on the call that OPENS its resident session.
    hasLiveStatefulSession: (workstreamId) => Boolean(getPoSessionState(workstreamId)),
    getUiContextSnapshot,
    resolvePendingPoQuestion,
    // secondBrainCapability is constructed further down (see the forward
    // declaration above) — same thunk-through-a-closure shape as
    // checkNotesSkillsStatus/ensureNotesVaultReady elsewhere in this file, since
    // this tool can only actually be called once the live session is up, long
    // after wiring finishes.
    captureNote: (args) => secondBrainCapability.captureNote(args),
    mutateVaultNotes: (args) => secondBrainCapability.mutateVaultNotes(args),
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
    agentPrefix: AGENT_PREFIX,
    retiredAgents: RETIRED_AGENTS,
    hasOpenSpec,
    openspecCommand,
    findWorkstream,
    getActiveWorkstreamId,
    resolveVerbModel,
  });
  const {
    resolveAgentDefinition,
    irisPluginConfig,
    legacyClaudeArtifactsStatus,
    removeLegacyClaudeArtifacts,
    ensureProjectScaffold,
    verbsSnapshot,
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
    notifyIris,
    getMainWindow: () => getMainWindow(),
    getPipelineAvailable: () => getPipelineAvailable(),
    userDisplayName,
    dialog,
    openPathExternally,
    irisPluginDir: () => pipelineInstall.irisPluginDir(),
    runQueue,
    findWorkstream,
    persistSessionStore,
    sessionKeyFor,
    resolveVerbModel,
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
    // Read through the same forward-reference thunk every other liveSessionModule
    // consumer uses — wiring-live.mjs registers it further down this function.
    getLiveStatus: () => getLiveStatus(),
    recentUtterances: () => getRecentUtterances(),
    modelChoices: MODEL_CHOICES,
    envFlag,
    workspaceContextLine,
  });
  canvasCapability = caps.canvasCapability;
  secondBrainCapability = caps.secondBrainCapability;
  const { startClaudeRun, geminiTools, geminiPrompts } = caps;
  const CAPABILITIES = caps.capabilities;

  // The Live session and window/HUD/tray — split into wiring-live.mjs for
  // the same line-count reason this file was split from main.mjs. See its
  // header for why these two stay together in one file (a mutual
  // dependency).
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
    listenHotkey: live.listenHotkey,
    wakeHotkey: live.wakeHotkey,
    sleepHotkey: live.sleepHotkey,
    requestWake: live.requestWake,
    requestSleep: live.requestSleep,
    notifyWakeReady: live.notifyWakeReady,
    installAppMenu: live.installAppMenu,
    setRendererSecurity: live.setRendererSecurity,
    // Live session / listen-only mode
    startLive: live.startLive,
    stopLive: live.stopLive,
    getLiveStatus,
    GreetGate: live.GreetGate,
    toggleListenOnly: live.toggleListenOnly,
    isListenOnlyEngaged: live.isListenOnlyEngaged,
    listenOnlyStatePayload: live.listenOnlyStatePayload,
    handleSystemAudioUnavailable: live.handleSystemAudioUnavailable,
    sendCommand: live.sendCommand,
    sendAudioChunk: live.sendAudioChunk,
    // Sessions / agents
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    verbsSnapshot,
    rememberVerbUsed,
    setVerbModel,
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
