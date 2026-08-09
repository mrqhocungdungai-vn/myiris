import { describe, it, expect, vi } from "vitest";
import { createRunStream, QUESTION_EXPIRY } from "./run-stream.mjs";

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

// ask-when-unspecified D3: one policy with a declared parameter, supplied by the
// asking caller rather than inferred here — inference from the verb or the run is
// exactly how the two behaviors would drift apart.
describe("run-stream: the caller-supplied expiry policy", () => {
  const questions = [
    { question: "Which database?", options: [{ label: "Postgres", description: "p" }, { label: "SQLite", description: "s" }] },
  ];

  // The regression guard for the divergence: the resident path is untouched, and
  // its callers pass nothing at all.
  it("still applies the recommended option when the caller declares no policy", async () => {
    const stream = make();
    const pending = stream.askUserQuestionViaVoice("ws1", questions);
    stream.PendingQuestion.expire();
    const settled = await pending;

    expect(settled.behavior).toBe("allow");
    expect(settled.answers["Which database?"]).toBe("Postgres");
  });

  it("applies it just the same when the caller declares RECOMMENDED_OPTION outright", async () => {
    const stream = make();
    const pending = stream.askUserQuestionViaVoice("ws1", questions, {
      onExpiry: QUESTION_EXPIRY.RECOMMENDED_OPTION,
    });
    stream.PendingQuestion.expire();
    const settled = await pending;

    expect(settled.behavior).toBe("allow");
    expect(settled.answers["Which database?"]).toBe("Postgres");
  });

  it("supplies no answer at all under DENY, and names the question it could not get answered", async () => {
    const stream = make();
    const pending = stream.askUserQuestionViaVoice("ws1", questions, { onExpiry: QUESTION_EXPIRY.DENY });
    stream.PendingQuestion.expire();
    const settled = await pending;

    expect(settled.behavior).toBe("deny");
    expect(settled.reason).toBe("unanswered");
    // No fabricated recommendation travels back under any key.
    expect(settled).not.toHaveProperty("answers");
    expect(settled.message).toContain("Which database?");
    expect(settled.message).toMatch(/no option was chosen on the user's behalf/i);
  });

  // voice-decision-relay, "The unanswered outcome is never presented as a
  // decision": both expiry policies settle as status "timed_out", so status
  // alone cannot tell a consumer which branch ran — and the renderer was
  // announcing the ALLOW wording for both. `outcome` is what carries the
  // distinction; these two cases are what stop it being dropped again.
  it("names the branch that ran on the settlement event, not just the status", async () => {
    for (const [onExpiry, outcome] of [
      [QUESTION_EXPIRY.RECOMMENDED_OPTION, "defaulted"],
      [QUESTION_EXPIRY.DENY, "unanswered"],
    ]) {
      const emitEvent = vi.fn();
      const stream = make({ emitEvent });
      const pending = stream.askUserQuestionViaVoice("ws1", questions, { onExpiry });
      stream.PendingQuestion.expire();
      await pending;

      const settlement = emitEvent.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "po_question" && event.status !== "pending");
      expect(settlement).toHaveLength(1);
      expect(settlement[0].status).toBe("timed_out");
      expect(settlement[0].outcome).toBe(outcome);
    }
  });

  it("reports an answered question as answered, not as a timeout branch", async () => {
    const emitEvent = vi.fn();
    const stream = make({ emitEvent });
    const pending = stream.askUserQuestionViaVoice("ws1", questions, {
      onExpiry: QUESTION_EXPIRY.DENY,
    });
    stream.PendingQuestion.answer({ "Which database?": "Postgres" });
    await pending;

    const settlement = emitEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "po_question" && event.status !== "pending");
    expect(settlement.status).toBe("answered");
    expect(settlement.outcome).toBe("answered");
  });

  // 4.6: both branches funnel through the single settle(), so neither can miss
  // runQueue.resume() — and the idle bound is suspended for a headless run on
  // exactly the same terms as for a resident turn.
  it("suspends and resumes the idle bound under either policy", async () => {
    for (const onExpiry of [QUESTION_EXPIRY.RECOMMENDED_OPTION, QUESTION_EXPIRY.DENY]) {
      const runQueue = makeRunQueue();
      const stream = make({ runQueue });
      const pending = stream.askUserQuestionViaVoice("ws1", questions, { onExpiry });
      expect(runQueue.suspend).toHaveBeenCalledTimes(1);
      expect(runQueue.resume).not.toHaveBeenCalled();

      stream.PendingQuestion.expire();
      await pending;
      expect(runQueue.resume).toHaveBeenCalledTimes(1);
    }
  });

  // An answered question is answered the same way regardless of policy: the
  // policy governs only what an ABSENT answer settles as.
  it("is answered identically under either policy when an answer actually arrives", async () => {
    for (const onExpiry of [QUESTION_EXPIRY.RECOMMENDED_OPTION, QUESTION_EXPIRY.DENY]) {
      const stream = make();
      const pending = stream.askUserQuestionViaVoice("ws1", questions, { onExpiry });
      stream.resolvePendingPoQuestion([{ question: "Which database?", choice: "SQLite" }]);
      const settled = await pending;

      expect(settled.behavior).toBe("allow");
      expect(settled.answers["Which database?"]).toBe("SQLite");
    }
  });

  // 5.4: Iris must not tell the user a defaulted answer was applied when the run
  // in fact stopped, so the relay's own instruction states which one applies.
  it("tells the voice layer which unanswered outcome this question has", async () => {
    const notifyIris = vi.fn();
    const deny = make({ notifyIris });
    deny.askUserQuestionViaVoice("ws1", questions, { onExpiry: QUESTION_EXPIRY.DENY });
    const [denyText] = notifyIris.mock.calls[0];
    expect(denyText).toMatch(/the run STOPS and writes nothing further/);
    expect(denyText).toMatch(/never that a recommended option was used/i);

    const notifyIris2 = vi.fn();
    const dflt = make({ notifyIris: notifyIris2 });
    dflt.askUserQuestionViaVoice("ws1", questions);
    const [defaultText] = notifyIris2.mock.calls[0];
    expect(defaultText).toMatch(/first-listed option is applied as the recommended default/);
    expect(defaultText).not.toMatch(/the run STOPS/);
  });

  // A session reset settles a denial too, but for a different reason — and the
  // asking run has to be able to tell them apart.
  it("distinguishes an abandoned question from an unanswered one", async () => {
    const stream = make();
    const pending = stream.askUserQuestionViaVoice("ws1", questions, { onExpiry: QUESTION_EXPIRY.DENY });
    stream.PendingQuestion.abandon("ws1");
    const settled = await pending;

    expect(settled.behavior).toBe("deny");
    expect(settled.reason).toBe("abandoned");
    expect(settled.message).toContain("session was reset");
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
