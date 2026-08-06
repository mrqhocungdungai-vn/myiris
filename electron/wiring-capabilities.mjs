// A further slice of the composition root's wiring — split out of
// wiring.mjs purely because the whole wiring block together exceeded the
// 450-line ceiling once every module existed (design.md's Risks section
// explicitly permits this kind of extraction). This slice wires the canvas
// and second-brain capabilities, the run-execution module they feed into
// (ensureCanvasMcpForRun/ensureNotesVaultReady are run-exec's own gates),
// and the Gemini tool/prompt modules that compose each capability's
// contribution — a cohesive "capability + what consumes it" unit.
// Electron-free itself: `dialog` is received injected from wiring.mjs,
// which received it from main.mjs.
import { createRunExec } from "./run-exec.mjs";
import { createGeminiTools } from "./gemini-tools.mjs";
import { createGeminiPrompts } from "./gemini-prompts.mjs";
import { createCanvasCapability } from "./capabilities/canvas.mjs";
import { createSecondBrainCapability } from "./capabilities/second-brain.mjs";

/**
 * @param {{
 *   canvasStoreFile: string,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   emitEvent: (event: any) => void,
 *   notifyIris: (lines: string | string[], opts?: { bufferIfOffline?: boolean }) => void,
 *   getMainWindow: () => any,
 *   getPipelineAvailable: () => boolean,
 *   userDisplayName: () => string,
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
 *   openPathExternally?: (filePath: string) => Promise<any>,
 *   irisPluginDir: () => string | null,
 *   runQueue: any,
 *   findWorkstream: any,
 *   persistSessionStore: any,
 *   sessionKeyFor: any,
 *   resolveVerbModel: any,
 *   agentPrefix: string,
 *   claudeWorkdir: any,
 *   claudeBinary: any,
 *   resolveAgentDefinition: any,
 *   irisPluginConfig: any,
 *   ensureProjectScaffold: any,
 *   openChangesWithTasks: any,
 *   handleClaudeStreamMessage: any,
 *   pushActivity: any,
 *   rememberClaudeSessionId: any,
 *   pushToolStart: any,
 *   pushToolEnd: any,
 *   askUserQuestionViaVoice: any,
 *   getLiveStatus: () => { running: boolean },
 *   recentUtterances: () => Array<{ text: string, at: number }>,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   workspaceContextLine: () => string,
 * }} deps
 */
export function createCapabilitiesWiring({
  canvasStoreFile,
  emitToRenderer,
  emitEvent,
  notifyIris,
  getMainWindow,
  getPipelineAvailable,
  userDisplayName,
  dialog,
  openPathExternally,
  irisPluginDir,
  runQueue,
  findWorkstream,
  persistSessionStore,
  sessionKeyFor,
  resolveVerbModel,
  agentPrefix,
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
  getLiveStatus,
  recentUtterances,
  modelChoices,
  envFlag,
  workspaceContextLine,
}) {
  // Canvas capability (canvas-claude-mcp) and second-brain capability
  // (personal-knowledge-notes, second-brain-galaxy-view), gathered end to end
  // per design.md D10 rather than spread across the layered core modules.
  const canvasCapability = createCanvasCapability({
    canvasStoreFile,
    emitToRenderer,
    emitEvent,
    getMainWindow,
    getPipelineAvailable,
    userDisplayName,
    dialog,
  });

  const secondBrainCapability = createSecondBrainCapability({
    emitEvent,
    emitToRenderer,
    notifyIris,
    irisPluginDir,
    userDisplayName,
    getPipelineAvailable,
    // add-manual-note-editing design.md D3: Electron's `shell.openPath`,
    // injected so the capability itself stays Electron-free.
    openPathExternally,
    // Ambient session capture's flush reads the SAME ring runExec's own
    // prompt composition already reads below — no second buffer, no new
    // recording path (ambient-memory spec: "Only already-retained text is
    // captured").
    recentUtterances,
  });

  const runExec = createRunExec({
    runQueue,
    emitEvent,
    findWorkstream,
    persistSessionStore,
    sessionKeyFor,
    resolveVerbModel,
    agentPrefix,
    claudeWorkdir,
    claudeBinary,
    resolveAgentDefinition,
    irisPluginConfig,
    ensureProjectScaffold,
    openChangesWithTasks,
    ensureCanvasMcpForRun: () => canvasCapability.ensureCanvasMcpForRun(),
    ensureNotesVaultReady: () => secondBrainCapability.ensureNotesVaultReady(),
    checkNotesSkillsStatus: () => secondBrainCapability.checkNotesSkillsStatus(),
    notesVaultDir: secondBrainCapability.notesVaultDir,
    notesInboxDir: secondBrainCapability.notesInboxDir,
    recentUtterances,
    resolveFocusForPrompt: () => secondBrainCapability.resolveFocusForRun(),
    resolveOpenNoteForRun: () => secondBrainCapability.resolveOpenNoteForRun(),
    openNoteWritePath: () => secondBrainCapability.openNoteWritePath(),
    handleClaudeStreamMessage,
    pushActivity,
    rememberClaudeSessionId,
    pushToolStart,
    pushToolEnd,
    askUserQuestionViaVoice,
    // ask-when-unspecified D2/2.1: whether a question can actually reach the
    // user and be answered. The live session's own status is the existing
    // source of truth — run-exec receives it as a predicate rather than
    // learning what a live session is.
    canRelayQuestion: () => Boolean(getLiveStatus?.()?.running),
  });
  const { startClaudeRun } = runExec;

  const capabilities = [canvasCapability, secondBrainCapability];

  const geminiTools = createGeminiTools({
    getPipelineAvailable,
    modelChoices,
    envFlag,
    capabilities,
  });

  const geminiPrompts = createGeminiPrompts({
    getPipelineAvailable,
    modelChoices,
    envFlag,
    userDisplayName,
    workspaceContextLine,
    capabilities,
  });

  return {
    canvasCapability,
    secondBrainCapability,
    startClaudeRun,
    capabilities,
    geminiTools,
    geminiPrompts,
  };
}
