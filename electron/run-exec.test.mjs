import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRunExec } from "./run-exec.mjs";

/** @returns {any} */
function makeChildProcess() {
  const child = new EventEmitter();
  const extended = /** @type {any} */ (child);
  extended.pid = 12345;
  extended.stdout = new EventEmitter();
  extended.stderr = new EventEmitter();
  extended.kill = vi.fn();
  return extended;
}

/** @param {any} child @returns {(bin: string, args: string[], options: any) => any} */
function fakeSpawn(child) {
  return (_bin, _args, _options) => child;
}

function makeWorkstream(overrides = {}) {
  return {
    id: "ws1",
    cwd: "/tmp/project",
    agent_sessions: {},
    active_agent: null,
    ...overrides,
  };
}

function make(overrides = {}) {
  const workstream = makeWorkstream();
  return createRunExec({
    runQueue: { finalize: vi.fn() },
    emitEvent: vi.fn(),
    findWorkstream: () => workstream,
    persistSessionStore: vi.fn(),
    agentKey: (agent) => agent ?? "default",
    resolveAgentModel: () => "claude-sonnet-5",
    agentLabels: { po: "PO", dev: "DEV" },
    agentPrefix: "iris-",
    claudeWorkdir: () => "/tmp/default-workspace",
    claudeBinary: () => "claude",
    installedAgentFile: () => "/fake/iris-dev.md",
    ensureProjectScaffold: () => ({ created: [] }),
    openChangesWithTasks: () => ["some-change"],
    ensureCanvasMcpForRun: vi.fn(async () => null),
    ensureNotesVaultReady: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true }),
    notesVaultDir: "/tmp/notes-vault",
    noteCaptureHintRe: /note/,
    vaultChangedSince: () => false,
    handleClaudeStreamEvent: vi.fn(),
    pushActivity: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    ...overrides,
  });
}

describe("run-exec: killChild", () => {
  it("signals the process group when the child has a pid", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const exec = make();
      const child = makeChildProcess();
      exec.killChild(child, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("falls back to the direct child kill when the process group is already gone", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    try {
      const exec = make();
      const child = makeChildProcess();
      exec.killChild(child, "SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });
});

describe("run-exec: startDevRun", () => {
  it("spawns detached and never spawns a real subprocess (fake spawnImpl)", async () => {
    const child = makeChildProcess();
    const spawnImpl = vi.fn(fakeSpawn(child));
    const runQueue = { finalize: vi.fn() };
    const exec = make({ spawnImpl, runQueue });

    const run = { run_id: "r1", agent: null, task: "do a thing", workstream_id: "ws1", urgency: "normal" };
    await exec.startDevRun(run);

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [, , options] = spawnImpl.mock.calls[0];
    expect(options.detached).toBe(true);
  });

  it("withholds GEMINI_API_KEY from DEV's env, and CLAUDE_CODE_OAUTH_TOKEN specifically", async () => {
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-secret";
    try {
      const child = makeChildProcess();
      const spawnImpl = vi.fn(fakeSpawn(child));
      const exec = make({ spawnImpl });
      const run = { run_id: "r1", agent: null, task: "do a thing", workstream_id: "ws1", urgency: "normal" };
      await exec.startDevRun(run);

      const [, , options] = spawnImpl.mock.calls[0];
      expect(options.env.GEMINI_API_KEY).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  it("finalizes as COMPLETED when the child closes with exit code 0 and a clean result", async () => {
    const child = makeChildProcess();
    const spawnImpl = vi.fn(fakeSpawn(child));
    const runQueue = { finalize: vi.fn() };
    const exec = make({ spawnImpl, runQueue });
    const run = { run_id: "r1", agent: null, task: "do a thing", workstream_id: "ws1", urgency: "normal" };
    await exec.startDevRun(run);

    run.result = { result: "all done", is_error: false };
    child.emit("close", 0);
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "completed", "all done");
  });

  it("finalizes as ERROR without spawning when the spawn call itself throws", async () => {
    const runQueue = { finalize: vi.fn() };
    const spawnImpl = vi.fn(() => {
      throw new Error("ENOENT: claude not found");
    });
    const exec = make({ spawnImpl, runQueue });
    const run = { run_id: "r1", agent: null, task: "do a thing", workstream_id: "ws1", urgency: "normal" };
    await exec.startDevRun(run);
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "error", expect.stringContaining("Failed to launch claude"));
  });

  it("refuses to start a role run when the agent persona is not installed", () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, installedAgentFile: () => null });
    const run = { run_id: "r1", agent: "dev", task: "implement", workstream_id: "ws1", urgency: "normal" };
    exec.startClaudeRun(run);
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", expect.stringContaining("not installed"));
  });

  it("refuses a DEV run when there is no open change with tasks", () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, openChangesWithTasks: () => [] });
    const run = { run_id: "r1", agent: "dev", task: "implement", workstream_id: "ws1", urgency: "normal" };
    exec.startClaudeRun(run);
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", expect.stringContaining("No open OpenSpec change"));
  });
});

describe("run-exec: startPoRun", () => {
  it("refuses to start without a billed PO token", async () => {
    // poBillingStatus is imported directly by run-exec.mjs from po-session.mjs,
    // not injected — clear the credentials it reads rather than stubbing
    // that import, so this test doesn't depend on the ambient environment.
    const originalEnv = { ...process.env };
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const runQueue = { finalize: vi.fn() };
      const exec = make({ runQueue });
      const run = { run_id: "r1", agent: "po", task: "grill this", workstream_id: "ws1", urgency: "normal" };
      await exec.startPoRun(run);
      expect(runQueue.finalize).toHaveBeenCalledWith(
        "r1",
        "failed",
        expect.stringContaining("PO needs a subscription token"),
      );
    } finally {
      process.env = originalEnv;
    }
  });
});
