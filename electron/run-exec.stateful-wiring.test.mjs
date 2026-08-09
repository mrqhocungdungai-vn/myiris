// The wiring the prose-narration tests did not cover, and could not have: they
// drove `handleClaudeStreamMessage`, which is the STATELESS path, while the
// canvas conversation is resident and routes through po-session's own parser
// with callbacks assembled here. The feature was wired to nothing and the
// suite was green — so this file drives the stateful path instead, and asserts
// the callbacks a resident turn is actually given.
import { describe, it, expect, vi, beforeEach } from "vitest";

const delivered = { calls: [] };

vi.mock("./po-session.mjs", () => ({
  poBillingStatus: () => ({ ok: true, mode: "subscription" }),
  getOrCreatePoSession: vi.fn(() => ({ currentModel: "claude-opus-5", currentMcp: true, ended: false })),
  getPoSessionState: vi.fn(() => null),
  deliverPoTurn: vi.fn((_state, task, callbacks) => {
    delivered.calls.push({ task, callbacks });
    return new Promise(() => {});
  }),
  cancelPoTurn: vi.fn(),
  setPoSessionModel: vi.fn(async () => {}),
  setPoSessionMcpServers: vi.fn(async () => {}),
  DEFAULT_PO_QUESTION_TIMEOUT_MS: 300000,
}));

const { createRunExec } = await import("./run-exec.mjs");
const { resolveVerb } = await import("./verbs.mjs");

function makeExec(overrides = {}) {
  const workstream = { id: "ws1", cwd: "/tmp/project", agent_sessions: {}, label: "Project" };
  return createRunExec({
    runQueue: { finalize: vi.fn() },
    emitEvent: vi.fn(),
    findWorkstream: () => workstream,
    persistSessionStore: vi.fn(),
    sessionKeyFor: (verb) => resolveVerb(verb).sessionKey,
    resolveVerbModel: () => "claude-opus-5",
    agentPrefix: "iris-",
    claudeWorkdir: () => "/tmp/default-workspace",
    claudeBinary: () => "/bundled/claude",
    resolveAgentDefinition: (base) => ({ description: `${base} persona`, prompt: `You are ${base}.` }),
    irisPluginConfig: () => [],
    ensureProjectScaffold: () => ({ created: [] }),
    openChangesWithTasks: () => [],
    ensureCanvasMcpForRun: vi.fn(async () => null),
    ensureNotesVaultReady: vi.fn(),
    checkNotesSkillsStatus: () => ({ ok: true }),
    notesVaultDir: "/tmp/notes-vault",
    notesInboxDir: "/tmp/notes-vault/inbox/runs",
    recentUtterances: () => [],
    handleClaudeStreamMessage: vi.fn(),
    pushActivity: vi.fn(),
    speakWorkingText: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    resolveFocusForPrompt: () => null,
    resolveOpenNoteForRun: () => null,
    openNoteWritePath: () => null,
    ...overrides,
  });
}

function makeRun(verb) {
  return { run_id: "run-1", workstream_id: "ws1", verb, task: "make it blue", urgency: "normal", activity: [] };
}

describe("run-exec: what a resident turn is actually given", () => {
  beforeEach(() => {
    delivered.calls = [];
  });

  it("routes the worker's prose to the voice", async () => {
    const speakWorkingText = vi.fn();
    const exec = makeExec({ speakWorkingText });
    const run = makeRun("shape_on_canvas");

    await exec.startStatefulRun(run, resolveVerb("shape_on_canvas"));
    // The turn is delivered after a model/MCP readiness hop, so it lands a
    // microtask later than the call that started it.
    await vi.waitFor(() => expect(delivered.calls).toHaveLength(1));
    const { callbacks } = delivered.calls[0];
    expect(typeof callbacks.onAssistantText).toBe("function");

    callbacks.onAssistantText("Those two boxes overlap.");
    expect(speakWorkingText).toHaveBeenCalledWith(run, "Those two boxes overlap.");
  });

  it("still routes activity and tool events where they went before", async () => {
    const pushActivity = vi.fn();
    const pushToolStart = vi.fn();
    const exec = makeExec({ pushActivity, pushToolStart });
    const run = makeRun("shape_on_canvas");

    await exec.startStatefulRun(run, resolveVerb("shape_on_canvas"));
    await vi.waitFor(() => expect(delivered.calls).toHaveLength(1));
    const { callbacks } = delivered.calls[0];

    callbacks.onActivity("[Read] canvas.json");
    callbacks.onToolStart("t1", "add_elements", "3 boxes");

    expect(pushActivity).toHaveBeenCalledWith(run, "[Read] canvas.json");
    expect(pushToolStart).toHaveBeenCalledWith(run, "t1", "add_elements", "3 boxes");
  });
});
