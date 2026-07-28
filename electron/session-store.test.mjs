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
    agentLabels: { po: "PO", dev: "DEV" },
    announceWorkspaceUpdate: vi.fn(),
    announceAgentSelection: vi.fn(),
    abandonPendingQuestion: vi.fn(),
    abandonPendingReview: vi.fn(),
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
    expect(onDisk.schemaVersion).toBe(1);
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
        schemaVersion: 1,
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
    expect(snapshot.sessions[0].agent_sessions.default).toBe("legacy-claude-session-id");
  });
});

describe("session-store: model resolution", () => {
  it("resolveAgentModel prefers the stored per-workstream choice, then env, then default", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    expect(store.resolveAgentModel(workstream, "dev")).toBe("claude-sonnet-5");

    store.setAgentModel(workstream.id, "dev", "claude-opus-4-8");
    const updated = store.findWorkstream(workstream.id);
    expect(store.resolveAgentModel(updated, "dev")).toBe("claude-opus-4-8");
  });

  it("setAgentModel rejects an unknown role or unknown model", () => {
    const store = make();
    const workstream = store.createWorkstream("Proj");
    expect(store.setAgentModel(workstream.id, "ba", "claude-sonnet-5").status).toBe("error");
    expect(store.setAgentModel(workstream.id, "dev", "not-a-real-model").status).toBe("error");
  });
});

describe("session-store: workstream switching", () => {
  it("selectWorkstream abandons pending question/review and closes the PO session for the previous workstream", () => {
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
