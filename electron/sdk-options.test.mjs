// The exact `Options` object each role hands to `query()`, asserted field by
// field — the guard F1 lacked.
//
// F1's failure mode is not "a wrong value". It is a field the SDK does not read,
// sitting in an options object that looks entirely correct at the call site:
// `appendSystemPrompt` was passed for months, the code claimed PO had a
// live-session instruction, and the SDK silently dropped it. A test that checks
// only the fields it expects to be there cannot catch that — so these assert the
// COMPLETE key set, and an option that is added, renamed, or misspelled fails
// here instead of in a user's run.
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
import { skillsForRole } from "./run-skills.mjs";

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
  const workstream = { id: "ws1", cwd: "/tmp/project", agent_sessions: {}, active_agent: null };
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
    agent: null,
    task: "do a thing",
    workstream_id: "ws1",
    urgency: "normal",
    cwd: "/tmp/project",
    ...overrides,
  };
}

async function optionsFor(agent) {
  const queryImpl = fakeQuery();
  await makeExec(queryImpl).startDevRun(makeRun({ agent }));
  return queryImpl.calls[0].options;
}

// Keys that carry a function or a live object, asserted by presence and shape
// rather than by value.
const DEV_KEYS = [
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

const PLAIN_KEYS = [
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
  "abortController",
  "title",
];

describe("the options DEV hands to query()", () => {
  it("has exactly these fields, and no others", async () => {
    expect(Object.keys(await optionsFor("dev")).sort()).toEqual([...DEV_KEYS].sort());
  });

  it("sets each one to the value the policy modules produce", async () => {
    const options = await optionsFor("dev");
    const budget = resolveRunBudget("dev", {});

    expect(options.cwd).toBe("/tmp/project");
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.systemPrompt).toEqual(buildSystemPrompt("dev"));
    expect(options.pathToClaudeCodeExecutable).toBe("/bundled/claude");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.skills).toEqual(skillsForRole("dev"));
    expect(options.maxTurns).toBe(budget.maxTurns);
    expect(options.maxBudgetUsd).toBe(budget.maxBudgetUsd);
    expect(options.outputFormat).toBe(DECISION_OUTPUT_FORMAT);
    expect(options.disallowedTools).toEqual(["AskUserQuestion"]);
    expect(options.agent).toBe("iris-dev");
    expect(Object.keys(options.agents)).toEqual(["iris-dev"]);
    expect(options.model).toBe("claude-sonnet-5");
    // A transcript the user can identify, instead of an auto-generated summary.
    expect(options.title).toContain("DEV");
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
  // reaches a role. Both are load-bearing security properties, not conveniences.
  it("keeps the worker's environment computed by subtraction", async () => {
    const options = await optionsFor("dev");
    expect(options.settingSources).not.toContain("user");
    expect(options.env.GEMINI_API_KEY).toBeUndefined();
    expect(options.env.CLAUDE_CONFIG_DIR).toContain(path.join(".iris", "claude-home"));
    expect(options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });
});

describe("the options plain Claude hands to query()", () => {
  it("has exactly these fields, and no others", async () => {
    expect(Object.keys(await optionsFor(null)).sort()).toEqual([...PLAIN_KEYS].sort());
  });

  // Plain Claude is not a role: no persona, no schema, no question lockout, and
  // it is the only one granted the notes vault.
  it("differs from DEV exactly where it should", async () => {
    const options = await optionsFor(null);

    expect(options.agent).toBeUndefined();
    expect(options.agents).toBeUndefined();
    expect(options.outputFormat).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
    expect(options.canUseTool).toBeUndefined();
    expect(options.model).toBeUndefined();
    expect(options.additionalDirectories).toEqual(["/tmp/notes-vault"]);
    expect(options.skills).toEqual(skillsForRole("plain"));
    expect(options.maxTurns).toBe(resolveRunBudget("plain", {}).maxTurns);
  });
});

describe("the options PO hands to query()", () => {
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
        agent: "iris-po",
        agentDefinition: { description: "po", prompt: "You are PO." },
        plugins: [{ type: "local", path: "/bundle/iris-plugin" }],
        cwd: "/tmp/project",
        claudeExecutable: "/bundled/claude",
        model: "claude-opus-5",
        budget: resolveRunBudget("po", {}),
        stderr: () => {},
        skills: skillsForRole("po"),
        buildHooks: () => ({ PreToolUse: [] }),
        title: "Iris · PO",
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

  // The whole point of F1: PO's live-session instruction must travel on the
  // field the SDK reads, and its base prompt must match DEV's.
  it("carries the live-session instruction on `systemPrompt`, never `appendSystemPrompt`", async () => {
    const options = poOptions();
    expect(options).not.toHaveProperty("appendSystemPrompt");
    expect(options.systemPrompt).toEqual(buildSystemPrompt("po"));
    await closeAllPoSessions();
  });

  it("shares its ceilings, skills, and schema policy with DEV's", async () => {
    const options = poOptions();
    expect(options.maxTurns).toBe(resolveRunBudget("po", {}).maxTurns);
    expect(options.skills).toEqual(skillsForRole("po"));
    expect(options.outputFormat).toBe(DECISION_OUTPUT_FORMAT);
    // PO is the role that IS allowed to ask, so it must not be locked out.
    expect(options).not.toHaveProperty("disallowedTools");
    expect(typeof options.canUseTool).toBe("function");
    await closeAllPoSessions();
  });
});

// The check that makes the above more than a snapshot of our own beliefs: every
// field name we set must exist on the SDK's declared `Options` type. This is
// exactly what would have caught F1 — `appendSystemPrompt` is not declared there.
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
    for (const field of new Set([...DEV_KEYS, ...PLAIN_KEYS])) {
      expect(declared, `Options does not declare "${field}"`).toContain(field);
    }
    // The control: the field F1 was actually passing is NOT declared.
    expect(declared).not.toContain("appendSystemPrompt");
  });
});
