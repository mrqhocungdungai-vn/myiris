// The exact `Options` object each run shape hands to `query()`, asserted field
// by field — the guard the dropped-instruction failure lacked.
//
// That failure was not "a wrong value". It was a field the SDK does not read,
// sitting in an options object that looked entirely correct at the call site:
// `appendSystemPrompt` was passed for months, the code claimed the resident
// session had a live-session instruction, and the SDK silently dropped it. A
// test that checks only the fields it expects to be there cannot catch that — so
// these assert the COMPLETE key set, and an option that is added, renamed, or
// misspelled fails here instead of in a user's run.
//
// Every field name below is checked against the installed SDK's declared
// `Options` type by the last test in this file, so a field that ceases to exist
// upstream is caught on the next `npm ci` rather than silently ignored at
// runtime.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunExec } from "./run-exec.mjs";
import { getOrCreatePoSession, closeAllPoSessions } from "./po-session.mjs";
import { buildSystemPrompt } from "./role-prompt.mjs";
import { DECISION_OUTPUT_FORMAT } from "./run-output-format.mjs";
import { resolveRunBudget } from "./run-budget.mjs";
import { resolveVerb } from "./verbs.mjs";

function fakeQuery() {
  const calls = [];
  /** @type {any} */
  const impl = ({ prompt, options }) => {
    calls.push({ prompt, options });
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "result", subtype: "success", is_error: false, result: "done" };
      },
    };
  };
  impl.calls = calls;
  return impl;
}

function makeExec(queryImpl, overrides = {}) {
  const workstream = { id: "ws1", cwd: "/tmp/project", agent_sessions: {} };
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
    handleClaudeStreamMessage: (run, message) => {
      if (message?.type === "result") run.result = message;
    },
    pushActivity: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    isSessionAliveImpl: async () => true,
    queryImpl,
    ...overrides,
  });
}

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

async function optionsFor(name, changes = ["some-change"]) {
  const queryImpl = fakeQuery();
  await makeExec(queryImpl).startStatelessRun(makeRun({ verb: name }), resolveVerb(name, changes));
  return queryImpl.calls[0].options;
}

// Keys that carry a function or a live object, asserted by presence and shape
// rather than by value.
const EXECUTE_KEYS = [
  "cwd",
  "permissionMode",
  "allowDangerouslySkipPermissions",
  "systemPrompt",
  "env",
  "pathToClaudeCodeExecutable",
  "plugins",
  "settingSources",
  "skills",
  "maxTurns",
  "maxBudgetUsd",
  "stderr",
  "hooks",
  "outputFormat",
  "agents",
  "agent",
  "disallowedTools",
  "canUseTool",
  "model",
  "abortController",
  "title",
];

// The capture verb is the only one granted the vault, and the only stateless
// verb without the decisions schema.
const CAPTURE_KEYS = [
  "cwd",
  "permissionMode",
  "allowDangerouslySkipPermissions",
  "systemPrompt",
  "env",
  "pathToClaudeCodeExecutable",
  "plugins",
  "settingSources",
  "skills",
  "maxTurns",
  "maxBudgetUsd",
  "stderr",
  "hooks",
  "additionalDirectories",
  "agents",
  "agent",
  "disallowedTools",
  "canUseTool",
  "model",
  "abortController",
  "title",
];

describe("the options `execute` hands to query()", () => {
  it("has exactly these fields, and no others", async () => {
    expect(Object.keys(await optionsFor("execute")).sort()).toEqual([...EXECUTE_KEYS].sort());
  });

  it("sets each one to the value the policy modules produce", async () => {
    const verb = resolveVerb("execute", ["some-change"]);
    const options = await optionsFor("execute");
    const budget = resolveRunBudget("worker", {});

    expect(options.cwd).toBe("/tmp/project");
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.systemPrompt).toEqual(buildSystemPrompt(verb));
    expect(options.pathToClaudeCodeExecutable).toBe("/bundled/claude");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.skills).toEqual(verb.skills);
    expect(options.maxTurns).toBe(budget.maxTurns);
    expect(options.maxBudgetUsd).toBe(budget.maxBudgetUsd);
    expect(options.outputFormat).toBe(DECISION_OUTPUT_FORMAT);
    expect(options.disallowedTools).toEqual(["AskUserQuestion"]);
    expect(options.agent).toBe("iris-stateless");
    expect(Object.keys(options.agents)).toEqual(["iris-stateless"]);
    expect(options.model).toBe("claude-sonnet-5");
    // A transcript the user can identify, instead of an auto-generated summary.
    expect(options.title).toContain("Build");
    expect(typeof options.stderr).toBe("function");
    expect(typeof options.canUseTool).toBe("function");
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(Object.keys(options.hooks).sort()).toEqual([
      "Notification",
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "PreToolUse",
    ]);
  });

  // The user's own ~/.claude is never a source, and the voice credential never
  // reaches a run. Both are load-bearing security properties, not conveniences.
  it("keeps the worker's environment computed by subtraction", async () => {
    const options = await optionsFor("execute");
    expect(options.settingSources).not.toContain("user");
    expect(options.env.GEMINI_API_KEY).toBeUndefined();
    expect(options.env.CLAUDE_CONFIG_DIR).toContain(path.join(".iris", "claude-home"));
    expect(options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  // D4: the fork is visible in the options, not just in a branch somewhere.
  it("changes exactly the skills and the prompt when there is no open change", async () => {
    const withChange = await optionsFor("execute", ["some-change"]);
    const without = await optionsFor("execute", []);

    expect(Object.keys(without).sort()).toEqual(Object.keys(withChange).sort());
    expect(without.skills).toEqual([]);
    expect(without.systemPrompt).not.toEqual(withChange.systemPrompt);
  });
});

describe("the options `capture_learning` hands to query()", () => {
  it("has exactly these fields, and no others", async () => {
    expect(Object.keys(await optionsFor("capture_learning")).sort()).toEqual([...CAPTURE_KEYS].sort());
  });

  // Every verb is a persona run now, so what differs is the capability surface:
  // the vault grant, the skills, the ceiling, and whether a decisions schema
  // applies at all.
  it("differs from `execute` exactly where it should", async () => {
    const options = await optionsFor("capture_learning");

    expect(options.outputFormat).toBeUndefined();
    expect(options.additionalDirectories).toEqual(["/tmp/notes-vault"]);
    expect(options.skills).toEqual(resolveVerb("capture_learning").skills);
    expect(options.maxTurns).toBe(resolveRunBudget("light", {}).maxTurns);
    expect(options.disallowedTools).toEqual(["AskUserQuestion"]);
  });
});

describe("the options `investigate` hands to query()", () => {
  // Investigating does not modify, and that is enforced by configuration rather
  // than promised in a prompt.
  it("withholds the edit tools as well as the question tool", async () => {
    const options = await optionsFor("investigate");
    expect(options.disallowedTools).toEqual(["AskUserQuestion", "Write", "Edit", "NotebookEdit"]);
    expect(options.additionalDirectories).toBeUndefined();
  });
});

describe("the options the resident session hands to query()", () => {
  const PO_KEYS = [
    "agent",
    "cwd",
    "abortController",
    "permissionMode",
    "allowDangerouslySkipPermissions",
    "settingSources",
    "skills",
    "env",
    "canUseTool",
    "systemPrompt",
    "outputFormat",
    "maxTurns",
    "maxBudgetUsd",
    "stderr",
    "hooks",
    "agents",
    "plugins",
    "pathToClaudeCodeExecutable",
    "model",
    "title",
  ];

  function poOptions() {
    /** @type {any} */
    let captured;
    getOrCreatePoSession(
      { id: `ws-${Math.random()}` },
      {
        agent: "iris-stateful",
        agentDefinition: { description: "stateful", prompt: "You are stateful." },
        plugins: [{ type: "local", path: "/bundle/iris-plugin" }],
        cwd: "/tmp/project",
        sessionKey: resolveVerb("shape_requirements").sessionKey,
        claudeExecutable: "/bundled/claude",
        model: "claude-opus-5",
        budget: resolveRunBudget("stateful", {}),
        stderr: () => {},
        skills: resolveVerb("shape_requirements").skills,
        systemPrompt: buildSystemPrompt(resolveVerb("shape_requirements")),
        buildHooks: () => ({ PreToolUse: [] }),
        title: "Iris · Shaping",
        onAskUserQuestion: async () => ({ behavior: "allow", answers: {} }),
        query: /** @type {any} */ (({ options }) => {
          captured = options;
          return { async *[Symbol.asyncIterator]() {} };
        }),
      },
    );
    return captured;
  }

  it("has exactly these fields, and no others", async () => {
    expect(Object.keys(poOptions()).sort()).toEqual([...PO_KEYS].sort());
    await closeAllPoSessions();
  });

  // The whole point of the original failure: the live-session instruction must
  // travel on the field the SDK reads.
  it("carries the live-session instruction on `systemPrompt`, never `appendSystemPrompt`", async () => {
    const options = poOptions();
    expect(options).not.toHaveProperty("appendSystemPrompt");
    expect(options.systemPrompt).toEqual(buildSystemPrompt(resolveVerb("shape_requirements")));
    await closeAllPoSessions();
  });

  it("shares its ceilings, skills, and schema policy with the stateless shape's", async () => {
    const options = poOptions();
    expect(options.maxTurns).toBe(resolveRunBudget("stateful", {}).maxTurns);
    expect(options.skills).toEqual(resolveVerb("shape_requirements").skills);
    expect(options.outputFormat).toBe(DECISION_OUTPUT_FORMAT);
    // This is the shape that IS allowed to ask, so it must not be locked out.
    expect(options).not.toHaveProperty("disallowedTools");
    expect(typeof options.canUseTool).toBe("function");
    await closeAllPoSessions();
  });
});

// The check that makes the above more than a snapshot of our own beliefs: every
// field name we set must exist on the SDK's declared `Options` type. This is
// exactly what would have caught the original failure — `appendSystemPrompt` is
// not declared there.
describe("every option Iris sets is one the SDK declares", () => {
  it("finds each field on the installed Options type", () => {
    const sdkTypes = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts",
      ),
      "utf8",
    );
    const optionsBlock = sdkTypes.slice(
      sdkTypes.indexOf("export declare type Options = {"),
      sdkTypes.indexOf("export declare type OutputFormat"),
    );
    expect(optionsBlock.length).toBeGreaterThan(1000);

    const declared = new Set(
      [...optionsBlock.matchAll(/^\s{4}(\w+)\??:/gm)].map((match) => match[1]),
    );
    for (const field of new Set([...EXECUTE_KEYS, ...CAPTURE_KEYS])) {
      expect(declared, `Options does not declare "${field}"`).toContain(field);
    }
    // The control: the field that was actually being passed is NOT declared.
    expect(declared).not.toContain("appendSystemPrompt");
  });
});
