// Asserts the invariants openspec/specs/run-execution-queue/spec.md already
// states, driven purely through createRunQueue's public interface with
// injected fakes — no refactor needed, see design.md D1/D2 of
// add-test-harness-and-po-seam.
import { describe, it, expect, vi } from "vitest";
import { createRunQueue, RUN_STATUS, runIdleTimeoutMs, DEFAULT_RUN_IDLE_TIMEOUT_MS } from "./run-queue.mjs";

let nextId = 0;
function makeRun(overrides = {}) {
  nextId += 1;
  return {
    run_id: overrides.run_id ?? `run-${nextId}`,
    workstream_id: "ws-1",
    session_label: "Workstream 1",
    task: "do the thing",
    urgency: "normal",
    agent: "dev",
    status: RUN_STATUS.QUEUED,
    output: "",
    activity: [],
    queued_at: Date.now() / 1000,
    child: null,
    ...overrides,
  };
}

// Records invocation order distinctly from completion order, so a test
// asserting "at most one active run" can't pass against a queue that never
// actually started anything (design.md Risks).
function makeStartRunFake() {
  const invoked = [];
  return {
    startRun: (run) => invoked.push(run.run_id),
    invoked,
  };
}

function makeQueue(overrides = {}) {
  const events = [];
  const finalized = [];
  const { startRun, invoked } = makeStartRunFake();
  const queue = createRunQueue({
    startRun,
    emit: (event) => events.push(event),
    onFinalized: (run) => finalized.push(run.run_id),
    ...overrides,
  });
  return { queue, events, finalized, invoked };
}

// A run.child fake that records what it was signalled, without ever actually
// "closing" — simulating a subprocess that ignores SIGTERM, so the escalation
// path (SIGKILL) is what a test can observe.
function makeChildFake() {
  const killCalls = [];
  return { child: { kill: (signal) => killCalls.push(signal) }, killCalls };
}

describe("run-queue", () => {
  it("starts a run immediately when the slot is free", () => {
    const { queue, invoked } = makeQueue();
    const run = makeRun();

    const outcome = queue.submit(run);

    expect(outcome.status).toBe("started");
    expect(invoked).toEqual([run.run_id]);
    expect(queue.status(run.run_id)).toBe(RUN_STATUS.QUEUED); // startRun is a fake — it never flips status itself
  });

  it("queues a run FIFO when the slot is held, without starting it", () => {
    const { queue, invoked } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();

    queue.submit(active);
    const outcome = queue.submit(queuedRun);

    expect(outcome).toEqual({ status: "queued", position: 1 });
    expect(invoked).toEqual([active.run_id]);
    expect(queue.status(queuedRun.run_id)).toBe(RUN_STATUS.QUEUED);
  });

  it("finalizes a run exactly once", () => {
    const { queue, events, finalized, invoked } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.finalize(active.run_id, RUN_STATUS.COMPLETED, "done");
    const terminalEmitsAfterFirst = events.filter(
      (e) => e.run_id === active.run_id && e.status === RUN_STATUS.COMPLETED,
    ).length;
    const invokedAfterFirst = [...invoked];
    const finalizedAfterFirst = [...finalized];

    // Second finalize of the same (already-terminal) run must be a no-op.
    queue.finalize(active.run_id, RUN_STATUS.COMPLETED, "done again");

    expect(terminalEmitsAfterFirst).toBe(1);
    expect(
      events.filter((e) => e.run_id === active.run_id && e.status === RUN_STATUS.COMPLETED).length,
    ).toBe(1);
    expect(finalized).toEqual(finalizedAfterFirst);
    // The slot was released exactly once: the queued run started exactly once,
    // not started again by the redundant finalize call.
    expect(invoked).toEqual(invokedAfterFirst);
  });

  it("skips a queue entry cancelled while waiting and starts the next eligible run", () => {
    const { queue, invoked } = makeQueue();
    const active = makeRun();
    const cancelledWhileQueued = makeRun();
    const nextEligible = makeRun();
    queue.submit(active);
    queue.submit(cancelledWhileQueued);
    queue.submit(nextEligible);

    queue.stop(cancelledWhileQueued.run_id);
    expect(queue.status(cancelledWhileQueued.run_id)).toBe(RUN_STATUS.CANCELLED);

    queue.finalize(active.run_id, RUN_STATUS.COMPLETED, "done");

    expect(invoked).toEqual([active.run_id, nextEligible.run_id]);
  });

  it("releases the slot exactly once per run, so a later submit starts immediately", () => {
    const { queue, invoked } = makeQueue();
    const first = makeRun();
    queue.submit(first);
    queue.finalize(first.run_id, RUN_STATUS.COMPLETED, "done");

    const second = makeRun();
    const outcome = queue.submit(second);

    expect(outcome.status).toBe("started");
    expect(invoked).toEqual([first.run_id, second.run_id]);
  });

  it("does not finalize a run cancelled while queued (BUG K — spec vs. code disagree, see docs/BUGFIX_PLAN.md)", () => {
    // run-execution-queue/spec.md says stopping a queued run finalizes it as
    // "cancelled" immediately; run-queue.mjs:142-151 deliberately does not
    // call finalize() for this case ("no announcement to make"). This test
    // asserts the CODE's behavior, per design.md D6 — the reconciliation is
    // deferred to BUG K's own change, not decided here.
    const { queue, finalized } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.stop(queuedRun.run_id);

    expect(queue.status(queuedRun.run_id)).toBe(RUN_STATUS.CANCELLED);
    expect(queue.get(queuedRun.run_id).finalized).not.toBe(true);
    expect(finalized).not.toContain(queuedRun.run_id);
  });

  it("gates onFinalized on run.started_at (settle-and-attribute-po-turn design D3)", () => {
    // electron/main.mjs's real onFinalized wraps announceClaudeCompletion in
    // exactly this predicate — a run finalized before it ever stamped
    // started_at (e.g. rejected at a gate before dispatch, like a missing
    // agent) has no result worth announcing, same as today's queued-cancel.
    // finalize() itself still fires for these — only the announcement is gated.
    const { startRun } = makeStartRunFake();
    const gated = [];
    const queue = createRunQueue({
      startRun,
      emit: () => {},
      onFinalized: (run) => {
        if (run.started_at) gated.push(run.run_id);
      },
    });

    const neverStarted = makeRun();
    queue.submit(neverStarted);
    queue.finalize(neverStarted.run_id, RUN_STATUS.FAILED, "missing agent");
    expect(gated).not.toContain(neverStarted.run_id);

    const started = makeRun();
    queue.submit(started);
    started.started_at = Date.now() / 1000;
    queue.finalize(started.run_id, RUN_STATUS.COMPLETED, "done");
    expect(gated).toEqual([started.run_id]);
  });
});

describe("runIdleTimeoutMs", () => {
  it("defaults to 30 minutes when unset or unparseable", () => {
    expect(runIdleTimeoutMs({})).toBe(DEFAULT_RUN_IDLE_TIMEOUT_MS);
    expect(runIdleTimeoutMs({ IRIS_RUN_IDLE_TIMEOUT_MS: "not-a-number" })).toBe(DEFAULT_RUN_IDLE_TIMEOUT_MS);
  });

  it("honors an explicit override, including a very large value used as the documented rollback", () => {
    expect(runIdleTimeoutMs({ IRIS_RUN_IDLE_TIMEOUT_MS: "5000" })).toBe(5000);
    // Not special-cased — passed straight through, which is what makes "set
    // it high enough to never fire" work without a code change (design
    // Migration Plan).
    expect(runIdleTimeoutMs({ IRIS_RUN_IDLE_TIMEOUT_MS: "2147483647" })).toBe(2147483647);
  });
});

// openspec/changes/add-run-idle-watchdog/specs/run-execution-queue/spec.md.
// Fake timers throughout — the bound is exercised at millisecond scale, not
// real 30-minute waits.
describe("run-queue idle watchdog", () => {
  it("never terminates a healthy run producing progress faster than the bound (spec: 'A healthy long run is not terminated')", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, finalized } = makeQueue({ idleTimeoutMs });
      const run = makeRun();
      queue.submit(run);

      // Ten heartbeats, each just under the bound: total elapsed time is far
      // beyond the bound, but the run is never silent for longer than it.
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(idleTimeoutMs - 1);
        queue.heartbeat();
      }

      expect(queue.get(run.run_id).finalized).not.toBe(true);
      expect(finalized).not.toContain(run.run_id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalizes a silent run once the bound elapses and releases the slot (spec: 'A silent run loses the slot')", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, events, finalized, invoked } = makeQueue({ idleTimeoutMs });
      const active = makeRun();
      const queuedRun = makeRun();
      queue.submit(active);
      queue.submit(queuedRun);

      vi.advanceTimersByTime(idleTimeoutMs + 1);

      const terminalEvents = events.filter((e) => e.run_id === active.run_id && e.status === RUN_STATUS.ERROR);
      expect(terminalEvents.length).toBe(1);
      expect(finalized).toEqual([active.run_id]);
      expect(invoked).toEqual([active.run_id, queuedRun.run_id]); // the next queued run started
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time a run sitting in the queue (spec: 'A queued run is not timed')", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, invoked } = makeQueue({ idleTimeoutMs });
      const active = makeRun();
      const queuedRun = makeRun();
      queue.submit(active);
      queue.submit(queuedRun);

      // Keep the active run healthy so only the queued run's fate is under
      // test — the queued run sits well past the bound the whole time.
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(idleTimeoutMs - 1);
        queue.heartbeat();
      }
      expect(queue.get(queuedRun.run_id).finalized).not.toBe(true);
      expect(invoked).toEqual([active.run_id]);

      queue.finalize(active.run_id, RUN_STATUS.COMPLETED, "done");

      expect(invoked).toEqual([active.run_id, queuedRun.run_id]); // starts normally once the slot frees
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer armed after normal termination (spec: 'The bound is disarmed by normal termination')", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, finalized } = makeQueue({ idleTimeoutMs });
      const run = makeRun();
      queue.submit(run);

      queue.finalize(run.run_id, RUN_STATUS.COMPLETED, "done");
      vi.advanceTimersByTime(idleTimeoutMs * 10);

      expect(finalized).toEqual([run.run_id]); // exactly once — no stale timer fired afterwards
      expect(queue.get(run.run_id).status).toBe(RUN_STATUS.COMPLETED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not terminate a suspended run even far past the bound (spec: 'Turn paused on a question outlives the idle bound')", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, finalized } = makeQueue({ idleTimeoutMs });
      const run = makeRun();
      queue.submit(run);

      queue.suspend();
      vi.advanceTimersByTime(idleTimeoutMs * 100);

      expect(queue.get(run.run_id).finalized).not.toBe(true);
      expect(finalized).not.toContain(run.run_id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes the bound after resume(), and finalizes a run that stays silent afterward (spec: 'Suspension ends however the question settles' / 'A run that stays silent after being unblocked still loses the slot')", () => {
    // run-queue.mjs exposes one generic suspend()/resume() pair; main.mjs's
    // PendingQuestion.settle() (the single funnel every settlement path goes
    // through — answered, expired, abandoned) is what guarantees resume() is
    // reached no matter how the question settles. That funnel property isn't
    // re-testable from this file without a main.mjs harness, so this test
    // covers what the queue itself owns: the bound genuinely restarts from
    // resume() and still terminates a run that goes silent afterward.
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, finalized } = makeQueue({ idleTimeoutMs });
      const run = makeRun();
      queue.submit(run);

      queue.suspend();
      vi.advanceTimersByTime(idleTimeoutMs * 100); // would have expired long ago if still armed
      queue.resume();

      expect(queue.get(run.run_id).finalized).not.toBe(true); // the bound restarts fresh from resume()
      vi.advanceTimersByTime(idleTimeoutMs + 1);

      expect(finalized).toEqual([run.run_id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to SIGKILL and finalizes exactly once when a signalled process ignores SIGTERM (spec: 'A signalled process ignores the signal')", () => {
    vi.useFakeTimers();
    try {
      const { queue, events, finalized } = makeQueue();
      const { child, killCalls } = makeChildFake();
      const run = makeRun({ child, status: RUN_STATUS.RUNNING });
      queue.submit(run);

      queue.stop(run.run_id);
      expect(killCalls).toEqual(["SIGTERM"]);
      expect(queue.get(run.run_id).finalized).not.toBe(true); // grace period still pending

      vi.advanceTimersByTime(5001); // past the SIGTERM->SIGKILL grace period
      expect(killCalls).toEqual(["SIGTERM", "SIGKILL"]);
      expect(finalized).toEqual([run.run_id]);
      const terminalEvents = events.filter((e) => e.run_id === run.run_id && e.status === RUN_STATUS.CANCELLED);
      expect(terminalEvents.length).toBe(1);

      // A stale escalation timer (or a duplicate call) firing again later
      // must stay a no-op — finalize-once still holds.
      vi.advanceTimersByTime(60000);
      expect(finalized).toEqual([run.run_id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the single-slot invariant across an expiry racing a transport callback for the same run", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, invoked } = makeQueue({ idleTimeoutMs });
      const active = makeRun();
      const queuedRun = makeRun();
      queue.submit(active);
      queue.submit(queuedRun);

      vi.advanceTimersByTime(idleTimeoutMs + 1); // watchdog finalizes `active` first
      // A transport callback for the SAME run arriving after the watchdog
      // already released the slot must be a no-op, not a second start.
      queue.finalize(active.run_id, RUN_STATUS.COMPLETED, "raced result");

      expect(invoked).toEqual([active.run_id, queuedRun.run_id]); // queuedRun started exactly once
      expect(queue.get(active.run_id).status).toBe(RUN_STATUS.ERROR); // the watchdog's finalize won the race
    } finally {
      vi.useRealTimers();
    }
  });
});
