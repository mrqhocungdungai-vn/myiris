import electron from "electron";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawn, execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  poBillingStatus,
  poQuestionTimeoutMs,
  getOrCreatePoSession,
  deliverPoTurn,
  closePoSession,
  closeAllPoSessions,
  setPoSessionModel,
} from "./po-session.mjs";
import { parseClaudeStreamMessage } from "./claude-stream.mjs";
import { createRunQueue, RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "./run-queue.mjs";

const { app, BrowserWindow, ipcMain, session, nativeImage, Menu, dialog, Tray, screen, globalShortcut } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Name the app "Iris" (menu bar / about panel). The Dock tile fully reflects this
// only in a packaged build; in dev the generic Electron bundle name is used.
app.setName("Iris");

const iconPath = path.join(repoRoot, "build", "icon.png");
const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

function parseEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Look for .env in several places so both the dev repo run and a packaged
// Iris.app can find credentials. First match for a given key wins.
function loadEnvFile() {
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(os.homedir(), ".iris", ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
  ];
  for (const candidate of candidates) parseEnvFile(candidate);
}

loadEnvFile();
logPoBillingPathOnce();

let mainWindow = null;
let liveSession = null;
let ai = null;
let liveStatus = { running: false, pid: null };
let userTranscriptBuffer = "";
let modelTranscriptBuffer = "";
// Gemini Live closes each WebSocket connection after ~10 minutes. With
// sessionResumption enabled the server hands us refresh handles; on close we
// reconnect with the latest handle so the conversation continues seamlessly
// instead of dropping Iris back to the "Press W to wake" sleep screen.
let resumptionHandle = null;
let userStopped = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const pendingClaudeAnnouncements = [];

// Latest UI-state snapshot pushed by the renderer over iris:ui-context
// (throttled — see App.tsx). Read by the get_ui_context Gemini tool so voice
// commands like "open that" or "show history" can resolve without blocking on
// a renderer round-trip (design.md D1).
let irisUiContext = {
  tasks: [],
  expandedTaskId: null,
  focusedTaskId: null,
  latestResultTaskId: null,
  pendingTaskMatches: [],
  showHistory: false,
  uiMode: "deck",
};

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

// At most one PO turn (or DEV run) is ever mid-execution system-wide — Claude
// runs strictly one at a time (see runQueue below) — so at most one
// AskUserQuestion can be pending across the whole app. This object owns that
// single slot and the "raised → answered/expired/abandoned, exactly once"
// invariant: every settlement path (answer, expire, abandon) funnels through
// one settle() so nothing can resolve the same question twice or hang it
// forever — see openspec/changes/architecture-deepening-refactors/design.md
// decision 2 (an earlier bare-global version already caused exactly that bug).
const PendingQuestion = {
  current: null, // { workstreamId, questions, resolve, timer }

  raise(workstreamId, questions, { timeoutMs }) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.expire(), timeoutMs);
      this.current = { workstreamId, questions, resolve, timer };
      emitPoQuestionEvent(workstreamId, questions, "pending");
    });
  },

  settle(status, resolvedValue) {
    if (!this.current) return;
    const { workstreamId, questions, resolve, timer } = this.current;
    clearTimeout(timer);
    this.current = null;
    emitPoQuestionEvent(workstreamId, questions, status);
    resolve(resolvedValue);
  },

  answer(answers) {
    this.settle("answered", answers);
  },

  expire() {
    if (!this.current) return;
    emitEvent({
      type: "log",
      level: "warn",
      message: "The PO's question went unanswered — applying the recommended option for each.",
    });
    this.settle("timed_out", defaultPoAnswers(this.current.questions));
  },

  abandon(workstreamId) {
    if (!this.current || this.current.workstreamId !== workstreamId) return;
    this.settle("timed_out", defaultPoAnswers(this.current.questions));
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

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function emitEvent(event) {
  // DIAGNOSTIC: surface all events to the dev terminal (the renderer's log
  // list is not rendered, so fatal/connection errors were otherwise invisible).
  if (event?.type === "fatal") {
    console.error("[IRIS][fatal]", event.message || "", event.error || "");
  } else if (event?.type === "gemini_status" || event?.type === "sidecar_status") {
    console.log(`[IRIS][${event.type}]`, JSON.stringify(event.status ?? event));
  }
  emitToRenderer("sidecar:event", { timestamp: Date.now() / 1000, ...event });
}

function flushTranscripts() {
  if (userTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "you", text: userTranscriptBuffer.trim() });
  }
  if (modelTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
  }
  userTranscriptBuffer = "";
  modelTranscriptBuffer = "";
}

// Background work is handled by Claude Code running headless (claude -p). Each task
// spawns one non-interactive claude process streaming NDJSON progress events.
// Sessions are USER-CONTROLLED: the user picks the active session from the UI
// (or asks by voice for a new one); Gemini cannot choose or invent session ids.
// Every task resumes the active session's Claude session (--resume), tasks run
// strictly one at a time (queued), and sessions survive app restarts.
const SESSION_STORE = path.join(os.homedir(), ".iris", "claude-sessions.json");
let sessionStore = { active: null, sessions: [] };
// One task at a time, globally — see electron/run-queue.mjs. startClaudeRun and
// announceClaudeCompletion are function declarations defined later in this file;
// referencing them here is safe because they're hoisted before this line ever runs.
const runQueue = createRunQueue({
  startRun: startClaudeRun,
  emit: emitEvent,
  onFinalized: (run) =>
    announceClaudeCompletion({
      runId: run.run_id,
      task: run.task,
      status: run.status,
      output: String(run.output || "").slice(0, 2500),
    }),
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
const AGENT_ROSTER = ["po", "dev"];
const AGENT_PREFIX = "iris-";
const AGENT_LABELS = { po: "PO", dev: "DEV" };
// Roles removed when the pipeline was collapsed to PO → DEV (and later when
// STUDY was removed for the community release); their installed agent files
// are cleaned up on install.
const RETIRED_AGENTS = ["ba", "test", "devops", "study"];

// Curated model choices for the PO/DEV roles — plain Claude keeps the CLI
// default and is not part of this list. PO defaults to the strongest model
// for product thinking; DEV defaults to the cheaper/faster one for routine
// implementation and can be raised to debug a hard issue.
const MODEL_CHOICES = [
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
const MODEL_IDS = new Set(MODEL_CHOICES.map((choice) => choice.id));
const MODEL_DEFAULTS = { po: "claude-fable-5", dev: "claude-sonnet-5" };
const MODEL_ENV_VARS = { po: "IRIS_PO_MODEL", dev: "IRIS_DEV_MODEL" };

// Resolution order: the workstream's own choice, then the role's env override,
// then the hardcoded default. Plain Claude (role === null) never gets a model
// — it keeps whatever the CLI defaults to.
function resolveAgentModel(workstream, role) {
  if (!role) return null;
  const stored = workstream?.agent_models?.[role];
  if (stored) return stored;
  const envVar = MODEL_ENV_VARS[role];
  const envValue = envVar ? String(process.env[envVar] || "").trim() : "";
  if (envValue) return envValue;
  return MODEL_DEFAULTS[role] ?? null;
}

function agentKey(agent) {
  return agent ?? "default";
}

// Bring a stored workstream up to the current shape. Older builds stored a
// single claude_session_id; sessions are now kept per agent so each role owns
// its own Claude conversation.
function normalizeWorkstream(entry) {
  const workstream = { ...entry, cwd: typeof entry.cwd === "string" ? entry.cwd : null };
  if (!workstream.agent_sessions || typeof workstream.agent_sessions !== "object") {
    workstream.agent_sessions = {};
  }
  if (!workstream.agent_models || typeof workstream.agent_models !== "object") {
    workstream.agent_models = {};
  }
  if (typeof workstream.claude_session_id === "string" && workstream.claude_session_id) {
    workstream.agent_sessions.default = workstream.claude_session_id;
  }
  delete workstream.claude_session_id;
  if (!AGENT_ROSTER.includes(workstream.active_agent)) workstream.active_agent = null;
  // null means the last run used plain Claude (the "default" conversation).
  if (!AGENT_ROSTER.includes(workstream.last_agent_used)) workstream.last_agent_used = null;
  return workstream;
}

function loadSessionStore() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_STORE, "utf8"));
    if (Array.isArray(data.sessions)) {
      sessionStore = {
        active: typeof data.active === "string" ? data.active : null,
        sessions: data.sessions
          .filter((entry) => entry && typeof entry.id === "string")
          .map(normalizeWorkstream),
      };
      // One-time cleanup: sessions created before auto-naming carry a
      // meaningless "Session N" label or an old-format auto label — possibly
      // named after a folder the session has since moved away from. Rename
      // them after their current project folder; blank the pending labels
      // first so they number 01, 02, … in list order.
      const knownBases = [
        ...new Set(
          sessionStore.sessions
            .map((entry) => (entry.cwd ? path.basename(entry.cwd) : null))
            .filter(Boolean),
        ),
      ];
      const isLegacyAutoLabel = (label) =>
        /^Session \d+$/.test(label) ||
        knownBases.some(
          (base) =>
            label === base ||
            (label.startsWith(`${base} · `) && /^\d+$/.test(label.slice(base.length + 3))),
        );
      const pending = sessionStore.sessions.filter(
        (workstream) =>
          workstream.cwd &&
          isLegacyAutoLabel(workstream.label) &&
          !(isAutoLabel(workstream.label, workstream.cwd) && / · \d{2}$/.test(workstream.label)),
      );
      for (const workstream of pending) workstream.label = "";
      for (const workstream of pending) {
        workstream.label = projectSessionLabel(workstream.cwd, workstream.id);
      }
      persistSessionStore();
      return;
    }
    // Migrate the legacy flat map { irisSessionId: claudeSessionId }.
    const now = Date.now() / 1000;
    const sessions = Object.entries(data)
      .filter(([, value]) => typeof value === "string" && value)
      .map(([key, value], index) => ({
        id: crypto.randomUUID(),
        label: key === "iris-voice" ? `Session ${index + 1}` : key,
        agent_sessions: { default: value },
        agent_models: {},
        active_agent: null,
        last_agent_used: null,
        cwd: null,
        created_at: now,
        last_used_at: now,
        last_task: "",
      }));
    sessionStore = { active: sessions[0]?.id ?? null, sessions };
    persistSessionStore();
  } catch { /* first run or unreadable store */ }
}

function persistSessionStore() {
  try {
    fs.mkdirSync(path.dirname(SESSION_STORE), { recursive: true });
    fs.writeFileSync(SESSION_STORE, JSON.stringify(sessionStore, null, 2));
  } catch { /* non-fatal */ }
}

loadSessionStore();

function findWorkstream(id) {
  return sessionStore.sessions.find((entry) => entry.id === id) || null;
}

function sessionsSnapshot() {
  return { active: sessionStore.active, sessions: sessionStore.sessions };
}

function emitSessions() {
  emitEvent({ type: "claude_session", ...sessionsSnapshot() });
}

// Sessions are named after their project: "<folder> · 01", "· 02", … so the
// list reads by project instead of by meaningless number. User-given labels
// are never touched; isAutoLabel() tells the two apart.
function projectSessionLabel(cwd, excludeId) {
  if (!cwd) return null;
  const base = path.basename(cwd);
  // Next ordinal = highest existing one + 1, so renamed legacy labels
  // ("base · 2") and fresh padded ones ("base · 02") can never collide.
  let highest = 0;
  for (const entry of sessionStore.sessions) {
    if (entry.id === excludeId) continue;
    if (entry.label === base) {
      highest = Math.max(highest, 1);
    } else if (entry.label.startsWith(`${base} · `)) {
      const ordinal = Number.parseInt(entry.label.slice(base.length + 3), 10);
      if (Number.isFinite(ordinal)) highest = Math.max(highest, ordinal);
    }
  }
  return `${base} · ${String(highest + 1).padStart(2, "0")}`;
}

function isAutoLabel(label, cwd) {
  if (/^Session \d+$/.test(label)) return true;
  if (!cwd) return false;
  const base = path.basename(cwd);
  return label === base || label.startsWith(`${base} · `);
}

function createWorkstream(label) {
  const now = Date.now() / 1000;
  // A new session keeps working in the current project folder — switching
  // projects is an explicit action, not a side effect of a fresh session.
  const inheritedCwd = findWorkstream(sessionStore.active)?.cwd ?? null;
  const workstream = {
    id: crypto.randomUUID(),
    label:
      String(label || "").trim() ||
      projectSessionLabel(inheritedCwd) ||
      `Session ${sessionStore.sessions.length + 1}`,
    agent_sessions: {},
    agent_models: {},
    active_agent: null,
    last_agent_used: null,
    cwd: inheritedCwd,
    created_at: now,
    last_used_at: now,
    last_task: "",
  };
  sessionStore.sessions.push(workstream);
  const previousActiveId = sessionStore.active;
  sessionStore.active = workstream.id;
  persistSessionStore();
  emitSessions();
  announceWorkspaceUpdate();
  // Switching away from a workstream with a resident PO session: nothing will
  // deliver it another turn until the user switches back, so free the
  // subprocess now rather than leaving it idle indefinitely.
  if (previousActiveId && previousActiveId !== workstream.id) {
    PendingQuestion.abandon(previousActiveId);
    closePoSession(previousActiveId);
  }
  return workstream;
}

function activeWorkstream() {
  return findWorkstream(sessionStore.active) || createWorkstream();
}

function selectWorkstream(id) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const previousActiveId = sessionStore.active;
  sessionStore.active = workstream.id;
  persistSessionStore();
  emitSessions();
  announceWorkspaceUpdate();
  if (previousActiveId && previousActiveId !== workstream.id) {
    PendingQuestion.abandon(previousActiveId);
    closePoSession(previousActiveId);
  }
  return { status: "ok", ...sessionsSnapshot() };
}

function setWorkstreamCwd(id, dir) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const cwd = String(dir || "").trim() || null;
  if (cwd && !fs.existsSync(cwd)) {
    return { status: "error", error: `Folder not found: ${cwd}` };
  }
  if (workstream.cwd !== cwd) {
    const wasAutoNamed = isAutoLabel(workstream.label, workstream.cwd);
    // Claude Code stores conversations per project directory, so session ids
    // recorded in the old folder cannot be resumed from the new one. A resident
    // PO session is bound to the OLD cwd, so it must end here too — otherwise
    // its next turn would run in a directory it no longer matches.
    PendingQuestion.abandon(workstream.id);
    closePoSession(workstream.id);
    workstream.agent_sessions = {};
    workstream.last_agent_used = null;
    workstream.cwd = cwd;
    if (cwd && wasAutoNamed) {
      workstream.label = projectSessionLabel(cwd, workstream.id);
    }
    persistSessionStore();
    emitSessions();
    announceWorkspaceUpdate();
    emitEvent({
      type: "log",
      level: "info",
      message: `Claude session "${workstream.label}" now works in ${cwd || "the default workspace"} (fresh Claude context).`,
    });
  }
  return { status: "ok", ...sessionsSnapshot() };
}

// Selecting a role never touches stored sessions — each role keeps its own
// continuous conversation, so flipping the picker back and forth costs nothing.
function setWorkstreamAgent(id, agent) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const clean = agent ? String(agent).trim().toLowerCase() : null;
  if (clean !== null && !AGENT_ROSTER.includes(clean)) {
    return { status: "error", error: `Unknown agent: ${agent}` };
  }
  if (workstream.active_agent !== clean) {
    workstream.active_agent = clean;
    persistSessionStore();
    emitSessions();
    announceWorkspaceUpdate();
    announceAgentSelection(workstream);
  }
  return { status: "ok", ...sessionsSnapshot() };
}

// Shared by the UI (agents:set-model IPC) and the Gemini voice tool
// (set_agent_model) — a single choke point so both paths can never diverge.
// If PO's model changes while its live session is resident, the change is
// applied via setModel() on the next run start (see startPoRun), never by
// closing/resuming the session — that would needlessly drop context.
function setAgentModel(workstreamId, role, model) {
  const workstream = findWorkstream(workstreamId);
  if (!workstream) return { status: "error", error: `Unknown session: ${workstreamId}` };
  const cleanRole = String(role || "").trim().toLowerCase();
  if (!AGENT_ROSTER.includes(cleanRole)) {
    return { status: "error", error: `Model selection is only available for the ${AGENT_ROSTER.map((r) => AGENT_LABELS[r]).join("/")} roles, not "${role}".` };
  }
  const cleanModel = String(model || "").trim();
  if (!MODEL_IDS.has(cleanModel)) {
    return { status: "error", error: `Unknown model: ${model}` };
  }
  if (workstream.agent_models[cleanRole] !== cleanModel) {
    workstream.agent_models[cleanRole] = cleanModel;
    persistSessionStore();
    emitEvent({ type: "agent_model_update", workstream_id: workstream.id, role: cleanRole, model: cleanModel });
  }
  return { status: "ok", ...sessionsSnapshot() };
}

// Single delivery mechanism for every SYSTEM_EVENT_* voice announcement: send
// immediately if the live session is connected, otherwise buffer (unless the
// caller opts out) so a state change that lands mid-reconnect is delivered on
// reconnect instead of silently lost.
function notifyIris(lines, { bufferIfOffline = true } = {}) {
  const text = Array.isArray(lines) ? lines.join("\n") : lines;
  if (liveSession) {
    liveSession.sendRealtimeInput({ text });
  } else if (bufferIfOffline) {
    pendingClaudeAnnouncements.push(text);
  }
}

// Switching to a pipeline role is the start of a conversation, not a silent
// config change: Iris must open it — a fresh PO gets the pm-guide question
// ("how did this project start?"), a returning role gets a where-were-we.
function announceAgentSelection(workstream) {
  const role = workstream.active_agent;
  if (!role) return; // back to plain Iris — no ceremony needed
  const existing = workstream.agent_sessions?.[agentKey(role)] || null;
  const lines = [
    "SYSTEM_EVENT_AGENT_SELECT",
    `role: ${AGENT_LABELS[role] ?? role}`,
    `project: ${workstream.cwd || "the default workspace"}`,
    `existing_claude_conversation: ${existing ?? "none — the next task creates one"}`,
    "instructions_to_iris:",
  ];
  if (role === "po") {
    if (existing) {
      lines.push(
        "- Proactively speak: you are in Product Owner mode and the PO's ongoing Claude conversation is preserved — nothing needs re-explaining.",
        "- Ask ONE short question: continue where you left off (pending decisions, the next feature), or start something new?",
      );
    } else {
      lines.push(
        "- Proactively speak: you are now in Product Owner mode for this project.",
        "- Ask ONE short question: what do they want to build or change?",
        "- After they answer, follow PRODUCT OWNER CONTROL from your instructions: send the PO a SHORT control intent that forwards the request and tells it to grill. Do NOT interview them yourself or write a PRD — the PO grills and asks you questions back by voice.",
      );
    }
  } else if (role === "dev") {
    lines.push(
      existing
        ? "- Proactively speak: you are in Developer mode; the DEV's ongoing Claude conversation is preserved."
        : "- Proactively speak: you are in Developer mode; the next task implements the open OpenSpec change the PO proposed.",
      "- Tell DEV to implement the remaining tasks of the open change (or name a specific change if the user did). If the PO has not proposed a change yet, say so — DEV needs one first.",
    );
  }
  lines.push("- Speak in the user's language. Keep it short and conversational — one or two sentences plus the question.");
  notifyIris(lines);
}

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

// What Iris (the voice model) is allowed to know about the current workspace:
// the active session, its project folder, and the active pipeline role.
function workspaceInfo() {
  const workstream = findWorkstream(sessionStore.active);
  const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  return {
    session_label: workstream?.label ?? null,
    project_folder: cwd,
    project_name: cwd ? path.basename(cwd) : null,
    active_role: workstream?.active_agent ? AGENT_LABELS[workstream.active_agent] : null,
    note: cwd
      ? `Claude's file/terminal work for this session happens inside ${cwd}.`
      : "No project folder is selected for this session — Claude falls back to the default workspace (~/.iris/workspace). The user can pick a folder from the UI.",
  };
}

function workspaceContextLine() {
  const info = workspaceInfo();
  const folder = info.project_folder
    ? `project folder ${info.project_folder} (project "${info.project_name}")`
    : "no project folder selected yet (Claude falls back to the default workspace)";
  const role = info.active_role ? `, active role: ${info.active_role}` : "";
  return `Current workspace: session "${info.session_label ?? "none"}", ${folder}${role}.`;
}

// Keep the live voice session in sync when the user changes workspace state
// from the UI — otherwise Iris only ever knows what the system prompt said at
// connect time and cannot answer "which project are we working in?".
function announceWorkspaceUpdate() {
  notifyIris([
    "SYSTEM_EVENT_WORKSPACE_UPDATE",
    workspaceContextLine(),
    "instructions_to_iris: silently remember this as the current workspace state. Do NOT speak or respond to this message.",
  ]);
}

function userDisplayName() {
  return (process.env.IRIS_USER_NAME || process.env.USER || process.env.USERNAME || "there").trim();
}

function claudeBinary() {
  if (process.env.IRIS_CLAUDE_BIN) return process.env.IRIS_CLAUDE_BIN;
  // A packaged .app does not inherit the shell PATH, so probe common installs.
  const known = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "claude";
}

// Same PATH-probe rationale as claudeBinary(): a packaged .app does not inherit
// the shell PATH, and the OpenSpec CLI (the SDD engine the pipeline runs on) is
// typically installed under ~/.local/bin. Override with IRIS_OPENSPEC_BIN.
function openspecBinary() {
  if (process.env.IRIS_OPENSPEC_BIN) return process.env.IRIS_OPENSPEC_BIN;
  const known = [
    path.join(os.homedir(), ".local", "bin", "openspec"),
    "/usr/local/bin/openspec",
    "/opt/homebrew/bin/openspec",
  ];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "openspec";
}

// A `cwd` is OpenSpec-ready once it has an `openspec/` directory (created by
// `openspec init`). The pipeline uses OpenSpec as its only SDD surface.
function hasOpenSpec(cwd) {
  try {
    return fs.statSync(path.join(cwd, "openspec")).isDirectory();
  } catch {
    return false;
  }
}

// Names of active (non-archived) OpenSpec changes in `cwd` whose tasks.md still
// has at least one unchecked `- [ ]` task. DEV runs are gated on this being
// non-empty (see startClaudeRun): no open change with work → no DEV run.
function openChangesWithTasks(cwd) {
  const out = [];
  try {
    const changesDir = path.join(cwd, "openspec", "changes");
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
      const tasksMd = path.join(changesDir, entry.name, "tasks.md");
      try {
        if (/^\s*-\s*\[\s\]/m.test(fs.readFileSync(tasksMd, "utf8"))) out.push(entry.name);
      } catch { /* no tasks.md yet — not an implementable change */ }
    }
  } catch { /* no openspec/changes — none */ }
  return out;
}

function claudeWorkdir() {
  const dir = process.env.IRIS_CLAUDE_CWD || path.join(os.homedir(), ".iris", "workspace");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function checkClaudeStatus() {
  return new Promise((resolve) => {
    execFile(claudeBinary(), ["--version"], { timeout: 15000 }, (error, stdout) => {
      if (error) {
        emitEvent({ type: "claude_status", status: "error", error: error.message });
        resolve({ reachable: false, error: error.message });
      } else {
        const health = { version: String(stdout).trim(), binary: claudeBinary() };
        emitEvent({ type: "claude_status", status: "ready", detail: health });
        resolve({ reachable: true, health });
      }
    });
  });
}

// Single source of truth for whether the PO → DEV pipeline is available —
// determined solely by the `claude` binary resolving (see design.md decision
// 1). Chat-only mode (no Claude tools declared to Gemini, no pipeline prompt
// content, pipeline UI hidden) is the default until this flips true.
// CLAUDE_CODE_OAUTH_TOKEN is deliberately NOT part of this check — it only
// gates individual PO turns via poBillingStatus(), never the master switch.
let pipelineAvailable = false;

async function probePipelineAvailability() {
  const status = await checkClaudeStatus();
  const next = Boolean(status.reachable);
  if (next !== pipelineAvailable) {
    pipelineAvailable = next;
    emitEvent({ type: "pipeline_availability", available: pipelineAvailable });
  }
  return { available: pipelineAvailable, status };
}

async function checkOpenSpecStatus() {
  return new Promise((resolve) => {
    execFile(openspecBinary(), ["--version"], { timeout: 15000 }, (error, stdout) => {
      if (error) resolve({ ok: false, error: error.message });
      else resolve({ ok: true, version: String(stdout).trim() });
    });
  });
}

// Skills the PO/DEV personas invoke by name (resources/personas/iris-po.md,
// iris-dev.md) — the OpenSpec workflow skills plus mattpocock's. Presence-only
// probe (pipeline-availability spec): a directory existing under
// ~/.claude/skills means "detected", not semantically validated — deeper
// problems still surface through normal PO/DEV run errors.
const REQUIRED_SKILLS = [
  "grilling",
  "openspec-propose",
  "openspec-apply-change",
  "openspec-archive-change",
  "tdd",
  "verify",
  "code-review",
  "diagnosing-bugs",
];

function checkSkillsStatus() {
  const skillsDir = path.join(os.homedir(), ".claude", "skills");
  const missing = REQUIRED_SKILLS.filter((name) => !fs.existsSync(path.join(skillsDir, name)));
  return { ok: missing.length === 0, missing, skillsDir };
}

// Combined status for the SetupPanel's Claude section (design.md D3b/D3c):
// CLI reachability (same probe as checkClaudeStatus), the PO subscription
// billing-path status, and the openspec CLI / global skills prerequisite
// checks (pipeline-availability spec) — all read-only, never editable from
// the UI. Also the SetupPanel's re-check path for pipeline availability
// (design.md decision 1).
async function checkClaudeHealth() {
  const { available, status } = await probePipelineAvailability();
  const billing = poBillingStatus();
  const openspecStatus = await checkOpenSpecStatus();
  const skillsStatus = checkSkillsStatus();
  return {
    reachable: available,
    pipelineAvailable: available,
    version: status.health?.version,
    error: status.error,
    billingOk: billing.ok,
    billingError: billing.ok
      ? undefined
      : "No CLAUDE_CODE_OAUTH_TOKEN set — PO turns will fail until you run `claude setup-token`.",
    openspecOk: openspecStatus.ok,
    openspecVersion: openspecStatus.version,
    openspecInstallHint: "npm install -g @fission-ai/openspec@latest",
    skillsOk: skillsStatus.ok,
    missingSkills: skillsStatus.missing,
    skillsInstallHint: "npx skills@latest add mattpocock/skills  (see also github.com/Fission-AI/OpenSpec for its Claude skills)",
  };
}

// ===== Onboarding / Settings (design.md D3/D4) =====
function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function sleepDelayMs() {
  const parsed = Number(process.env.IRIS_SLEEP_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede",
  "Leda", "Orus", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
];
const GEMINI_LIVE_MODELS = ["models/gemini-3.1-flash-live-preview"];
const ALLOWED_CONFIG_KEYS = new Set([
  "GEMINI_API_KEY",
  "GEMINI_LIVE_MODEL",
  "GEMINI_LIVE_VOICE",
  "IRIS_USER_NAME",
  "IRIS_LOAD_TEST_DATA",
  "IRIS_WAKE_WORD",
]);

// Repo .env in dev, ~/.iris/.env in a packaged build — the same location
// loadEnvFile() already reads from, so a save takes effect without restart.
function userConfigPath() {
  return app.isPackaged ? path.join(os.homedir(), ".iris", ".env") : path.join(repoRoot, ".env");
}

function ensureIncludes(list, value) {
  if (value && !list.includes(value)) return [value, ...list];
  return list;
}

// Full settings snapshot for the SetupPanel. Values come from process.env
// (populated from .env at boot and updated live on save).
function getFullConfig() {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
    geminiVoice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
    userName: process.env.IRIS_USER_NAME || "",
    loadTestData: envFlag("IRIS_LOAD_TEST_DATA", false),
    wakeWord: envFlag("IRIS_WAKE_WORD", true),
    configured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
    voices: GEMINI_VOICES,
    models: ensureIncludes(GEMINI_LIVE_MODELS, process.env.GEMINI_LIVE_MODEL),
    configPath: userConfigPath(),
  };
}

function serializeConfigValue(value) {
  const str = String(value ?? "").trim();
  return /[\s"#]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

// Merge updates into the effective .env (preserving comments/other keys) and
// apply them to process.env so they take effect on the next wake without a
// full restart. Never logs secret values (design.md D4).
function writeUserConfig(rawUpdates) {
  const updates = {};
  for (const [key, value] of Object.entries(rawUpdates || {})) {
    if (ALLOWED_CONFIG_KEYS.has(key)) updates[key] = value;
  }
  if (!Object.keys(updates).length) return getFullConfig();

  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(updates));
  const out = [];
  for (const line of existing) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
    if (remaining.has(key)) {
      out.push(`${key}=${serializeConfigValue(updates[key])}`);
      remaining.delete(key);
    } else {
      out.push(line);
    }
  }
  for (const key of remaining) out.push(`${key}=${serializeConfigValue(updates[key])}`);

  fs.writeFileSync(file, `${out.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  for (const [key, value] of Object.entries(updates)) process.env[key] = String(value ?? "").trim();
  return getFullConfig();
}

// Validate a Gemini key by forcing one authenticated round-trip (ListModels).
async function testGeminiKey(candidateKey) {
  const key = (candidateKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) return { ok: false, error: "No API key provided." };
  try {
    const testAi = new GoogleGenAI({ apiKey: key });
    const pager = await testAi.models.list();
    for await (const _model of pager) break;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

// Speak a short sample with the chosen voice via a throwaway Live session. Audio
// streams to the renderer over the existing live:audio channel.
let previewSession = null;
async function previewVoice(payload = {}) {
  if (liveSession) return { ok: false, error: "Sleep Iris before previewing a voice." };
  const apiKey = (payload.key || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "Save your Gemini key first." };
  const voiceName = payload.voice || process.env.GEMINI_LIVE_VOICE || "Zephyr";
  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
  try {
    if (previewSession) {
      try { previewSession.close(); } catch { /* ignore */ }
      previewSession = null;
    }
    const previewAi = new GoogleGenAI({ apiKey });
    previewSession = await previewAi.live.connect({
      model,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        systemInstruction: {
          parts: [{ text: "You are a short voice sample. Say exactly the line you are asked to say, nothing more." }],
        },
      },
      callbacks: {
        onmessage(message) {
          const content = message.serverContent;
          if (!content) return;
          for (const part of content.modelTurn?.parts || []) {
            const inlineData = part.inlineData;
            if (inlineData?.data && (inlineData.mimeType || "").startsWith("audio/")) {
              emitToRenderer("live:audio", { data: inlineData.data, mimeType: inlineData.mimeType });
            }
          }
          if (content.turnComplete) {
            try { previewSession?.close(); } catch { /* ignore */ }
            previewSession = null;
          }
        },
        onerror() { previewSession = null; },
        onclose() { previewSession = null; },
      },
    });
    // Send AFTER connect resolves: onopen can fire before the session variable is
    // assigned, so triggering inside onopen would no-op (silent preview).
    previewSession.sendRealtimeInput({
      text: `Say exactly: Hi, I'm Iris. This is the ${voiceName} voice.`,
    });
    return { ok: true };
  } catch (error) {
    previewSession = null;
    return { ok: false, error: error?.message || String(error) };
  }
}

function rememberClaudeSessionId(run, claudeSessionId) {
  if (!claudeSessionId) return;
  run.claude_session_id = claudeSessionId;
  const workstream = findWorkstream(run.workstream_id);
  if (!workstream) return;
  const key = agentKey(run.agent);
  const changed =
    workstream.agent_sessions[key] !== claudeSessionId ||
    workstream.last_agent_used !== (run.agent ?? null);
  workstream.agent_sessions[key] = claudeSessionId;
  workstream.last_agent_used = run.agent ?? null;
  workstream.last_used_at = Date.now() / 1000;
  workstream.last_task = run.task.slice(0, 100);
  persistSessionStore();
  if (changed) emitSessions();
}

function pushActivity(run, line) {
  const clean = String(line || "").trim();
  if (!clean) return;
  run.activity.push(clean.length > 220 ? `${clean.slice(0, 220)}…` : clean);
  if (run.activity.length > 80) run.activity.splice(0, run.activity.length - 80);
  emitEvent(toUpdateEvent(run, RUN_STATUS.RUNNING, { output: run.activity.join("\n") }));
}

// Live per-task step timeline: additive fields on the SAME claude_task_update
// projection (no new event type), keyed by Claude's own tool_use id so
// start/end pairing survives duplicate tool names within one run. See
// openspec/changes/two-hand-gestures-and-orb design.md D2.
function pushToolStart(run, toolId, toolName, detail) {
  if (!toolId) return;
  if (!run.toolStartedAt) run.toolStartedAt = new Map();
  run.toolStartedAt.set(toolId, Date.now());
  emitEvent(
    toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_start", tool: toolName, tool_id: toolId, detail }),
  );
}

function pushToolEnd(run, toolId, isError) {
  if (!toolId) return;
  const startedAt = run.toolStartedAt?.get(toolId);
  const duration = startedAt ? (Date.now() - startedAt) / 1000 : undefined;
  run.toolStartedAt?.delete(toolId);
  emitEvent(
    toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_end", tool_id: toolId, error: isError, duration }),
  );
}

function handleClaudeStreamEvent(run, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  parseClaudeStreamMessage(event, {
    onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
    onActivity: (text) => pushActivity(run, text),
    onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
    onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
    onResult: (result) => {
      run.result = result;
      rememberClaudeSessionId(run, result.session_id);
    },
  });
}

function runProjectDir(run) {
  const projectDir = findWorkstream(run.workstream_id)?.cwd;
  if (projectDir && fs.existsSync(projectDir)) return projectDir;
  return claudeWorkdir();
}

function globalAgentsDir() {
  return path.join(os.homedir(), ".claude", "agents");
}

// Roles install globally (~/.claude/agents) so they work in any project, but a
// project-local .claude/agents copy wins if the user customized one there.
function installedAgentFile(agent, cwd) {
  const name = `${AGENT_PREFIX}${agent}.md`;
  const candidates = [
    cwd ? path.join(cwd, ".claude", "agents", name) : null,
    path.join(globalAgentsDir(), name),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function personasSourceDir() {
  const candidates = [
    path.join(repoRoot, "resources", "personas"),
    process.resourcesPath ? path.join(process.resourcesPath, "personas") : null,
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function installIrisAgents() {
  const sourceDir = personasSourceDir();
  if (!sourceDir) {
    return { status: "error", error: "Persona templates were not found in the app bundle.", installed: [], skipped: [], errors: [] };
  }
  const targetDir = globalAgentsDir();
  const installed = [];
  const skipped = [];
  const removed = [];
  const errors = [];
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    return { status: "error", error: `Could not create ${targetDir}: ${error.message}`, installed, skipped, errors };
  }
  for (const agent of AGENT_ROSTER) {
    const name = `${AGENT_PREFIX}${agent}.md`;
    try {
      const source = path.join(sourceDir, name);
      const target = path.join(targetDir, name);
      if (!fs.existsSync(source)) {
        errors.push(`${name}: template missing from the app bundle`);
        continue;
      }
      // "Install agents" is an explicit user action: always sync the installed
      // copy to the bundled template so prompt updates actually land.
      const content = fs.readFileSync(source, "utf8");
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
        skipped.push(name);
        continue;
      }
      fs.writeFileSync(target, content);
      installed.push(name);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  for (const agent of RETIRED_AGENTS) {
    const name = `${AGENT_PREFIX}${agent}.md`;
    try {
      const target = path.join(targetDir, name);
      if (fs.existsSync(target)) {
        fs.rmSync(target);
        removed.push(name);
      }
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  emitEvent({
    type: "log",
    level: errors.length ? "warn" : "info",
    message: `Iris agents: ${installed.length} installed/updated, ${skipped.length} already current, ${removed.length} retired removed in ${targetDir}${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
  });
  return { status: errors.length ? "partial" : "ok", installed, skipped, removed, errors };
}

// OpenSpec is the pipeline's only SDD surface (see the po-voice-controller
// change). A fresh project `cwd` is made OpenSpec-ready with `openspec init`
// instead of the old hand-written `.scratch/` + CONTEXT.md + docs/agents seeding.
// The PO agent then produces changes under `openspec/changes/`, and archiving
// syncs deltas into `openspec/specs/`. No-op if `openspec/` already exists so an
// existing OpenSpec setup is never disturbed.
function ensureProjectScaffold(cwd) {
  if (hasOpenSpec(cwd)) return { created: [] };
  try {
    // `openspec init` is interactive by default; `--tools claude` runs it
    // non-interactively and writes the Claude slash-commands (verified against
    // openspec 1.6.0). Point it at `cwd` explicitly rather than relying on the
    // child's own cwd.
    execFileSync(openspecBinary(), ["init", cwd, "--tools", "claude"], {
      stdio: "ignore",
      timeout: 60000,
    });
    return { created: hasOpenSpec(cwd) ? ["openspec/"] : [] };
  } catch (error) {
    return { created: [], error: `openspec init failed: ${error.message}` };
  }
}

function agentDescription(filePath) {
  try {
    const head = fs.readFileSync(filePath, "utf8").slice(0, 2000);
    const match = /^description:\s*(.+)$/m.exec(head);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

// The most recently modified active (non-archived) OpenSpec change in `cwd`, or
// null. This is the "current feature" the pipeline UI reports gates for.
function latestOpenChange(cwd) {
  try {
    const changesDir = path.join(cwd, "openspec", "changes");
    let best = null;
    let bestTime = -1;
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
      const mtime = fs.statSync(path.join(changesDir, entry.name)).mtimeMs;
      if (mtime > bestTime) {
        bestTime = mtime;
        best = entry.name;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Snapshot for the pipeline UI: which roles are installed, and — for the
// workstream's project folder — which gates have been passed for the current
// OpenSpec change. PO gate = a proposal exists (the change was proposed); DEV
// gate = every task in tasks.md is checked (implementation complete).
function agentsSnapshot(workstreamId) {
  const workstream = findWorkstream(workstreamId) || findWorkstream(sessionStore.active);
  const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  const roster = AGENT_ROSTER.map((agent) => {
    const file = installedAgentFile(agent, cwd);
    return {
      key: agent,
      label: AGENT_LABELS[agent],
      installed: Boolean(file),
      description: file ? agentDescription(file) : "",
      model: resolveAgentModel(workstream, agent),
    };
  });
  const gates = { slug: null, byRole: {} };
  if (cwd) {
    gates.slug = latestOpenChange(cwd);
    if (gates.slug) {
      const changeDir = path.join(cwd, "openspec", "changes", gates.slug);
      gates.byRole.po = fs.existsSync(path.join(changeDir, "proposal.md"));
      // DEV gate passes when tasks.md exists and has no unchecked `- [ ]` left.
      let devDone = false;
      try {
        const tasks = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf8");
        devDone = !/^\s*-\s*\[\s\]/m.test(tasks);
      } catch { devDone = false; }
      gates.byRole.dev = devDone;
    }
  }
  return {
    roster,
    installed: roster.every((entry) => entry.installed),
    hasProject: Boolean(cwd),
    gates,
  };
}

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

// The stateless module: unchanged one-shot `claude -p` subprocess per run,
// exactly as before this change — mechanism AND auth (process.env, `/login`).
function startDevRun(run) {
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
  const args = [
    "-p", run.task,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions",
    "--append-system-prompt",
    "You are invoked from Iris voice. Work autonomously. Do not ask for clarification unless absolutely impossible. Use sensible defaults and report concise final results.",
  ];
  if (run.agent) args.push("--agent", `${AGENT_PREFIX}${run.agent}`);
  if (run.model) args.push("--model", run.model);

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
      env: process.env,
    });
  } catch (error) {
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
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
  });
  child.on("close", (code) => {
    if (run.status === RUN_STATUS.CANCELLED) {
      runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return;
    }
    const result = run.result;
    if (code === 0 && result && !result.is_error) {
      runQueue.finalize(run.run_id, RUN_STATUS.COMPLETED, String(result.result ?? ""));
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
function startPoRun(run) {
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
    });
  } catch (error) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start PO session: ${error.message}`);
    return;
  }

  // The session may already be live on an older model (created before a
  // queued model change) — switch it via setModel() so the turn about to run
  // uses the current choice with the session's context fully preserved,
  // instead of closing/resuming just to change models.
  const modelReady =
    state.currentModel === run.model ? Promise.resolve() : setPoSessionModel(state, run.model);

  modelReady
    .catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch PO's live session model: ${error.message}` });
    })
    .then(() =>
      deliverPoTurn(state, run.task, {
        onActivity: (line) => pushActivity(run, line),
        onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
        onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
        onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      }),
    )
    .then((result) => runQueue.finalize(run.run_id, result.status, result.output))
    .catch((error) => runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `PO session error: ${error.message}`));
}

async function submitClaudeTask({ task, urgency = "normal", agent } = {}) {
  if (!task || !String(task).trim()) {
    return { status: "error", error: "Task is required." };
  }
  const cleanTask = String(task).trim();
  const workstream = activeWorkstream();
  // The role is captured at enqueue time: a queued task keeps the agent it was
  // submitted under even if the user flips the pipeline picker afterwards.
  // Gemini may name a role explicitly; anything not in the roster is ignored.
  const requestedAgent = agent ? String(agent).trim().toLowerCase() : null;
  if (requestedAgent && !AGENT_ROSTER.includes(requestedAgent)) {
    emitEvent({ type: "log", level: "warn", message: `Ignoring unknown agent "${agent}" — using the session's active agent.` });
  }
  const runAgent = AGENT_ROSTER.includes(requestedAgent) ? requestedAgent : workstream.active_agent ?? null;
  const agentLabel = runAgent ? `${AGENT_LABELS[runAgent]} agent` : "Claude";
  const projectFolder = workstream.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  const whereNote = projectFolder
    ? `Working in project folder ${projectFolder}.`
    : "No project folder is selected — working in the default workspace.";
  const runId = crypto.randomUUID();
  const run = {
    run_id: runId,
    workstream_id: workstream.id,
    session_label: workstream.label,
    task: cleanTask,
    urgency,
    agent: runAgent,
    status: RUN_STATUS.QUEUED,
    output: "",
    activity: [],
    queued_at: Date.now() / 1000,
    child: null,
  };

  const outcome = runQueue.submit(run);
  if (outcome.status === "queued") {
    return {
      status: "queued",
      run_id: runId,
      position: outcome.position,
      project_folder: projectFolder,
      message: `Claude is still finishing the current task. This one is queued at position ${outcome.position} for the ${agentLabel} and will start automatically. ${whereNote}`,
    };
  }
  return {
    status: "started",
    run_id: runId,
    agent: runAgent,
    project_folder: projectFolder,
    message: `${runAgent ? `Claude's ${agentLabel} has started the task.` : "Claude has started the task."} ${whereNote}`,
  };
}

async function startNewClaudeSession({ label } = {}) {
  const workstream = createWorkstream(label);
  emitEvent({ type: "log", level: "info", message: `Claude: started a fresh session (${workstream.label}).` });
  return {
    status: "ok",
    message: `Started a fresh Claude session named ${workstream.label}. New tasks begin with a clean slate; tasks already running are not affected.`,
    session: { id: workstream.id, label: workstream.label },
  };
}

async function getClaudeTaskStatus({ run_id }) {
  const serialized = runQueue.serialize(run_id);
  if (!serialized) return { status: "error", error: `Unknown run: ${run_id}` };
  return serialized;
}

async function stopClaudeTask({ run_id }) {
  const status = runQueue.stop(run_id);
  if (status == null) return { status: "error", error: `Unknown run: ${run_id}` };
  return { status, run_id };
}

// Voice path for switching a role's model — goes through the exact same
// setAgentModel() choke point the UI popover uses, so the two can never
// diverge. Always targets the active workstream (Gemini never invents ids).
function setAgentModelTool({ role, model } = {}) {
  const workstream = activeWorkstream();
  const result = setAgentModel(workstream.id, role, model);
  if (result.status === "error") return result;
  const label = MODEL_CHOICES.find((choice) => choice.id === model)?.label ?? model;
  return { status: "ok", message: `${AGENT_LABELS[role] ?? role}'s model is now ${label}.` };
}

// Voice-driven UI control (design.md D1/D2, spec voice-ui-control). Single
// tool with an action enum — mirrors the {action, target_id?, query?} shape
// forwarded verbatim to the renderer over iris:ui-action. Renamed from
// upstream's Hermes vocabulary to Claude terms; no other change.
const UI_ACTIONS = new Set([
  "open_task",
  "open_task_by_query",
  "open_current_claude_result",
  "open_latest_claude_result",
  "open_claude_history",
  "close_reader",
  "close_history",
  "close_all_overlays",
  "show_task_steps",
  "hide_task_steps",
]);

function getUiContext() {
  return irisUiContext;
}

function controlUi({ action, target_id = undefined, query = undefined } = {}) {
  if (!UI_ACTIONS.has(action)) {
    return { status: "error", error: `Unknown UI action: ${action}` };
  }
  emitToRenderer("iris:ui-action", { action, target_id, query });
  return { status: "sent", action, target_id, query };
}

// Tools that only make sense when the pipeline is available — declared to
// Gemini only when pipelineAvailable is true (see buildClaudeTools). This
// guard is a defensive backstop, not the primary gate: Gemini should never
// call one of these in chat-only mode since it was never given the
// declaration, but a stray call (e.g. a race right after availability drops)
// gets a clean error instead of throwing.
const PIPELINE_ONLY_TOOLS = new Set([
  "check_claude_status",
  "submit_claude_task",
  "get_claude_task_status",
  "stop_claude_task",
  "start_new_claude_session",
  "get_workspace_info",
  "answer_po_question",
  "set_agent_model",
]);

async function executeClaudeTool(name, args = {}) {
  if (PIPELINE_ONLY_TOOLS.has(name) && !pipelineAvailable) {
    return { status: "error", error: "The Claude pipeline is not available on this machine — install the Claude CLI to enable it (see Settings)." };
  }
  switch (name) {
    case "check_claude_status":
      return checkClaudeStatus();
    case "submit_claude_task":
      return submitClaudeTask(args);
    case "get_claude_task_status":
      return getClaudeTaskStatus(args);
    case "stop_claude_task":
      return stopClaudeTask(args);
    case "start_new_claude_session":
      return startNewClaudeSession(args);
    case "get_workspace_info":
      return workspaceInfo();
    case "answer_po_question":
      return resolvePendingPoQuestion(args.answers);
    case "set_agent_model":
      return setAgentModelTool(args);
    case "get_ui_context":
      return getUiContext();
    case "control_ui":
      return controlUi(args);
    case "go_to_sleep":
      // Give the goodbye a moment to play before the renderer tears down
      // audio (its stop() flushes playback immediately).
      setTimeout(() => emitToRenderer("iris:sleep", {}), sleepDelayMs());
      return {
        status: "sleeping",
        instructions: `Say a one-line goodbye right now (nothing else, no new topics). Iris goes to sleep in about ${Math.round(sleepDelayMs() / 1000)} seconds.`,
      };
    default:
      return { status: "error", error: `Unknown tool: ${name}` };
  }
}

// The PO's recommended choice for each question, used both as the AskUserQuestion
// convention (first option = recommended) and as the safe default on timeout/reset.
function defaultPoAnswers(questions) {
  const answers = {};
  for (const q of questions) {
    answers[q.question] = q.options?.[0]?.label ?? "";
  }
  return answers;
}

// The event type stays `po_question` for renderer/IPC back-compat.
function emitPoQuestionEvent(workstreamId, questions, status) {
  emitEvent({ type: "po_question", workstream_id: workstreamId, status, questions });
}

// canUseTool's onAskUserQuestion callback (electron/po-session.mjs): pauses
// the PO's live turn, relays the question(s) to Gemini voice, and resolves
// once an answer arrives — via the Gemini tool, the UI IPC channel, or
// PendingQuestion's own timeout fallback. Only one run executes globally at a
// time, so at most one question is ever pending. See the voice-decision-relay
// spec.
function askUserQuestionViaVoice(workstreamId, questions) {
  const promise = PendingQuestion.raise(workstreamId, questions, { timeoutMs: poQuestionTimeoutMs() });

  const lines = [
    "SYSTEM_EVENT_PO_QUESTION",
    "instructions_to_iris:",
    "- The PO has paused to ask you something. Read each question aloud with its options, in order, and collect the user's answer for each.",
    "- Once you have every answer, call answer_po_question with one entry per question (question text verbatim, and the option label the user chose).",
    "- If asked for your recommendation, suggest the first-listed option, but submit whatever the user actually picks.",
    "questions:",
    ...questions.map(
      (q, i) =>
        `${i + 1}. ${q.question}\n${(q.options || [])
          .map((opt, j) => `   ${j + 1}) ${opt.label} — ${opt.description}`)
          .join("\n")}`,
    ),
  ].join("\n");
  notifyIris(lines);

  return promise;
}

// Text the user typed/pasted instead of saying it aloud (a link, a note) —
// voice can't reliably dictate this. Delivered as one more SYSTEM_EVENT_* so
// Gemini reacts to it exactly like everything else in the live conversation.
// Deliberately never buffered: the composer UI disables itself while asleep,
// so there is nothing worth redelivering on reconnect (design.md decision 6).
function sendContextSupplement(text) {
  const clean = String(text || "").trim();
  if (!clean) return { status: "error", error: "Empty supplement text." };
  const lines = [
    "SYSTEM_EVENT_CONTEXT_SUPPLEMENT",
    `supplement: ${clean}`,
    "instructions_to_iris:",
    "- The user just typed/pasted this instead of saying it aloud (voice can't reliably convey links or precise text).",
    "- CRITICAL: be decisive — do not ask for confirmation first.",
    "- Immediately call submit_claude_task with a brief that combines the recent conversation with this supplement (e.g. research the linked repo for a feature relevant to what you were just discussing, and report whether/how it applies here).",
    "- Do not set the agent field — let it route to whichever role is already active for this session.",
  ].join("\n");
  notifyIris(lines, { bufferIfOffline: false });
  return { status: "ok" };
}

// Voice (Gemini tool) and the UI (IPC) both call this; whichever answers first
// wins — the second call is a no-op since PendingQuestion is already settled.
function resolvePendingPoQuestion(answers) {
  if (!PendingQuestion.current) return { status: "error", error: "No PO question is pending." };
  const map = {};
  for (const entry of Array.isArray(answers) ? answers : []) {
    if (entry?.question) map[entry.question] = entry.choice ?? "";
  }
  PendingQuestion.answer(map);
  return { status: "ok" };
}

function announceClaudeCompletion({ runId, task, status, output }) {
  const eventText = [
    "SYSTEM_EVENT_CLAUDE_COMPLETE",
    `run_id: ${runId}`,
    `status: ${status}`,
    `original_task: ${task}`,
    "instructions_to_iris:",
    `- Proactively tell ${userDisplayName()} Claude has returned.`,
    "- If another conversation is in progress, politely pause it with a short bridge like: Quick update, Claude is back with a result.",
    "- Give a concise spoken summary in 1-3 sentences.",
    "- If the result contains a 'Decisions needed' section, read each decision aloud with its numbered options and the recommendation, collect the user's choice, then submit a follow-up task to the SAME role stating the chosen options.",
    "- Ask whether he wants to go through the details before continuing the current conversation.",
    "- Do not say you personally did the work; Claude did.",
    "claude_result:",
    output || "(Claude returned no text output.)",
  ].join("\n");

  emitEvent({
    type: "claude_completion",
    run_id: runId,
    task,
    status,
    output,
  });

  notifyIris(eventText);
}

// Declarations only meaningful when the pipeline is available — omitted from
// the Gemini session entirely in chat-only mode (design.md decision 2), not
// just guarded at call time, so Gemini never offers to delegate.
function buildPipelineToolDeclarations() {
  return [
    {
          name: "check_claude_status",
          description: "Check if the Claude Code CLI is installed and ready. Use this for questions about Claude status.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "submit_claude_task",
          description:
            "Immediately hand actionable work to Claude. Invoke for deals, shopping, research, coding, file work, terminal tasks, summaries, automations, or anything requiring tools. Do not ask the user clarifying questions first. Claude works in ONE continuous session: it remembers previous tasks in the session, and runs tasks one at a time — if it is busy, the new task is queued and starts automatically (the response will say 'queued'). IMPORTANT: Claude cannot hear this voice conversation — the 'task' string is the only new information it gets, so write a complete brief with every concrete detail.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description:
                  "The task for Claude in clear English, shaped to the role per the BRIEF WRITING rules in your instructions. For the PO role: a SHORT control intent (start-and-grill / propose the change / are there tasks left? / archive) plus the concrete details the user gave — never a PRD. For a plain task or the DEV role: a COMPLETE brief with the goal, every concrete detail the user gave (names, numbers, URLs, dates, budgets, constraints), sensible defaults, and the expected output; DEV is told to implement the open OpenSpec change. Claude remembers earlier tasks in this session, so follow-ups may reference previous work, but never omit new details.",
              },
              urgency: { type: "string", description: "low, normal, or high." },
              agent: {
                type: "string",
                description:
                  "Optional role to run the task as: 'po' (Product Owner — grills, then proposes an OpenSpec change) or 'dev' (Developer — implements the open change's remaining tasks and verifies). ONLY set this when the user explicitly names a role (e.g. 'have the PO grill this…', 'cho dev làm…'). Otherwise OMIT it — the session's active agent from the UI is used.",
              },
            },
            required: ["task"],
          },
        },
        {
          name: "get_workspace_info",
          description:
            "Return the current workspace state: the active Claude session, the project folder it works in, and the active pipeline role. ALWAYS call this (never guess) when the user asks which project/folder/directory Claude is working in, what session or role is active, or before describing where work will happen.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "get_claude_task_status",
          description: "Fetch the latest status for a Claude run.",
          parameters: {
            type: "object",
            properties: { run_id: { type: "string" } },
            required: ["run_id"],
          },
        },
        {
          name: "stop_claude_task",
          description: "Stop an active or queued Claude run.",
          parameters: {
            type: "object",
            properties: { run_id: { type: "string" } },
            required: ["run_id"],
          },
        },
        {
          name: "start_new_claude_session",
          description:
            "Start a fresh Claude session with a clean slate (previous task context is forgotten). Call this ONLY when the user explicitly asks for it — e.g. says 'new session', 'phien moi', 'start over', 'iris new session'. Never call it on your own initiative. The user can also switch sessions from the UI.",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Optional short name for the new session, if the user gave one." },
            },
          },
        },
        {
          name: "answer_po_question",
          description:
            "Answer the pending question(s) from the Product Owner after SYSTEM_EVENT_PO_QUESTION. The PO's live session is paused waiting for this — call it only once you have collected every answer by voice, never before.",
          parameters: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                description: "One entry per question from the event, in any order.",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "The exact question text, copied verbatim from the event." },
                    choice: { type: "string", description: "The option label the user chose for this question." },
                  },
                  required: ["question", "choice"],
                },
              },
            },
            required: ["answers"],
          },
        },
        {
          name: "set_agent_model",
          description:
            "Change which Claude model a role (PO or DEV) runs on for the active session — e.g. switch DEV to a stronger model to debug a hard problem, then switch it back afterwards. Only call this when the user EXPLICITLY asks to change or switch a role's model; never on your own initiative.",
          parameters: {
            type: "object",
            properties: {
              role: { type: "string", description: "'po' or 'dev'." },
              model: {
                type: "string",
                description: `One of: ${MODEL_CHOICES.map((choice) => `${choice.id} (${choice.label})`).join(", ")}.`,
              },
            },
            required: ["role", "model"],
          },
        },
  ];
}

// Declarations available regardless of pipeline availability — interface
// control and sleep have nothing to do with Claude (design.md decision 2).
function buildAlwaysToolDeclarations() {
  return [
        {
          name: "get_ui_context",
          description:
            "Get the current Iris UI context: visible Claude tasks, latest result task, focused task, expanded task, whether history is open, any pending task-chooser candidates, and whether the Glass HUD overlay is active (uiMode). Use before UI-only voice commands like 'open that', 'show latest result', 'close it', or 'show history'.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "control_ui",
          description:
            "Control the Iris UI directly for UI-only requests — open/close/show a Claude task result, task history, or overlays. Use this instead of submit_claude_task when the request is purely about the interface, not new work.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description:
                  "One of: open_task, open_task_by_query, open_current_claude_result, open_latest_claude_result, open_claude_history, close_reader, close_history, close_all_overlays, show_task_steps, hide_task_steps. Use show_task_steps/hide_task_steps to expand or collapse the tool-step timeline for a Claude task; when the user names a specific card, pass its words in `query` (or its exact id in `target_id`). With no target, steps default to the card the user is currently viewing (open reader / focused), then the running task.",
              },
              target_id: {
                type: "string",
                description: "Optional exact Claude task id for open_task, show_task_steps, or hide_task_steps.",
              },
              query: {
                type: "string",
                description:
                  "Loose words from the user identifying a card, usable with open_task_by_query, show_task_steps, and hide_task_steps — e.g. 'failed one', 'the deals card', 'second one'. The renderer fuzzy-matches this against visible task titles/status. For open_task_by_query, close matches show a chooser overlay instead of guessing.",
              },
            },
            required: ["action"],
          },
        },
        {
          name: "go_to_sleep",
          description:
            "Put Iris to sleep (end this voice session). Call ONLY when the user explicitly asks — e.g. 'go to sleep', 'sleep now', 'goodnight Iris', 'that's all for today'. Say a very short goodbye BEFORE calling this; the session ends a few seconds later. The wake word (if enabled) keeps working, so they can wake Iris again by voice.",
          parameters: { type: "object", properties: {} },
        },
  ];
}

function buildClaudeTools() {
  return [
    {
      functionDeclarations: [
        ...(pipelineAvailable ? buildPipelineToolDeclarations() : []),
        ...buildAlwaysToolDeclarations(),
      ],
    },
  ];
}

// One prompt builder with the pipeline sections included only when
// pipelineAvailable (design.md decision 2) — never a second maintained
// variant, so the two surfaces can't drift out of sync.
function buildSystemInstructionText() {
  const lines = [`You are Iris, the realtime voice front-end for ${userDisplayName()}.`];
  const googleSearchEnabled = process.env.IRIS_ENABLE_GOOGLE_SEARCH === "true";

  if (pipelineAvailable) {
    lines.push(
      "Claude is your worker brain for tools, terminal, files, web, deals, coding, research, and automations.",
      ...(googleSearchEnabled
        ? [
            "You also have built-in Google Search. Use Google Search directly for quick current facts, simple web lookups, and lightweight questions that do not need Claude to do work.",
          ]
        : []),
      `CRITICAL: Be decisive. Do not ask clarifying questions for actionable tasks. If ${userDisplayName()} asks for a deal, research, coding, checking something, building something, or any work, immediately call submit_claude_task with the request. The ONLY exception is the Product Owner intake below, when a NEW project or feature is being started.`,
      googleSearchEnabled
        ? "Routing rule: quick answer or fact lookup -> Google Search; multi-step work, monitoring, files, email, deals, coding, automation, or anything that should continue in the background -> Claude."
        : "Routing rule: multi-step work, monitoring, files, email, deals, coding, research, automation, or anything that should continue in the background -> Claude.",
      `When you call submit_claude_task for a plain task or the DEV role, write the 'task' as a COMPLETE brief. Claude cannot hear this conversation, so do not send a short paraphrase. Expand what ${userDisplayName()} said into a precise, detailed instruction that captures the goal, every concrete detail mentioned (names, numbers, URLs, dates, budgets, preferences, constraints), any reasonable defaults you are assuming, and the expected result/format. (The PO role is the exception — you steer it with a SHORT control intent, not a PRD; see PRODUCT OWNER CONTROL below.)`,
      "Session model: context is USER-CONTROLLED. Within the session the user picked, each role (PO, DEV, and plain Claude) keeps its OWN continuous conversation that every new task automatically resumes — Claude remembers ALL its earlier tasks in that role, even when other roles ran in between. Context is never dropped automatically; it resets ONLY when the user explicitly starts a new session (UI 'New' button or a voice request) or picks a different project folder. So follow-up briefs may safely reference the role's previous work ('the PRD you wrote', 'the issue you implemented'). Each session is attached to a project folder the user picks from the UI, and Claude's file/terminal work happens inside that folder. Claude does ONE task at a time; if it is busy, a new task is queued and starts automatically. You never pick or invent session ids or project folders yourself; if the user wants to work on a different project, tell them to pick its folder from the UI.",
      workspaceContextLine(),
      "When the user asks which project/folder/session/role is active — or you need to state where work will happen — call get_workspace_info and answer from its result; never guess. When you receive SYSTEM_EVENT_WORKSPACE_UPDATE, silently update your knowledge of the workspace; do not speak in response to it. When you receive SYSTEM_EVENT_AGENT_SELECT, the user just switched the pipeline role from the UI: follow its instructions_to_iris and speak proactively — switching to PO with no ongoing conversation ALWAYS opens with the how-did-this-project-start question (own idea / boss-CTO mandate / customer request).",
      "Agent pipeline (runs on OpenSpec): Claude runs as one of two roles — PO (Product Owner: grills the request, then proposes an OpenSpec change under openspec/changes/<name>/ with a tasks.md — decides WHAT gets built) and DEV (Developer: implements the remaining tasks of the open change test-first, verifies, then archives it to update the living spec). The user picks the active role from the UI; moving PO → DEV is a gate, and the roles hand work to each other through the OpenSpec change in the project, never a shared conversation. Only pass the 'agent' parameter when the user explicitly names a role; never choose or advance a role yourself. PO runs as a LIVE session (stays open across tasks and pauses mid-task to ask YOU questions by voice — see SYSTEM_EVENT_PO_QUESTION); DEV runs headless and never pauses. A DEV run only works when the PO has already proposed a change with tasks — if none exists, the DEV run fails and asks for the PO to propose first.",
      "PRODUCT OWNER CONTROL — you are the PO's VOICE, not its analyst. When the user starts a NEW project or feature (or switches to the PO role with no ongoing PO conversation), do NOT interview them yourself and do NOT write a PRD. Instead call submit_claude_task for the PO role with a SHORT control intent that forwards what the user wants and tells the PO to start grilling — e.g. 'Start a new feature: <what the user said, with the concrete details verbatim>. Grill me to pin down the requirements.' The Claude-side PO then runs its grilling pass and pauses to ask YOU questions by voice (SYSTEM_EVENT_PO_QUESTION) — read those aloud and answer with answer_po_question. When the user is satisfied, send the PO a follow-up: 'You have enough — propose the change.' To check progress, send the PO 'Are there tasks left?' and it reads the change's tasks.md and reports back. For ordinary tasks that are not a new project/feature, skip all of this and stay decisive.",
      "DECISIONS RELAY — headless DEV, and the PO for lower-stakes calls, cannot ask yes/no questions mid-run, so they hand choices back to you at the END of a run. When a Claude result contains a 'Decisions needed' (or numbered 'Open Questions') section: read each decision aloud, one at a time, with its numbered options and the recommendation, and let the user pick (they may say 'option 2' or 'go with your recommendation'). Then call submit_claude_task for the SAME role with a follow-up task stating each decision and the chosen option. If the user postpones, note that the recommended defaults stay applied.",
      `Model control: PO and DEV each run on a chosen Claude model, visible as a badge on the pipeline chip in the UI (defaults: PO on the strongest model, DEV on a faster one for routine work). Call set_agent_model(role, model) ONLY when ${userDisplayName()} explicitly asks to switch a role's model (e.g. "switch DEV to a stronger model to debug this", "put PO back on the fast one") — never change it on your own initiative. Available models: ${MODEL_CHOICES.map((choice) => `${choice.label} (${choice.id})`).join(", ")}.`,
      "PO LIVE QUESTIONS — different from Decisions Relay above: when the PO reaches a real fork in the road MID-TASK, it pauses immediately and you receive SYSTEM_EVENT_PO_QUESTION with a list of questions and options. Read each one aloud right then — don't wait for the run to finish, it hasn't. Once you have every answer, call answer_po_question with the exact question text and the chosen option's label for each; the PO resumes the same task the instant you do. If the user asks what you'd pick, suggest the first-listed option, but always submit what they actually chose.",
      "BRIEF WRITING — the 'task' string is the ONLY thing headless Claude receives; a detail you do not write down is lost forever. Shape every brief to the role:",
      "- PO control intent (NOT a PRD — the PO does the analysis, you just steer it): a short line forwarding the user's request plus the intent — start-and-grill, 'propose the change', 'are there tasks left?', or 'archive the change'. Include the concrete details the user gave (names, numbers, URLs, constraints) so the PO has them, but never write the PRD, tasks, or acceptance criteria yourself — that is the PO's job via grilling and the OpenSpec propose flow.",
      "- DEV brief: tell DEV to implement the open OpenSpec change — e.g. 'Implement the remaining tasks of the open change.' If the user named a specific change, include its name. Append any spoken instruction that overrides the spec ('the messages should be in English after all') — DEV cannot know it otherwise. DEV only runs when the PO has already proposed a change with tasks.",
      "- Follow-up brief (answers to Decisions needed): send to the SAME role and repeat each decision with the chosen option verbatim, e.g. 'Decision 1: option 2 — <restate the option text>. Decision 3: keep the recommendation.' Never re-open decisions the user already settled, and never let a chosen option be paraphrased into something new.",
      "- Self-check before every submit_claude_task call: could someone who never heard this conversation do the right work from this brief alone? If not, add the missing names, numbers, paths, and decisions before sending.",
    );
  } else {
    lines.push(
      `You do not have a background worker on this machine right now — you are a friendly, capable conversational voice companion.${googleSearchEnabled ? " You also have built-in Google Search; use it directly for quick current facts, simple web lookups, and lightweight questions." : ""}`,
      `If ${userDisplayName()} asks for multi-step work, coding, file/terminal automation, or anything else that needs tools you don't have, say plainly that this needs the Claude pipeline, which is not set up on this machine yet (the Claude Code CLI can be installed and checked from Settings), and offer to help conversationally with whatever you can instead. Never claim you will hand work off to Claude — you have no worker to hand it to.`,
    );
  }

  lines.push(
    `UI control rule: if the user says things like 'open it', 'open that result', 'show the latest result', 'show history', 'close it', 'go back', or 'open the current task', use get_ui_context and control_ui — these are UI-only${pipelineAvailable ? " and must NOT be sent to submit_claude_task" : ""}. Also handle 'show the steps' / 'what is it doing' / 'show what tools it used' -> show_task_steps; 'hide the steps' -> hide_task_steps. If they name a specific card ('steps for the deals one', 'steps for the second card'), pass those words in query; with no target named, steps apply to the card they are viewing (open reader first), else the running task.`,
    "If the user refers to a task by partial words from its header, like 'open the failed one' or 'open the deals task', call control_ui with action open_task_by_query and put those words in query — do not require an exact title match. If Iris shows a task chooser because multiple cards matched, the user can click a choice or say first/second/third; use get_ui_context to inspect pendingTaskMatches before opening a specific task. When a UI command is ambiguous, prefer the expanded task first, then the focused task, then the latest result. Keep the spoken acknowledgement short.",
    `Sleep rule: when ${userDisplayName()} asks you to sleep ('go to sleep', 'sleep now', 'goodnight', 'that's all for now'), say a short warm goodbye and call go_to_sleep. Never call it unless explicitly asked.${
      pipelineAvailable
        ? " Note: while a PO question is pending (see PO LIVE QUESTIONS below), UI actions like close_reader still work, but a new ambiguous open-task request is deferred — the PO question always answers first."
        : ""
    }`,
  );

  if (pipelineAvailable) {
    lines.push(
      `After submit_claude_task returns: if status is 'started', say one short acknowledgement like: On it, Claude is handling that now. If status is 'queued', tell ${userDisplayName()} Claude is still finishing the current task and this one is queued next. (Keep what you SAY short, even though the task you SENT is detailed.)`,
      `Only call start_new_claude_session when ${userDisplayName()} explicitly asks for a new session (says something like: new session, fresh session, start over). After it returns, confirm briefly that Claude has a clean slate.`,
    );
  }

  lines.push(
    `When you receive SYSTEM_EVENT_SESSION_START, immediately speak a warm welcome-back greeting to ${userDisplayName()} as instructed, without waiting for the user to talk first.`,
  );

  if (pipelineAvailable) {
    lines.push(
      `When you receive SYSTEM_EVENT_CLAUDE_COMPLETE, treat it as a high-priority background result from Claude. Proactively announce it even if ${userDisplayName()} was chatting with you. Keep it polite and short: say Claude is back, summarize the result, and ask whether they want to go through it before continuing.`,
    );
  }

  lines.push(
    pipelineAvailable
      ? "Only answer directly for greetings, quick chat, or status questions."
      : "Answer everything directly and conversationally — you have no background worker to delegate to right now.",
    "Keep voice responses natural and short.",
  );

  return lines.join("\n");
}

function buildLiveConfig(resumeHandle) {
  return {
    responseModalities: ["AUDIO"],
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: process.env.GEMINI_LIVE_VOICE || "Zephyr",
        },
      },
    },
    // Empty object still opts in to receiving resumption handles.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    contextWindowCompression: {
      triggerTokens: 104857,
      slidingWindow: { targetTokens: 52428 },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [
      // Google Search grounding is a BILLED feature. On a free-tier Gemini key the
      // Live API closes the session immediately with a 1011 "exceeded your current
      // quota" error the moment this tool is present. Enable only with billing on:
      //   IRIS_ENABLE_GOOGLE_SEARCH=true
      ...(process.env.IRIS_ENABLE_GOOGLE_SEARCH === "true" ? [{ googleSearch: {} }] : []),
      ...buildClaudeTools(),
    ],
    systemInstruction: {
      parts: [{ text: buildSystemInstructionText() }],
    },
  };
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
  await connectLive({ isReconnect: false });
  return { running: true, pid: process.pid };
}

async function connectLive({ isReconnect }) {
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
    config: buildLiveConfig(resumptionHandle),
    callbacks: {
      onopen() {
        reconnectAttempts = 0;
        liveStatus = { running: true, pid: process.pid };
        emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec" } });
        emitEvent({ type: "gemini_status", status: "connected", model });
        emitEvent({ type: "audio_state", state: "listening" });
        updateTrayMenu();
        while (pendingClaudeAnnouncements.length > 0 && liveSession) {
          liveSession.sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
        }
        // The resumed session keeps its context; greeting again mid-conversation
        // every ~10 minutes would be jarring.
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
        if (userStopped) {
          liveStatus = { running: false, pid: null };
          emitEvent({ type: "gemini_status", status: "offline" });
          emitEvent({ type: "audio_state", state: "idle" });
          emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
          updateTrayMenu();
          return;
        }
        scheduleReconnect(event?.reason || "connection closed");
      },
    },
  });
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
    connectLive({ isReconnect: true }).catch((error) => {
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
    if (resumable && newHandle) resumptionHandle = newHandle;
  }

  if (message.goAway) {
    // Server warns the connection is about to be dropped (connection lifetime
    // limit). onclose fires shortly after and reconnects with the handle.
    console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
  }

  if (message.toolCall) {
    handleToolCall(message.toolCall).catch((error) => {
      emitEvent({ type: "fatal", message: "Tool call failed", error: error.message });
    });
  }

  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    flushTranscripts();
    emitToRenderer("live:interrupt", {});
    emitEvent({ type: "audio_state", state: "listening" });
    return;
  }

  if (content.inputTranscription?.text) userTranscriptBuffer += content.inputTranscription.text;
  if (content.outputTranscription?.text) modelTranscriptBuffer += content.outputTranscription.text;

  for (const part of content.modelTurn?.parts || []) {
    if (part.text) modelTranscriptBuffer += part.text;
    const inlineData = part.inlineData;
    if (!inlineData?.data) continue;
    const mimeType = inlineData.mimeType || "audio/pcm;rate=24000";
    if (!mimeType.startsWith("audio/")) continue;
    emitToRenderer("live:audio", { data: inlineData.data, mimeType });
    emitEvent({ type: "audio_state", state: "speaking" });
  }

  if (content.turnComplete) {
    flushTranscripts();
    emitEvent({ type: "audio_state", state: "listening" });
  }
}

async function stopLive() {
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
      // Audio capture/playback and the HUD must keep running when occluded.
      backgroundThrottling: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const useProd = app.isPackaged || process.env.IRIS_START_PROD === "1";
  if (useProd) mainWindow.loadFile(path.join(repoRoot, "dist", "index.html"));
  else mainWindow.loadURL(devUrl);
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
  if (appIcon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }
  installAppMenu();

  // Fire-and-forget so app startup isn't blocked on the CLI probe; the
  // pipeline_availability sidecar event (see probePipelineAvailability)
  // updates the renderer whenever this resolves, and connectLive() re-probes
  // before the Gemini session that actually consumes the value is built.
  probePipelineAvailability().catch(() => {});

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "audioCapture" || permission === "videoCapture");
  });

  ipcMain.handle("sidecar:start", () => startLive());
  ipcMain.handle("sidecar:stop", () => stopLive());
  ipcMain.handle("sidecar:status", () => liveStatus);
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
  ipcMain.handle("agents:set-model", (_event, payload) =>
    setAgentModel(String(payload?.workstreamId || ""), payload?.role, payload?.model));
  // Secondary answer path for the PO's pending AskUserQuestion — lets a
  // sighted user click an option directly instead of answering by voice.
  // Whichever path (this, or the Gemini answer_po_question tool) answers
  // first wins; the other becomes a no-op since the question is already resolved.
  ipcMain.handle("po:answer-question", (_event, answers) => resolvePendingPoQuestion(answers));
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
  ipcMain.on("win:control", (_event, action) => {
    if (!mainWindow) return;
    if (action === "close") mainWindow.close();
    else if (action === "minimize") mainWindow.minimize();
  });
  ipcMain.handle("config:get", () => getFullConfig());
  ipcMain.handle("config:save", (_event, updates) => writeUserConfig(updates));
  ipcMain.handle("config:test-gemini", (_event, payload) => testGeminiKey(payload?.key));
  ipcMain.handle("config:test-claude", () => checkClaudeHealth());
  // Renderer's boot-time read of the pipeline master switch (see design.md
  // decision 1/3) — cached, synchronous-feeling; live updates arrive over the
  // pipeline_availability sidecar event emitted whenever the value flips.
  ipcMain.handle("pipeline:status", () => ({ available: pipelineAvailable }));
  ipcMain.handle("config:preview-voice", (_event, payload) => previewVoice(payload || {}));
  ipcMain.on("iris:boot-done", () => GreetGate.fire());
  ipcMain.on("iris:ui-context", (_event, context) => {
    if (context && typeof context === "object") {
      irisUiContext = context;
    }
  });
  ipcMain.on("live:audio", (_event, chunk) => sendAudioChunk(chunk));
  createWindow();
  createTray();
  const registered = globalShortcut.register(hudHotkey(), () => {
    toggleHud();
    updateTrayMenu();
  });
  if (!registered) {
    emitEvent({ type: "log", level: "error", message: `Could not register HUD hotkey ${hudHotkey()}.` });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", () => {
  stopLive();
  // The app is exiting regardless, so this just signals live subprocesses to
  // die with it — run-queue.mjs owns the runs map, so kill children directly
  // via list() rather than mutating run.status from outside the module.
  for (const run of runQueue.list()) {
    if (run.child) run.child.kill("SIGTERM");
  }
  closeAllPoSessions();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
