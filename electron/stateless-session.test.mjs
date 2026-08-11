// The extracted module's own surface (main-process-structure: each extracted
// module lands with its test). Deliberately thin: the BEHAVIOUR of a stateless
// run is covered where it already was — run-exec.test.mjs drives it end to end,
// and sdk-options.test.mjs pins the complete `query()` options key set, which is
// what proves the extraction moved code without changing what a run is given.
// What is NOT covered anywhere else is this: that the factory can be constructed
// from the stateless subset of the deps alone, with nothing reached for that only
// run-exec.mjs had.
import { describe, it, expect, vi } from "vitest";
import { createStatelessSession, effectiveDisallowedTools } from "./stateless-session.mjs";

// Exactly the stateless subset named in the factory's JSDoc — no cwd resolver,
// no verb resolution, no stateful session handles. If the module ever reaches
// for something outside this list, constructing it here is what says so.
function makeDeps(overrides = {}) {
  return {
    runQueue: { finalize: vi.fn() },
    emitEvent: vi.fn(),
    findWorkstream: () => ({ id: "ws1", cwd: "/tmp/project", agent_sessions: {}, label: "Project" }),
    persistSessionStore: vi.fn(),
    sessionKeyFor: (verb) => verb,
    resolveVerbModel: () => null,
    agentPrefix: "iris-",
    claudeBinary: () => "/bundled/claude",
    resolveAgentDefinition: () => ({ description: "d", prompt: "p" }),
    irisPluginConfig: () => null,
    ensureCanvasMcpForRun: async () => null,
    ensureNotesVaultReady: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true }),
    notesVaultDir: "/tmp/vault",
    notesInboxDir: "/tmp/vault/inbox",
    recentUtterances: () => [],
    handleClaudeStreamMessage: vi.fn(),
    pushActivity: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    ...overrides,
  };
}

describe("stateless-session: the factory surface", () => {
  it("returns exactly startStatelessRun", () => {
    const session = createStatelessSession(makeDeps());
    expect(Object.keys(session)).toEqual(["startStatelessRun"]);
    expect(typeof session.startStatelessRun).toBe("function");
  });

  // The optional deps carry defaults, so a wiring that has not grown a focus
  // resolver or a listening window still constructs — the same
  // default-to-nothing shape run-exec.mjs had before the extraction.
  it("constructs from the required deps alone, without the optional ones", () => {
    expect(() => createStatelessSession(makeDeps())).not.toThrow();
  });

  // The one dep whose default must not be permissive: canRelayQuestion fails
  // CLOSED, so a wiring that forgot it withholds the question tool rather than
  // granting a tool whose answer nothing could deliver.
  it("withholds the question tool when nothing declares it can relay one", () => {
    const verb = { disallowedTools: [] };
    expect(effectiveDisallowedTools(verb, false)).toContain("AskUserQuestion");
    expect(effectiveDisallowedTools(verb, true)).toEqual([]);
  });
});
