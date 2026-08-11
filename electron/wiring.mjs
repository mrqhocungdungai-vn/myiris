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
import { getStatefulSessionState, hasUsedStatefulSession } from "./stateful-session.mjs";
import { isVerb, projectState, resolveVerb } from "./verbs.mjs";
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
 *   recordLog?: (record: { level: string, src: string, msg: string, [key: string]: any }) => void,
 * }} deps
 */
export function createWiring({ repoRoot, appIcon, iconPath, canvasStoreFile, envFlag, dialog, openPathExternally, getIsPackaged, recordLog }) {
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
    // diagnostic-logging: the event stream's tap, handed down from the
    // composition root. A no-op by default there, so nothing here has to know
    // whether logging is on.
    recordLog,
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
    markListenWindowEnded,
    getListenWindowEndedAt,
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
  // Same forward reference, for the same reason: runDispatch below needs the
  // prepared-answer lookup, and this capability is constructed with the others.
  let preparedAnswersCapability;
  // And again, for the token account: runQueue's onFinalized below records
  // every finished run's tokens through it, and the Live wiring further down
  // hands its Gemini recorder to the message handler (token-accounting).
  let tokenUsageCapability;

  // One task at a time, globally — see electron/run-queue.mjs. startClaudeRun
  // comes from wiring-capabilities.mjs's runExec, constructed later in this
  // function — referencing it directly here would see it before
  // initialization, so every such collaborator is called through a thunk,
  // deferred until runQueue actually dispatches a run (design.md D6: "ESM
  // circular imports resolving to undefined" is the single highest-risk step in
  // the whole split).
  const runQueue = createRunQueue({
    startRun: (run) => startClaudeRun(run),
    // Ends an active run's transport, whichever shape it has. A stateless run carries
    // its own `cancel` (the AbortController for its query); a stateful turn is ended
    // through its resident session, looked up by workstream. Never touches the
    // slot itself — the slot releases when the transport settles and finalizes
    // the run (design.md D1/D2).
    // One path for both lifetimes: run-exec gives every run a `cancel`, whether
    // it is a one-shot query (abort its controller) or a stateful turn inside a
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
      runStream.cancelActivityThrottle(run);
      // token-accounting: this run's tokens, counted once. `onFinalized` is
      // the seam precisely because it is documented as firing once per run
      // after a terminal update, and `run.usage` is set by then on both the
      // one-shot and resident paths — hooking the two assignment sites would
      // invite divergence, and hooking toUpdateEvent would double-count,
      // since that projection re-emits `run.usage` on every later event
      // (design D4).
      //
      // Unconditional, and deliberately ABOVE the started_at gate: a run that
      // never started has no usage and this is a no-op, whereas placing it
      // below would silently skip nothing today and something tomorrow.
      // Counted whatever the terminal status is — a `limited`, `unanswered`
      // or `failed` run spent tokens too. Through the same thunk shape as
      // startRun/emit above: caps is constructed further down this function.
      tokenUsageCapability?.recordClaudeRun?.(run);
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
      // How a result is spoken is declared by the verb, not decided here. This
      // was `run.verb === "work_on_note"` — a verb defined in a second place,
      // which is the duplication the registry exists to prevent, and which is
      // exactly what would have gone wrong when the canvas conversation needed
      // the same treatment for its own reasons.
      if (isVerb(run.verb) && resolveVerb(run.verb).spokenResult === "verbatim") {
        announceVerbatimResult({
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
    announceVerbatimResult,
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
    // token-accounting: the voice preview's throwaway Live session spends real
    // tokens and is counted through the same recorder (design D3). Through a
    // thunk — caps is constructed well below this call.
    recordGeminiUsage: (usageMetadata) => tokenUsageCapability?.recordGeminiUsage?.(usageMetadata),
  });
  const {
    getPromptReviewMode,
    getFullConfig,
    writeUserConfig,
    setPromptReviewMode,
    saveClaudeToken,
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
    speakWorkingText,
    pushToolStart,
    pushToolEnd,
    handleClaudeStreamMessage,
    askUserQuestionViaVoice,
    resolvePendingClaudeQuestion,
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
    // "Has the user got a conversation open", not "does a transport exist".
    // A session warmed when the canvas opened is live and resumable but has
    // had no turn: the review gate must still park on the first sentence, and
    // the voice layer must not be told a shaping conversation is under way
    // before one is.
    hasLiveStatefulSession: (workstreamId) => hasUsedStatefulSession(workstreamId),
    // Mechanics, not consent: a warmed session counts here, because a turn can
    // be delivered into it without starting a job.
    hasResidentSession: (workstreamId) => Boolean(getStatefulSessionState(workstreamId)),
    getUiContextSnapshot,
    resolvePendingClaudeQuestion,
    // secondBrainCapability is constructed further down (see the forward
    // declaration above) — same thunk-through-a-closure shape as
    // checkNotesSkillsStatus/ensureNotesVaultReady elsewhere in this file, since
    // this tool can only actually be called once the live session is up, long
    // after wiring finishes.
    captureNote: (args) => secondBrainCapability.captureNote(args),
    findNoteByName: (args) => secondBrainCapability.findNoteByName(args),
    mutateVaultNotes: (args) => secondBrainCapability.mutateVaultNotes(args),
    findPreparedAnswer: (args) => preparedAnswersCapability.findPreparedAnswer(args),
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
    activeWorkstream,
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
    speakWorkingText,
    rememberClaudeSessionId,
    pushToolStart,
    pushToolEnd,
    askUserQuestionViaVoice,
    // Read through the same forward-reference thunk every other liveSessionModule
    // consumer uses — wiring-live.mjs registers it further down this function.
    getLiveStatus: () => getLiveStatus(),
    isListenOnlyEngaged: () => Boolean(liveSessionModule?.getListenOnlyEngaged()),
    recentUtterances: () => getRecentUtterances(),
    listenWindowEndedAt: () => getListenWindowEndedAt(),
    modelChoices: MODEL_CHOICES,
    envFlag,
    workspaceContextLine,
    // The folder the prepared-answer lookup searches, taken from the one place
    // that already decides what "the folder we are working in" means — so the
    // folder Iris searches is exactly the folder get_workspace_info names, down
    // to the existence check (design D1).
    openFolder: () => workspaceInfo().project_folder,
  });
  canvasCapability = caps.canvasCapability;
  secondBrainCapability = caps.secondBrainCapability;
  preparedAnswersCapability = caps.preparedAnswersCapability;
  tokenUsageCapability = caps.tokenUsageCapability;
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
    // diagnostic-logging: reaches the window module, where the renderer's own
    // faults are captured.
    recordLog,
    emitEvent,
    emitToRenderer,
    flushTranscripts,
    markListenWindowEnded,
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
    // token-accounting: no thunk needed here — caps is constructed above this
    // call, unlike the runQueue seam further up.
    recordGeminiUsage: (usageMetadata) => tokenUsageCapability.recordGeminiUsage(usageMetadata),
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
    resolvePendingClaudeQuestion,
    // Config / prompt review
    getPromptReviewMode,
    setPromptReviewMode,
    resolvePromptReview,
    sendContextSupplement,
    getFullConfig,
    writeUserConfig,
    saveClaudeToken,
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
