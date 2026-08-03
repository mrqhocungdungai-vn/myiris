// The persisted session store: workstreams (one per project the user is
// working in), each with its own per-role Claude conversation and model
// choice. Split out of electron/main.mjs (split-main-process-modules):
// Electron-free — every cross-module effect (emitting to the renderer,
// announcing a workspace change or agent selection, abandoning a pending
// voice question/review, closing a resident PO session) is injected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { closePoSession } from "./po-session.mjs";
import { writeFileAtomicSync, quarantineFile } from "./atomic-file.mjs";

// Bumped when the on-disk shape changes; a store written by a newer build is
// quarantined rather than parsed-and-overwritten (design.md D3).
const SESSION_STORE_SCHEMA_VERSION = 1;

// Role pipeline: each role is a Claude Code agent installed at
// ~/.claude/agents/iris-<role>.md and run headless via `claude --agent`. Two
// roles: PO (BA/PM/PO thinking before code — analysis, PRD, issues) and DEV
// (implements one issue at a time and verifies it itself) form the build
// pipeline PO → DEV.
const AGENT_ROSTER = ["po", "dev"];

// Curated model choices for the PO/DEV roles — plain Claude keeps the CLI
// default and is not part of this list. PO defaults to the strongest model
// for product thinking; DEV defaults to the cheaper/faster one for routine
// implementation and can be raised to debug a hard issue.
const MODEL_CHOICES = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
const MODEL_IDS = new Set(MODEL_CHOICES.map((choice) => choice.id));
const MODEL_DEFAULTS = { po: "claude-opus-5", dev: "claude-sonnet-5" };
const MODEL_ENV_VARS = { po: "IRIS_PO_MODEL", dev: "IRIS_DEV_MODEL" };

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   agentLabels: Record<string, string>,
 *   announceWorkspaceUpdate: () => void,
 *   announceAgentSelection: (workstream: any) => void,
 *   abandonPendingQuestion: (workstreamId: string) => void,
 *   abandonPendingReview: (workstreamId: string) => void,
 *   showOpenDialog: (window: any, options: any) => Promise<{ canceled: boolean, filePaths: string[] }>,
 *   getMainWindow: () => any,
 *   storeFile?: string,
 * }} deps
 */
export function createSessionStore({
  emitEvent,
  agentLabels,
  announceWorkspaceUpdate,
  announceAgentSelection,
  abandonPendingQuestion,
  abandonPendingReview,
  showOpenDialog,
  getMainWindow,
  // Evaluated at call time, not module load — so os.homedir() reflects
  // whatever it resolves to when the store is actually constructed (real
  // homedir in production, a mocked temp dir in tests).
  storeFile = path.join(os.homedir(), ".iris", "claude-sessions.json"),
}) {
  let sessionStore = { active: null, sessions: [] };

  function getActiveId() {
    return sessionStore.active;
  }

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

  function persistSessionStore() {
    try {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      writeFileAtomicSync(
        storeFile,
        JSON.stringify({ schemaVersion: SESSION_STORE_SCHEMA_VERSION, ...sessionStore }, null, 2),
      );
    } catch { /* non-fatal */ }
  }

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

  function loadSessionStore() {
    try {
      const data = JSON.parse(fs.readFileSync(storeFile, "utf8"));
      if (typeof data.schemaVersion === "number" && data.schemaVersion > SESSION_STORE_SCHEMA_VERSION) {
        throw new Error(
          `session store schemaVersion ${data.schemaVersion} is newer than this build understands (${SESSION_STORE_SCHEMA_VERSION})`,
        );
      }
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
    } catch (err) {
      if (err && err.code === "ENOENT") return; // first run, nothing to load
      try {
        const quarantined = quarantineFile(storeFile);
        console.warn(`[session-store] corrupt store quarantined to ${quarantined}:`, err);
      } catch (quarantineErr) {
        console.warn("[session-store] failed to quarantine corrupt store:", quarantineErr);
      }
    }
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
      abandonPendingQuestion(previousActiveId);
      abandonPendingReview(previousActiveId);
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
      abandonPendingQuestion(previousActiveId);
      abandonPendingReview(previousActiveId);
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
      abandonPendingQuestion(workstream.id);
      abandonPendingReview(workstream.id);
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

  // Orphan resolved explicitly (split-main-process-modules task 3.6): by
  // position in the original file this sat inside what would have been
  // announcements.mjs, which the spec requires to be Electron-free — but its
  // only job is choosing a workstream's project folder, so it belongs here
  // with the dialog call injected, not carried along with the block it
  // happened to sit in.
  async function chooseWorkstreamCwd(id) {
    const workstream = findWorkstream(id) || activeWorkstream();
    const result = await showOpenDialog(getMainWindow(), {
      title: "Choose the project folder Claude works in",
      defaultPath: workstream.cwd || os.homedir(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { status: "cancelled", ...sessionsSnapshot() };
    }
    return setWorkstreamCwd(workstream.id, result.filePaths[0]);
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
      return { status: "error", error: `Model selection is only available for the ${AGENT_ROSTER.map((r) => agentLabels[r]).join("/")} roles, not "${role}".` };
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

  loadSessionStore();

  return {
    agentRoster: AGENT_ROSTER,
    modelChoices: MODEL_CHOICES,
    getActiveId,
    resolveAgentModel,
    agentKey,
    findWorkstream,
    sessionsSnapshot,
    emitSessions,
    // Exposed because a run-lifecycle call site (still in main.mjs, moving to
    // run-exec.mjs in a later commit) mutates a workstream object returned by
    // findWorkstream directly (dropping a dead --resume id) and then needs to
    // flush that mutation — the same object reference this module holds
    // internally.
    persistSessionStore,
    createWorkstream,
    activeWorkstream,
    selectWorkstream,
    setWorkstreamCwd,
    chooseWorkstreamCwd,
    setWorkstreamAgent,
    setAgentModel,
  };
}
