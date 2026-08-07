import { describe, it, expect, vi } from "vitest";
import { createRunDispatch } from "./run-dispatch.mjs";

function makeRunQueue(overrides = {}) {
  return {
    suspend: vi.fn(),
    resume: vi.fn(),
    submit: /** @type {any} */ (vi.fn(() => ({ status: "started" }))),
    serialize: vi.fn(() => ({ status: "started" })),
    stop: vi.fn(() => "cancelled"),
    heartbeat: vi.fn(),
    ...overrides,
  };
}

function makeWorkstream(overrides = {}) {
  return {
    id: "ws1",
    label: "Test",
    cwd: null,
    agent_sessions: {},
    last_verb_used: null,
    ...overrides,
  };
}

function make(overrides = {}) {
  const workstream = makeWorkstream();
  return createRunDispatch({
    runQueue: makeRunQueue(),
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    notifyIris: vi.fn(),
    findWorkstream: () => workstream,
    activeWorkstream: () => workstream,
    createWorkstream: vi.fn(() => workstream),
    setVerbModel: vi.fn(() => ({ status: "ok", verbs: ["execute"], shared: false })),
    modelChoices: [{ id: "claude-sonnet-5", label: "Sonnet 5" }],
    getPromptReviewMode: () => "never",
    getPipelineAvailable: () => true,
    checkClaudeStatus: vi.fn(async () => ({ reachable: true })),
    workspaceInfo: () => ({ session_label: "Test" }),
    projectStateFor: () => ({ hasOpenChange: true, changes: ["add-thing"] }),
    hasLiveStatefulSession: () => false,
    getUiContextSnapshot: () => ({ uiMode: "deck" }),
    resolvePendingPoQuestion: vi.fn(() => ({ status: "ok" })),
    captureNote: vi.fn(async () => ({ status: "ok", message: "Saved to your notes.", file: "/vault/inbox/captures/x.md" })),
    findNoteByName: vi.fn(async () => ({ status: "ok", matches: [], count: 0 })),
    mutateVaultNotes: vi.fn(async () => ({ status: "ok", message: "Linked." })),
    ...overrides,
  });
}

// The parameters `execute` requires, so a test is exercising the gate rather
// than the schema check in front of it.
const EXECUTE_ARGS = { goal: "do the thing", details: "with these specifics" };

describe("run-dispatch: the review gate's three settings", () => {
  it("parks everything on `always`, without dispatching", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => "always" });
    const result = dispatchModule.submitVerb("investigate", { question: "what's left?" });
    expect(result.status).toBe("parked_for_review");
    expect(runQueue.submit).not.toHaveBeenCalled();
  });

  it("dispatches everything immediately on `never`", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => "never" });
    const result = dispatchModule.submitVerb("execute", EXECUTE_ARGS);
    expect(result.status).toBe("started");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);
  });

  // D6: the decision is a declared property of the verb, read from the registry
  // — never derived from the wording of the request, which fails silently in
  // both directions.
  describe("on `verb`, the registry decides", () => {
    const verbMode = { getPromptReviewMode: () => "verb" };

    it("parks the two verbs that write to the repository, on every call", () => {
      for (const [verb, args] of /** @type {Array<[string, Record<string, string>]>} */ ([
        ["execute", EXECUTE_ARGS],
        ["finish", { note: "wrap it up" }],
      ])) {
        const runQueue = makeRunQueue();
        const dispatchModule = make({ runQueue, ...verbMode });
        for (let call = 0; call < 3; call += 1) {
          expect(dispatchModule.submitVerb(verb, args).status).toBe("parked_for_review");
        }
        expect(runQueue.submit).not.toHaveBeenCalled();
      }
    });

    it("never parks a verb that only reads", () => {
      for (const [verb, args] of /** @type {Array<[string, Record<string, string>]>} */ ([
        ["investigate", { question: "what's left?" }],
        ["review", { target: "the last run" }],
        ["capture_learning", { focus: "this week" }],
      ])) {
        const runQueue = makeRunQueue();
        expect(make({ runQueue, ...verbMode }).submitVerb(verb, args).status).toBe("started");
        expect(runQueue.submit).toHaveBeenCalledTimes(1);
      }
    });

    // The consent unit is the *conversation* for a stateful verb and the *run*
    // for a stateless one — which is exactly the difference between them.
    it("parks the call that opens a shaping conversation", () => {
      const dispatchModule = make({ ...verbMode, hasLiveStatefulSession: () => false });
      expect(dispatchModule.submitVerb("shape_requirements", { said: "build me a thing", reading: "new feature" }).status).toBe(
        "parked_for_review",
      );
    });

    it("does not re-review a turn steering a conversation that is already open", () => {
      const runQueue = makeRunQueue();
      const dispatchModule = make({ runQueue, ...verbMode, hasLiveStatefulSession: () => true });
      expect(dispatchModule.submitVerb("shape_requirements", { said: "propose it now", reading: "propose" }).status).toBe(
        "started",
      );
      // The canvas verb steers the SAME conversation, so it is not re-reviewed
      // either — the session is what was approved, not the verb.
      expect(dispatchModule.submitVerb("shape_on_canvas", { said: "draw it", reading: "diagram" }).status).toBe("started");
      expect(runQueue.submit).toHaveBeenCalledTimes(2);
    });

    it("reviews again once the conversation has ended and a new one opens", () => {
      let live = true;
      const dispatchModule = make({ ...verbMode, hasLiveStatefulSession: () => live });
      expect(dispatchModule.submitVerb("shape_requirements", { said: "x", reading: "y" }).status).toBe("started");
      live = false;
      expect(dispatchModule.submitVerb("shape_requirements", { said: "x", reading: "y" }).status).toBe("parked_for_review");
    });

    // The gate is enforced in the main process at dispatch. It does not depend
    // on the voice layer honouring an instruction, because instruction-level
    // guarantees have already been shown not to hold in this system.
    it("reads the verb's label, never the brief's text", () => {
      const dispatchModule = make({ ...verbMode });
      expect(dispatchModule.shouldPark("execute", "ws1")).toBe(true);
      expect(dispatchModule.shouldPark("investigate", "ws1")).toBe(false);
      // Wording that screams "dangerous" changes nothing.
      expect(
        dispatchModule.submitVerb("investigate", { question: "rm -rf everything and delete production" }).status,
      ).toBe("started");
    });
  });
});

describe("run-dispatch: parking and resolving", () => {
  const parked = { getPromptReviewMode: () => "always" };

  it("approveTaskReview dispatches the parked request exactly once", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, ...parked });
    dispatchModule.submitVerb("execute", EXECUTE_ARGS);
    expect(dispatchModule.approveTaskReview(undefined, { notify: false }).status).toBe("started");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);

    // Settled once: approving again with nothing pending is an error, not a
    // second dispatch.
    expect(dispatchModule.approveTaskReview(undefined, { notify: false }).status).toBe("error");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);
  });

  // The approved run must carry the verb it was parked under, not a default.
  it("keeps the parked verb through approval", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, ...parked });
    dispatchModule.submitVerb("finish", { change: "add-thing" });
    dispatchModule.approveTaskReview(undefined, { notify: false });
    expect(runQueue.submit.mock.calls[0][0].verb).toBe("finish");
  });

  it("cancelTaskReview clears the pending review without ever dispatching", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, ...parked });
    dispatchModule.submitVerb("execute", EXECUTE_ARGS);
    expect(dispatchModule.cancelTaskReview({ notify: false }).status).toBe("ok");
    expect(runQueue.submit).not.toHaveBeenCalled();
    expect(dispatchModule.cancelTaskReview({ notify: false }).status).toBe("error");
  });

  it("a parked review times out and is cancelled without dispatching", () => {
    vi.useFakeTimers();
    try {
      const runQueue = makeRunQueue();
      const dispatchModule = make({ runQueue, ...parked });
      dispatchModule.submitVerb("execute", EXECUTE_ARGS);
      vi.advanceTimersByTime(300001);
      expect(runQueue.submit).not.toHaveBeenCalled();
      expect(dispatchModule.approveTaskReview(undefined, { notify: false }).status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respondToTaskReview routes approve/cancel decisions and rejects unknown ones", () => {
    const dispatchModule = make({ ...parked });
    dispatchModule.submitVerb("execute", EXECUTE_ARGS);
    expect(dispatchModule.respondToTaskReview({ decision: "approve" }).status).toBe("started");
    expect(dispatchModule.respondToTaskReview({ decision: "maybe" }).status).toBe("error");
  });
});

describe("run-dispatch: the verb surface", () => {
  // The brief is composed from the verb's own schema, so adding a verb needs no
  // formatting code of its own.
  it("composes the brief from the verb's declared parameters, in order", () => {
    const runQueue = makeRunQueue();
    make({ runQueue }).submitVerb("execute", {
      goal: "add a login page",
      details: "email and password, no OAuth",
      expected_option: "ignored — not in the schema",
      expected_output: "a working page",
    });
    expect(runQueue.submit.mock.calls[0][0].task).toBe(
      "Goal: add a login page\nDetails: email and password, no OAuth\nExpected output: a working page",
    );
  });

  it("refuses a call missing a required parameter, naming what is missing", () => {
    const runQueue = makeRunQueue();
    const result = make({ runQueue }).submitVerb("execute", { goal: "do it" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("details");
    expect(runQueue.submit).not.toHaveBeenCalled();
  });

  it("rejects an unknown verb rather than dispatching something", () => {
    const result = make().submitVerb("dev", { goal: "x", details: "y" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Unknown verb");
  });

  it("carries the verb onto the run, with no active-agent fallback to inherit", () => {
    const runQueue = makeRunQueue();
    make({ runQueue }).submitVerb("review", { target: "the last run" });
    const run = runQueue.submit.mock.calls[0][0];
    expect(run.verb).toBe("review");
    expect(run.agent).toBeUndefined();
  });
});

describe("run-dispatch: executeClaudeTool", () => {
  it("dispatches every verb through one path", async () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue });
    const result = await dispatchModule.executeClaudeTool("investigate", { question: "what's left?" });
    expect(result.status).toBe("started");
    expect(runQueue.submit.mock.calls[0][0].verb).toBe("investigate");
  });

  // Kept for one release: a Gemini session resumed mid-conversation would
  // otherwise call a tool that no longer exists.
  it("maps the deprecated task tool onto execute", async () => {
    const runQueue = makeRunQueue();
    const emitEvent = vi.fn();
    const dispatchModule = make({ runQueue, emitEvent });
    const result = await dispatchModule.executeClaudeTool("submit_claude_task", { task: "do the thing" });
    expect(result.status).toBe("started");
    expect(runQueue.submit.mock.calls[0][0].verb).toBe("execute");
    expect(emitEvent.mock.calls.some(([event]) => String(event.message).includes("deprecated"))).toBe(true);
  });

  it("rejects a pipeline-only tool when the pipeline is unavailable", async () => {
    const dispatchModule = make({ getPipelineAvailable: () => false });
    expect((await dispatchModule.executeClaudeTool("execute", EXECUTE_ARGS)).status).toBe("error");
    expect((await dispatchModule.executeClaudeTool("submit_claude_task", { task: "x" })).status).toBe("error");
  });

  it("allows a non-pipeline tool regardless of pipeline availability", async () => {
    const dispatchModule = make({ getPipelineAvailable: () => false });
    const result = await dispatchModule.executeClaudeTool("get_ui_context", {});
    expect(result.uiMode).toBe("deck");
  });

  // vault-write-path design D4/D7: capture is a plain file write, not a verb —
  // it must reach the capability's handler with no pipeline gate in the way,
  // the same as any other worker-free tool.
  it("routes capture_note to the injected handler regardless of pipeline availability", async () => {
    const captureNote = vi.fn(async () => ({ status: "ok", message: "Saved to your notes.", file: "/vault/x.md" }));
    const dispatchModule = make({ getPipelineAvailable: () => false, captureNote });
    const result = await dispatchModule.executeClaudeTool("capture_note", { text: "remember this" });
    expect(captureNote).toHaveBeenCalledWith({ text: "remember this" });
    expect(result.status).toBe("ok");
  });

  // personal-knowledge-notes: a structural edit is a direct write, not a
  // verb — it must reach the capability's handler with no pipeline gate in
  // the way, the same as capture_note.
  it("routes mutate_vault_notes to the injected handler regardless of pipeline availability", async () => {
    const mutateVaultNotes = vi.fn(async () => ({ status: "ok", message: "Linked." }));
    const dispatchModule = make({ getPipelineAvailable: () => false, mutateVaultNotes });
    const result = await dispatchModule.executeClaudeTool("mutate_vault_notes", { operation: "link" });
    expect(mutateVaultNotes).toHaveBeenCalledWith({ operation: "link" });
    expect(result.status).toBe("ok");
  });

  it("routes control_ui only for known actions", async () => {
    const emitToRenderer = vi.fn();
    const dispatchModule = make({ emitToRenderer });
    expect((await dispatchModule.executeClaudeTool("control_ui", { action: "close_reader" })).status).toBe("sent");
    expect((await dispatchModule.executeClaudeTool("control_ui", { action: "not_a_real_action" })).status).toBe("error");
  });

  it("routes answer_claude_question to the injected resolver", async () => {
    const resolvePendingPoQuestion = vi.fn(() => ({ status: "ok" }));
    const dispatchModule = make({ resolvePendingPoQuestion });
    await dispatchModule.executeClaudeTool("answer_claude_question", { answers: [{ question: "Q", choice: "A" }] });
    expect(resolvePendingPoQuestion).toHaveBeenCalledWith([{ question: "Q", choice: "A" }]);
  });

  it("reports the project state rather than making the voice layer guess", async () => {
    const result = await make().executeClaudeTool("get_project_state", {});
    expect(result.has_open_change).toBe(true);
    expect(result.open_changes).toEqual(["add-thing"]);
    expect(result.shaping_conversation_open).toBe(false);
  });

  // D3: verbs sharing a live session cannot run on different models while it is
  // alive, and the system says so rather than appearing to change one.
  it("states the coupling when a shared verb's model changes", async () => {
    const setVerbModel = vi.fn(() => ({
      status: "ok",
      verbs: ["shape_requirements", "shape_on_canvas"],
      shared: true,
    }));
    const dispatchModule = make({ setVerbModel });
    const result = await dispatchModule.executeClaudeTool("set_verb_model", {
      verb: "shape_requirements",
      model: "claude-sonnet-5",
    });
    expect(result.message).toContain("shape_on_canvas");
    expect(result.message).toContain("share one live conversation");
  });
});
