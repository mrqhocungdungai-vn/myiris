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
 *   getMainWindow: () => any,
 *   getPipelineAvailable: () => boolean,
 *   userDisplayName: () => string,
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
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
 *   recentUtterances: () => Array<{ text: string, at: number }>,
 *   modelChoices: Array<{ id: string, label: string }>,
 *   envFlag: (name: string, fallback?: boolean) => boolean,
 *   workspaceContextLine: () => string,
 *   fenceUntrustedText: (text: string, label: string) => string,
 * }} deps
 */
export function createCapabilitiesWiring({
  canvasStoreFile,
  emitToRenderer,
  emitEvent,
  getMainWindow,
  getPipelineAvailable,
  userDisplayName,
  dialog,
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
  recentUtterances,
  modelChoices,
  envFlag,
  workspaceContextLine,
  fenceUntrustedText,
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
    irisPluginDir,
    userDisplayName,
    getPipelineAvailable,
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
    handleClaudeStreamMessage,
    pushActivity,
    rememberClaudeSessionId,
    pushToolStart,
    pushToolEnd,
    askUserQuestionViaVoice,
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
    fenceUntrustedText,
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
