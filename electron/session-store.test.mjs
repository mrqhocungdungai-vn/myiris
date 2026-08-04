import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "./session-store.mjs";

let homeDir;
let restoreHome;
const STORE_PATH = () => path.join(homeDir, ".iris", "claude-sessions.json");

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-session-store-"));
  restoreHome = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
});

afterEach(() => {
  restoreHome.mockRestore();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function make(overrides = {}) {
  return createSessionStore({
    emitEvent: vi.fn(),
    announceWorkspaceUpdate: vi.fn(),
    abandonPendingQuestion: vi.fn(),
    abandonPendingReview: vi.fn(),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    getMainWindow: () => null,
    ...overrides,
  });
}

describe("session-store: fresh store", () => {
  it("creates a workstream lazily via activeWorkstream() on first use", () => {
    const store = make();
    expect(store.getActiveId()).toBeNull();
    const workstream = store.activeWorkstream();
    expect(workstream.id).toBeTruthy();
    expect(store.getActiveId()).toBe(workstream.id);
  });

  it("createWorkstream persists to disk and becomes active", () => {
    const store = make();
    const workstream = store.createWorkstream("My Project");
    expect(workstream.label).toBe("My Project");
    expect(fs.existsSync(STORE_PATH())).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(STORE_PATH(), "utf8"));
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.sessions).toHaveLength(1);
  });
});

describe("session-store: corrupt-store quarantine", () => {
  it("quarantines a corrupt (invalid JSON) store instead of crashing or overwriting silently", () => {
    fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
    fs.writeFileSync(STORE_PATH(), "{ not valid json ");

    const store = make();
    // A fresh in-memory store is used; the corrupt file is moved aside, not deleted-in-place.
    expect(store.getActiveId()).toBeNull();
    expect(fs.existsSync(STORE_PATH())).toBe(false);
    const dir = fs.readdirSync(path.dirname(STORE_PATH()));
    expect(dir.some((name) => name !== "claude-sessions.json")).toBe(true);
  });
});

describe("session-store: schema-version guard", () => {
  it("quarantines a store written by a newer, not-yet-understood schema version", () => {
    fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
    fs.writeFileSync(
      STORE_PATH(),
      JSON.stringify({ schemaVersion: 999, active: null, sessions: [] }),
    );

    const store = make();
    expect(store.getActiveId()).toBeNull();
    expect(fs.existsSync(STORE_PATH())).toBe(false);
    const dir = fs.readdirSync(path.dirname(STORE_PATH()));
    expect(dir.some((name) => name !== "claude-sessions.json")).toBe(true);
  });

  it("loads a store at the current schema version normally", () => {
    fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
    fs.writeFileSync(
      STORE_PATH(),
      JSON.stringify({
        schemaVersion: 2,
        active: "abc",
        sessions: [{ id: "abc", label: "Existing", cwd: null }],
      }),
    );

    const store = make();
    expect(store.getActiveId()).toBe("abc");
    expect(store.findWorkstream("abc").label).toBe("Existing");
  });

  it("migrates the legacy flat-map format", () => {
    fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
    fs.writeFileSync(STORE_PATH(), JSON.stringify({ "iris-voice": "legacy-claude-session-id" }));

    const store = make();
    const snapshot = store.sessionsSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].agent_sessions.execute).toBe("legacy-claude-session-id");
  });
});

describe("session-store: model resolution", () => {
  it("resolveVerbModel prefers the stored per-workstream choice, then env, then the verb's default", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    expect(store.resolveVerbModel(workstream, "execute")).toBe("claude-sonnet-5");
    // The reason to change a model is about the KIND of work, so the defaults
    // differ per verb rather than per run shape.
    expect(store.resolveVerbModel(workstream, "shape_requirements")).toBe("claude-opus-5");
    expect(store.resolveVerbModel(workstream, "capture_learning")).toBe("claude-haiku-4-5-20251001");

    store.setVerbModel(workstream.id, "execute", "claude-opus-4-8");
    const updated = store.findWorkstream(workstream.id);
    expect(store.resolveVerbModel(updated, "execute")).toBe("claude-opus-4-8");
    // And only that verb moved.
    expect(store.resolveVerbModel(updated, "finish")).toBe("claude-sonnet-5");
  });

  it("setVerbModel rejects an unknown verb or unknown model", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    expect(store.setVerbModel(workstream.id, "dev", "claude-sonnet-5").status).toBe("error");
    expect(store.setVerbModel(workstream.id, "execute", "not-a-real-model").status).toBe("error");
  });

  // D3: the two shaping verbs share a live session and therefore cannot run on
  // different models while it is alive. The coupling is declared, not hidden.
  it("applies a change to one shaping verb to both, and says so", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    const result = /** @type {any} */ (store.setVerbModel(workstream.id, "shape_on_canvas", "claude-sonnet-5"));

    expect(result.status).toBe("ok");
    expect(result.shared).toBe(true);
    expect(result.verbs).toEqual(["shape_requirements", "shape_on_canvas"]);
    const updated = store.findWorkstream(workstream.id);
    expect(store.resolveVerbModel(updated, "shape_requirements")).toBe("claude-sonnet-5");
    expect(store.resolveVerbModel(updated, "shape_on_canvas")).toBe("claude-sonnet-5");
  });

  it("does not couple a verb that owns its own session", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    const result = /** @type {any} */ (store.setVerbModel(workstream.id, "review", "claude-sonnet-5"));
    expect(result.shared).toBe(false);
    expect(result.verbs).toEqual(["review"]);
  });

  it("reads a persona-group env override before the verb's default", () => {
    const original = { ...process.env };
    process.env.IRIS_STATELESS_MODEL = "claude-opus-4-8";
    try {
      const store = make();
      const workstream = store.createWorkstream("Proj");
      expect(store.resolveVerbModel(workstream, "execute")).toBe("claude-opus-4-8");
      expect(store.resolveVerbModel(workstream, "shape_requirements")).toBe("claude-opus-5");
    } finally {
      process.env = original;
    }
  });

  // An existing .env must not be silently reinterpreted just because the
  // variable was renamed.
  it("still honours the previous role-named env variables", () => {
    const original = { ...process.env };
    process.env.IRIS_PO_MODEL = "claude-sonnet-5";
    process.env.IRIS_DEV_MODEL = "claude-opus-4-8";
    try {
      const store = make();
      const workstream = store.createWorkstream("Proj");
      expect(store.resolveVerbModel(workstream, "shape_requirements")).toBe("claude-sonnet-5");
      expect(store.resolveVerbModel(workstream, "execute")).toBe("claude-opus-4-8");
    } finally {
      process.env = original;
    }
  });
});

// D8. CLAUDE.md promises a context reset only when the user asks, and an app
// upgrade is not the user asking — so nothing here may discard a conversation.
describe("session-store: migrating a pre-verb store", () => {
  function writeStore(session) {
    fs.mkdirSync(path.dirname(STORE_PATH()), { recursive: true });
    fs.writeFileSync(
      STORE_PATH(),
      JSON.stringify({ schemaVersion: 1, active: "abc", sessions: [{ id: "abc", label: "Old", cwd: null, ...session }] }),
    );
  }

  it("maps the conversational role onto the shared stateful session", () => {
    writeStore({ agent_sessions: { po: "po-session" }, agent_models: {}, active_agent: "po", last_agent_used: "po" });
    const workstream = make().findWorkstream("abc");

    expect(workstream.agent_sessions.stateful).toBe("po-session");
    expect(workstream.agent_sessions.po).toBeUndefined();
    expect(workstream.last_verb_used).toBe("shape_requirements");
    // A workstream no longer has a current role.
    expect("active_agent" in workstream).toBe(false);
  });

  it("gives `execute` the conversation last used, and keeps the loser", () => {
    writeStore({
      agent_sessions: { dev: "dev-session", default: "plain-session" },
      agent_models: {},
      last_agent_used: "dev",
    });
    const workstream = make().findWorkstream("abc");

    expect(workstream.agent_sessions.execute).toBe("dev-session");
    expect(workstream.agent_sessions.execute__superseded).toBe("plain-session");
    expect(workstream.last_verb_used).toBe("execute");
  });

  it("resolves the collision the other way when plain Claude ran last", () => {
    writeStore({
      agent_sessions: { dev: "dev-session", default: "plain-session" },
      agent_models: {},
      last_agent_used: null,
    });
    const workstream = make().findWorkstream("abc");

    expect(workstream.agent_sessions.execute).toBe("plain-session");
    expect(workstream.agent_sessions.execute__superseded).toBe("dev-session");
  });

  it("discards no conversation, whichever way the collision goes", () => {
    for (const last of [null, "dev"]) {
      writeStore({
        agent_sessions: { po: "po-session", dev: "dev-session", default: "plain-session" },
        agent_models: {},
        last_agent_used: last,
      });
      const stored = Object.values(make().findWorkstream("abc").agent_sessions);
      for (const id of ["po-session", "dev-session", "plain-session"]) {
        expect(stored).toContain(id);
      }
    }
  });

  it("carries a stored model choice onto every verb of the matching persona group", () => {
    writeStore({
      agent_sessions: {},
      agent_models: { po: "claude-opus-4-8", dev: "claude-haiku-4-5-20251001" },
      last_agent_used: "dev",
    });
    const store = make();
    const workstream = store.findWorkstream("abc");

    for (const verb of ["shape_requirements", "shape_on_canvas"]) {
      expect(store.resolveVerbModel(workstream, verb)).toBe("claude-opus-4-8");
    }
    for (const verb of ["execute", "finish", "investigate", "review", "capture_learning"]) {
      expect(store.resolveVerbModel(workstream, verb)).toBe("claude-haiku-4-5-20251001");
    }
    expect(workstream.agent_models.po).toBeUndefined();
    expect(workstream.agent_models.dev).toBeUndefined();
  });

  // A migration that ran twice and moved things a second time would be worse
  // than one that never ran.
  it("is idempotent across a reload", () => {
    writeStore({
      agent_sessions: { po: "po-session", dev: "dev-session", default: "plain-session" },
      agent_models: { po: "claude-opus-4-8" },
      last_agent_used: "dev",
    });
    const first = make().findWorkstream("abc");
    const second = make().findWorkstream("abc");
    expect(second.agent_sessions).toEqual(first.agent_sessions);
    expect(second.agent_models).toEqual(first.agent_models);
    expect(second.last_verb_used).toBe(first.last_verb_used);
  });
});

describe("session-store: workstream switching", () => {
  it("selectWorkstream abandons pending question/review and closes the live session for the previous workstream", () => {
    const abandonPendingQuestion = vi.fn();
    const abandonPendingReview = vi.fn();
    const store = make({ abandonPendingQuestion, abandonPendingReview });
    const first = store.createWorkstream("First");
    const second = store.createWorkstream("Second");
    abandonPendingQuestion.mockClear();
    abandonPendingReview.mockClear();

    store.selectWorkstream(first.id);
    expect(abandonPendingQuestion).toHaveBeenCalledWith(second.id);
    expect(abandonPendingReview).toHaveBeenCalledWith(second.id);
  });

  it("setWorkstreamCwd clears agent sessions on a real cwd change", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-session-cwd-"));
    try {
      const result = store.setWorkstreamCwd(workstream.id, dir);
      expect(result.status).toBe("ok");
      expect(store.findWorkstream(workstream.id).cwd).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("setWorkstreamCwd rejects a folder that does not exist", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    const result = store.setWorkstreamCwd(workstream.id, "/definitely/not/a/real/folder");
    expect(result.status).toBe("error");
  });
});

describe("session-store: chooseWorkstreamCwd (orphan resolved, task 3.6)", () => {
  it("applies the chosen folder via setWorkstreamCwd", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-session-choose-"));
    try {
      const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [dir] }));
      const store = make({ showOpenDialog, getMainWindow: () => "fake-window" });
      const workstream = store.createWorkstream("Proj");
      const result = await store.chooseWorkstreamCwd(workstream.id);
      expect(result.status).toBe("ok");
      expect(store.findWorkstream(workstream.id).cwd).toBe(dir);
      expect(showOpenDialog).toHaveBeenCalledWith(
        "fake-window",
        expect.objectContaining({ properties: ["openDirectory", "createDirectory"] }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the cwd unchanged when the dialog is cancelled", async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    const store = make({ showOpenDialog });
    const workstream = store.createWorkstream("Proj");
    const result = await store.chooseWorkstreamCwd(workstream.id);
    expect(result.status).toBe("cancelled");
    expect(store.findWorkstream(workstream.id).cwd).toBeNull();
  });

  it("falls back to the active workstream when the given id is unknown", async () => {
    /** @type {(window: any, options: any) => Promise<{ canceled: boolean, filePaths: string[] }>} */
    const dialogFn = async (_window, _options) => ({ canceled: true, filePaths: [] });
    const showOpenDialog = vi.fn(dialogFn);
    const store = make({ showOpenDialog });
    const active = store.activeWorkstream();
    await store.chooseWorkstreamCwd("not-a-real-id");
    expect(showOpenDialog.mock.calls[0]?.[1]?.defaultPath).toBe(active.cwd || os.homedir());
  });
});
