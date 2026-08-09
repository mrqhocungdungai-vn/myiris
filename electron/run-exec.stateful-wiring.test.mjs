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

// Cast to the mock shape: vi.mock above replaces the module at runtime, but
// the real module's types do not carry `.mock`, exactly as
// capabilities/canvas.test.mjs already does for its own mocks.
/** @type {any} */
const poSession = await import("./po-session.mjs");
const { createRunExec } = await import("./run-exec.mjs");
const { resolveVerb } = await import("./verbs.mjs");

function makeExec(overrides = {}) {
  const workstream = { id: "ws1", cwd: "/tmp/project", agent_sessions: {}, label: "Project" };
  return createRunExec({
    runQueue: { finalize: vi.fn() },
    emitEvent: vi.fn(),
    findWorkstream: () => workstream,
    activeWorkstream: () => workstream,
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

// The canvas capability's own test asserts that opening the panel CALLS
// warmConversation, with the function mocked. That is a test of the call site,
// and it stayed green while the real function did nothing at all: it looked
// the workstream up with `findWorkstream(null)`, which matches no session, so
// every warm returned "no-workstream" and no conversation was ever opened
// ahead of the first sentence. This suite drives the real one.
describe("run-exec: warming a conversation before the first sentence", () => {
  beforeEach(() => {
    delivered.calls = [];
    poSession.getOrCreatePoSession.mockClear();
    poSession.getPoSessionState.mockReturnValue(null);
  });

  it("opens a session against the ACTIVE workstream", async () => {
    const workstream = { id: "ws1", cwd: "/tmp/project", agent_sessions: {}, label: "Project" };
    const exec = makeExec({
      activeWorkstream: () => workstream,
      // A lookup by id is what a RUN uses; a warm has no run and no id, and
      // reaching for this is the bug.
      findWorkstream: () => null,
    });

    const result = await exec.warmStatefulConversation("shape_on_canvas");

    expect(result).toEqual({ warmed: true, reason: null });
    expect(poSession.getOrCreatePoSession).toHaveBeenCalledTimes(1);
    expect(poSession.getOrCreatePoSession.mock.calls[0][0]).toBe(workstream);
  });

  it("marks the session warm, so the review gate still sees no conversation", async () => {
    const exec = makeExec({ activeWorkstream: () => ({ id: "ws1", cwd: "/tmp/project", agent_sessions: {} }) });

    await exec.warmStatefulConversation("shape_on_canvas");

    expect(poSession.getOrCreatePoSession.mock.calls[0][1].warm).toBe(true);
  });

  it("delivers no turn — a warm is a transport, not a conversation", async () => {
    const exec = makeExec({ activeWorkstream: () => ({ id: "ws1", cwd: "/tmp/project", agent_sessions: {} }) });

    await exec.warmStatefulConversation("shape_on_canvas");

    expect(delivered.calls).toHaveLength(0);
  });

  it("does nothing when a conversation is already open", async () => {
    // Warming again would be a handoff, closing the very conversation it means
    // to have ready.
    poSession.getPoSessionState.mockReturnValue({ ended: false });
    const exec = makeExec({ activeWorkstream: () => ({ id: "ws1", cwd: "/tmp/project", agent_sessions: {} }) });

    const result = await exec.warmStatefulConversation("shape_on_canvas");

    expect(result).toEqual({ warmed: false, reason: "already-open" });
    expect(poSession.getOrCreatePoSession).not.toHaveBeenCalled();
  });

  it("says why it did not warm when there is no workstream", async () => {
    const exec = makeExec({ activeWorkstream: () => null });

    expect(await exec.warmStatefulConversation("shape_on_canvas")).toEqual({
      warmed: false,
      reason: "no-workstream",
    });
  });
});

// The objective's second requirement, checked where it actually lands: not
// "does buildRunPrompt order the blocks correctly" (that is unit-tested in
// run-context) but "does the turn Claude is handed contain the user's own
// words, ahead of the voice layer's reading of them". Composition is where
// that promise has broken twice before.
describe("run-exec: what a resident turn is told the user said", () => {
  beforeEach(() => {
    delivered.calls = [];
    poSession.getPoSessionState.mockReturnValue(null);
  });

  it("puts the user's verbatim words ahead of the brief", async () => {
    const exec = makeExec({
      recentUtterances: () => [
        { text: "no wait, not the blue one", at: 1 },
        { text: "the box on the left, move it under the arrow", at: 2 },
      ],
    });
    const run = makeRun("shape_on_canvas");
    run.task = "Move the blue box.";

    await exec.startStatefulRun(run, resolveVerb("shape_on_canvas"));
    await vi.waitFor(() => expect(delivered.calls).toHaveLength(1));

    const { task } = delivered.calls[0];
    const wordsAt = task.indexOf("the box on the left");
    const briefAt = task.indexOf("Move the blue box.");
    expect(wordsAt).toBeGreaterThanOrEqual(0);
    expect(wordsAt).toBeLessThan(briefAt);
    expect(task).toMatch(/This is your instruction/);
  });

  it("still carries the verb's own clause, since the session is shared", async () => {
    // A session opened by the voice verb has that verb's clause baked into its
    // system prompt, so each turn has to say which kind of turn it is.
    const exec = makeExec({ recentUtterances: () => [{ text: "draw it", at: 1 }] });

    await exec.startStatefulRun(makeRun("shape_on_canvas"), resolveVerb("shape_on_canvas"));
    await vi.waitFor(() => expect(delivered.calls).toHaveLength(1));

    expect(delivered.calls[0].task).toContain("Work on the drawing canvas with the user.");
  });

  it("falls back to the brief alone when nothing was heard", async () => {
    const exec = makeExec({ recentUtterances: () => [] });
    const run = makeRun("shape_on_canvas");
    run.task = "Add a box.";

    await exec.startStatefulRun(run, resolveVerb("shape_on_canvas"));
    await vi.waitFor(() => expect(delivered.calls).toHaveLength(1));

    expect(delivered.calls[0].task).toContain("Add a box.");
    expect(delivered.calls[0].task).not.toMatch(/This is your instruction/);
  });
});
