import electron from "electron";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  closeAllPoSessions,
  getPoSessionState,
  cancelPoTurn,
} from "./po-session.mjs";
import { createRunQueue, RUN_STATUS } from "./run-queue.mjs";
import { shouldRefuseLaunch } from "./platform.mjs";
import { createCanvasStore } from "./canvas-store.mjs";
import { createCanvasMcp, buildMcpServerRecord } from "./canvas-mcp.mjs";
import { createVaultGraph } from "./vault-graph.mjs";
import { createGeminiTools } from "./gemini-tools.mjs";
import { createGeminiPrompts } from "./gemini-prompts.mjs";
import { createPipelineProbes } from "./pipeline-probes.mjs";
import { createPipelineInstall } from "./pipeline-install.mjs";
import {
  createUserConfig,
  loadEnvFile,
  envFlag,
  shutdownDeadlineMs,
} from "./user-config.mjs";
import { createRendererBridge } from "./renderer-bridge.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createAnnouncements } from "./announcements.mjs";
import { createRunDispatch } from "./run-dispatch.mjs";
import { createRunStream } from "./run-stream.mjs";
import { createRunExec } from "./run-exec.mjs";
import { installRendererSecurity } from "./renderer-security.mjs";
import { registerIpc } from "./ipc.mjs";
import { createWindowModule } from "./window.mjs";
import { createLiveSession } from "./live-session.mjs";
import { createLiveMessages } from "./live-messages.mjs";
import { createListenMode } from "./listen-mode.mjs";

const { app, BrowserWindow, nativeImage, dialog, globalShortcut } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Name the app "Iris" (menu bar / about panel). The Dock tile fully reflects this
// only in a packaged build; in dev the generic Electron bundle name is used.
app.setName("Iris");

const iconPath = path.join(repoRoot, "build", "icon.png");
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

loadEnvFile({ repoRoot });

// windowModule (constructed further down) owns mainWindow/uiMode/tray now.
let windowModule;
function getMainWindow() {
  return windowModule.getMainWindow();
}
function getUiMode() {
  return windowModule.getUiMode();
}
// liveSessionModule (constructed further down) owns liveSession/liveStatus/
// speakerMuted now.
let liveSessionModule;
function getLiveSession() {
  return liveSessionModule.getLiveSession();
}
function getLiveStatus() {
  return liveSessionModule.getLiveStatus();
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

// Background work is handled by Claude Code running headless (claude -p). Each task
// spawns one non-interactive claude process streaming NDJSON progress events.
// Sessions are USER-CONTROLLED: the user picks the active session from the UI
// (or asks by voice for a new one); Gemini cannot choose or invent session ids.
// Every task resumes the active session's Claude session (--resume), tasks run
// strictly one at a time (queued), and sessions survive app restarts.
// Drawing panel scene seam (hud-drawing-canvas): the renderer pushes the
// serialized excalidraw scene here; this is the same cache the
// canvas-claude-mcp change will read from. See design.md D5.
const CANVAS_STORE_FILE = path.join(os.homedir(), ".iris", "canvas.json");
const canvasStore = createCanvasStore({ file: CANVAS_STORE_FILE });

// canvas-claude-mcp: main→renderer image-export request/response. Keyed by a
// correlation id since preload has no invoke-based main→renderer req/resp
// primitive (design.md D3) — a plain `on`+`send` pair, with a pending-promise
// registry here and a generous cleanup timer so a request that never gets a
// reply (panel unmounted mid-flight) can't leak the map entry. canvas-mcp.mjs
// itself owns the hard timeout the get_canvas tool actually blocks on
// (DEFAULT_IMAGE_TIMEOUT_MS) — this cleanup timer is just a longer backstop.
const pendingCanvasImageRequests = new Map(); // id -> resolve
const CANVAS_IMAGE_CLEANUP_MS = 8000;

function requestCanvasImage() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    pendingCanvasImageRequests.set(id, resolve);
    emitToRenderer("canvas:request-image", { id });
    const timer = setTimeout(() => {
      if (pendingCanvasImageRequests.delete(id)) resolve(null);
    }, CANVAS_IMAGE_CLEANUP_MS);
    timer.unref?.();
  });
}

// Reply half of the main→renderer image-export request (design.md D3) —
// resolves the pending promise requestCanvasImage() created, if it hasn't
// already been cleaned up by its own timeout. Exposed to ipc.mjs so the
// registration itself never touches pendingCanvasImageRequests directly.
function resolveCanvasImageRequest(id, image) {
  const resolve = pendingCanvasImageRequests.get(id);
  if (!resolve) return;
  pendingCanvasImageRequests.delete(id);
  resolve(image ?? null);
}

// One Iris-hosted local MCP server exposing the drawing canvas to Claude
// (design.md of canvas-claude-mcp) — gated on pipelineAvailable AND
// canvasEngaged below, never started for a session that never opens the
// drawing panel.
const canvasMcp = createCanvasMcp({
  getScene: () => canvasStore.getScene(),
  setScene: (scene) => canvasStore.setScene(scene),
  flush: () => canvasStore.flush(),
  broadcastApply: (elements) => emitToRenderer("canvas:apply", { elements }),
  requestImage: () => requestCanvasImage(),
  log: (event, detail) => {
    emitEvent({ type: "log", level: "info", message: `[canvas-mcp] ${event} ${JSON.stringify(detail || {})}` });
  },
});

// Sticky per-session flag (design.md D6): set true the first time the
// drawing panel reports it was opened; never reset except by an app
// restart. Combined with pipelineAvailable, this is the sole gate on
// whether the canvas MCP is ever wired — a pure-voice session that never
// opens the canvas starts nothing.
let canvasEngaged = false;

// First-open signal for canvas-claude-mcp's sticky canvasEngaged gate
// (design.md D6) — a no-op on every subsequent open/close of the panel.
// Exposed to ipc.mjs so the registration itself never assigns the module
// binding directly.
function markCanvasEngaged() {
  canvasEngaged = true;
}

// Idempotent no-op unless BOTH gates hold; safe to call from any signal that
// might have just flipped one of them (probePipelineAvailability, and the
// drawing panel's first canvas:activate).
function maybeStartCanvasMcp() {
  if (!getPipelineAvailable() || !canvasEngaged) return;
  canvasMcp.start().catch((error) => {
    emitEvent({ type: "log", level: "warn", message: `Canvas MCP server failed to start: ${error.message}` });
  });
}

// Awaited by both run paths (§5) right before wiring a Claude run — ensures
// the server is up (starting it if this is the very first turn where both
// gates already held) and returns the Iris-scoped McpHttpServerConfig record,
// or null when the canvas MCP does not apply to this run.
async function ensureCanvasMcpForRun() {
  if (!getPipelineAvailable() || !canvasEngaged) return null;
  try {
    await canvasMcp.start();
  } catch (error) {
    emitEvent({ type: "log", level: "warn", message: `Canvas MCP unavailable for this run: ${error.message}` });
    return null;
  }
  return buildMcpServerRecord(canvasMcp.getInfo());
}


// One task at a time, globally — see electron/run-queue.mjs. startClaudeRun,
// killChild and emitEvent are today function declarations defined later in
// this file, hoisted before this line ever runs — but the split
// (split-main-process-modules design.md D6) will make each of them a `const`
// destructured from a module constructed further down this same wiring
// block (run-exec.mjs, renderer-bridge.mjs), which a direct reference here
// would see before initialization. Every collaborator that will eventually
// live in a later-constructed module is therefore called through a thunk —
// deferred until runQueue actually dispatches a run, well after the whole
// file has finished its top-to-bottom setup — rather than passed as a
// direct reference. This is the single highest-risk step in the split
// (design.md Risks: "ESM circular imports resolving to undefined").
const runQueue = createRunQueue({
  startRun: (run) => startClaudeRun(run),
  killChild: (child, signal) => killChild(child, signal),
  // Routes stop() on an active PO turn (no child process to signal) by
  // workstream — a no-op if no live session exists for it. Never touches the
  // slot itself; the slot releases when startPoRun's settle handler finalizes
  // the run, exactly like the DEV kill-signal branch (design.md D1/D2).
  cancelRun: (run) => {
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
    // startRun/killChild/emit above.
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

// Role pipeline: each role is a Claude Code agent installed at
// ~/.claude/agents/iris-<role>.md and run headless via `claude --agent`. Two
// roles: PO (BA/PM/PO thinking before code — analysis, PRD, issues) and DEV
// (implements one issue at a time and verifies it itself) form the build
// pipeline PO → DEV. Moving from PO to DEV is a "gate"; context crosses the
// gate through the OpenSpec change in the project, never a shared Claude
// conversation. Interactive product thinking lives in Iris (voice), not here:
// the headless DEV receives decided briefs; PO may pause to ask by voice.
// The pipeline is available only when the `claude` binary is detected — see
// pipelineAvailable/probePipelineAvailability below (chat-only otherwise).
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

const announcements = createAnnouncements({
  getLiveSession: () => getLiveSession(),
  isListenModeSuppressing: () => ListenMode.engaged || ListenMode.transitioning,
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
  maybeStartCanvasMcp,
  checkNotesSkillsStatus,
  // Deferred: pipeline-install.mjs (constructed below, after this module,
  // because it in turn needs hasOpenSpec/openspecBinary from this one) owns
  // globalAgentsDir. Only called once the app is running, by which point
  // pipelineInstall is assigned — never at construction time.
  globalAgentsDir: () => pipelineInstall.globalAgentsDir(),
  agentRoster: AGENT_ROSTER,
  agentPrefix: AGENT_PREFIX,
});
const {
  getPipelineAvailable,
  claudeBinary,
  openspecBinary,
  hasOpenSpec,
  openChangesWithTasks,
  claudeWorkdir,
  checkClaudeStatus,
  probePipelineAvailability,
  checkClaudeHealth,
} = pipelineProbes;

const userConfig = createUserConfig({
  repoRoot,
  getIsPackaged: () => app.isPackaged,
  emitEvent,
  emitToRenderer,
  getLiveSession: () => getLiveSession(),
  runQueue,
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
  handleClaudeStreamEvent,
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
  openspecBinary,
  findWorkstream,
  getActiveWorkstreamId,
  resolveAgentModel,
});
const {
  installedAgentFile,
  skillsSourceDir,
  installIrisAgents,
  installPipelinePrereqs,
  ensureProjectScaffold,
  agentsSnapshot,
} = pipelineInstall;


// Personal-knowledge-notes capability (see openspec/changes/llm-wiki/):
// the LLM-Wiki vault is pinned to this fixed, user-level path, independent of
// any workstream's project cwd — plain-Claude runs only, never PO/DEV.
const NOTES_VAULT_DIR = path.join(os.homedir(), "iris-second-brain");

// isUserNote (in vault-graph-parse.mjs) is the single
// authoritative "what is a user note" predicate for this capability (design.md
// D3/H-1 of second-brain-galaxy-view) — it excludes the LLM-Wiki system files
// (index.md, log.md, wiki-config.md, wiki-schema.md) and plumbing folders
// (templates/, raw/, archive/, ingested/). Reading excludes from
// wiki-config.md's own frontmatter is insufficient: renderNotesVaultConfig
// (below) writes `blacklist: []`, and the template's `index_excludes` never
// lists index.md/log.md themselves. It lives in vault-graph-parse.mjs (pure,
// no fs/IPC) rather than here so vault-graph.mjs can consume it without
// importing this Electron entry module; main.mjs re-uses the same function
// rather than re-deriving the list.

// The 6 vendored skill names this capability needs installed in
// ~/.claude/skills before Claude actually has LLM-Wiki instructions to follow
// (they are deliberately NOT in REQUIRED_SKILLS — that list gates the
// PO/DEV pipeline, not Talk-mode notes; see checkSkillsStatus()). Vault
// creation (ensureNotesVaultReady, below) and skill installation
// (installPipelinePrereqs, via the SetupPanel's "Install missing" button) are
// two independent actions on two different schedules — the vault can exist
// before the skills are ever installed. Without this check, the
// append-system-prompt directive would tell Claude to "use the wiki skills"
// that aren't actually there, and Claude would either invent an ungoverned
// note format or hallucinate the skill's behavior instead of doing the real
// LLM-Wiki workflow.
const NOTES_SKILLS = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];

// Same presence-only shape as checkSkillsStatus()/checkAgentsStatus() — used
// both to gate the append-system-prompt directive (startDevRun, below) and to
// surface a status row in the SetupPanel (checkClaudeHealth), so the user has
// a visible signal for whether the notes capability is actually installed,
// not just whether the vault directory happens to exist.
function checkNotesSkillsStatus() {
  const skillsDir = path.join(os.homedir(), ".claude", "skills");
  const missing = NOTES_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
  return { ok: missing.length === 0, missing, skillsDir };
}

// Ensures the vault directory exists and, on first use, pre-seeds
// wiki-config.md + wiki-schema.md from the vendored wiki-config skill's own
// bundled templates. Without this, the operational wiki skills' "Config
// Discovery" step finds no config on a genuinely first-ever run and ends the
// turn asking the user to run an interactive /wiki-config setup — a question
// a one-shot `claude -p` run has no way to answer (design.md D5 of the
// llm-wiki change). Idempotent: never overwrites either file once present, so
// user edits or a missing bundle (skillsSourceDir() unresolved) are safe —
// the directory still gets created either way.
function ensureNotesVaultReady() {
  try {
    fs.mkdirSync(NOTES_VAULT_DIR, { recursive: true });
  } catch (error) {
    emitEvent({ type: "log", level: "warn", message: `Could not create notes vault at ${NOTES_VAULT_DIR}: ${error.message}` });
    return;
  }

  const configTarget = path.join(NOTES_VAULT_DIR, "wiki-config.md");
  const schemaTarget = path.join(NOTES_VAULT_DIR, "wiki-schema.md");
  if (fs.existsSync(configTarget) && fs.existsSync(schemaTarget)) return;

  const skillsRoot = skillsSourceDir();
  if (!skillsRoot) return; // bundle not present (e.g. unpackaged dev checkout) — directory alone is still created above
  const assetsDir = path.join(skillsRoot, "claude-skills", "wiki-config", "assets");

  try {
    if (!fs.existsSync(schemaTarget)) {
      const schemaSource = path.join(assetsDir, "wiki-schema.md");
      if (fs.existsSync(schemaSource)) fs.copyFileSync(schemaSource, schemaTarget);
    }
    if (!fs.existsSync(configTarget)) {
      const configSource = path.join(assetsDir, "wiki-config-template.md");
      if (fs.existsSync(configSource)) {
        fs.writeFileSync(configTarget, renderNotesVaultConfig(fs.readFileSync(configSource, "utf8")));
      }
    }
  } catch (error) {
    emitEvent({ type: "log", level: "warn", message: `Could not pre-seed notes vault config: ${error.message}` });
  }
}

// Adapts the vendored wiki-config template's frontmatter for this
// single-purpose, macOS-only vault (design.md D5): the template ships
// `blacklist` as placeholder prose ("Folder(s) where the wiki should not
// write"), not real folder names — wiki-config's own Validate step flags
// leftover placeholder text, and since nothing but wiki content ever lives
// under ~/iris-second-brain, an empty list is the correct config, not a stub.
// `index_excludes`/`templates_folder` ship with the template's Windows-style
// trailing backslash; this app is macOS-only, so those become forward
// slashes. Everything else (ingested_folder, ingested_subdirs, log_format,
// and all prose below the frontmatter) is left exactly as vendored.
function renderNotesVaultConfig(templateText) {
  const match = templateText.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return templateText; // unexpected shape — copy verbatim rather than risk corrupting it
  const [, frontmatter, body] = match;
  const adapted = frontmatter
    .replace(/^blacklist:\n(?:  - .*\n)+/m, "blacklist: []\n")
    .replace(/^(\s*- (?:raw|archive|ingested))\\$/gm, "$1/")
    .replace(/^templates_folder: templates\\$/m, "templates_folder: templates/");
  return `---\n${adapted}\n---\n${body}`;
}

// Loose heuristic for the vault-write backstop below — matches common
// English/Vietnamese phrasing for "save/capture a note" (mirrors the example
// utterances in specs/personal-knowledge-notes/spec.md). False negatives just
// mean the backstop caveat isn't appended (same as before this capability
// existed); false positives are harmless (the caveat only fires when nothing
// in the vault changed, so a request that never intended to write there
// stays silent).
const NOTE_CAPTURE_HINT_RE = /ghi ch[uú]|note (it |this )?down|jot down|save (a |this )?note|second[- ]brain/i;

// True if any file under the notes vault has an mtime at/after `sinceMs`.
// Cheap, best-effort backstop — not a guarantee (a write racing the scan, or
// one outside the vault entirely, can still be missed or misreported).
function vaultChangedSince(sinceMs) {
  const stack = [NOTES_VAULT_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        if (fs.statSync(full).mtimeMs >= sinceMs) return true;
      } catch {
        // file removed mid-scan — ignore
      }
    }
  }
  return false;
}

// Second-brain galaxy view (second-brain-galaxy-view): reads the same
// NOTES_VAULT_DIR the notes capability writes, purely for viewing — never
// creates or writes to the vault. Module-level singleton, like canvasStore,
// so its watcher/cache lifecycle survives window recreation.
const notesVaultGraph = createVaultGraph({ dir: NOTES_VAULT_DIR });
// Dedicated channel for the (potentially large) full graph payload, kept out
// of the sidecar:event log stream (design.md D3/L2). Only fires while the
// watcher is actually running (start()'d), so this subscription is safe to
// hold for the module's whole lifetime rather than churning per toggle.
notesVaultGraph.onUpdate((graph) => emitToRenderer("secondbrain:graph-updated", graph));

// Gated purely on the vault existing, independent of pipelineAvailable
// (design.md D7) — viewing only reads local markdown. Modeled exactly on
// probePipelineAvailability's single-mutation-choke-point shape: tracks the
// last-emitted value and only emits on a real false<->true transition, never
// on every ensureNotesVaultReady() call (which runs on every plain-Claude
// turn and would otherwise fire constantly).
let secondBrainAvailable = false;
function probeSecondBrainAvailability() {
  const next = fs.existsSync(NOTES_VAULT_DIR);
  if (next !== secondBrainAvailable) {
    secondBrainAvailable = next;
    emitEvent({ type: "secondbrain_availability", available: secondBrainAvailable });
    // The vault disappeared out from under an active watch (e.g. deleted
    // while the galaxy was open) — stop rather than let fs.watch spin on a
    // now-missing directory.
    if (!secondBrainAvailable) notesVaultGraph.stop();
  }
  return secondBrainAvailable;
}

const runExec = createRunExec({
  runQueue,
  emitEvent,
  findWorkstream,
  persistSessionStore,
  agentKey,
  resolveAgentModel,
  agentLabels: AGENT_LABELS,
  agentPrefix: AGENT_PREFIX,
  claudeWorkdir,
  claudeBinary,
  installedAgentFile,
  ensureProjectScaffold,
  openChangesWithTasks,
  ensureCanvasMcpForRun,
  ensureNotesVaultReady,
  checkNotesSkillsStatus,
  notesVaultDir: NOTES_VAULT_DIR,
  noteCaptureHintRe: NOTE_CAPTURE_HINT_RE,
  vaultChangedSince,
  handleClaudeStreamEvent,
  pushActivity,
  rememberClaudeSessionId,
  pushToolStart,
  pushToolEnd,
  askUserQuestionViaVoice,
});
const { killChild, startClaudeRun } = runExec;



const geminiTools = createGeminiTools({
  getPipelineAvailable: () => getPipelineAvailable(),
  modelChoices: MODEL_CHOICES,
  envFlag,
});

const geminiPrompts = createGeminiPrompts({
  getPipelineAvailable: () => getPipelineAvailable(),
  modelChoices: MODEL_CHOICES,
  envFlag,
  userDisplayName,
  workspaceContextLine,
  checkNotesSkillsStatus,
  fenceUntrustedText,
});


// listenModeModule, liveMessages, and liveSessionModule form a three-way
// mutual dependency (listen-mode needs live-session's connect/schedule/
// getters; live-session and live-messages need listen-mode's ListenMode
// object and transition functions; live-messages and live-session need each
// other's handleLiveMessage/getLiveSession). Constructed in this order —
// listen-mode first, with thunks deferring to liveSessionModule (assigned
// later, only ever called at runtime) — so every direct (non-thunked)
// reference always points at an already-constructed module.
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
  submitClaudeTask,
  // Deferred: windowModule (constructed further down this wiring block,
  // after liveSessionModule) owns updateTrayMenu. Only called once the app
  // is running, well after windowModule is assigned.
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

// rendererSecurity (installed inside app.whenReady() below) owns
// APP_DEV_URL/isAppOwnDocument now; assigned before createWindow() is ever
// called, which is the only thing here that reads it.
let rendererSecurity;

windowModule = createWindowModule({
  repoRoot,
  appIcon,
  iconPath,
  getAppDevUrl: () => rendererSecurity.appDevUrl,
  envFlag,
  emitToRenderer,
  stopVaultGraphWatch: () => notesVaultGraph.stop(),
  probeSecondBrainAvailability: () => probeSecondBrainAvailability(),
  getLiveStatus: () => getLiveStatus(),
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

app.whenReady().then(() => {
  if (shouldRefuseLaunch(process.platform, process.env)) {
    dialog.showMessageBoxSync({
      type: "error",
      title: "Unsupported platform",
      message: "Iris only supports macOS.",
    });
    app.quit();
    return;
  }

  if (appIcon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }
  installAppMenu();

  // Fire-and-forget so app startup isn't blocked on the CLI probe; the
  // pipeline_availability sidecar event (see probePipelineAvailability)
  // updates the renderer whenever this resolves, and connectLive() re-probes
  // before the Gemini session that actually consumes the value is built.
  probePipelineAvailability().catch(() => {});
  // Cheap synchronous existsSync check — establishes the initial value so
  // the boot-time secondbrain:availability read (below) isn't just the
  // `false` default before the toggle has ever been checked.
  probeSecondBrainAvailability();

  // Renderer content security (renderer-content-security capability, design.md
  // D9/D10 of harden-security-boundaries): navigation containment and
  // device-permission scoping. MUST run before createWindow() below —
  // reversing this ordering fails silently: a "web-contents-created" handler
  // registered after a window is created never fires for that window,
  // leaving the app's only window with no navigation containment and no
  // error, no failing test, no log line (split-main-process-modules D7).
  rendererSecurity = installRendererSecurity({ repoRoot });

  // The renderer↔main IPC channel surface (design.md D3): every
  // ipcMain.handle/on registration lives in ipc.mjs, and only there — this
  // call marshals no arguments itself, it just wires the domain modules
  // constructed above into that module's injected deps.
  registerIpc({
    getMainWindow,
    getUiMode,
    toggleHud,
    updateTrayMenu,
    startLive,
    stopLive,
    getLiveStatus,
    greetGateFire: () => GreetGate.fire(),
    setSpeakerMuted,
    toggleListenMode,
    isListenModeEngaged: () => ListenMode.engaged,
    sendCommand,
    sendAudioChunk,
    sessionsSnapshot,
    selectWorkstream,
    createWorkstream,
    chooseWorkstreamCwd,
    agentsSnapshot,
    setWorkstreamAgent,
    setAgentModel,
    installIrisAgents,
    installPipelinePrereqs,
    resolvePendingPoQuestion,
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
    setUiContextSnapshot,
    markCanvasEngaged,
    maybeStartCanvasMcp,
    resolveCanvasImageRequest,
    canvasStore,
    probeSecondBrainAvailability,
    notesVaultGraph,
    notesVaultDir: NOTES_VAULT_DIR,
  });

  createWindow();
  createTray();
  const registered = globalShortcut.register(hudHotkey(), () => {
    toggleHud();
    updateTrayMenu();
  });
  if (!registered) {
    emitEvent({ type: "log", level: "error", message: `Could not register HUD hotkey ${hudHotkey()}.` });
  }
  const muteRegistered = globalShortcut.register(muteHotkey(), () => {
    emitToRenderer("iris:mute-toggle", {});
  });
  if (!muteRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register mute hotkey ${muteHotkey()}.` });
  }
  // Calls main's toggle directly, not emitToRenderer (design.md Decision
  // 11) — a modifier+key accelerator, not a media key, so no Accessibility
  // or Input Monitoring grant is involved. No unregistration code needed:
  // will-quit already calls globalShortcut.unregisterAll().
  const listenRegistered = globalShortcut.register(listenHotkey(), () => {
    toggleListenMode();
  });
  if (!listenRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register listening-mode hotkey ${listenHotkey()}.` });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Awaited teardown for app quit (design.md D3 of bound-shutdown-teardown):
// closes the Gemini Live socket, group-kills every live DEV child so no tool
// subprocess is orphaned, then closes every resident PO session. run-queue.mjs
// owns the runs map, so children are reached directly via list() rather than
// mutating run.status from outside the module.
async function shutdownTeardown() {
  await stopLive();
  for (const run of runQueue.list()) {
    if (run.child) killChild(run.child, "SIGTERM");
  }
  await closeAllPoSessions();
  // A quit-while-drawing shouldn't lose recent strokes (hud-drawing-canvas
  // design.md D5 "Flush").
  await canvasStore.flush().catch(() => {});
  // Stop the canvas MCP listener (canvas-claude-mcp design.md D6) — a no-op
  // if it was never started this session.
  await canvasMcp.stop().catch(() => {});
  // Tear down the vault-graph watcher, if it was running (second-brain-galaxy-view design.md D3).
  notesVaultGraph.stop();
}

app.on("will-quit", () => globalShortcut.unregisterAll());
let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return; // re-entrant quit signal — teardown already in flight
  shuttingDown = true;
  event.preventDefault();
  const deadline = new Promise((resolve) => {
    const timer = setTimeout(resolve, shutdownDeadlineMs());
    timer.unref?.();
  });
  Promise.race([shutdownTeardown(), deadline]).finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
