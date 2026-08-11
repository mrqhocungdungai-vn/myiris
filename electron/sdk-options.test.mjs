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
import { getOrCreateStatefulSession, closeAllStatefulSessions } from "./stateful-session.mjs";
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
    activeWorkstream: () => workstream,
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
    speakWorkingText: vi.fn(),
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

async function optionsFor(name, changes = ["some-change"], overrides = {}) {
  const queryImpl = fakeQuery();
  await makeExec(queryImpl, overrides).startStatelessRun(makeRun({ verb: name }), resolveVerb(name, changes));
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
    expect(options.env.CLAUDE_CONFIG_DIR).toContain(path.join(".myiris", "claude-home"));
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

  // ask-when-unspecified: `execute` now resolves to TWO run configurations, so
  // both get the complete-key-set assertion this file exists for — the key set is
  // identical either way, and only the contents of one list differ, which is
  // exactly what should be checked.
  describe("its second configuration: no open change, and someone listening", () => {
    const listening = { canRelayQuestion: () => true };

    it("has exactly the same fields, and no others", async () => {
      expect(Object.keys(await optionsFor("execute", [], listening)).sort()).toEqual([...EXECUTE_KEYS].sort());
    });

    it("differs from the settled-work configuration only in the question tool, the skills, and the prompt", async () => {
      const settled = await optionsFor("execute", ["some-change"], listening);
      const unspecified = await optionsFor("execute", [], listening);

      expect(settled.disallowedTools).toEqual(["AskUserQuestion"]);
      expect(unspecified.disallowedTools).toEqual([]);
      expect(unspecified.skills).toEqual([]);
      expect(unspecified.systemPrompt).not.toEqual(settled.systemPrompt);

      // Everything else is byte-identical, so the fork cannot quietly widen.
      // The three fields above are excluded because they are what differs; the
      // rest carry a function or a live object and are asserted by shape above.
      const FORKED = ["disallowedTools", "skills", "systemPrompt"];
      const BY_SHAPE = ["canUseTool", "stderr", "hooks", "abortController", "agents", "env"];
      const rest = (options) =>
        Object.fromEntries(
          Object.entries(options).filter(([key]) => !FORKED.includes(key) && !BY_SHAPE.includes(key)),
        );
      expect(rest(unspecified)).toEqual(rest(settled));
    });

    // Both halves of the guarantee, in one place: the tool is present, and the
    // prompt the same run carries agrees that it is.
    it("carries a prompt that agrees with the tool the run was actually given", async () => {
      const unspecified = await optionsFor("execute", [], listening);
      const settled = await optionsFor("execute", ["some-change"], listening);

      expect(unspecified.systemPrompt.append).toContain("AskUserQuestion");
      expect(settled.systemPrompt.append).not.toContain("AskUserQuestion");
    });

    // The listener is the second condition, and it is independent of the first.
    it("withholds the tool again when nothing can relay an answer", async () => {
      const asleep = await optionsFor("execute", [], { canRelayQuestion: () => false });
      expect(asleep.disallowedTools).toEqual(["AskUserQuestion"]);
      expect(asleep.systemPrompt.append).not.toContain("AskUserQuestion");
    });
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
  const STATEFUL_KEYS = [
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

  function statefulOptions() {
    /** @type {any} */
    let captured;
    getOrCreateStatefulSession(
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
    expect(Object.keys(statefulOptions()).sort()).toEqual([...STATEFUL_KEYS].sort());
    await closeAllStatefulSessions();
  });

  // The whole point of the original failure: the live-session instruction must
  // travel on the field the SDK reads.
  it("carries the live-session instruction on `systemPrompt`, never `appendSystemPrompt`", async () => {
    const options = statefulOptions();
    expect(options).not.toHaveProperty("appendSystemPrompt");
    expect(options.systemPrompt).toEqual(buildSystemPrompt(resolveVerb("shape_requirements")));
    await closeAllStatefulSessions();
  });

  it("shares its ceilings, skills, and schema policy with the stateless shape's", async () => {
    const options = statefulOptions();
    expect(options.maxTurns).toBe(resolveRunBudget("stateful", {}).maxTurns);
    expect(options.skills).toEqual(resolveVerb("shape_requirements").skills);
    expect(options.outputFormat).toBe(DECISION_OUTPUT_FORMAT);
    // This is the shape that IS allowed to ask, so it must not be locked out.
    expect(options).not.toHaveProperty("disallowedTools");
    expect(typeof options.canUseTool).toBe("function");
    await closeAllStatefulSessions();
  });
});

// open-note-session: work_on_note is ALSO a resident session, but with an
// explicit `outputFormat: false` (its reading must not be squeezed through
// the decisions schema's "keep it to a few sentences" summary) and its own
// per-note sessionKey rather than the shared shaping one.
describe("the options work_on_note hands to query()", () => {
  const noteVerb = resolveVerb("work_on_note", { changes: [], openNoteId: "note-1" });
  // Same shape as STATEFUL_KEYS, minus outputFormat: run-exec.mjs passes `false`
  // explicitly for this verb, and stateful-session.mjs omits the key entirely
  // rather than falling back to its default.
  const NOTE_KEYS = [
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

  function noteOptions(overrides = {}) {
    /** @type {any} */
    let captured;
    getOrCreateStatefulSession(
      { id: `ws-${Math.random()}` },
      {
        // Derived from the verb, like run-exec.mjs does it — a hard-coded
        // "iris-stateful" here would keep passing after the registry moved the
        // verb to its own persona.
        agent: `iris-${noteVerb.basePersona}`,
        agentDefinition: { description: noteVerb.basePersona, prompt: "You work on the open note." },
        plugins: [{ type: "local", path: "/bundle/iris-plugin" }],
        cwd: "/tmp/project",
        sessionKey: noteVerb.sessionKey,
        claudeExecutable: "/bundled/claude",
        model: "claude-opus-5",
        budget: resolveRunBudget("stateful", {}),
        stderr: () => {},
        skills: noteVerb.skills,
        systemPrompt: buildSystemPrompt(noteVerb),
        outputFormat: noteVerb.structuredOutput ? DECISION_OUTPUT_FORMAT : false,
        buildHooks: () => ({ PreToolUse: [] }),
        title: "Iris · Note",
        onAskUserQuestion: async () => ({ behavior: "allow", answers: {} }),
        query: /** @type {any} */ (({ options }) => {
          captured = options;
          return { async *[Symbol.asyncIterator]() {} };
        }),
        ...overrides,
      },
    );
    return captured;
  }

  it("has exactly these fields, and no others — outputFormat is absent, not just falsy", async () => {
    const options = noteOptions();
    expect(Object.keys(options).sort()).toEqual([...NOTE_KEYS].sort());
    expect(options).not.toHaveProperty("outputFormat");
    await closeAllStatefulSessions();
  });

  it("resolves to its own per-note session key, distinct from the shared shaping one", () => {
    expect(noteVerb.sessionKey).not.toBe(resolveVerb("shape_requirements").sessionKey);
    expect(noteVerb.sessionKey).toContain("note-1");
  });

  // The vault is still granted — the open note lives in it — but the skills are
  // not capture_learning's. The wiki suite curates the whole corpus; this verb
  // edits the one note on screen, and its discipline is prompt text plus the
  // confirmWrite seam below, never a skill the model may optionally invoke.
  it("is granted the vault, and carries no skills — the note discipline is not a skill", () => {
    expect(noteVerb.vault).toBe(true);
    expect(noteVerb.skills).toEqual([]);
    expect(noteVerb.skills).not.toEqual(resolveVerb("capture_learning").skills);
  });

  it("is not locked out of asking, and can hold a write via the injected confirmWrite seam", async () => {
    const confirmWrite = async () => ({ behavior: "deny", message: "hold" });
    const options = noteOptions({ confirmWrite });
    expect(options).not.toHaveProperty("disallowedTools");
    const decision = await options.canUseTool("Edit", { file_path: "/x", old_string: "a", new_string: "b" });
    expect(decision).toEqual({ behavior: "deny", message: "hold" });
    await closeAllStatefulSessions();
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
