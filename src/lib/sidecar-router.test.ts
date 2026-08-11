import { describe, it, expect, vi } from "vitest";
import { routeSidecarEvent, type SidecarRouterDeps } from "./sidecar-router";

// This routing lived as a 19-branch chain inside a React component and could
// not be exercised at all. It can now be driven with fakes.
function fakes() {
  const deps = {
    session: { setRunning: vi.fn(), setPid: vi.fn(), setGemini: vi.fn(), setClaude: vi.fn(), setAudio: vi.fn() },
    work: { apply: vi.fn(), finishRun: vi.fn() },
    review: { applyMode: vi.fn(), setPending: vi.fn() },
    claudeQuestion: { raise: vi.fn(), clear: vi.fn() },
    listenOnly: { refuse: vi.fn(), setHeardLive: vi.fn() },
    orb: { ripple: vi.fn() },
    workstreams: { apply: vi.fn(), refreshVerbs: vi.fn() },
    hud: { closeGalaxy: vi.fn() },
    pushLog: vi.fn(),
    pushTranscript: vi.fn(),
    setPipelineAvailable: vi.fn(),
    setSecondBrainAvailable: vi.fn(),
  } satisfies SidecarRouterDeps;
  const send = (event: Record<string, unknown>) => routeSidecarEvent(event as never, deps);
  return { deps, send };
}

describe("availability", () => {
  it("routes pipeline availability", () => {
    const { deps, send } = fakes();
    send({ type: "pipeline_availability", available: true });
    expect(deps.setPipelineAvailable).toHaveBeenCalledWith(true);
  });

  // On disappearance the galaxy is force-closed, or the toggle hides while the
  // layer stays up (design.md D7/M4/M-5/L2).
  it("force-closes the galaxy when the second brain disappears", () => {
    const { deps, send } = fakes();
    send({ type: "secondbrain_availability", available: false });
    expect(deps.setSecondBrainAvailable).toHaveBeenCalledWith(false);
    expect(deps.hud.closeGalaxy).toHaveBeenCalled();
  });

  it("does not close the galaxy when it becomes available", () => {
    const { deps, send } = fakes();
    send({ type: "secondbrain_availability", available: true });
    expect(deps.hud.closeGalaxy).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it("routes each status to its own setter", () => {
    const { deps, send } = fakes();
    send({ type: "sidecar_status", status: { running: true, pid: 42 } });
    expect(deps.session.setRunning).toHaveBeenCalledWith(true);
    expect(deps.session.setPid).toHaveBeenCalledWith(42);
    send({ type: "gemini_status", status: "connected" });
    expect(deps.session.setGemini).toHaveBeenCalledWith("connected");
    send({ type: "audio_state", state: "speaking" });
    expect(deps.session.setAudio).toHaveBeenCalledWith("speaking");
  });

  it("logs a claude error at error level and anything else at info", () => {
    const { deps, send } = fakes();
    send({ type: "claude_status", status: "error", error: "boom" });
    expect(deps.pushLog.mock.calls[0][0]).toBe("error");
    expect(deps.pushLog.mock.calls[0][1]).toContain("boom");
    send({ type: "claude_status", status: "ready" });
    expect(deps.pushLog.mock.calls[1][0]).toBe("info");
  });

  it("tolerates a malformed status object", () => {
    const { deps, send } = fakes();
    send({ type: "sidecar_status", status: null });
    expect(deps.session.setPid).toHaveBeenCalledWith(null);
  });
});

describe("transcript", () => {
  // The ripple means "your speech just locked in" — it must not fire for a line
  // Iris merely overheard.
  it("ripples for the user's own speech only", () => {
    const { deps, send } = fakes();
    send({ type: "transcript", speaker: "you", text: "hello" });
    expect(deps.orb.ripple).toHaveBeenCalledTimes(1);
    send({ type: "transcript", speaker: "heard", text: "overheard" });
    expect(deps.orb.ripple).toHaveBeenCalledTimes(1);
    expect(deps.pushTranscript).toHaveBeenCalledTimes(2);
  });

  it("drops an empty or whitespace-only line", () => {
    const { deps, send } = fakes();
    send({ type: "transcript", speaker: "you", text: "   " });
    expect(deps.pushTranscript).not.toHaveBeenCalled();
  });
});

describe("claude_question", () => {
  it("raises a pending question and clears a settled one", () => {
    const { deps, send } = fakes();
    send({ type: "claude_question", status: "pending", workstream_id: "w1", questions: [] });
    expect(deps.claudeQuestion.raise).toHaveBeenCalledWith({ workstreamId: "w1", questions: [] });
    send({ type: "claude_question", status: "answered" });
    expect(deps.claudeQuestion.clear).toHaveBeenCalled();
  });

  // voice-decision-relay: "The unanswered outcome is never presented as a
  // decision." Announcing the ALLOW wording for a DENY settlement would report
  // a decision the user never made.
  it("uses the outcome main reports rather than inferring one", () => {
    const { deps, send } = fakes();
    send({ type: "claude_question", status: "timed_out", outcome: "defaulted" });
    expect(deps.pushLog.mock.calls[0][1]).toMatch(/applied its recommended option/);

    const b = fakes();
    b.send({ type: "claude_question", status: "timed_out", outcome: "unanswered" });
    expect(b.deps.pushLog.mock.calls[0][1]).toMatch(/no answer was supplied/);
    expect(b.deps.pushLog.mock.calls[0][1]).not.toMatch(/recommended option/);
  });

  // An older main that sends no `outcome` must fall back to neutral wording,
  // never to the wrong one.
  it("falls back to neutral wording when no outcome is reported", () => {
    const { deps, send } = fakes();
    send({ type: "claude_question", status: "timed_out" });
    expect(deps.pushLog.mock.calls[0][1]).toBe("Claude's question went unanswered.");
  });

  it("says nothing extra when the question was actually answered", () => {
    const { deps, send } = fakes();
    send({ type: "claude_question", status: "answered" });
    expect(deps.pushLog).not.toHaveBeenCalled();
  });
});

describe("task_review", () => {
  it("raises a parked review and clears a settled one", () => {
    const { deps, send } = fakes();
    send({ type: "task_review", status: "pending", workstream_id: "w1", task: "do it", verb: "execute" });
    expect(deps.review.setPending).toHaveBeenCalledWith(
      expect.objectContaining({ workstreamId: "w1", task: "do it", verb: "execute" }),
    );
    send({ type: "task_review", status: "approved" });
    expect(deps.review.setPending).toHaveBeenLastCalledWith(null);
  });

  it("rejects a verb the registry does not know", () => {
    const { deps, send } = fakes();
    send({ type: "task_review", status: "pending", verb: "dev" });
    expect(deps.review.setPending).toHaveBeenCalledWith(expect.objectContaining({ verb: null }));
  });

  it("warns when a parked brief went unanswered", () => {
    const { deps, send } = fakes();
    send({ type: "task_review", status: "timed_out" });
    expect(deps.pushLog.mock.calls[0][0]).toBe("warn");
  });
});

describe("completion", () => {
  // The finished run may have written its handoff file.
  it("re-reads the roster and closes any step left running", () => {
    const { deps, send } = fakes();
    send({ type: "claude_completion", task: "built it", run_id: "r1" });
    expect(deps.workstreams.refreshVerbs).toHaveBeenCalled();
    expect(deps.work.finishRun).toHaveBeenCalledWith("r1");
  });

  it("does not try to close steps when no run id came back", () => {
    const { deps, send } = fakes();
    send({ type: "claude_completion", task: "built it" });
    expect(deps.work.finishRun).not.toHaveBeenCalled();
  });
});

describe("routing discipline", () => {
  it("sends each event to exactly one domain", () => {
    const { deps, send } = fakes();
    send({ type: "claude_task_update", run_id: "r1" });
    expect(deps.work.apply).toHaveBeenCalledTimes(1);
    expect(deps.session.setRunning).not.toHaveBeenCalled();
    expect(deps.review.setPending).not.toHaveBeenCalled();
  });

  it("ignores an event type it does not know", () => {
    const { deps, send } = fakes();
    expect(() => send({ type: "something_new" })).not.toThrow();
    for (const fn of [deps.pushLog, deps.work.apply, deps.session.setRunning]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
