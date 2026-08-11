// Asserts the invariants openspec/specs/run-execution-queue/spec.md already
// states, driven purely through createRunQueue's public interface with
// injected fakes — no refactor needed, see design.md D1/D2 of
// add-test-harness-and-po-seam.
import { describe, it, expect, vi } from "vitest";
import { createRunQueue, RUN_STATUS, runIdleTimeoutMs, DEFAULT_RUN_IDLE_TIMEOUT_MS } from "./run-queue.mjs";

let nextId = 0;
/**
 * @param {Partial<import("./run-queue.mjs").Run>} [overrides]
 * @returns {import("./run-queue.mjs").Run}
 */
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
    cancel: null,
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

// The injected cancelRun hook — records which runs it was asked to end, without
// ever settling them, simulating a transport that ignores the cancel. That is
// what makes the grace-period force-finalize observable.
function makeCancelRunFake() {
  const calls = [];
  return { cancelRun: (run) => calls.push(run.run_id), calls };
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

  it("marks a run cancelled while queued as finalized without calling finalize() (BUG K, reconcile-queued-cancel)", () => {
    // run-execution-queue/spec.md now describes this directly: stopping a
    // queued run reaches `cancelled`, is marked finalized, and emits exactly
    // one update — but does NOT go through finalize()/dequeueNext(), since
    // dequeueNext() would clobber the active run's slot. The once-guard flag
    // is set at the stop() site itself, decided here rather than deferred.
    const { queue, finalized } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.stop(queuedRun.run_id);

    expect(queue.status(queuedRun.run_id)).toBe(RUN_STATUS.CANCELLED);
    expect(queue.get(queuedRun.run_id).finalized).toBe(true);
    expect(finalized).not.toContain(queuedRun.run_id);
  });

  it("does not disturb the active run when a queued run is cancelled", () => {
    const { queue, invoked } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.stop(queuedRun.run_id);

    // The slot is still held by the active run — a further submit queues
    // rather than starting immediately.
    const another = makeRun();
    const outcome = queue.submit(another);

    expect(outcome).toEqual({ status: "queued", position: 1 });
    expect(invoked).toEqual([active.run_id]);
  });

  it("treats finalize() on an already queued-cancelled run as a no-op", () => {
    const { queue, events, finalized, invoked } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.stop(queuedRun.run_id);
    const eventsAfterStop = [...events];
    const invokedAfterStop = [...invoked];

    queue.finalize(queuedRun.run_id, RUN_STATUS.CANCELLED, "late finalize");

    expect(events).toEqual(eventsAfterStop);
    expect(finalized).not.toContain(queuedRun.run_id);
    // No queue advance triggered either — the active run's slot is untouched.
    expect(invoked).toEqual(invokedAfterStop);
  });

  it("returns the run's terminal status when startRun finalizes it synchronously, and releases the slot (BUG E, report-synchronous-start-failure design D1)", () => {
    // startRun (the injected transport) can finalize the run before beginRun
    // returns — e.g. an unknown verb, or a persona the bundle cannot load.
    // submit() must report that real status, not the "started" it would
    // otherwise assume.
    const events = [];
    const finalized = [];
    const invoked = [];
    let queue;
    const startRun = (run) => {
      invoked.push(run.run_id);
      // Only the first run hits the synchronous-rejection gate — the second
      // submit (after the slot is released) takes the healthy path.
      if (invoked.length === 1) {
        queue.finalize(run.run_id, RUN_STATUS.FAILED, "the stateless persona could not be loaded");
      }
    };
    queue = createRunQueue({
      startRun,
      emit: (event) => events.push(event),
      // Mirrors main.mjs's real onFinalized, which wraps the voice
      // completion announcement in exactly this started_at gate (Wave 0.3 /
      // settle-and-attribute-po-turn design D3) — run-queue.mjs's own
      // finalize() always calls onFinalized unconditionally, so the gate
      // that prevents double-speak lives in the callback, not here.
      onFinalized: (run) => {
        if (run.started_at) finalized.push(run.run_id);
      },
    });
    const run = makeRun();

    const outcome = queue.submit(run);

    expect(outcome).toEqual({ status: RUN_STATUS.FAILED, output: "the stateless persona could not be loaded", run_id: run.run_id });
    expect(queue.get(run.run_id).finalized).toBe(true);
    // Guard for the double-speak the plan warned about: a run finalized
    // during start never stamped started_at, so the gated onFinalized never
    // pushes it — the rejection reaches the caller exactly once, through
    // submit()'s return value.
    expect(finalized).not.toContain(run.run_id);

    // The slot was released — the next submit starts immediately rather than
    // being stuck behind a run that already finished.
    const next = makeRun();
    const nextOutcome = queue.submit(next);
    expect(nextOutcome.status).toBe("started");
  });

  it("still returns started when startRun leaves the run running instead of finalizing it (healthy path unchanged)", () => {
    const { queue, invoked } = makeQueue();
    const run = makeRun();

    const outcome = queue.submit(run);

    expect(outcome).toEqual({ status: "started", run_id: run.run_id });
    expect(invoked).toEqual([run.run_id]);
    expect(queue.get(run.run_id).finalized).not.toBe(true);
  });

  it("still returns queued (with position) when submitted while another run is active, regardless of how that run will finalize", () => {
    const { queue } = makeQueue();
    const active = makeRun();
    const queuedRun = makeRun();
    queue.submit(active);

    const outcome = queue.submit(queuedRun);

    expect(outcome).toEqual({ status: "queued", position: 1 });
  });

  it("stops an active run with no child (a stateful turn) by calling the injected cancelRun, marking it cancelled without releasing the slot itself (make-po-turns-cancellable design D1)", () => {
    const cancelCalls = [];
    const { queue, invoked } = makeQueue({ cancelRun: (run) => cancelCalls.push(run.run_id) });
    const active = makeRun({ status: RUN_STATUS.RUNNING });
    queue.submit(active);

    const status = queue.stop(active.run_id);

    expect(status).toBe(RUN_STATUS.CANCELLED);
    expect(queue.status(active.run_id)).toBe(RUN_STATUS.CANCELLED);
    expect(cancelCalls).toEqual([active.run_id]);
    // Not finalized yet — stop() itself never releases the slot for a
    // no-child run, exactly as it doesn't for the subprocess
    // (killWithEscalation) branch until the transport actually terminates.
    expect(queue.get(active.run_id).finalized).not.toBe(true);

    // A further submit still queues — the slot is still held.
    const queuedRun = makeRun();
    const outcome = queue.submit(queuedRun);
    expect(outcome).toEqual({ status: "queued", position: 1 });
    expect(invoked).toEqual([active.run_id]);
  });

  it("releases the slot and starts the next queued run, exactly once, once the (fake) transport finalizes the cancelled stateful run (make-po-turns-cancellable design D1)", () => {
    const { queue, invoked, finalized } = makeQueue({ cancelRun: () => {} });
    const active = makeRun({ status: RUN_STATUS.RUNNING });
    const queuedRun = makeRun();
    queue.submit(active);
    queue.submit(queuedRun);

    queue.stop(active.run_id);
    expect(invoked).toEqual([active.run_id]); // not started yet — slot still held

    // Simulates startPoRun's settle handler finalizing the run once the
    // turn's teardown-driven promise rejects — the same finalize() call path
    // a real cancelStatefulTurn round-trip ends in.
    queue.finalize(active.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");

    expect(queue.get(active.run_id).status).toBe(RUN_STATUS.CANCELLED);
    expect(finalized).toEqual([active.run_id]);
    expect(invoked).toEqual([active.run_id, queuedRun.run_id]); // started exactly once

    // A stray second finalize (e.g. a late settle) must not double-start.
    queue.finalize(active.run_id, RUN_STATUS.CANCELLED, "late");
    expect(invoked).toEqual([active.run_id, queuedRun.run_id]);
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

  it("cancels the transport and force-finalizes exactly once when the transport ignores the cancel (spec: 'A signalled process ignores the signal', bound-shutdown-teardown design D1/D5)", () => {
    vi.useFakeTimers();
    try {
      const { cancelRun, calls } = makeCancelRunFake();
      const { queue, events, finalized } = makeQueue({ cancelRun });
      const run = makeRun({ status: RUN_STATUS.RUNNING });
      queue.submit(run);

      queue.stop(run.run_id);
      expect(calls).toEqual([run.run_id]);
      expect(queue.get(run.run_id).finalized).not.toBe(true); // grace period still pending

      vi.advanceTimersByTime(5001); // past the grace period
      expect(finalized).toEqual([run.run_id]);
      const terminalEvents = events.filter((e) => e.run_id === run.run_id && e.status === RUN_STATUS.CANCELLED);
      expect(terminalEvents.length).toBe(1);

      // A stale grace timer (or a duplicate call) firing again later must stay
      // a no-op — finalize-once still holds.
      vi.advanceTimersByTime(60000);
      expect(finalized).toEqual([run.run_id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a transport that settles on its own finalize first, leaving the grace timer a no-op", () => {
    // The normal path: cancelRun reaches the transport, which unwinds and
    // finalizes itself well inside the grace window. The forced finalize must
    // not then overwrite the status the transport reported.
    vi.useFakeTimers();
    try {
      const finalizedStatuses = [];
      const { queue, events } = makeQueue({
        cancelRun: (run) => queue.finalize(run.run_id, RUN_STATUS.CANCELLED, "settled by transport"),
        onFinalized: (run) => finalizedStatuses.push([run.status, run.output]),
      });
      const run = makeRun({ status: RUN_STATUS.RUNNING });
      queue.submit(run);

      queue.stop(run.run_id);
      expect(finalizedStatuses).toEqual([[RUN_STATUS.CANCELLED, "settled by transport"]]);

      vi.advanceTimersByTime(60000);
      expect(finalizedStatuses).toEqual([[RUN_STATUS.CANCELLED, "settled by transport"]]);
      expect(events.filter((e) => e.status === RUN_STATUS.CANCELLED).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still force-finalizes a stopped run when no cancelRun hook is injected", () => {
    // cancelRun is optional; without it stop() has no transport to end, but the
    // run must not be left holding the single slot forever.
    vi.useFakeTimers();
    try {
      const { queue, finalized } = makeQueue(); // no cancelRun override
      const run = makeRun({ status: RUN_STATUS.RUNNING });
      queue.submit(run);

      queue.stop(run.run_id);
      expect(finalized).toEqual([]);

      vi.advanceTimersByTime(5001);
      expect(finalized).toEqual([run.run_id]);
      expect(queue.get(run.run_id).status).toBe(RUN_STATUS.CANCELLED);
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

  it("finalizing a run that does not hold the slot leaves the active run's slot and idle timer untouched (design D1, harden-slot-release-and-event-subscription)", () => {
    vi.useFakeTimers();
    try {
      const idleTimeoutMs = 1000;
      const { queue, events, invoked } = makeQueue({ idleTimeoutMs });
      const active = makeRun();
      const queuedRun = makeRun();
      queue.submit(active);
      queue.submit(queuedRun);

      // Advance partway through the active run's idle bound, then target the
      // still-queued (never-slot-holding, unfinalized) run with finalize()
      // directly — bypassing stop(), which is how a stray/misrouted finalize
      // would look.
      vi.advanceTimersByTime(idleTimeoutMs - 1);
      queue.finalize(queuedRun.run_id, RUN_STATUS.CANCELLED, "targeted while queued");

      // The targeted run reaches its terminal status and emits exactly once.
      expect(queue.get(queuedRun.run_id).finalized).toBe(true);
      expect(
        events.filter((e) => e.run_id === queuedRun.run_id && e.status === RUN_STATUS.CANCELLED).length,
      ).toBe(1);

      // The active run's slot is untouched — a further submit still queues
      // rather than starting immediately, and nothing new was started.
      // (queuedRun is still sitting in the FIFO position array — finalize()
      // brings a run to terminal but only dequeueNext()'s skip-loop removes
      // cancelled entries from it — so `another` lands at position 2.)
      const another = makeRun();
      expect(queue.submit(another)).toEqual({ status: "queued", position: 2 });
      expect(invoked).toEqual([active.run_id]);

      // The active run's idle timer was NOT cleared by the stray finalize —
      // advancing past the remainder of its bound still expires it normally.
      vi.advanceTimersByTime(2);
      expect(queue.get(active.run_id).finalized).toBe(true);
      expect(queue.get(active.run_id).status).toBe(RUN_STATUS.ERROR);
    } finally {
      vi.useRealTimers();
    }
  });
});

// the-canvas-becomes-a-conversation D2: the slot stops two JOBS running at
// once. The next turn of an already-open conversation is not a job.
describe("run-queue: the resident lane", () => {
  it("starts a resident turn while a long job holds the slot", () => {
    // The behaviour the whole lane exists for: a five-second "make that box
    // blue" must not wait behind a twenty-minute execute.
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, emit: vi.fn() });
    const job = makeRun({ run_id: "long-job" });
    queue.submit(job);

    const turn = queue.submitResident(makeRun({ run_id: "canvas-turn" }));

    expect(turn.status).toBe("started");
    expect(invoked).toEqual(["long-job", "canvas-turn"]);
  });

  it("does not release the slot when a resident turn finishes", () => {
    // A run that never held the slot must not hand it to the next queued job.
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, emit: vi.fn() });
    queue.submit(makeRun({ run_id: "long-job" }));
    queue.submit(makeRun({ run_id: "waiting-job" }));
    queue.submitResident(makeRun({ run_id: "canvas-turn" }));

    queue.finalize("canvas-turn", RUN_STATUS.COMPLETED, "done");

    expect(invoked).toEqual(["long-job", "canvas-turn"]);
    expect(queue.status("waiting-job")).toBe(RUN_STATUS.QUEUED);
  });

  it("serializes two turns of the SAME conversation", () => {
    // deliverStatefulTurn overwrites the in-flight turn's handle, so two turns of one
    // conversation must never be in flight together.
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, emit: vi.fn() });
    queue.submitResident(makeRun({ run_id: "turn-1", workstream_id: "ws-A" }));

    const second = queue.submitResident(makeRun({ run_id: "turn-2", workstream_id: "ws-A" }));

    expect(second).toEqual({ status: "queued", position: 1 });
    expect(invoked).toEqual(["turn-1"]);

    queue.finalize("turn-1", RUN_STATUS.COMPLETED, "done");
    expect(invoked).toEqual(["turn-1", "turn-2"]);
  });

  it("does not serialize turns of DIFFERENT conversations against each other", () => {
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, emit: vi.fn() });

    queue.submitResident(makeRun({ run_id: "turn-A", workstream_id: "ws-A" }));
    queue.submitResident(makeRun({ run_id: "turn-B", workstream_id: "ws-B" }));

    expect(invoked).toEqual(["turn-A", "turn-B"]);
  });

  it("watches a resident turn for silence, and says the conversation survives", () => {
    // The gap this closes: the slot's watchdog is keyed to the active run, so
    // a resident turn would otherwise run with no watchdog at all — trading
    // "your turn waits too long" for "your turn wedges forever unnoticed".
    vi.useFakeTimers();
    try {
      const cancelRun = vi.fn();
      const queue = createRunQueue({ startRun: () => {}, cancelRun, emit: vi.fn(), idleTimeoutMs: 60_000 });
      queue.submitResident(makeRun({ run_id: "wedged-turn" }));

      vi.advanceTimersByTime(60_001);

      expect(cancelRun).toHaveBeenCalled();
      expect(queue.status("wedged-turn")).toBe(RUN_STATUS.ERROR);
      expect(queue.get("wedged-turn").output).toMatch(/conversation is still open/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a resident turn's own progress reset only its own watchdog", () => {
    vi.useFakeTimers();
    try {
      const queue = createRunQueue({ startRun: () => {}, cancelRun: vi.fn(), emit: vi.fn(), idleTimeoutMs: 60_000 });
      queue.submitResident(makeRun({ run_id: "chatty-turn" }));

      vi.advanceTimersByTime(40_000);
      queue.heartbeat("chatty-turn");
      vi.advanceTimersByTime(40_000);

      expect(queue.status("chatty-turn")).toBe(RUN_STATUS.QUEUED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a resident turn's progress keep an unrelated job alive", () => {
    // The coupling the separate lane exists to remove: a chatty conversation
    // must not be able to hold a silent, wedged job open forever.
    vi.useFakeTimers();
    try {
      const queue = createRunQueue({ startRun: () => {}, cancelRun: vi.fn(), emit: vi.fn(), idleTimeoutMs: 60_000 });
      queue.submit(makeRun({ run_id: "silent-job" }));
      queue.submitResident(makeRun({ run_id: "chatty-turn", workstream_id: "ws-B" }));

      vi.advanceTimersByTime(40_000);
      queue.heartbeat("chatty-turn");
      vi.advanceTimersByTime(40_000);

      expect(queue.status("silent-job")).toBe(RUN_STATUS.ERROR);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a resident turn queued behind its own conversation", () => {
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, emit: vi.fn() });
    queue.submitResident(makeRun({ run_id: "turn-1", workstream_id: "ws-A" }));
    queue.submitResident(makeRun({ run_id: "turn-2", workstream_id: "ws-A" }));

    expect(queue.stop("turn-2")).toBe(RUN_STATUS.CANCELLED);
    queue.finalize("turn-1", RUN_STATUS.COMPLETED, "done");

    // Cancelled while waiting: it must not start afterwards.
    expect(invoked).toEqual(["turn-1"]);
  });
});

describe("run-queue: barge-in", () => {
  it("interrupts the resident turn that is talking", () => {
    const cancelRun = vi.fn();
    const queue = createRunQueue({ startRun: () => {}, cancelRun, emit: vi.fn() });
    queue.submitResident(makeRun({ run_id: "talking-turn" }));

    expect(queue.interruptResidentTurns()).toEqual(["talking-turn"]);
    expect(cancelRun).toHaveBeenCalled();
    expect(queue.status("talking-turn")).toBe(RUN_STATUS.CANCELLED);
  });

  it("leaves an unrelated job alone", () => {
    // Barge-in says something about the conversation the user is in. A job
    // holding the slot has nothing to do with them starting a new sentence,
    // and stopping it would be a destructive reading of an ordinary act.
    const queue = createRunQueue({ startRun: () => {}, cancelRun: vi.fn(), emit: vi.fn() });
    queue.submit(makeRun({ run_id: "long-job" }));

    expect(queue.interruptResidentTurns()).toEqual([]);
    expect(queue.status("long-job")).not.toBe(RUN_STATUS.CANCELLED);
  });

  it("is a no-op when nobody is talking", () => {
    const queue = createRunQueue({ startRun: () => {}, cancelRun: vi.fn(), emit: vi.fn() });
    expect(queue.interruptResidentTurns()).toEqual([]);
  });
});

// Found by the barge-in tests: a started run still reads QUEUED until its
// transport flips it, and startRun reaches an await before that happens. Stop
// called inside that window used to take the "waiting" branch — marking the
// run cancelled without ending its transport and without releasing what it
// held, stranding the slot or the conversation lane for good.
describe("run-queue: stopping a run that has started but not yet reported RUNNING", () => {
  it("ends the transport of a resident turn in that window", () => {
    const cancelRun = vi.fn();
    const queue = createRunQueue({ startRun: () => {}, cancelRun, emit: vi.fn() });
    queue.submitResident(makeRun({ run_id: "just-started", status: RUN_STATUS.QUEUED }));

    queue.stop("just-started");

    expect(cancelRun).toHaveBeenCalled();
  });

  it("frees the conversation lane afterwards", () => {
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, cancelRun: vi.fn(), emit: vi.fn() });
    queue.submitResident(makeRun({ run_id: "turn-1", workstream_id: "ws-A" }));
    queue.submitResident(makeRun({ run_id: "turn-2", workstream_id: "ws-A" }));

    queue.stop("turn-1");
    queue.finalize("turn-1", RUN_STATUS.CANCELLED, "stopped");

    expect(invoked).toEqual(["turn-1", "turn-2"]);
  });

  it("ends the transport of a slot run in that window too", () => {
    const cancelRun = vi.fn();
    const queue = createRunQueue({ startRun: () => {}, cancelRun, emit: vi.fn() });
    queue.submit(makeRun({ run_id: "slot-run", status: RUN_STATUS.QUEUED }));

    queue.stop("slot-run");

    expect(cancelRun).toHaveBeenCalled();
  });

  it("still treats a genuinely waiting run as waiting", () => {
    // The distinction has to keep working in the ordinary case, or cancelling
    // a queued job would start it.
    const { startRun, invoked } = makeStartRunFake();
    const queue = createRunQueue({ startRun, cancelRun: vi.fn(), emit: vi.fn() });
    queue.submit(makeRun({ run_id: "running-job" }));
    queue.submit(makeRun({ run_id: "waiting-job" }));

    expect(queue.stop("waiting-job")).toBe(RUN_STATUS.CANCELLED);
    queue.finalize("running-job", RUN_STATUS.COMPLETED, "done");

    expect(invoked).toEqual(["running-job"]);
  });
});
