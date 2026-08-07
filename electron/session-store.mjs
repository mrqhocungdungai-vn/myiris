// The persisted session store: workstreams (one per project the user is
// working in), each with its own per-verb Claude conversation and model
// choice. Split out of electron/main.mjs (split-main-process-modules):
// Electron-free — every cross-module effect (emitting to the renderer,
// announcing a workspace change, abandoning a pending voice question/review,
// closing a resident session) is injected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { sessionStoreFile } from "./app-paths.mjs";
import { closePoSession } from "./po-session.mjs";
import { writeFileAtomicSync, quarantineFile } from "./atomic-file.mjs";
import {
  MODEL_CHOICES,
  STATEFUL_SESSION_KEY,
  STATEFUL_VERBS,
  VERB_NAMES,
  defaultModelFor,
  isVerb,
  resolveVerb,
} from "./verbs.mjs";

// Bumped when the on-disk shape changes; a store written by a newer build is
// quarantined rather than parsed-and-overwritten (design.md D3). Version 2 is
// the verb migration: a v1 store still loads and is mapped forward on read.
const SESSION_STORE_SCHEMA_VERSION = 2;

const MODEL_IDS = new Set(MODEL_CHOICES.map((choice) => choice.id));

// Env defaults, one per persona group rather than one per verb: a user setting
// a model in `.env` is expressing "how strong should the thinking work be",
// which is exactly the stateful/stateless split. The role-named variables are
// still accepted so an existing `.env` is not silently reinterpreted — the
// same courtesy the review-mode flag extends to its previous boolean values.
const MODEL_ENV_VARS = {
  stateful: ["IRIS_STATEFUL_MODEL", "IRIS_PO_MODEL"],
  stateless: ["IRIS_STATELESS_MODEL", "IRIS_DEV_MODEL"],
};

// D8: what a pre-verb store's keys become. `dev` and `default` both land on
// `execute`, which is a real collision — `last_agent_used` decides which one
// wins and the loser is retained under the archive key below rather than
// deleted. CLAUDE.md promises a context reset only when the user asks, and an
// app upgrade is not the user asking.
const SUPERSEDED_SESSION_KEY = "execute__superseded";

/**
 * @param {{
 *   emitEvent: (event: any) => void,
 *   announceWorkspaceUpdate: () => void,
 *   abandonPendingQuestion: (workstreamId: string) => void,
 *   abandonPendingReview: (workstreamId: string) => void,
 *   showOpenDialog: (window: any, options: any) => Promise<{ canceled: boolean, filePaths: string[] }>,
 *   getMainWindow: () => any,
 *   storeFile?: string,
 * }} deps
 */
export function createSessionStore({
  emitEvent,
  announceWorkspaceUpdate,
  abandonPendingQuestion,
  abandonPendingReview,
  showOpenDialog,
  getMainWindow,
  // Evaluated at call time, not module load — sessionStoreFile() resolves
  // os.homedir() when the store is actually constructed, so it reflects the real
  // homedir in production and a mocked temp dir in tests.
  storeFile = sessionStoreFile(),
}) {
  let sessionStore = { active: null, sessions: [] };

  function getActiveId() {
    return sessionStore.active;
  }

  // Resolution order: the workstream's own choice, then the persona group's env
  // override, then the verb's own default from the registry. Every verb has a
  // model — there is no longer a "plain Claude" path that runs on whatever the
  // CLI happens to default to.
  function resolveVerbModel(workstream, verb) {
    if (!isVerb(verb)) return null;
    const stored = workstream?.agent_models?.[verb];
    if (stored) return stored;
    const group = resolveVerb(verb).basePersona;
    for (const name of MODEL_ENV_VARS[group] ?? []) {
      const envValue = String(process.env[name] || "").trim();
      if (envValue) return envValue;
    }
    return defaultModelFor(verb);
  }

  // Which stored conversation a verb resumes. The two shaping verbs share one
  // (design.md D3); every other verb has its own. Continuity is not
  // statefulness: a stateless verb resumes too, which is what makes a follow-up
  // request intelligible. `state` (open-note-session D2) is how a caller that
  // already resolved a verb against a specific open note gets the SAME
  // per-note key back — omitted, this resolves against no open note.
  function sessionKeyFor(verb, state) {
    return isVerb(verb) ? resolveVerb(verb, state).sessionKey : verb;
  }

  // Bring a stored workstream up to the current shape.
  //
  // Two migrations layered oldest-first: a single `claude_session_id` became a
  // per-agent map, and that map's role keys now become verb keys (D8). Neither
  // discards a conversation — the collision `dev` and `default` both landing on
  // `execute` keeps the loser under SUPERSEDED_SESSION_KEY.
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
    migrateRolesToVerbs(workstream);
    if (!isVerb(workstream.last_verb_used)) workstream.last_verb_used = null;
    return workstream;
  }

  // D8. Idempotent: a store already migrated has no `po`/`dev`/`default` keys
  // left, so this is a no-op on every load after the first.
  function migrateRolesToVerbs(workstream) {
    const sessions = workstream.agent_sessions;
    const models = workstream.agent_models;

    // The conversational role maps straight onto the shared stateful session —
    // no collision, because nothing else claims that key.
    if (sessions.po) {
      if (!sessions[STATEFUL_SESSION_KEY]) sessions[STATEFUL_SESSION_KEY] = sessions.po;
      delete sessions.po;
    }

    // `dev` and `default` both mean "the autonomous worker's conversation" now.
    // Whichever the workstream used last wins the `execute` key; the other is
    // retained rather than dropped, which makes the migration reversible for
    // the cost of one string.
    const dev = sessions.dev ?? null;
    const plain = sessions.default ?? null;
    delete sessions.dev;
    delete sessions.default;
    if (dev || plain) {
      const devWins = dev && (workstream.last_agent_used === "dev" || !plain);
      const winner = devWins ? dev : plain ?? dev;
      const loser = devWins ? plain : dev;
      if (!sessions.execute) sessions.execute = winner;
      if (loser && !sessions[SUPERSEDED_SESSION_KEY]) sessions[SUPERSEDED_SESSION_KEY] = loser;
    }

    // A stored model choice is about the kind of work, so it carries onto every
    // verb of the matching persona group rather than being dropped or applied
    // to one arbitrary verb.
    if (models.po) {
      for (const verb of STATEFUL_VERBS) models[verb] ??= models.po;
      delete models.po;
    }
    if (models.dev) {
      for (const verb of VERB_NAMES.filter((name) => !STATEFUL_VERBS.includes(name))) {
        models[verb] ??= models.dev;
      }
      delete models.dev;
    }

    // A workstream no longer has a current role, and the last thing that ran is
    // now recorded as a verb.
    if ("active_agent" in workstream) delete workstream.active_agent;
    if ("last_agent_used" in workstream) {
      if (!workstream.last_verb_used) {
        workstream.last_verb_used =
          workstream.last_agent_used === "po" ? "shape_requirements" : workstream.last_agent_used ? "execute" : null;
      }
      delete workstream.last_agent_used;
    }
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
          agent_sessions: { execute: value },
          agent_models: {},
          last_verb_used: null,
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
      last_verb_used: null,
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
    // Switching away from a workstream with a resident stateful session: nothing will
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
      // stateful session is bound to the OLD cwd, so it must end here too —
      // otherwise its next turn would run in a directory it no longer matches.
      abandonPendingQuestion(workstream.id);
      abandonPendingReview(workstream.id);
      closePoSession(workstream.id);
      workstream.agent_sessions = {};
      workstream.last_verb_used = null;
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

  // Records which verb last ran in this workstream, so the interface can show
  // what happened rather than offering a control for choosing what will.
  function rememberVerbUsed(workstreamId, verb) {
    const workstream = findWorkstream(workstreamId);
    if (!workstream || !isVerb(verb) || workstream.last_verb_used === verb) return;
    workstream.last_verb_used = verb;
    persistSessionStore();
    emitSessions();
  }

  // Shared by the UI (verbs:set-model IPC) and the Gemini voice tool
  // (set_verb_model) — a single choke point so both paths can never diverge.
  // If a stateful verb's model changes while its live session is resident, the
  // change is applied via setModel() on the next run start (see startStatefulRun),
  // never by closing/resuming the session — that would needlessly drop context.
  //
  // D3: verbs sharing a live session cannot run on different models while it is
  // alive, so a change to one is written to all of them and the return message
  // says so. Appearing to change one verb's model while silently changing
  // another's is the failure this avoids.
  function setVerbModel(workstreamId, verb, model) {
    const workstream = findWorkstream(workstreamId);
    if (!workstream) return { status: "error", error: `Unknown session: ${workstreamId}` };
    const cleanVerb = String(verb || "").trim();
    if (!isVerb(cleanVerb)) {
      return { status: "error", error: `Unknown verb: ${verb}. Known verbs: ${VERB_NAMES.join(", ")}.` };
    }
    const cleanModel = String(model || "").trim();
    if (!MODEL_IDS.has(cleanModel)) {
      return { status: "error", error: `Unknown model: ${model}` };
    }
    // Sharing means "resolves to the SAME session key", not merely "is
    // stateful" — work_on_note is stateful too (open-note-session D2) but
    // deliberately does not share the shaping verbs' key, and its own key is
    // per-note rather than a fixed constant, so it can never collide with
    // another verb's here.
    const targetKey = resolveVerb(cleanVerb).sessionKey;
    const sharing = STATEFUL_VERBS.filter((name) => resolveVerb(name).sessionKey === targetKey);
    const shared = sharing.length > 1 ? sharing : [cleanVerb];
    const changed = [];
    for (const target of shared) {
      if (workstream.agent_models[target] === cleanModel) continue;
      workstream.agent_models[target] = cleanModel;
      changed.push(target);
    }
    if (changed.length) {
      persistSessionStore();
      for (const target of changed) {
        emitEvent({ type: "verb_model_update", workstream_id: workstream.id, verb: target, model: cleanModel });
      }
    }
    return { status: "ok", verbs: [...shared], shared: shared.length > 1, ...sessionsSnapshot() };
  }

  loadSessionStore();

  return {
    modelChoices: MODEL_CHOICES,
    getActiveId,
    resolveVerbModel,
    sessionKeyFor,
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
    rememberVerbUsed,
    setVerbModel,
  };
}
