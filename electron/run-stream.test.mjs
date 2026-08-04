import { describe, it, expect, vi } from "vitest";
import { createRunStream } from "./run-stream.mjs";

function makeRunQueue(overrides = {}) {
  return {
    suspend: vi.fn(),
    resume: vi.fn(),
    heartbeat: vi.fn(),
    ...overrides,
  };
}

function makeWorkstream(overrides = {}) {
  return {
    id: "ws1",
    agent_sessions: {},
    last_verb_used: null,
    last_used_at: 0,
    last_task: "",
    ...overrides,
  };
}

function make(overrides = {}) {
  const workstream = makeWorkstream();
  return createRunStream({
    runQueue: makeRunQueue(),
    emitEvent: vi.fn(),
    notifyIris: vi.fn(),
    findWorkstream: () => workstream,
    sessionKeyFor: (verb) => (verb === "shape_on_canvas" ? "stateful" : verb),
    persistSessionStore: vi.fn(),
    emitSessions: vi.fn(),
    ...overrides,
  });
}

describe("run-stream: PO question settle-once invariant", () => {
  it("settles exactly once even if answered and expired race", () => {
    vi.useFakeTimers();
    try {
      const runQueue = makeRunQueue();
      const stream = make({ runQueue });
      const questions = [{ question: "Which color?", options: [{ label: "Red", description: "r" }] }];
      const promise = stream.askUserQuestionViaVoice("ws1", questions);

      const first = stream.resolvePendingPoQuestion([{ question: "Which color?", choice: "Red" }]);
      expect(first.status).toBe("ok");

      // A second answer call after settlement is a no-op error, not a second resolve.
      const second = stream.resolvePendingPoQuestion([{ question: "Which color?", choice: "Blue" }]);
      expect(second.status).toBe("error");

      return promise.then((resolved) => {
        expect(resolved.answers["Which color?"]).toBe("Red");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the recommended (first) option on timeout", async () => {
    vi.useFakeTimers();
    try {
      const runQueue = makeRunQueue();
      const stream = make({ runQueue });
      const questions = [{ question: "Which color?", options: [{ label: "Red", description: "r" }, { label: "Blue", description: "b" }] }];
      const promise = stream.askUserQuestionViaVoice("ws1", questions);
      vi.advanceTimersByTime(400000);
      const resolved = await promise;
      expect(resolved.behavior).toBe("allow");
      expect(resolved.answers["Which color?"]).toBe("Red");
    } finally {
      vi.useRealTimers();
    }
  });

  it("suspends the run queue while a question is pending and resumes on settle", () => {
    const runQueue = makeRunQueue();
    const stream = make({ runQueue });
    stream.askUserQuestionViaVoice("ws1", [{ question: "Q", options: [{ label: "A", description: "a" }] }]);
    expect(runQueue.suspend).toHaveBeenCalledTimes(1);
    stream.resolvePendingPoQuestion([{ question: "Q", choice: "A" }]);
    expect(runQueue.resume).toHaveBeenCalledTimes(1);
  });

  it("resolvePendingPoQuestion is a no-op error when nothing is pending", () => {
    const stream = make();
    const result = stream.resolvePendingPoQuestion([{ question: "Q", choice: "A" }]);
    expect(result.status).toBe("error");
  });
});

describe("run-stream: activity and tool-step projection", () => {
  it("pushActivity trims long lines and heartbeats the run queue", () => {
    const runQueue = makeRunQueue();
    const stream = make({ runQueue });
    const run = { activity: [] };
    stream.pushActivity(run, "a".repeat(300));
    expect(run.activity[0].length).toBeLessThanOrEqual(221);
    expect(runQueue.heartbeat).toHaveBeenCalled();
  });

  it("pushActivity drops empty/whitespace-only lines", () => {
    const stream = make();
    const run = { activity: [] };
    stream.pushActivity(run, "   ");
    expect(run.activity).toHaveLength(0);
  });

  it("pushToolStart/pushToolEnd emit tool_start/tool_end phases and heartbeat", () => {
    const emitEvent = vi.fn();
    const runQueue = makeRunQueue();
    const stream = make({ emitEvent, runQueue });
    const run = { run_id: "r1" };
    stream.pushToolStart(run, "tool-1", "bash", "ls");
    stream.pushToolEnd(run, "tool-1", false);
    const phases = emitEvent.mock.calls.map(([event]) => event.phase);
    expect(phases).toEqual(["tool_start", "tool_end"]);
    expect(runQueue.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("handleClaudeStreamMessage records the Claude session id on a session_id message", () => {
    const persistSessionStore = vi.fn();
    const emitSessions = vi.fn();
    const workstream = makeWorkstream();
    const stream = make({
      findWorkstream: () => workstream,
      persistSessionStore,
      emitSessions,
    });
    const run = { workstream_id: "ws1", verb: "execute", task: "do thing" };
    stream.handleClaudeStreamMessage(run, { type: "system", subtype: "init", session_id: "sess-123" });
    expect(workstream.agent_sessions.execute).toBe("sess-123");
    expect(workstream.last_verb_used).toBe("execute");
    expect(persistSessionStore).toHaveBeenCalled();
    expect(emitSessions).toHaveBeenCalled();
  });

  it("handleClaudeStreamMessage silently ignores a non-message value", () => {
    // The SDK iterator yields only objects, but the projection is on the hot
    // path for every run — it must never be the thing that throws.
    const stream = make();
    const run = { activity: [] };
    expect(() => stream.handleClaudeStreamMessage(run, null)).not.toThrow();
    expect(() => stream.handleClaudeStreamMessage(run, "not a message")).not.toThrow();
  });
});

// F12: a question reached the user with its shape flattened — `header` and
// `multiSelect` were dropped, and the answers map could only ever carry one
// label per question, including on the timeout path.
describe("AskUserQuestion survives the relay with its shape intact", () => {
  const multi = {
    question: "Which checks should run?",
    header: "Checks",
    multiSelect: true,
    options: [
      { label: "lint", description: "oxlint" },
      { label: "tests", description: "vitest" },
      { label: "typecheck", description: "tsc" },
    ],
  };
  const single = {
    question: "Which package manager?",
    header: "Tooling",
    options: [
      { label: "npm", description: "the default" },
      { label: "pnpm", description: "faster" },
    ],
  };

  it("reads the header and the multi-select affordance aloud", () => {
    const notifyIris = vi.fn();
    const stream = make({ notifyIris });
    stream.askUserQuestionViaVoice("ws1", [multi, single]);

    const [text] = notifyIris.mock.calls[0];
    expect(text).toContain("[Checks]");
    expect(text).toContain("[Tooling]");
    expect(text).toContain("multi_select");
    expect(text).toContain("Never narrow it to one");
  });

  it("carries every chosen option back, comma-separated as the tool expects", async () => {
    const stream = make();
    /** @type {any} */
    let delivered;
    const pending = stream.askUserQuestionViaVoice("ws1", [multi]).then((value) => {
      delivered = value;
    });
    stream.resolvePendingPoQuestion([{ question: multi.question, choice: ["lint", "typecheck"] }]);
    await pending;

    expect(delivered.answers[multi.question]).toBe("lint, typecheck");
  });

  it("accepts a single label unchanged", async () => {
    const stream = make();
    /** @type {any} */
    let delivered;
    const pending = stream.askUserQuestionViaVoice("ws1", [single]).then((value) => {
      delivered = value;
    });
    stream.resolvePendingPoQuestion([{ question: single.question, choice: "pnpm" }]);
    await pending;

    expect(delivered.answers[single.question]).toBe("pnpm");
  });

  it("applies the recommended default on timeout, in the question's own shape", async () => {
    const stream = make();
    /** @type {any} */
    let delivered;
    const pending = stream.askUserQuestionViaVoice("ws1", [multi, single]).then((value) => {
      delivered = value;
    });
    stream.PendingQuestion.expire();
    await pending;

    expect(delivered.answers[multi.question]).toBe("lint");
    expect(delivered.answers[single.question]).toBe("npm");
  });
});
