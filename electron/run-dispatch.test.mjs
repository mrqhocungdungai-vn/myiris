import { describe, it, expect, vi } from "vitest";
import { createRunDispatch } from "./run-dispatch.mjs";

function makeRunQueue(overrides = {}) {
  return {
    suspend: vi.fn(),
    resume: vi.fn(),
    submit: vi.fn(() => ({ status: "started" })),
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
    active_agent: null,
    agent_sessions: {},
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
    setAgentModel: vi.fn(() => ({ status: "ok" })),
    agentRoster: ["po", "dev"],
    agentLabels: { po: "PO", dev: "DEV" },
    modelChoices: [{ id: "claude-sonnet-5", label: "Sonnet 5" }],
    getPromptReviewMode: () => false,
    getPipelineAvailable: () => true,
    checkClaudeStatus: vi.fn(async () => ({ reachable: true })),
    workspaceInfo: () => ({ session_label: "Test" }),
    getUiContextSnapshot: () => ({ uiMode: "deck" }),
    resolvePendingPoQuestion: vi.fn(() => ({ status: "ok" })),
    ...overrides,
  });
}

describe("run-dispatch: prompt-review gate", () => {
  it("submitClaudeTask parks the brief when review mode is on, without dispatching", () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => true });
    return dispatchModule.submitClaudeTask({ task: "do the thing" }).then((result) => {
      expect(result.status).toBe("parked_for_review");
      expect(runQueue.submit).not.toHaveBeenCalled();
    });
  });

  it("submitClaudeTask dispatches immediately when review mode is off", async () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => false });
    const result = await dispatchModule.submitClaudeTask({ task: "do the thing" });
    expect(result.status).toBe("started");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);
  });

  it("approveTaskReview dispatches the parked brief exactly once", async () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => true });
    await dispatchModule.submitClaudeTask({ task: "do the thing" });
    const result = dispatchModule.approveTaskReview(undefined, { notify: false });
    expect(result.status).toBe("started");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);

    // Settled once: approving again with nothing pending is an error, not a
    // second dispatch.
    const second = dispatchModule.approveTaskReview(undefined, { notify: false });
    expect(second.status).toBe("error");
    expect(runQueue.submit).toHaveBeenCalledTimes(1);
  });

  it("cancelTaskReview clears the pending review without ever dispatching", async () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => true });
    await dispatchModule.submitClaudeTask({ task: "do the thing" });
    const result = dispatchModule.cancelTaskReview({ notify: false });
    expect(result.status).toBe("ok");
    expect(runQueue.submit).not.toHaveBeenCalled();

    const second = dispatchModule.cancelTaskReview({ notify: false });
    expect(second.status).toBe("error");
  });

  it("a parked review times out and is cancelled without dispatching", async () => {
    vi.useFakeTimers();
    try {
      const runQueue = makeRunQueue();
      const dispatchModule = make({ runQueue, getPromptReviewMode: () => true });
      const pending = dispatchModule.submitClaudeTask({ task: "do the thing" });
      await pending;
      vi.advanceTimersByTime(300001);
      // The timeout fired synchronously inside the timer callback; confirm no dispatch happened.
      expect(runQueue.submit).not.toHaveBeenCalled();
      // Approving after timeout is now a no-op error, since the review already cleared.
      const result = dispatchModule.approveTaskReview(undefined, { notify: false });
      expect(result.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respondToTaskReview routes approve/cancel decisions and rejects unknown ones", async () => {
    const runQueue = makeRunQueue();
    const dispatchModule = make({ runQueue, getPromptReviewMode: () => true });
    await dispatchModule.submitClaudeTask({ task: "do the thing" });
    const result = dispatchModule.respondToTaskReview({ decision: "approve" });
    expect(result.status).toBe("started");

    const unknown = dispatchModule.respondToTaskReview({ decision: "maybe" });
    expect(unknown.status).toBe("error");
  });
});

describe("run-dispatch: executeClaudeTool", () => {
  it("rejects a pipeline-only tool when the pipeline is unavailable", async () => {
    const dispatchModule = make({ getPipelineAvailable: () => false });
    const result = await dispatchModule.executeClaudeTool("submit_claude_task", { task: "x" });
    expect(result.status).toBe("error");
  });

  it("allows a non-pipeline tool regardless of pipeline availability", async () => {
    const dispatchModule = make({ getPipelineAvailable: () => false });
    const result = await dispatchModule.executeClaudeTool("get_ui_context", {});
    expect(result.uiMode).toBe("deck");
  });

  it("routes control_ui only for known actions", async () => {
    const emitToRenderer = vi.fn();
    const dispatchModule = make({ emitToRenderer });
    const ok = await dispatchModule.executeClaudeTool("control_ui", { action: "close_reader" });
    expect(ok.status).toBe("sent");
    const bad = await dispatchModule.executeClaudeTool("control_ui", { action: "not_a_real_action" });
    expect(bad.status).toBe("error");
  });

  it("routes answer_po_question to the injected resolvePendingPoQuestion", async () => {
    const resolvePendingPoQuestion = vi.fn(() => ({ status: "ok" }));
    const dispatchModule = make({ resolvePendingPoQuestion });
    await dispatchModule.executeClaudeTool("answer_po_question", { answers: [{ question: "Q", choice: "A" }] });
    expect(resolvePendingPoQuestion).toHaveBeenCalledWith([{ question: "Q", choice: "A" }]);
  });
});
