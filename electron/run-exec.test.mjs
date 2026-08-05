import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunExec, buildNoteWriteGuard } from "./run-exec.mjs";
import { buildRunInstructions } from "./role-prompt.mjs";
import { resolveVerb } from "./verbs.mjs";
import { runUsageFrom } from "./claude-stream.mjs";

// A stand-in for the SDK's `query()`: returns an async iterable over a fixed
// list of messages, and records the options it was called with. No subprocess,
// no network — the whole stateless lifecycle is drivable from here.
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
  if (message?.type !== "result") return;
  run.result = message;
  run.usage = runUsageFrom(message);
}

function makeWorkstream(overrides = {}) {
  return {
    id: "ws1",
    cwd: "/tmp/project",
    agent_sessions: {},
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
    sessionKeyFor: (verb) => resolveVerb(verb).sessionKey,
    resolveVerbModel: () => "claude-sonnet-5",
    agentPrefix: "iris-",
    claudeWorkdir: () => "/tmp/default-workspace",
    claudeBinary: () => "/bundled/claude",
    resolveAgentDefinition: (base) => ({ description: `${base} persona`, prompt: `You are ${base}.` }),
    irisPluginConfig: () => [{ type: "local", path: "/bundle/iris-plugin", skipMcpDiscovery: true }],
    ensureProjectScaffold: () => ({ created: [] }),
    openChangesWithTasks: () => ["some-change"],
    ensureCanvasMcpForRun: vi.fn(async () => null),
    ensureNotesVaultReady: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true }),
    notesVaultDir: "/tmp/notes-vault",
    notesInboxDir: "/tmp/notes-vault/inbox/runs",
    recentUtterances: () => [],
    handleClaudeStreamMessage: recordResult,
    pushActivity: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    // The real one reads the on-disk transcript store; tests say outright
    // whether the stored id is still real.
    isSessionAliveImpl: async () => true,
    queryImpl: fakeQuery([resultMessage()]),
    ...overrides,
  });
}

// `cwd` and the resolved verb are produced by startClaudeRun's preamble; these
// tests call the run shapes directly, so they carry the already-resolved values
// the preamble would set.
function makeRun(overrides = {}) {
  return {
    run_id: "r1",
    verb: "execute",
    task: "do a thing",
    workstream_id: "ws1",
    urgency: "normal",
    cwd: "/tmp/project",
    ...overrides,
  };
}

// The project state the preamble would have read. Defaults to "an open change
// exists", matching make()'s openChangesWithTasks stub.
function verbFor(name = "execute", changes = ["some-change"]) {
  return resolveVerb(name, changes);
}

describe("run-exec: the stateless run shape", () => {
  it("drives the bundled binary through the SDK, never a host CLI or a real subprocess", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(queryImpl.calls.length).toBe(1);
    const { prompt, options } = queryImpl.calls[0];
    expect(prompt).toBe("do a thing");
    expect(options.pathToClaudeCodeExecutable).toBe("/bundled/claude");
    expect(options.cwd).toBe("/tmp/project");
  });

  describe("the system prompt", () => {
    it("gives a non-vault verb the shared policy's prompt with no vault clause", async () => {
      const queryImpl = fakeQuery([resultMessage()]);
      const exec = make({ queryImpl });
      await exec.startStatelessRun(makeRun(), verbFor());

      const { append } = queryImpl.calls[0].options.systemPrompt;
      expect(append).toBe(buildRunInstructions(verbFor()));
      expect(append).not.toContain("/tmp/notes-vault");
    });

    it("gives the capture verb the vault clause, and only when the skills are present", async () => {
      const capture = verbFor("capture_learning");
      const installed = fakeQuery([resultMessage()]);
      await make({ queryImpl: installed }).startStatelessRun(makeRun({ verb: "capture_learning" }), capture);
      expect(installed.calls[0].options.systemPrompt.append).toContain("/tmp/notes-vault");
      expect(installed.calls[0].options.systemPrompt.append).toContain("/tmp/notes-vault/inbox/runs");

      const missing = fakeQuery([resultMessage()]);
      await make({ queryImpl: missing, checkNotesSkillsStatus: () => ({ ok: false }) }).startStatelessRun(
        makeRun({ verb: "capture_learning" }),
        capture,
      );
      expect(missing.calls[0].options.systemPrompt.append).toContain("not available in this build");
      expect(missing.calls[0].options.systemPrompt.append).not.toContain("/tmp/notes-vault/inbox");
    });

    it("only readies the notes vault for the verb that declares it", async () => {
      const ensureNotesVaultReady = vi.fn();
      const exec = make({ ensureNotesVaultReady });
      await exec.startStatelessRun(makeRun(), verbFor());
      expect(ensureNotesVaultReady).not.toHaveBeenCalled();

      await exec.startStatelessRun(makeRun({ verb: "capture_learning" }), verbFor("capture_learning"));
      expect(ensureNotesVaultReady).toHaveBeenCalled();
    });
  });

  it("does not smuggle the bypass flag in when the permission mode is restricted", async () => {
    // IRIS_CLAUDE_PERMISSION_MODE exists to narrow the worker; attaching the
    // bypass flag unconditionally would make setting it meaningless.
    const originalEnv = { ...process.env };
    process.env.IRIS_CLAUDE_PERMISSION_MODE = "acceptEdits";
    try {
      const queryImpl = fakeQuery([resultMessage()]);
      const exec = make({ queryImpl });
      await exec.startStatelessRun(makeRun(), verbFor());

      const { options } = queryImpl.calls[0];
      expect(options.permissionMode).toBe("acceptEdits");
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  it("withholds GEMINI_API_KEY from a run's env but keeps the Claude credential it needs", async () => {
    // The bundled binary has no host /login store to fall back on, so stripping
    // CLAUDE_CODE_OAUTH_TOKEN (as the old spawn path did) would leave a run
    // unable to authenticate at all.
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-secret";
    process.env.ANTHROPIC_API_KEY = "api-secret";
    try {
      const queryImpl = fakeQuery([resultMessage()]);
      const exec = make({ queryImpl });
      await exec.startStatelessRun(makeRun(), verbFor());

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

  // The canvas server is wired from the verb's registry entry, not from a
  // per-run special case: a verb that has nothing to do with drawing never gets
  // it, even when the canvas is engaged.
  it("wires the canvas MCP record in-process, and only for the verb that declares it", async () => {
    const canvasQuery = fakeQuery([resultMessage()]);
    const ensureCanvasMcpForRun = vi.fn(async () => ({ url: "http://x", headers: {} }));
    await make({ queryImpl: canvasQuery, ensureCanvasMcpForRun }).startStatelessRun(makeRun(), verbFor());
    expect(canvasQuery.calls[0].options.mcpServers).toBeUndefined();
    expect(ensureCanvasMcpForRun).not.toHaveBeenCalled();
  });

  it("resumes the verb's own stored conversation for this workstream", async () => {
    const workstream = makeWorkstream({ agent_sessions: { execute: "sess-abc" } });
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl, findWorkstream: () => workstream });
    await exec.startStatelessRun(makeRun(), verbFor());

    const { options } = queryImpl.calls[0];
    expect(options.resume).toBe("sess-abc");
    expect(options.agent).toBe("iris-stateless");
    expect(options.model).toBe("claude-sonnet-5");
  });

  it("finalizes as COMPLETED on a successful result message", async () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, queryImpl: fakeQuery([resultMessage()]) });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "completed", "all done");
  });

  it("finalizes as FAILED when the result reports an error subtype", async () => {
    const runQueue = { finalize: vi.fn() };
    const queryImpl = fakeQuery([
      resultMessage({ subtype: "error_during_execution", is_error: true, result: "it broke" }),
    ]);
    const exec = make({ runQueue, queryImpl });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", "it broke");
  });

  describe("ceilings, cost, and diagnostics", () => {
    // The whole point of the distinct status: a run that hit a limit and a run
    // that broke need different responses from the user.
    for (const subtype of ["error_max_turns", "error_max_budget_usd"]) {
      it(`finalizes ${subtype} as LIMITED, naming the ceiling and how to raise it`, async () => {
        const runQueue = { finalize: vi.fn() };
        const queryImpl = fakeQuery([resultMessage({ subtype, is_error: true, result: "" })]);
        await make({ runQueue, queryImpl }).startStatelessRun(makeRun(), verbFor());

        const [, status, output] = runQueue.finalize.mock.calls[0];
        expect(status).toBe("limited");
        expect(output).not.toContain("claude reported");
        expect(output).toContain(subtype === "error_max_turns" ? "turn ceiling" : "spend ceiling");
        expect(output).toContain(
          subtype === "error_max_turns" ? "IRIS_CLAUDE_MAX_TURNS" : "IRIS_CLAUDE_MAX_BUDGET_USD",
        );
      });
    }

    it("keeps a stateless verb structurally unable to ask, and fails loudly if it ever tries", async () => {
      const runQueue = { finalize: vi.fn() };
      const queryImpl = fakeQuery([resultMessage()]);
      await make({ runQueue, queryImpl }).startStatelessRun(makeRun(), verbFor());

      const { options } = queryImpl.calls[0];
      expect(options.disallowedTools).toEqual(["AskUserQuestion"]);

      // The backstop: reaching the callback denies, aborts, and reports the
      // violation — it never waits for an answer nobody is listening for.
      const decision = await options.canUseTool("AskUserQuestion", { questions: [] });
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("nothing is listening");
      expect(options.abortController.signal.aborted).toBe(true);
    });

    // Investigating does not modify, and that has to be structural rather than
    // a promise in a prompt.
    it("withholds the edit tools from `investigate` without ending its run", async () => {
      const queryImpl = fakeQuery([resultMessage()]);
      const verb = verbFor("investigate");
      await make({ queryImpl }).startStatelessRun(makeRun({ verb: "investigate" }), verb);

      const { options } = queryImpl.calls[0];
      expect(options.disallowedTools).toEqual(expect.arrayContaining(["AskUserQuestion", "Write", "Edit"]));

      const decision = await options.canUseTool("Write", { file_path: "/x" });
      expect(decision.behavior).toBe("deny");
      // Denied, but the run continues: it can still answer, which is what it was
      // asked for. Only an attempt to ASK is fatal.
      expect(options.abortController.signal.aborted).toBe(false);
    });

    it("attaches the subprocess's stderr to a failure, and to nothing else", async () => {
      const runQueue = { finalize: vi.fn() };
      const queryImpl = fakeQuery([
        () => queryImpl.calls[0].options.stderr("Error: ENOENT spawn claude\n  at boot\n"),
        resultMessage({ subtype: "error_during_execution", is_error: true, result: "it broke" }),
      ]);
      await make({ runQueue, queryImpl }).startStatelessRun(makeRun(), verbFor());

      const [, , output] = runQueue.finalize.mock.calls[0];
      expect(output).toContain("it broke");
      expect(output).toContain("ENOENT spawn claude");

      const okQueue = { finalize: vi.fn() };
      const okQuery = fakeQuery([
        () => okQuery.calls[0].options.stderr("noisy debug line\n"),
        resultMessage(),
      ]);
      await make({ runQueue: okQueue, queryImpl: okQuery }).startStatelessRun(makeRun(), verbFor());
      expect(okQueue.finalize.mock.calls[0][2]).not.toContain("noisy debug line");
    });

    it("records what the run cost so the projection can carry it", async () => {
      const run = /** @type {any} */ (makeRun());
      const queryImpl = fakeQuery([
        resultMessage({ total_cost_usd: 0.42, num_turns: 7, usage: { output_tokens: 10 }, modelUsage: { "claude-sonnet-5": {} } }),
      ]);
      await make({ queryImpl }).startStatelessRun(run, verbFor());

      expect(run.usage).toEqual({
        cost_usd: 0.42,
        num_turns: 7,
        usage: { output_tokens: 10 },
        model_usage: { "claude-sonnet-5": {} },
      });
    });
  });

  it("finalizes as FAILED, naming the cause, when the iterator ends with no result at all", async () => {
    const runQueue = { finalize: vi.fn() };
    const exec = make({ runQueue, queryImpl: fakeQuery([]) });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", "claude ended without a result");
  });

  it("drops a dead resume id before the run starts, so it costs nothing", async () => {
    // This used to be discovered only AFTER a run had already failed, by regex-
    // matching the SDK's error string. getSessionInfo answers it up front.
    const workstream = makeWorkstream({ agent_sessions: { execute: "sess-dead" } });
    const persistSessionStore = vi.fn();
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({
      queryImpl,
      persistSessionStore,
      findWorkstream: () => workstream,
      isSessionAliveImpl: async () => false,
    });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(workstream.agent_sessions.execute).toBeUndefined();
    expect(persistSessionStore).toHaveBeenCalled();
    // And the run still goes ahead — as a fresh session, not a failure.
    expect(queryImpl.calls[0].options.resume).toBeUndefined();
  });

  it("probes the stored id against the run's own project directory", async () => {
    const workstream = makeWorkstream({ agent_sessions: { execute: "sess-abc" } });
    const isSessionAliveImpl = vi.fn(async () => true);
    await make({ findWorkstream: () => workstream, isSessionAliveImpl }).startStatelessRun(
      makeRun({ cwd: "/tmp/project" }),
      verbFor(),
    );

    expect(isSessionAliveImpl).toHaveBeenCalledWith("sess-abc", { dir: "/tmp/project" });
  });

  it("keeps a live resume id when the run fails for an unrelated reason", async () => {
    // An ordinary failure must not reset the workstream's context as a side
    // effect — losing a conversation is far worse than one failed run.
    const workstream = makeWorkstream({ agent_sessions: { execute: "sess-live" } });
    const persistSessionStore = vi.fn();
    const queryImpl = /** @type {any} */ (async function* () {
      yield resultMessage({ subtype: "error", is_error: true, result: "disk full" });
      throw new Error("disk full");
    });
    const exec = make({ queryImpl, persistSessionStore, findWorkstream: () => workstream });
    await exec.startStatelessRun(makeRun(), verbFor());

    expect(workstream.agent_sessions.execute).toBe("sess-live");
    expect(persistSessionStore).not.toHaveBeenCalled();
  });

  it("finalizes as ERROR when the query itself throws", async () => {
    const runQueue = { finalize: vi.fn() };
    const queryImpl = /** @type {any} */ (() => {
      throw new Error("ENOENT: bundled binary missing");
    });
    const exec = make({ queryImpl, runQueue });
    await exec.startStatelessRun(makeRun(), verbFor());

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
    await exec.startStatelessRun(capturedRun, verbFor());

    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "cancelled", "Run was stopped before completion.");
  });

  it("exposes a cancel hook the queue can use to abort the run", async () => {
    const run = makeRun();
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startStatelessRun(run, verbFor());

    const { options } = queryImpl.calls[0];
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(options.abortController.signal.aborted).toBe(false);
  });

  it("refuses to start a run when its persona cannot be loaded", () => {
    // The personas ship in the app, so this is a broken-bundle case rather than
    // a missing install step — but it must still fail loudly instead of
    // silently running as something else.
    const runQueue = { finalize: vi.fn() };
    const exec = make({
      runQueue,
      resolveAgentDefinition: () => {
        throw new Error("persona missing from the app bundle");
      },
    });
    exec.startClaudeRun({ run_id: "r1", verb: "execute", task: "implement", workstream_id: "ws1", urgency: "normal" });
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", expect.stringContaining("could not be loaded"));
  });

  it("refuses an unknown verb by name rather than running something", () => {
    const runQueue = { finalize: vi.fn() };
    make({ runQueue }).startClaudeRun({ run_id: "r1", verb: "dev", task: "x", workstream_id: "ws1", urgency: "normal" });
    expect(runQueue.finalize).toHaveBeenCalledWith("r1", "failed", expect.stringContaining("Unknown verb"));
  });

  it("hands the persona to the SDK by value, not by a ~/.claude/agents name", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    const exec = make({ queryImpl });
    await exec.startStatelessRun(makeRun(), verbFor());

    const { options } = queryImpl.calls[0];
    expect(options.agent).toBe("iris-stateless");
    expect(options.agents).toEqual({
      "iris-stateless": { description: "stateless persona", prompt: "You are stateless." },
    });
  });

  // D4. The gate that used to sit here refused a DEV run outright when no open
  // change had unchecked tasks. A user asking for a small piece of work is not
  // asking for a software-development process, and refusing them was never a
  // safety measure — the protection now comes from `execute` being parked for
  // review on every dispatch (run-dispatch.mjs).
  describe("`execute` forks on the project instead of refusing", () => {
    it("runs the OpenSpec workflow when an open change with tasks exists", async () => {
      const queryImpl = fakeQuery([resultMessage()]);
      make({ queryImpl, openChangesWithTasks: () => ["add-thing"] }).startClaudeRun(makeRun());
      await vi.waitFor(() => expect(queryImpl.calls.length).toBe(1));

      const { options } = queryImpl.calls[0];
      expect(options.skills).toContain("iris:openspec-apply-change");
      expect(options.systemPrompt.append).toContain("open OpenSpec change");
    });

    it("simply does the work when there is no open change, rather than failing", async () => {
      const runQueue = { finalize: vi.fn() };
      const queryImpl = fakeQuery([resultMessage()]);
      make({ runQueue, queryImpl, openChangesWithTasks: () => [] }).startClaudeRun(makeRun());
      await vi.waitFor(() => expect(queryImpl.calls.length).toBe(1));

      const { options } = queryImpl.calls[0];
      expect(options.skills).toEqual([]);
      expect(options.systemPrompt.append).toContain("do not propose one");
      expect(runQueue.finalize).not.toHaveBeenCalledWith("r1", "failed", expect.stringContaining("No open OpenSpec"));
    });

    // "no process artifacts created" is part of the same requirement: scaffolding
    // a project the user only asked a small favour of is exactly that.
    it("does not scaffold OpenSpec into a project for ordinary work", async () => {
      const ensureProjectScaffold = vi.fn(() => ({ created: [] }));
      make({ ensureProjectScaffold, openChangesWithTasks: () => [] }).startClaudeRun(makeRun());
      expect(ensureProjectScaffold).not.toHaveBeenCalled();

      const shaping = vi.fn(() => ({ created: [] }));
      make({ ensureProjectScaffold: shaping }).startClaudeRun(makeRun({ verb: "shape_requirements" }));
      expect(shaping).toHaveBeenCalled();
    });

    // More ways to misroute is the trade this change accepts; it is only
    // acceptable while every selection is inspectable after the fact.
    it("logs the verb, its resolved configuration, and the project state that produced it", () => {
      const emitEvent = vi.fn();
      make({ emitEvent, openChangesWithTasks: () => ["add-thing"] }).startClaudeRun(makeRun());

      const line = emitEvent.mock.calls.map(([event]) => event.message).find((text) => text?.startsWith("Dispatching"));
      expect(line).toContain("execute");
      expect(line).toContain("claude-sonnet-5");
      expect(line).toContain("stateless");
      expect(line).toContain("park always");
      expect(line).toContain("open changes: add-thing");
      // The brief is the user's content, not diagnostics.
      expect(line).not.toContain("do a thing");
    });
  });
});

describe("run-exec: the stateful run shape", () => {
  it("refuses to start without a subscription token", async () => {
    // poBillingStatus is imported directly by run-exec.mjs from po-session.mjs,
    // not injected — clear the credentials it reads rather than stubbing
    // that import, so this test doesn't depend on the ambient environment.
    const originalEnv = { ...process.env };
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const runQueue = { finalize: vi.fn() };
      const exec = make({ runQueue });
      const run = { run_id: "r1", verb: "shape_requirements", task: "grill this", workstream_id: "ws1", urgency: "normal" };
      await exec.startStatefulRun(run, verbFor("shape_requirements"));
      expect(runQueue.finalize).toHaveBeenCalledWith(
        "r1",
        "failed",
        expect.stringContaining("live session needs a subscription token"),
      );
    } finally {
      process.env = originalEnv;
    }
  });

  // D3: the two shaping verbs are the same conversation in two media, so both
  // resolve to one resident session — whichever is called first opens it.
  it("resumes the one shared conversation for either shaping verb", async () => {
    const sessionKeys = [];
    const exec = make({ sessionKeyFor: (verb) => { const key = resolveVerb(verb).sessionKey; sessionKeys.push(key); return key; } });
    const originalEnv = { ...process.env };
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "token";
    try {
      await exec.startStatefulRun(
        { run_id: "r1", verb: "shape_requirements", task: "x", workstream_id: "ws1", urgency: "normal", cwd: "/tmp/project" },
        verbFor("shape_requirements"),
      ).catch(() => {});
      await exec.startStatefulRun(
        { run_id: "r2", verb: "shape_on_canvas", task: "y", workstream_id: "ws1", urgency: "normal", cwd: "/tmp/project" },
        verbFor("shape_on_canvas"),
      ).catch(() => {});
    } finally {
      process.env = originalEnv;
    }
    expect(new Set(sessionKeys)).toEqual(new Set(["stateful"]));
  });
});

// D7. The voice layer used to be the ONLY channel through which information
// about a request reached Claude; a detail dropped in its summary was gone.
describe("run-exec: the user's own words reach the run", () => {
  const spoken = [
    { text: "make the buttons blue, the hex is 0033ff", at: 1 },
    { text: "and it has to work on the iPad", at: 2 },
  ];

  it("attaches the recent transcript to a stateless run, fenced", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    await make({ queryImpl, recentUtterances: () => spoken }).startStatelessRun(makeRun(), verbFor());

    const { prompt } = queryImpl.calls[0];
    expect(prompt.startsWith("do a thing")).toBe(true);
    expect(prompt).toContain("0033ff");
    expect(prompt).toContain("untrusted content");
    expect(prompt).toMatch(/<<<IRIS_UNTRUSTED_[0-9a-f]+>>>/);
  });

  it("sends the brief alone when nothing was captured", async () => {
    const queryImpl = fakeQuery([resultMessage()]);
    await make({ queryImpl, recentUtterances: () => [] }).startStatelessRun(makeRun(), verbFor());
    expect(queryImpl.calls[0].prompt).toBe("do a thing");
  });

  // On a resumed session this block is attached on every turn, so an unbounded
  // one would grow the cost of a long conversation turn after turn.
  it("stays bounded however long the conversation gets", async () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ text: "z".repeat(300), at: index }));
    const queryImpl = fakeQuery([resultMessage()]);
    await make({ queryImpl, recentUtterances: () => many }).startStatelessRun(makeRun(), verbFor());
    expect(queryImpl.calls[0].prompt.length).toBeLessThan(6000);
  });
});

// open-note-session design D6/8: the destructive-edit confirmation, wired only
// for the verb that declares `guardOpenNoteWrites`. buildNoteWriteGuard is the
// caller half of the seam po-session.mjs's buildCanUseTool exposes — this
// exercises it directly against a real file, the same convention
// vault-write.test.mjs uses.
describe("run-exec: the note write guard", () => {
  function withNote(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-note-guard-"));
    const notePath = path.join(dir, "note.md");
    fs.writeFileSync(notePath, content);
    return notePath;
  }

  it("returns undefined (no guard at all) when there is no open note", () => {
    expect(buildNoteWriteGuard({ askUserQuestionViaVoice: vi.fn(), workstreamId: "ws1", notePath: null })).toBeUndefined();
  });

  it("allows a write aimed at a different file without asking anything", async () => {
    const notePath = withNote("Paragraph one.\n\nParagraph two.");
    const askUserQuestionViaVoice = vi.fn();
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Edit", { file_path: "/somewhere/else.md", old_string: "x", new_string: "" });
    expect(result).toEqual({ behavior: "allow" });
    expect(askUserQuestionViaVoice).not.toHaveBeenCalled();
  });

  it("allows a pure-insertion Edit to the open note without asking", async () => {
    const notePath = withNote("Paragraph one.");
    const askUserQuestionViaVoice = vi.fn();
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Edit", {
      file_path: notePath,
      old_string: "Paragraph one.",
      new_string: "Paragraph one.\n\nParagraph two.",
    });
    expect(result).toEqual({ behavior: "allow" });
    expect(askUserQuestionViaVoice).not.toHaveBeenCalled();
  });

  it("holds a destructive Edit until confirmed, and orders the first option as the no-op", async () => {
    const notePath = withNote("Paragraph one.\n\nParagraph two.");
    const askUserQuestionViaVoice = vi.fn(async (_workstreamId, questions) => {
      expect(questions[0].options[0].label).toBe("Keep it, don't remove"); // task 8.5
      return { behavior: "allow", answers: { [questions[0].question]: "Yes, remove it" } };
    });
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Edit", {
      file_path: notePath,
      old_string: "Paragraph one.\n\nParagraph two.",
      new_string: "Paragraph one.",
    });
    expect(askUserQuestionViaVoice).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ behavior: "allow" });
  });

  it("denies the write when the user declines", async () => {
    const notePath = withNote("Paragraph one.\n\nParagraph two.");
    const askUserQuestionViaVoice = vi.fn(async (_workstreamId, questions) => ({
      behavior: "allow",
      answers: { [questions[0].question]: "Keep it, don't remove" },
    }));
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Edit", {
      file_path: notePath,
      old_string: "Paragraph one.\n\nParagraph two.",
      new_string: "Paragraph one.",
    });
    expect(result.behavior).toBe("deny");
    // Names which part it identified, so the next turn corrects (task 8.6).
    expect(result.message).toContain("Paragraph one.\n\nParagraph two.");
  });

  it("writes nothing when the confirmation goes unanswered (the relay's own timeout default is options[0])", async () => {
    const notePath = withNote("Paragraph one.\n\nParagraph two.");
    // Mirrors defaultPoAnswers' behavior: an unanswered question resolves to
    // options[0].label, which MUST be the no-op (task 8.5/9.9).
    const askUserQuestionViaVoice = vi.fn(async (_workstreamId, questions) => ({
      behavior: "allow",
      answers: { [questions[0].question]: questions[0].options[0].label },
    }));
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Write", { file_path: notePath, content: "Paragraph one." });
    expect(result.behavior).toBe("deny");
  });

  it("denies when the question is abandoned (a session reset mid-confirmation)", async () => {
    const notePath = withNote("Paragraph one.\n\nParagraph two.");
    const askUserQuestionViaVoice = vi.fn(async () => ({ behavior: "deny", message: "Question abandoned." }));
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Write", { file_path: notePath, content: "Paragraph one." });
    expect(result).toEqual({ behavior: "deny", message: "Question abandoned." });
  });

  it("allows a Write to a note that does not exist yet — nothing to remove from", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-note-guard-"));
    const notePath = path.join(dir, "brand-new.md");
    const askUserQuestionViaVoice = vi.fn();
    const confirmWrite = buildNoteWriteGuard({ askUserQuestionViaVoice, workstreamId: "ws1", notePath });

    const result = await confirmWrite("Write", { file_path: notePath, content: "First thought." });
    expect(result).toEqual({ behavior: "allow" });
    expect(askUserQuestionViaVoice).not.toHaveBeenCalled();
  });
});
