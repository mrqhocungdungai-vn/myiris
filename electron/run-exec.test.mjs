import { describe, it, expect, vi } from "vitest";
import { createRunExec } from "./run-exec.mjs";

// A stand-in for the SDK's `query()`: returns an async iterable over a fixed
// list of messages, and records the options it was called with. No subprocess,
// no network — the whole DEV lifecycle is drivable from here.
function fakeQuery(messages = []) {
  const calls = [];
  /** @type {any} */
  const impl = ({ prompt, options }) => {
    calls.push({ prompt, options });
    return {
      async *[Symbol.asyncIterator]() {
        for (const message of messages) {
          if (typeof message === "function") await message();
          else yield message;
        }
      },
    };
  };
  impl.calls = calls;
  return impl;
}

// The terminal message the SDK emits; run-exec reads it back off run.result,
// which the injected handleClaudeStreamMessage is responsible for setting.
function resultMessage(overrides = {}) {
  return { type: "result", subtype: "success", is_error: false, result: "all done", ...overrides };
}

// Mirrors what the real run-stream projection does with a result message, so a
// test can drive the completion path without pulling in run-stream itself.
function recordResult(run, message) {
  if (message?.type === "result") run.result = message;
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
    claudeBinary: () => "/bundled/claude",
    resolveAgentDefinition: (role) => ({ description: `${role} persona`, prompt: `You are ${role}.` }),
    irisPluginConfig: () => [{ type: "local", path: "/bundle/iris-plugin", skipMcpDiscovery: true }],
    ensureProjectScaffold: () => ({ created: [] }),
    openChangesWithTasks: () => ["some-change"],
    ensureCanvasMcpForRun: vi.fn(async () => null),
    ensureNotesVaultReady: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true }),
    notesVaultDir: "/tmp/notes-vault",
    noteCaptureHintRe: /note/,
    vaultChangedSince: () => false,
    handleClaudeStreamMessage: recordResult,
    pushActivity: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    queryImpl: fakeQuery([resultMessage()]),
    ...overrides,
  });
}

// `cwd` is resolved by startClaudeRun's preamble; these tests call startDevRun
// directly, so they carry the already-resolved value the preamble would set.
function makeRun(overrides = {}) {
  return {
    run_id: "r1",
    agent: null,
    task: "do a thing",
    workstream_id: "ws1",
    urgency: "normal",
    cwd: "/tmp/project",
    ...overrides,
  };
}

describe("run-exec: startDevRun", () => {
  it("drives the bundled binary through the SDK, never a host CLI or a real subprocess", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startDevRun(makeRun());

    expect(queryImpl.calls.length).toBe(1);
    const { prompt, options } = queryImpl.calls[0];
    expect(prompt).toBe("do a thing");
    expect(options.pathToClaudeCodeExecutable).toBe("/bundled/claude");
    expect(options.cwd).toBe("/tmp/project");
  });

  it("pairs bypassPermissions with the flag the SDK requires for it", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startDevRun(makeRun());

    const { options } = queryImpl.calls[0];
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it("does not smuggle the bypass flag in when the permission mode is restricted", async () => {
    // IRIS_CLAUDE_PERMISSION_MODE exists to narrow the worker; attaching the
    // bypass flag unconditionally would make setting it meaningless.
    const originalEnv = { ...process.env };
    process.env.IRIS_CLAUDE_PERMISSION_MODE = "acceptEdits";
    try {
      const queryImpl = fakeQuery([resultMessage()]);
      const exec = make({ queryImpl });
      await exec.startDevRun(makeRun());

      const { options } = queryImpl.calls[0];
      expect(options.permissionMode).toBe("acceptEdits");
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  it("withholds GEMINI_API_KEY from DEV's env but keeps the Claude credential it now needs", async () => {
    // The bundled binary has no host /login store to fall back on, so stripping
    // CLAUDE_CODE_OAUTH_TOKEN (as the old spawn path did) would leave DEV unable
    // to authenticate at all.
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-secret";
    process.env.ANTHROPIC_API_KEY = "api-secret";
    try {
      const queryImpl = fakeQuery([resultMessage()]);
      const exec = make({ queryImpl });
      await exec.startDevRun(makeRun());

      const { options } = queryImpl.calls[0];
      expect(options.env.GEMINI_API_KEY).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude-secret");
      // Subscription token present ⇒ the metered key is stripped so it cannot
      // silently outrank it in the SDK's auth precedence.
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  it("passes the canvas MCP record in-process instead of writing a temp config file", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl, ensureCanvasMcpForRun: async () => ({ url: "http://x", headers: {} }) });
    await exec.startDevRun(makeRun());

    const { options } = queryImpl.calls[0];
    expect(options.mcpServers).toEqual({ "iris-canvas": { url: "http://x", headers: {} } });
  });

  it("resumes the role's stored session for this workstream", async () => {
    const workstream = makeWorkstream({ agent_sessions: { dev: "sess-abc" } });
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl, findWorkstream: () => workstream });
    await exec.startDevRun(makeRun({ agent: "dev" }));

    const { options } = queryImpl.calls[0];
    expect(options.resume).toBe("sess-abc");
    expect(options.agent).toBe("iris-dev");
    expect(options.model).toBe("claude-sonnet-5");
  });

  it("finalizes as COMPLETED on a successful result message", async () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, queryImpl: fakeQuery([resultMessage()]) });
    await exec.startDevRun(makeRun());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "completed", "all done");
  });

  it("finalizes as FAILED when the result reports an error subtype", async () => {
    const runQueue = { finalize: vi.fn() };
    const queryImpl = fakeQuery([resultMessage({ subtype: "error_max_turns", is_error: true, result: "ran out" })]);
    const exec = make({ runQueue, queryImpl });
    await exec.startDevRun(makeRun());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", "ran out");
  });

  it("finalizes as FAILED, naming the cause, when the iterator ends with no result at all", async () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, queryImpl: fakeQuery([]) });
    await exec.startDevRun(makeRun());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", "claude ended without a result");
  });

  it("drops a dead resume id so the next run can start fresh", async () => {
    const workstream = makeWorkstream({ agent_sessions: { dev: "sess-dead" } });
    const persistSessionStore = vi.fn();
    const queryImpl = fakeQuery([
      resultMessage({ subtype: "error", is_error: true, result: "No conversation found with session ID" }),
    ]);
    const exec = make({ queryImpl, persistSessionStore, findWorkstream: () => workstream });
    await exec.startDevRun(makeRun({ agent: "dev" }));

    expect(workstream.agent_sessions.dev).toBeUndefined();
    expect(persistSessionStore).toHaveBeenCalled();
  });

  it("drops a dead resume id when the SDK throws it instead of reporting it", async () => {
    // This is how a stale id actually arrives: an empty `error_during_execution`
    // result, then a throw carrying the reason. Handling only the result path
    // left the id in the store, so every later task in the workstream failed
    // identically — a permanent break, and the shape a relocated
    // CLAUDE_CONFIG_DIR produces once for every existing workstream.
    const workstream = makeWorkstream({ agent_sessions: { dev: "sess-dead" } });
    const persistSessionStore = vi.fn();
    const queryImpl = /** @type {any} */ (async function* () {
      yield resultMessage({ subtype: "error_during_execution", is_error: true, result: undefined });
      throw new Error("No conversation found with session ID: sess-dead");
    });
    const exec = make({ queryImpl, persistSessionStore, findWorkstream: () => workstream });
    await exec.startDevRun(makeRun({ agent: "dev" }));

    expect(workstream.agent_sessions.dev).toBeUndefined();
    expect(persistSessionStore).toHaveBeenCalled();
  });

  it("keeps a live resume id when the run fails for an unrelated reason", async () => {
    // The guard is the error text, so an ordinary failure must not reset the
    // workstream's context as a side effect.
    const workstream = makeWorkstream({ agent_sessions: { dev: "sess-live" } });
    const persistSessionStore = vi.fn();
    const queryImpl = /** @type {any} */ (async function* () {
      yield resultMessage({ subtype: "error", is_error: true, result: "disk full" });
      throw new Error("disk full");
    });
    const exec = make({ queryImpl, persistSessionStore, findWorkstream: () => workstream });
    await exec.startDevRun(makeRun({ agent: "dev" }));

    expect(workstream.agent_sessions.dev).toBe("sess-live");
    expect(persistSessionStore).not.toHaveBeenCalled();
  });

  it("finalizes as ERROR when the query itself throws", async () => {
    const runQueue = { finalize: vi.fn() };
    const queryImpl = /** @type {any} */ (() => {
      throw new Error("ENOENT: bundled binary missing");
    });
    const exec = make({ queryImpl, runQueue });
    await exec.startDevRun(makeRun());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "error", expect.stringContaining("Failed to run claude"));
  });

  it("reports CANCELLED, not ERROR, when the abort is what ended the run", async () => {
    // runQueue.stop() marks the run CANCELLED before aborting, and the abort
    // surfaces as a thrown error — the two must not be confused.
    const runQueue = { finalize: vi.fn() };
    /** @type {any} */
    let capturedRun;
    const queryImpl = fakeQuery([
      () => {
        capturedRun.status = "cancelled";
        throw new Error("AbortError");
      },
    ]);
    const exec = make({ queryImpl, runQueue });
    capturedRun = makeRun();
    await exec.startDevRun(capturedRun);

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "cancelled", "Run was stopped before completion.");
  });

  it("exposes a cancel hook the queue can use to abort the run", async () => {
    const run = makeRun();
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startDevRun(run);

    const { options } = queryImpl.calls[0];
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(options.abortController.signal.aborted).toBe(false);
  });

  it("refuses to start a role run when its persona cannot be loaded", () => {
    // The personas ship in the app, so this is a broken-bundle case rather than
    // a missing install step — but it must still fail loudly instead of
    // silently falling back to plain Claude.
    const runQueue = { finalize: vi.fn() };
    const exec = make({
      runQueue,
      resolveAgentDefinition: () => {
        throw new Error("persona missing from the app bundle");
      },
    });
    const run = { run_id: "r1", agent: "dev", task: "implement", workstream_id: "ws1", urgency: "normal" };
    exec.startClaudeRun(run);
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", expect.stringContaining("could not be loaded"));
  });

  it("hands the persona to the SDK by value, not by a ~/.claude/agents name", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startDevRun(makeRun({ agent: "dev" }));

    const { options } = queryImpl.calls[0];
    expect(options.agent).toBe("iris-dev");
    expect(options.agents).toEqual({ "iris-dev": { description: "dev persona", prompt: "You are dev." } });
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
