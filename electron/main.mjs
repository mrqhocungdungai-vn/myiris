import electron from "electron";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  poBillingStatus,
  getOrCreatePoSession,
  deliverPoTurn,
  closeAllPoSessions,
  setPoSessionModel,
  setPoSessionMcpServers,
  getPoSessionState,
  cancelPoTurn,
} from "./po-session.mjs";
import { computeWorkerEnv } from "./worker-env.mjs";
import { createRunQueue, RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";
import { shouldRefuseLaunch } from "./platform.mjs";
import { createCanvasStore } from "./canvas-store.mjs";
import { createCanvasMcp, buildMcpServerRecord } from "./canvas-mcp.mjs";
import { createVaultGraph } from "./vault-graph.mjs";
import { buildLiveConfig } from "./live-config.mjs";
import { runBoundary } from "./listen-boundary.mjs";
import { createGeminiTools } from "./gemini-tools.mjs";
import { createGeminiPrompts } from "./gemini-prompts.mjs";
import { createPipelineProbes } from "./pipeline-probes.mjs";
import { createPipelineInstall } from "./pipeline-install.mjs";
import {
  createUserConfig,
  loadEnvFile,
  envFlag,
  envNumber,
  shutdownDeadlineMs,
} from "./user-config.mjs";
import { createRendererBridge } from "./renderer-bridge.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createAnnouncements } from "./announcements.mjs";
import { createRunDispatch } from "./run-dispatch.mjs";
import { createRunStream } from "./run-stream.mjs";

const { app, BrowserWindow, ipcMain, session, nativeImage, Menu, dialog, Tray, screen, globalShortcut, shell } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Name the app "Iris" (menu bar / about panel). The Dock tile fully reflects this
// only in a packaged build; in dev the generic Electron bundle name is used.
app.setName("Iris");

const iconPath = path.join(repoRoot, "build", "icon.png");
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

loadEnvFile({ repoRoot });
logPoBillingPathOnce();

let mainWindow = null;
let liveSession = null;
let ai = null;
let liveStatus = { running: false, pid: null };
// Mirror of the renderer's speaker-mute state, reported via
// iris:speaker-mute-state — main never mutates audio, it only tracks this to
// keep the tray label accurate (see openspec/changes/speaker-mute design D4).
let speakerMuted = false;
// Gemini Live closes each WebSocket connection after ~10 minutes. With
// sessionResumption enabled the server hands us refresh handles; on close we
// reconnect with the latest handle so the conversation continues seamlessly
// instead of dropping Iris back to the "Press W to wake" sleep screen.
let resumptionHandle = null;
let userStopped = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;

// ===== Listening mode (add-listening-mode) =====
// Main is the sole owner of this state (design.md D11): the tray item and
// the global hotkey act on it directly rather than dispatching to the
// renderer, and the renderer only displays what main pushes — see the IPC
// section further down. Ephemeral per session: reset to disengaged on any
// transition to not-running (stopLive, or an unexpected onclose), and never
// persisted to configuration.
const ListenMode = {
  engaged: false,
  // Guards every entry point (renderer/tray/hotkey/rotation timer/goAway)
  // against reentrancy while an enter/exit/rotation sequence is mid-flight —
  // spec "Mode transitions are atomic". Also gates notifyIris's
  // deliverability check, since the moment right after a deliberate
  // reconnect but before the mode is marked engaged is still not a safe
  // window to inject an announcement into.
  transitioning: false,
  rotationTimer: null,
  // Set immediately before WE close the session ourselves (entering,
  // exiting, or rotating) so `onclose` can tell a deliberate close from an
  // unexpected one (design.md Decision 12) — consumed and cleared by that
  // same onclose call.
  deliberateReconnect: false,
  // True for the lifetime of a boundary's forced turn — gates suppression
  // in handleLiveMessage. Every boundary turn (rotation or exit alike) is
  // neither heard nor shown (spec "Every boundary turn is neither heard nor
  // shown").
  boundaryInFlight: false,
  // Each chunk's input transcription, kept only for the life of the
  // listening session (spec "Segment records live in process memory only").
  segmentRecord: "",
  // Set when an unexpected disconnect ends the mode while a chunk may still
  // be uncommitted — tells the next converse connect to speak a recovery
  // synthesis once it is back up (design.md Decision 10 / tasks.md 4.7).
  synthesizeOnNextConverseConnect: false,
};

function listenChunkMs() {
  return envNumber("IRIS_LISTEN_CHUNK_MS", 8 * 60 * 1000, { min: 60 * 1000, max: 30 * 60 * 1000 });
}

// Pushes state one way, main -> renderer, and never the reverse (design.md
// D11) — a renderer that reported this back would be a second writer for
// state it does not own, overwriting the authoritative value on a reload
// while a chunk was still open.
function setListenEngaged(engaged) {
  if (ListenMode.engaged === engaged) return;
  ListenMode.engaged = engaged;
  emitToRenderer("listen-mode:state", { engaged });
  updateTrayMenu();
}

function clearListenRotationTimer() {
  if (ListenMode.rotationTimer) {
    clearTimeout(ListenMode.rotationTimer);
    ListenMode.rotationTimer = null;
  }
}

function armListenRotationTimer() {
  clearListenRotationTimer();
  ListenMode.rotationTimer = setTimeout(() => {
    ListenMode.rotationTimer = null;
    runListenRotation().catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation failed: ${error.message}` });
    });
  }, listenChunkMs());
}

// Resets every piece of listening-mode state to disengaged without running
// any boundary — used when committing would accomplish nothing observable:
// sleep and app quit (tasks.md 4.6), where the resumption handle does not
// outlive the process and no synthesis could be heard anyway.
function resetListenModeSilently() {
  clearListenRotationTimer();
  ListenMode.transitioning = false;
  ListenMode.boundaryInFlight = false;
  ListenMode.deliberateReconnect = false;
  ListenMode.segmentRecord = "";
  ListenMode.synthesizeOnNextConverseConnect = false;
  setListenEngaged(false);
}

// One-shot event bus feeding the boundary sequence (listen-boundary.mjs) and
// the entry-confirmation wait: subscribing here rather than reading a cached
// value is what makes handle-freshness structural (design.md Decision 5) — a
// handle from before a boundary began was never pushed to a listener that
// didn't exist yet, so it cannot satisfy that boundary's wait.
let turnCompleteListeners = [];
let freshHandleListeners = [];
let liveCloseListeners = [];

function notifyTurnComplete() {
  const listeners = turnCompleteListeners;
  turnCompleteListeners = [];
  listeners.forEach((cb) => cb());
}
function onTurnComplete(cb) {
  turnCompleteListeners.push(cb);
  return () => {
    turnCompleteListeners = turnCompleteListeners.filter((listener) => listener !== cb);
  };
}
function notifyFreshResumptionHandle(handle) {
  const listeners = freshHandleListeners;
  freshHandleListeners = [];
  listeners.forEach((cb) => cb(handle));
}
function onFreshResumptionHandle(cb) {
  freshHandleListeners.push(cb);
  return () => {
    freshHandleListeners = freshHandleListeners.filter((listener) => listener !== cb);
  };
}
function notifyLiveClosed() {
  const listeners = liveCloseListeners;
  liveCloseListeners = [];
  listeners.forEach((cb) => cb());
}
function waitForLiveClose() {
  return new Promise((resolve) => liveCloseListeners.push(resolve));
}

// Shared by every deliberate transition (enter/exit/rotation): marks the
// close as ours so `onclose` skips the failure-reconnect path and the
// offline teardown (design.md Decision 12), then closes — or, if the
// session is already gone, resolves the close-wait directly since no
// `onclose` will fire to do it.
function closeLiveSessionDeliberately() {
  ListenMode.deliberateReconnect = true;
  if (liveSession) {
    try {
      liveSession.close();
    } catch {
      /* ignore close races */
    }
  } else {
    notifyLiveClosed();
  }
}

// The session-like driver `runBoundary` (listen-boundary.mjs) needs — a thin
// adapter over the real liveSession and the event bus above. Built fresh per
// boundary since `liveSession` may be reassigned between boundaries.
function makeBoundarySession() {
  return {
    sendActivityEnd: () => liveSession?.sendRealtimeInput({ activityEnd: {} }),
    onTurnComplete,
    onFreshResumptionHandle,
    disconnect: closeLiveSessionDeliberately,
  };
}

// Drives one turn via sendClientContent (the measured-working way to drive a
// turn under AAD-off — design.md Decision 4; NOT sendRealtimeInput({text}),
// whose behavior in this configuration is unmeasured) and resolves once it
// completes or a bounded wait elapses. Used for the entry confirmation,
// which must finish before the first activity opens (spec "The confirmation
// does not swallow the user's first words").
function driveTurnAndWaitForCompletion(text, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = onTurnComplete(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });
    liveSession?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
  });
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

const rendererBridge = createRendererBridge({ getMainWindow: () => mainWindow });
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
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
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

// Group-aware kill for a DEV subprocess (spawned `detached: true`, so it is
// its own process-group leader on POSIX) — reaches descendant tool
// subprocesses (bash, MCP servers under bypassPermissions) that a plain
// child.kill() would orphan. Injected into createRunQueue below so
// run-queue.mjs stays free of process-group/platform knowledge (design.md D1
// of bound-shutdown-teardown).
function killChild(child, signal) {
  if (!child?.pid) {
    child?.kill?.(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Group already gone (or was never formed) — fall back to the direct
    // child, mirroring the escalation path's existing tolerance of a dead
    // process.
    child.kill(signal);
  }
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
  setWorkstreamCwd,
  setWorkstreamAgent,
  setAgentModel,
} = sessionStoreModule;

const announcements = createAnnouncements({
  getLiveSession: () => liveSession,
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

async function chooseWorkstreamCwd(id) {
  const workstream = findWorkstream(id) || activeWorkstream();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the project folder Claude works in",
    defaultPath: workstream.cwd || os.homedir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { status: "cancelled", ...sessionsSnapshot() };
  }
  return setWorkstreamCwd(workstream.id, result.filePaths[0]);
}


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
  getLiveSession: () => liveSession,
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

function runProjectDir(run) {
  const projectDir = findWorkstream(run.workstream_id)?.cwd;
  if (projectDir && fs.existsSync(projectDir)) return projectDir;
  return claudeWorkdir();
}

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

// Shared preamble (cwd, install check, scaffold) then dispatches to the
// stateful PO module or the stateless DEV module — see design.md D1. This is
// the `startRun` injected into electron/run-queue.mjs's createRunQueue(), which
// owns slot acquisition and finalization; both modules finalize through the
// same runQueue.finalize() path, so they share the single "Claude does one
// thing at a time" execution slot without either one needing to know the
// other exists.
function startClaudeRun(run) {
  run.cwd = runProjectDir(run);

  // A run submitted for a role must run AS that role — falling back to plain
  // Claude would silently skip the gate the user thinks they are in.
  if (run.agent && !installedAgentFile(run.agent, run.cwd)) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      `The ${AGENT_LABELS[run.agent] ?? run.agent} agent is not installed (missing ${AGENT_PREFIX}${run.agent}.md). Click "Install agents" in the Iris session bar, then retry.`,
    );
    return;
  }

  // First role run in a fresh project: make it OpenSpec-ready (`openspec init`)
  // so the PO can propose changes and the DEV can implement their tasks.
  if (run.agent) {
    const scaffold = ensureProjectScaffold(run.cwd);
    if (scaffold.created.length) {
      emitEvent({
        type: "log",
        level: "info",
        message: `Set up ${run.cwd} for the agent pipeline: ${scaffold.created.join(", ")}.`,
      });
    }
    if (scaffold.error) {
      emitEvent({ type: "log", level: "warn", message: `Project setup incomplete (${scaffold.error}) — the run continues anyway.` });
    }
  }

  // DEV runs only against an open OpenSpec change with unchecked tasks (see the
  // po-voice-controller change / openspec-native-pipeline spec). No open change
  // with work means the PO has not proposed yet — fail loudly rather than let
  // DEV free-code without a spec, and tell the user to have the PO propose first.
  if (run.agent === "dev" && !openChangesWithTasks(run.cwd).length) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      "No open OpenSpec change with remaining tasks to implement. Ask the PO to grill and propose a change first (it creates openspec/changes/<name>/tasks.md), then run the DEV.",
    );
    return;
  }

  // Rollback switch for the stateful PO module (design.md Migration Plan):
  // set IRIS_PO_LIVE_SESSION=0 to fall back to the pre-SDK behavior, where PO
  // runs exactly like DEV (one-shot `claude -p --resume`, no live session, no
  // mid-turn questions). No data migration needed — both paths read/write the
  // same workstream.agent_sessions.po id.
  if (run.agent === "po" && process.env.IRIS_PO_LIVE_SESSION !== "0") {
    startPoRun(run);
    return;
  }
  startDevRun(run);
}

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

// The stateless module: unchanged one-shot `claude -p` subprocess per run,
// exactly as before this change — mechanism AND auth (process.env, `/login`).
async function startDevRun(run) {
  // Model is resolved at run START (not at submit time), so a model change
  // made while this task was queued still applies — see design.md D4. Only
  // role runs are model-selectable; plain Claude gets no --model flag and no
  // --fallback-model is ever set (an unavailable model must fail loudly, not
  // silently downgrade — see design.md D6).
  const workstream = findWorkstream(run.workstream_id);
  run.model = run.agent ? resolveAgentModel(workstream, run.agent) : null;

  // DEV (stateless module): never asks mid-run, always defaults. The PO
  // (stateful module, see startPoRun) gets the opposite instruction — it is
  // allowed to pause via AskUserQuestion — so the two must not share this string.
  let systemPrompt =
    "You are invoked from Iris voice. Work autonomously. Do not ask for clarification unless absolutely impossible. Use sensible defaults and report concise final results.";

  // Personal-knowledge-notes capability: plain-Claude runs only (`!run.agent`)
  // — PO and DEV must see this exact string unchanged (design.md D3/D5 of the
  // llm-wiki change). Verified manually per task 2.3: when `run.agent` is set,
  // this whole branch is skipped, so `systemPrompt` stays byte-identical to
  // the base string above — there is no other place that mutates it.
  if (!run.agent) {
    ensureNotesVaultReady();
    if (checkNotesSkillsStatus().ok) {
      systemPrompt +=
        ` The personal-notes / LLM-Wiki vault root is fixed at ${NOTES_VAULT_DIR}, regardless of the current working directory — use the wiki skills there for any note-taking or second-brain request. wiki-config.md and wiki-schema.md already exist in that vault; never ask the user for the wiki root path or wait for a reply — proceed directly using this path.`;
    } else {
      // Vault creation and skill installation are independent actions on
      // independent schedules (see NOTES_SKILLS above) — the vault can exist
      // before "Install missing" is ever clicked. Without this branch the
      // directive above would send Claude looking for wiki skills that
      // aren't installed, and it would either invent an ungoverned note
      // format or hallucinate the skill's behavior instead of refusing honestly.
      systemPrompt +=
        " The personal-notes / LLM-Wiki skills are not installed on this machine yet. If the user asks to capture, save, or retrieve a personal note or second-brain entry, tell them the notes capability needs to be installed first (Iris's setup panel, \"Install missing\") — do not attempt an ad-hoc note file in its place.";
    }
  }

  const args = [
    "-p", run.task,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions",
    "--append-system-prompt",
    systemPrompt,
  ];
  if (run.agent) args.push("--agent", `${AGENT_PREFIX}${run.agent}`);
  if (run.model) args.push("--model", run.model);

  // canvas-claude-mcp (design.md D6/5.2): Iris-scoped per-run wiring, never
  // written to ~/.claude. A 0600 temp file (not inline argv) so the bearer
  // token isn't visible via `ps`; deleted once the run's own process ends
  // (see the child "close"/"error" handlers and the spawn-failure catch
  // below) — cleanupMcpConfig() is idempotent and safe to call from all three.
  const mcpRecord = await ensureCanvasMcpForRun();
  let mcpConfigDir = null;
  if (mcpRecord) {
    mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-mcp-"));
    const mcpConfigPath = path.join(mcpConfigDir, "mcp-config.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { "iris-canvas": mcpRecord } }), { mode: 0o600 });
    args.push("--mcp-config", mcpConfigPath);
  }
  function cleanupMcpConfig() {
    if (mcpConfigDir) fs.rmSync(mcpConfigDir, { recursive: true, force: true });
    mcpConfigDir = null;
  }

  // CONTEXT IS USER-CONTROLLED. Every role (and plain Claude) keeps its OWN
  // continuous conversation within this workstream: a task always --resumes the
  // role's stored session, no matter what ran in between. Nothing here ever
  // drops a session on its own — context resets only when the USER asks for it:
  // the "New" session button, an explicit voice new-session request, or picking
  // a different project folder (Claude stores conversations per directory).
  // Cross-role context still crosses the PO → DEV gate via the handoff files in
  // the project, never via a shared conversation.
  const key = agentKey(run.agent);
  const previousSession = workstream?.agent_sessions?.[key] ?? null;
  if (previousSession) args.push("--resume", previousSession);

  let child;
  try {
    child = spawn(claudeBinary(), args, {
      cwd: run.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // D12 (harden-security-boundaries): derived by subtraction, not
      // process.env passed through by reference — GEMINI_API_KEY has no use
      // to any role, and CLAUDE_CODE_OAUTH_TOKEN specifically has none to
      // DEV, confirmed empirically (an invalid token left the CLI's result
      // unaffected — `claude -p` authenticates via its own /login-based
      // credential store, never this env var; only the Agent SDK PO uses
      // reads it). Withholding an unused credential from a worker that runs
      // with bypassPermissions and reads untrusted content is pure risk
      // reduction, not a functional change.
      env: computeWorkerEnv(process.env, ["GEMINI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
      // Process-group leader (POSIX) so killChild's group kill also reaches
      // this run's own tool subprocesses (bash, MCP servers under
      // bypassPermissions) — not unref()'d, the parent keeps managing the
      // child. See design.md D2 of bound-shutdown-teardown.
      detached: true,
    });
  } catch (error) {
    cleanupMcpConfig();
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
    return;
  }

  run.status = RUN_STATUS.RUNNING;
  run.started_at = Date.now() / 1000;
  run.child = child;
  // The id the run will resume (if any) — replaced by the live id once
  // Claude's init event confirms it.
  run.claude_session_id = previousSession ?? null;
  emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

  let stdoutBuffer = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleClaudeStreamEvent(run, line);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    cleanupMcpConfig();
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
  });
  child.on("close", (code) => {
    cleanupMcpConfig();
    if (run.status === RUN_STATUS.CANCELLED) {
      runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return;
    }
    const result = run.result;
    if (code === 0 && result && !result.is_error) {
      let output = String(result.result ?? "");
      // Backstop for the soft append-system-prompt vault directive (design.md
      // Risks): the directive is a prompt, not a sandboxed writable root, so
      // Claude could ignore it. Only checked for plain-Claude tasks that look
      // like a note-capture request, so unrelated tasks (e.g. "translate
      // this") never get a spurious caveat — and only when nothing under the
      // vault changed, so a real save is never second-guessed.
      if (!run.agent && NOTE_CAPTURE_HINT_RE.test(run.task) && !vaultChangedSince(run.started_at * 1000)) {
        output +=
          `\n\n[vault-check: no file changes detected under ${NOTES_VAULT_DIR} during this run — verify the note actually saved before confirming that to the user]`;
      }
      runQueue.finalize(run.run_id, RUN_STATUS.COMPLETED, output);
    } else {
      const detail = result?.result || stderr.trim() || `claude exited with code ${code}`;
      // A dead --resume id (deleted history, moved project) would otherwise fail
      // every subsequent task; dropping it lets the next run start fresh.
      if (previousSession && /no conversation|session.*not.*found|unknown session/i.test(String(detail))) {
        const ws = findWorkstream(run.workstream_id);
        if (ws?.agent_sessions?.[key] === previousSession) {
          delete ws.agent_sessions[key];
          persistSessionStore();
        }
      }
      runQueue.finalize(run.run_id, RUN_STATUS.FAILED, String(detail));
    }
  });
}

// The stateful module: delivers the turn into the workstream's resident Agent
// SDK session (creating it on the first PO turn), instead of spawning a new
// process. See electron/po-session.mjs and design.md D1/D2/D3.
async function startPoRun(run) {
  const workstream = findWorkstream(run.workstream_id);
  if (!workstream) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, "Unknown workstream for PO run.");
    return;
  }
  const billing = poBillingStatus();
  if (!billing.ok) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      "PO needs a subscription token: run `claude setup-token`, set CLAUDE_CODE_OAUTH_TOKEN (see .env.example), then retry. DEV is unaffected.",
    );
    return;
  }

  // Resolved at run start (not submit time) so a model change made while this
  // task was queued still applies — see design.md D5.
  run.model = resolveAgentModel(workstream, "po");
  // canvas-claude-mcp (design.md D6/5.1): awaits server-ready before wiring,
  // so a PO turn that fires the instant the canvas is engaged never wires an
  // undefined URL, and never wires anything at all when the canvas MCP does
  // not apply to this session.
  const mcpRecord = await ensureCanvasMcpForRun();
  const mcpServers = mcpRecord ? { "iris-canvas": mcpRecord } : undefined;

  run.status = RUN_STATUS.RUNNING;
  run.started_at = Date.now() / 1000;
  run.claude_session_id = workstream.agent_sessions?.po ?? null;
  emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

  let state;
  try {
    state = getOrCreatePoSession(workstream, {
      agent: `${AGENT_PREFIX}po`,
      cwd: run.cwd,
      resumeSessionId: workstream.agent_sessions?.po ?? null,
      claudeExecutable: claudeBinary(),
      onAskUserQuestion: (workstreamId, questions) => askUserQuestionViaVoice(workstreamId, questions),
      model: run.model,
      mcpServers,
    });
  } catch (error) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start PO session: ${error.message}`);
    return;
  }

  // The session may already be live on an older model (created before a
  // queued model change) — switch it via setModel() so the turn about to run
  // uses the current choice with the session's context fully preserved,
  // instead of closing/resuming just to change models.
  const modelReady = (
    state.currentModel === run.model ? Promise.resolve() : setPoSessionModel(state, run.model)
  ).catch((error) => {
    emitEvent({ type: "log", level: "warn", message: `Could not switch PO's live session model: ${error.message}` });
  });
  // Applied lazily, at most once per session (design.md D6/D8) — a session
  // created before the canvas was engaged gets wired here on its first turn
  // after; a session created with it already set (mcpServers above) has
  // state.currentMcp === true and this is a no-op.
  const mcpReady = (
    state.currentMcp || !mcpServers ? Promise.resolve() : setPoSessionMcpServers(state, mcpServers)
  ).catch((error) => {
    emitEvent({ type: "log", level: "warn", message: `Could not wire the canvas MCP into PO's live session: ${error.message}` });
  });

  Promise.all([modelReady, mcpReady])
    .then(() =>
      deliverPoTurn(state, run.task, {
        onActivity: (line) => pushActivity(run, line),
        onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
        onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
        onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      }),
    )
    .then((result) => runQueue.finalize(run.run_id, result.status, result.output))
    .catch((error) => {
      // The reason travels on the rejected error (see po-session.mjs pump's
      // finally), not on session state — the session may already be deleted
      // from the map by the time this settles.
      if (error?.poEndReason?.kind === "teardown") {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "PO session was reset before the turn completed.");
        return;
      }
      if (error?.poEndReason?.kind === "cancelled") {
        runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
        return;
      }
      runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `PO session error: ${error.message}`);
    });
}



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

function buildLiveConfigForMode(mode, resumeHandle) {
  return buildLiveConfig({
    mode,
    resumeHandle,
    tools: geminiTools.buildLiveTools(),
    systemInstruction: mode === "listen" ? geminiPrompts.buildListenSystemInstructionText() : geminiPrompts.buildSystemInstructionText(),
    voice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
  });
}

function sendWelcomeGreeting() {
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
  await connectLive({ isReconnect: false, mode: "converse" });
  return { running: true, pid: process.pid };
}

async function connectLive({ isReconnect, mode = "converse" }) {
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
    config: buildLiveConfigForMode(mode, resumptionHandle),
    callbacks: {
      onopen() {
        reconnectAttempts = 0;
        liveStatus = { running: true, pid: process.pid };
        emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec" } });
        emitEvent({ type: "gemini_status", status: "connected", model });
        emitEvent({ type: "audio_state", state: "listening" });
        updateTrayMenu();
        // The resumed session keeps its context; greeting again mid-conversation
        // every ~10 minutes would be jarring. Every listening-mode reconnect
        // (enter/exit/rotation) also passes isReconnect:true for the same
        // reason (design.md Decision 12) — toggling never re-greets.
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
        notifyLiveClosed();

        // A deliberate transition (entering/exiting/rotating listening mode)
        // closed this socket itself — skip the failure-reconnect path and
        // the offline teardown entirely (design.md Decision 12); the
        // sequence that called closeLiveSessionDeliberately() drives the
        // reconnect explicitly.
        if (ListenMode.deliberateReconnect) {
          ListenMode.deliberateReconnect = false;
          return;
        }

        if (userStopped) {
          liveStatus = { running: false, pid: null };
          emitEvent({ type: "gemini_status", status: "offline" });
          emitEvent({ type: "audio_state", state: "idle" });
          emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
          updateTrayMenu();
          return;
        }

        // An unexpected disconnect (machine slept, network dropped, server
        // terminated the connection) while listening mode was engaged or
        // mid-transition ends the mode rather than riding across the
        // reconnect (spec "An unexpected disconnect ends listening mode"):
        // reconnecting in listen configuration without a fresh
        // activityStart would silently discard every subsequent byte, and
        // reconnecting in converse configuration while still "engaged"
        // would leave the ear icon lit over a session that has stopped
        // listening. The failure-reconnect path below always targets
        // converse, so either way the mode must end here first.
        if (ListenMode.engaged || ListenMode.transitioning) {
          clearListenRotationTimer();
          ListenMode.transitioning = false;
          ListenMode.boundaryInFlight = false;
          setListenEngaged(false);
          if (ListenMode.segmentRecord.trim()) {
            ListenMode.synthesizeOnNextConverseConnect = true;
          } else {
            ListenMode.segmentRecord = "";
          }
        }

        scheduleReconnect(event?.reason || "connection closed");
      },
    },
  });
  // Send AFTER connect resolves: onopen can fire before liveSession is
  // assigned, so draining inside onopen would no-op (mirrors previewVoice).
  // Skipped on a listen-config connect — the backlog is delivered on the
  // first connect that is not into listening mode (session-announcements
  // MODIFIED delta).
  if (mode !== "listen") {
    drainPendingAnnouncements();
    // Recovery synthesis after an unexpected disconnect ended the mode
    // (design.md Decision 10 / tasks.md 4.7) — fires at most once, only
    // once conversation is actually back up.
    if (ListenMode.synthesizeOnNextConverseConnect) {
      ListenMode.synthesizeOnNextConverseConnect = false;
      const segment = ListenMode.segmentRecord;
      ListenMode.segmentRecord = "";
      liveSession?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: geminiPrompts.buildListenExitSynthesisPrompt(segment) }] }],
        turnComplete: true,
      });
    }
  }
}

function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    liveStatus = { running: false, pid: null };
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
    // Always converse: this is the failure path, and listening mode has
    // already been ended (if it was engaged) by the onclose branch above
    // before scheduleReconnect was ever called.
    connectLive({ isReconnect: true, mode: "converse" }).catch((error) => {
      liveSession = null;
      scheduleReconnect(error?.message || String(error));
    });
  }, delay);
}

async function handleToolCall(toolCall) {
  const functionResponses = [];
  for (const call of toolCall.functionCalls || []) {
    emitEvent({ type: "tool_call", name: call.name, args: call.args || {} });
    try {
      const result = await executeClaudeTool(call.name, call.args || {});
      functionResponses.push({ id: call.id, name: call.name, response: { result } });
    } catch (error) {
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { status: "error", error: error.message },
      });
    }
  }
  if (functionResponses.length && liveSession) {
    liveSession.sendToolResponse({ functionResponses });
  }
}

function handleLiveMessage(message) {
  if (message.sessionResumptionUpdate) {
    const { resumable, newHandle } = message.sessionResumptionUpdate;
    if (resumable && newHandle) {
      resumptionHandle = newHandle;
      notifyFreshResumptionHandle(newHandle);
    }
  }

  if (message.goAway) {
    // Server warns the connection is about to be dropped (connection lifetime
    // limit). Rotate immediately rather than betting the rest of the chunk on
    // an unmeasured goAway.timeLeft (design.md Decision 3) if listening mode
    // is engaged and idle; otherwise onclose fires shortly after and the
    // ordinary reconnect handles it.
    console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
    if (ListenMode.engaged && !ListenMode.transitioning) {
      runListenRotation().catch((error) => {
        emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation (goAway) failed: ${error.message}` });
      });
    }
  }

  if (message.toolCall) {
    // A boundary turn cannot start background work (spec "A boundary turn
    // cannot start background work") — the listening config already ships
    // an empty tool set, so this only guards a stray call arriving folded
    // into the same batch as the boundary's turnComplete.
    if (!ListenMode.boundaryInFlight) {
      handleToolCall(message.toolCall).catch((error) => {
        emitEvent({ type: "fatal", message: "Tool call failed", error: error.message });
      });
    }
  }

  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    flushTranscripts();
    emitToRenderer("live:interrupt", {});
    emitEvent({ type: "audio_state", state: "listening" });
    return;
  }

  if (content.inputTranscription?.text) {
    appendUserTranscript(content.inputTranscription.text);
    // Segment record: the recovery path for the current chunk (design.md
    // Decision 7). Accumulated whenever the mode is engaged, including
    // across a rotation's boundary — never written to disk or the vault.
    if (ListenMode.engaged) ListenMode.segmentRecord += content.inputTranscription.text;
  }

  // Every boundary turn (rotation or exit alike) is neither heard nor shown
  // (spec "Every boundary turn is neither heard nor shown") — suppressed
  // here, in main, before any part of it reaches the renderer. Reusing the
  // renderer's speaker-mute suppression would be too late: this loop is what
  // appends to modelTranscriptBuffer and emits "speaking", both before the
  // renderer sees anything.
  if (!ListenMode.boundaryInFlight) {
    if (content.outputTranscription?.text) appendModelTranscript(content.outputTranscription.text);

    for (const part of content.modelTurn?.parts || []) {
      if (part.text) appendModelTranscript(part.text);
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;
      const mimeType = inlineData.mimeType || "audio/pcm;rate=24000";
      if (!mimeType.startsWith("audio/")) continue;
      emitToRenderer("live:audio", { data: inlineData.data, mimeType });
      emitEvent({ type: "audio_state", state: "speaking" });
    }
  }

  if (content.turnComplete) {
    flushTranscripts();
    emitEvent({ type: "audio_state", state: "listening" });
    notifyTurnComplete();
  }
}

// ===== Listening mode sequences (add-listening-mode) =====
// Each of enter/exit/rotation is a deliberate reconnect (design.md Decision
// 12): close the current session ourselves, marking the close as ours so
// `onclose` skips the failure-reconnect path, then reconnect carrying
// whatever resumption handle is current — via `{ isReconnect: true }` so
// `GreetGate` does not re-fire the welcome greeting on every toggle and
// rotation.

async function enterListenMode() {
  if (!liveStatus.running || ListenMode.transitioning || ListenMode.engaged) return;
  ListenMode.transitioning = true;
  try {
    const closed = waitForLiveClose();
    closeLiveSessionDeliberately();
    await closed;
    if (userStopped) return;

    try {
      await connectLive({ isReconnect: true, mode: "listen" });
    } catch (error) {
      // A failed transition leaves a coherent state (spec "A failed
      // transition leaves a coherent state") — never report engaged over a
      // session that is not listening.
      emitEvent({ type: "fatal", message: "Could not enter listening mode", error: error?.message || String(error) });
      try {
        await connectLive({ isReconnect: true, mode: "converse" });
      } catch (fallbackError) {
        scheduleReconnect(fallbackError?.message || String(fallbackError));
      }
      return;
    }
    if (userStopped) return;

    ListenMode.segmentRecord = "";
    const confirmed = await driveTurnAndWaitForCompletion(geminiPrompts.buildListenEntryConfirmationPrompt());
    if (!confirmed) {
      emitEvent({
        type: "log",
        level: "warn",
        message: "Listening-mode entry confirmation did not complete within the bounded wait; opening the activity anyway.",
      });
    }
    if (userStopped) return;

    // Opened only now, after the confirmation turn has completed, so the
    // confirmation cannot consume the user's opening words (spec "The
    // confirmation does not swallow the user's first words").
    liveSession?.sendRealtimeInput({ activityStart: {} });
    setListenEngaged(true);
    armListenRotationTimer();
  } finally {
    ListenMode.transitioning = false;
  }
}

async function exitListenMode() {
  if (!ListenMode.engaged || ListenMode.transitioning) return;
  ListenMode.transitioning = true;
  clearListenRotationTimer();
  try {
    ListenMode.boundaryInFlight = true;
    const closed = waitForLiveClose();
    await runBoundary(makeBoundarySession(), {
      onMissing: (what) =>
        emitEvent({ type: "log", level: "warn", message: `Listening-mode exit boundary missing ${what}; proceeding.` }),
    });
    ListenMode.boundaryInFlight = false;
    await closed;
    if (userStopped) return;

    try {
      await connectLive({ isReconnect: true, mode: "converse" });
    } catch (error) {
      setListenEngaged(false);
      scheduleReconnect(error?.message || String(error));
      return;
    }
    if (userStopped) return;

    // The synthesis is driven only now, after the converse reconnect — never
    // at the boundary, where the listening instruction is still in force and
    // would collapse it to the same one-word acknowledgement a rotation gets
    // (spec "Ending listening mode commits what was heard and Iris speaks
    // its synthesis").
    setListenEngaged(false);
    const segment = ListenMode.segmentRecord;
    ListenMode.segmentRecord = "";
    liveSession?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: geminiPrompts.buildListenExitSynthesisPrompt(segment) }] }],
      turnComplete: true,
    });
  } finally {
    ListenMode.transitioning = false;
  }
}

async function runListenRotation() {
  if (!ListenMode.engaged || ListenMode.transitioning) return;
  ListenMode.transitioning = true;
  clearListenRotationTimer();
  try {
    ListenMode.boundaryInFlight = true;
    const closed = waitForLiveClose();
    await runBoundary(makeBoundarySession(), {
      onMissing: (what) =>
        emitEvent({ type: "log", level: "warn", message: `Listening-mode rotation boundary missing ${what}; proceeding.` }),
    });
    ListenMode.boundaryInFlight = false;
    await closed;
    if (userStopped) return;

    try {
      await connectLive({ isReconnect: true, mode: "listen" });
    } catch (error) {
      // The deliberate path itself broke down — fall back to the ordinary
      // failure-reconnect (always converse) and treat this the same as an
      // unexpected disconnect: the mode ends, with the segment record as
      // the recovery path.
      setListenEngaged(false);
      if (ListenMode.segmentRecord.trim()) ListenMode.synthesizeOnNextConverseConnect = true;
      scheduleReconnect(error?.message || String(error));
      return;
    }
    if (userStopped) return;

    liveSession?.sendRealtimeInput({ activityStart: {} });
    armListenRotationTimer();
  } finally {
    ListenMode.transitioning = false;
  }
}

// The single entry point every control surface (renderer, tray, hotkey)
// calls directly — no `emitToRenderer` dispatch, so the mode stays reachable
// with no window open (design.md Decision 11).
function toggleListenMode() {
  if (!liveStatus.running) return; // no-op while asleep (spec "Toggling while asleep does nothing")
  if (ListenMode.transitioning) return; // spec "A toggle during a transition is ignored"
  if (ListenMode.engaged) {
    exitListenMode().catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Ending listening mode failed: ${error.message}` });
    });
  } else {
    enterListenMode().catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Entering listening mode failed: ${error.message}` });
    });
  }
}

async function stopLive() {
  // Sleep and app quit both route through here. Neither runs the exit
  // boundary (spec "A failed transition leaves a coherent state" / tasks.md
  // 4.6): the resumption handle does not outlive the process, quit runs
  // under a bounded teardown deadline, and at sleep the renderer's audio
  // pipeline is torn down before this fires — no synthesis could be heard.
  resetListenModeSilently();
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

function sendAudioChunk(arrayBuffer) {
  if (!liveSession || !arrayBuffer) return;
  const buffer = Buffer.from(new Uint8Array(arrayBuffer));
  if (!buffer.byteLength) return;
  liveSession.sendRealtimeInput({
    audio: { data: buffer.toString("base64"), mimeType: "audio/pcm;rate=16000" },
  });
}

function sendCommand(command) {
  if (command?.type === "text" && command.text) {
    if (!liveSession) throw new Error("Gemini Live is not running");
    liveSession.sendRealtimeInput({ text: command.text });
  }
  if (command?.type === "submit_claude_task" && command.task) {
    submitClaudeTask({ task: command.task, agent: command.agent }).catch((error) => {
      emitEvent({ type: "claude_task_update", status: "error", task: command.task, error: error.message });
    });
  }
}

// D9/D10 (harden-security-boundaries): the single source of truth for "is
// this URL the app's own document" — used both to contain navigation and to
// scope device permissions. Exact match, not a `file://` wildcard: a
// wildcard would match any local file (e.g. one dropped onto the window),
// which still carries `preload.cjs` and therefore `window.iris` into
// whatever content it navigates to.
const APP_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const APP_PACKAGED_URL = pathToFileURL(path.join(repoRoot, "dist", "index.html")).href;

function isAppOwnDocument(url) {
  return url === APP_DEV_URL || url.startsWith(`${APP_DEV_URL}/`) || url === APP_PACKAGED_URL;
}

function createWindow() {
  // Frameless + transparent from birth so the same window can morph into the
  // Glass HUD overlay — Electron cannot toggle `frame`/`transparent` after
  // creation. The deck paints its own rounded background in CSS; TopBar's
  // custom win-controls replace the native traffic lights this gives up.
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 800,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    fullscreenable: false,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(repoRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // OS-process-level renderer isolation, on top of contextIsolation.
      // Land alongside the `electron` version pin (package.json) so its
      // effect is verified against a fixed, known Electron version rather
      // than a floating `latest` (harden-security-boundaries D9).
      sandbox: true,
      // Audio capture/playback and the HUD must keep running when occluded.
      backgroundThrottling: false,
    },
  });
  const useProd = app.isPackaged || process.env.IRIS_START_PROD === "1";
  if (useProd) mainWindow.loadFile(path.join(repoRoot, "dist", "index.html"));
  else mainWindow.loadURL(APP_DEV_URL);
  // harden-wake-word-detection D6: the application menu ships with no View
  // role and nothing else calls openDevTools(), so the renderer console —
  // where IRIS_WAKE_DEBUG's score diagnostics land — is otherwise unreachable
  // by menu or accelerator in both dev and packaged builds.
  if (envFlag("IRIS_WAKE_DEBUG", false)) mainWindow.webContents.openDevTools();
  // Navigation containment and the external-link handoff now live on
  // app.on("web-contents-created") below, covering every web contents the
  // app ever creates instead of just this one window.
  // A crashed renderer or a reload/navigation doesn't fire the window's
  // "closed" event, so an active vault-graph fs.watch stream would
  // otherwise orphan while a fresh renderer starts a second one
  // (second-brain-galaxy-view design.md D3 M3).
  mainWindow.webContents.on("render-process-gone", () => notesVaultGraph.stop());
  mainWindow.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) notesVaultGraph.stop();
  });
  // Avoid a translucent first-paint flash on the transparent window.
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
    uiMode = "deck";
  });
}

// ===== Glass HUD =====
// One window, two shapes. Deck: a normal rounded app window. HUD: the same
// window stretched over the whole screen, transparent, always on top, and
// click-through except where the renderer marks interactive elements — Iris
// floats over everything while you keep working underneath.
let uiMode = "deck";
let deckBounds = null;

function enterHud() {
  if (!mainWindow || uiMode === "hud") return;
  uiMode = "hud";
  deckBounds = mainWindow.getBounds();
  // Re-check vault existence on every HUD open (design.md D7 of
  // second-brain-galaxy-view) — cheap existsSync, only emits on a real
  // transition, so the "show second brain" toggle's visibility stays in
  // sync even if the vault appeared/disappeared since the last HUD session.
  probeSecondBrainAvailability();
  // Let the renderer fade the deck out before the window jumps to full screen.
  emitToRenderer("hud:mode", { mode: "hud" });
  setTimeout(() => {
    if (!mainWindow || uiMode !== "hud") return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    mainWindow.setHasShadow(false);
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setBounds(display.bounds);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.show();
  }, 170);
}

function exitHud() {
  if (!mainWindow || uiMode === "deck") return;
  uiMode = "deck";
  mainWindow.setIgnoreMouseEvents(false);
  // Tell the renderer first (the deck mounts invisible and fades in), then
  // restore the window while it's still transparent — no stretched flash.
  emitToRenderer("hud:mode", { mode: "deck" });
  setTimeout(() => {
    if (!mainWindow || uiMode !== "deck") return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setHasShadow(true);
    mainWindow.setMinimumSize(980, 800);
    if (deckBounds) mainWindow.setBounds(deckBounds);
    mainWindow.show();
    mainWindow.focus();
  }, 170);
}

function toggleHud() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (uiMode === "hud") exitHud();
  else enterHud();
}

// ===== Tray (menu-bar presence) =====
let tray = null;

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: liveStatus.running ? "Sleep Iris" : "Wake Iris",
        click: () => emitToRenderer(liveStatus.running ? "iris:sleep" : "iris:wake", {}),
      },
      {
        label: speakerMuted ? "Unmute speaker" : "Mute speaker",
        enabled: liveStatus.running,
        click: () => emitToRenderer("iris:mute-toggle", {}),
      },
      {
        // Main owns this state directly (design.md Decision 11) — calls
        // toggleListenMode() itself rather than dispatching to the
        // renderer, so this still works with no window open.
        label: ListenMode.engaged ? "End listening mode" : "Start listening mode",
        enabled: liveStatus.running,
        click: () => toggleListenMode(),
      },
      { label: uiMode === "hud" ? "Exit Glass HUD" : "Enter Glass HUD", click: () => toggleHud() },
      { type: "separator" },
      {
        label: "Show Deck",
        click: () => {
          if (!mainWindow) createWindow();
          else {
            exitHud();
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      { label: "Quit Iris", role: "quit" },
    ]),
  );
}

function createTray() {
  const trayIconPath = path.join(repoRoot, "build", "trayTemplate.png");
  if (!fs.existsSync(trayIconPath)) return;
  tray = new Tray(trayIconPath);
  tray.setToolTip("Iris");
  updateTrayMenu();
}

function hudHotkey() {
  return process.env.IRIS_HUD_HOTKEY || "Alt+Space";
}

function muteHotkey() {
  return process.env.IRIS_MUTE_HOTKEY || "Alt+M";
}

function listenHotkey() {
  return process.env.IRIS_LISTEN_HOTKEY || "Alt+L";
}

function installAppMenu() {
  if (process.platform !== "darwin") return;
  app.setAboutPanelOptions({
    applicationName: "Iris",
    applicationVersion: app.getVersion(),
    ...(appIcon ? { iconPath } : {}),
  });
  const menu = Menu.buildFromTemplate([
    {
      label: "Iris",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

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

  // D9 (harden-security-boundaries): app-wide navigation containment,
  // replacing the old per-window will-navigate/setWindowOpenHandler pair
  // (second-brain-galaxy-view D9/M1) so every web contents the app ever
  // creates is covered, not just the first window. The galaxy renders
  // genuinely untrusted note content (wiki-ingest pulls web articles/PDFs
  // into the vault) and react-markdown turns `[text](https://…)` into a real
  // `<a>` — without this, clicking one would top-level-navigate the window
  // carrying `preload.cjs` to the remote page. window.open is denied as an
  // in-app window and handed to the OS browser instead, which also restores
  // the three panel links (src/App.tsx, SetupPanel.tsx) that a bare `deny`
  // left silently non-functional.
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isAppOwnDocument(url)) return;
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    });
  });

  // D10 (harden-security-boundaries): grant media/audio/video only to the
  // app's own document. Latent on its own (only the app's document loads
  // today), but combined with a navigation gap this would otherwise hand the
  // microphone/camera to whatever content got navigated to — this removes
  // that compounding factor regardless of whether D9 also holds.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const isOwnDocument = isAppOwnDocument(details?.requestingUrl || "");
    // "audioCapture"/"videoCapture" are not in the installed Electron type's
    // permission union for this handler (only "media" is) — see the change's
    // recorded findings. Cast rather than drop the checks: behavior-neutral.
    const perm = /** @type {string} */ (permission);
    callback(isOwnDocument && (perm === "media" || perm === "audioCapture" || perm === "videoCapture"));
  });

  ipcMain.handle("sidecar:start", () => startLive());
  ipcMain.handle("sidecar:stop", () => stopLive());
  ipcMain.handle("sidecar:status", () => liveStatus);
  // Listening mode's narrow bridge (design.md Decision 11): a toggle
  // request, and a query for boot/reload — no report-back channel. State
  // pushes to the renderer one-way over "listen-mode:state" from
  // setListenEngaged, never the reverse.
  ipcMain.on("listen-mode:toggle-request", () => toggleListenMode());
  ipcMain.handle("listen-mode:query", () => ({ engaged: ListenMode.engaged }));
  ipcMain.handle("sidecar:command", (_event, command) => sendCommand(command));
  ipcMain.handle("sessions:get", () => sessionsSnapshot());
  ipcMain.handle("sessions:select", (_event, id) => selectWorkstream(String(id || "")));
  ipcMain.handle("sessions:new", (_event, label) => {
    const workstream = createWorkstream(label);
    return { status: "ok", session: { id: workstream.id, label: workstream.label }, ...sessionsSnapshot() };
  });
  ipcMain.handle("sessions:choose-cwd", (_event, id) => chooseWorkstreamCwd(String(id || "")));
  ipcMain.handle("agents:list", (_event, id) => agentsSnapshot(String(id || "")));
  ipcMain.handle("agents:select", (_event, payload) =>
    setWorkstreamAgent(String(payload?.workstreamId || ""), payload?.agent ?? null));
  ipcMain.handle("agents:install", () => installIrisAgents());
  ipcMain.handle("pipeline:install-prereqs", () => installPipelinePrereqs());
  ipcMain.handle("agents:set-model", (_event, payload) =>
    setAgentModel(String(payload?.workstreamId || ""), payload?.role, payload?.model));
  // Secondary answer path for the PO's pending AskUserQuestion — lets a
  // sighted user click an option directly instead of answering by voice.
  // Whichever path (this, or the Gemini answer_po_question tool) answers
  // first wins; the other becomes a no-op since the question is already resolved.
  ipcMain.handle("po:answer-question", (_event, answers) => resolvePendingPoQuestion(answers));
  // Renderer's boot-time read of the review-gate mode (see setPromptReviewMode
  // above) plus the UI's Approve/Edit/Cancel and mode-toggle paths. Only
  // Approve/Edit/Cancel have a voice counterpart (respond_to_task_review) —
  // the mode toggle below is UI-only, never model-writable — mirroring the
  // po:answer-question pattern for whichever channel resolves first.
  ipcMain.handle("prompt:status", () => ({ reviewMode: getPromptReviewMode() }));
  ipcMain.handle("prompt:resolve-review", (_event, payload) => resolvePromptReview(payload));
  ipcMain.handle("prompt:set-review-mode", (_event, payload) => setPromptReviewMode(Boolean(payload?.enabled)));
  ipcMain.handle("context-supplement:send", (_event, text) => sendContextSupplement(text));
  ipcMain.handle("hud:toggle", () => {
    toggleHud();
    updateTrayMenu();
    return { mode: uiMode };
  });
  ipcMain.on("hud:interactive", (_event, on) => {
    if (mainWindow && uiMode === "hud") {
      mainWindow.setIgnoreMouseEvents(!on, { forward: true });
    }
  });
  // Drawing panel activation (hud-drawing-canvas design.md D4): the HUD
  // window is transparent/frameless/always-on-top, which on macOS commonly
  // does not receive key events without an explicit focus() — needed for
  // excalidraw's text tool, Delete, and tool shortcuts.
  ipcMain.on("canvas:activate", () => {
    if (mainWindow) mainWindow.focus();
    // First-open signal for canvas-claude-mcp's sticky canvasEngaged gate
    // (design.md D6) — a no-op on every subsequent open/close of the panel.
    canvasEngaged = true;
    maybeStartCanvasMcp();
  });
  // Reply half of the main→renderer image-export request (design.md D3);
  // resolves the pending promise requestCanvasImage() created, if it hasn't
  // already been cleaned up by its own timeout.
  ipcMain.on("canvas:image-result", (_event, payload) => {
    const resolve = pendingCanvasImageRequests.get(payload?.id);
    if (!resolve) return;
    pendingCanvasImageRequests.delete(payload.id);
    resolve(payload?.image ?? null);
  });
  // Scene-access seam (design.md D5): the in-memory cache updates
  // immediately on every push so `canvas:get-scene` is never behind the
  // debounced disk write; that debounced write is the only async part.
  ipcMain.on("canvas:scene", (_event, scene) => {
    if (scene && typeof scene === "object") canvasStore.setScene(scene);
  });
  ipcMain.handle("canvas:get-scene", () => canvasStore.getScene());
  // Native file-dialog fallback (design.md D5a) for when the renderer's File
  // System Access path is unavailable under file:// — feeds excalidraw's
  // own loadFromBlob / serializeAsJSON / exportToBlob on the renderer side.
  ipcMain.handle("canvas:native-open-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open drawing",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const content = fs.readFileSync(result.filePaths[0], "utf8");
    return { canceled: false, content };
  });
  ipcMain.handle("canvas:native-save-file", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save drawing",
      defaultPath: payload?.suggestedName || "drawing.excalidraw",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, String(payload?.content ?? ""), "utf8");
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("canvas:native-export-image", async (_event, payload) => {
    const format = payload?.format === "svg" ? "svg" : "png";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export image",
      defaultPath: payload?.suggestedName || `drawing.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    // SVG exports as raw markup text; PNG as a base64 payload (no data: URL prefix).
    if (format === "svg") fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "utf8");
    else fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "base64");
    return { canceled: false, filePath: result.filePath };
  });
  // Second-brain galaxy view (second-brain-galaxy-view design.md D3/D7/D8):
  // renderer's boot-time/HUD-open availability pull — the live push half of
  // this rides the existing sidecar:event stream (secondbrain_availability),
  // not a new dedicated channel (design.md D7, L2).
  ipcMain.handle("secondbrain:availability", () => ({ available: probeSecondBrainAvailability() }));
  // Always a fresh scan (design.md D3) — re-checks availability inline so a
  // vault that vanished between the toggle showing and being clicked is
  // caught here too, not just on the next HUD-open re-check.
  ipcMain.handle("secondbrain:get-graph", async () => {
    const available = probeSecondBrainAvailability();
    if (!available) return { graph: { nodes: [], links: [] }, available };
    const graph = await notesVaultGraph.getGraph();
    return { graph, available };
  });
  // Start/stop the watcher exactly on galaxy toggle-on/off (design.md D3
  // M-2) — an always-on recursive watcher would rebuild constantly during
  // normal note-capture use for a view that's off by default. start() is
  // idempotent; stop() is safe to call even if never started.
  ipcMain.on("secondbrain:activate", () => {
    notesVaultGraph.start();
  });
  ipcMain.on("secondbrain:deactivate", () => {
    notesVaultGraph.stop();
  });
  // Read-by-node-id only, resolved against the single graph cache — never a
  // renderer-supplied filesystem path (design.md D8/L-1). Type/bound-check
  // the arg since an XSS-in-renderer could pass anything (L1), then assert
  // the resolved path (after following symlinks) is inside the vault
  // (H3) before reading — refuses a note symlinked outside the vault
  // (e.g. `secret.md -> ~/.ssh/id_rsa`).
  ipcMain.handle("secondbrain:read-note", (_event, id) => {
    if (typeof id !== "string" || id.length === 0 || id.length > 512) return { ok: false };
    const notePath = notesVaultGraph.resolveNotePath(id);
    if (!notePath) return { ok: false }; // ghost node, unknown id, or since-removed file
    let realNotePath;
    let realVaultDir;
    try {
      realNotePath = fs.realpathSync(notePath);
      realVaultDir = fs.realpathSync(NOTES_VAULT_DIR);
    } catch {
      return { ok: false };
    }
    const withinVault = realNotePath === realVaultDir || realNotePath.startsWith(realVaultDir + path.sep);
    if (!withinVault) return { ok: false };
    try {
      return { ok: true, content: fs.readFileSync(realNotePath, "utf8") };
    } catch {
      return { ok: false };
    }
  });
  ipcMain.on("win:control", (_event, action) => {
    if (!mainWindow) return;
    if (action === "close") mainWindow.close();
    else if (action === "minimize") mainWindow.minimize();
  });
  ipcMain.handle("config:get", () => getFullConfig());
  ipcMain.handle("config:save", (_event, updates) => writeUserConfig(updates));
  ipcMain.handle("config:save-po-token", (_event, payload) => savePoToken(payload?.token));
  ipcMain.handle("config:remove-po-token", () => savePoToken("", { remove: true }));
  ipcMain.handle("config:test-gemini", (_event, payload) => testGeminiKey(payload?.key));
  ipcMain.handle("config:test-claude", () => checkClaudeHealth());
  // Renderer's boot-time read of the pipeline master switch (see design.md
  // decision 1/3) — cached, synchronous-feeling; live updates arrive over the
  // pipeline_availability sidecar event emitted whenever the value flips.
  ipcMain.handle("pipeline:status", () => ({ available: getPipelineAvailable() }));
  ipcMain.handle("config:preview-voice", (_event, payload) => previewVoice(payload || {}));
  ipcMain.on("iris:boot-done", () => GreetGate.fire());
  ipcMain.on("iris:ui-context", (_event, context) => {
    if (context && typeof context === "object") {
      setUiContextSnapshot(context);
    }
  });
  ipcMain.on("live:audio", (_event, chunk) => sendAudioChunk(chunk));
  ipcMain.on("iris:speaker-mute-state", (_event, muted) => {
    speakerMuted = Boolean(muted);
    updateTrayMenu();
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
