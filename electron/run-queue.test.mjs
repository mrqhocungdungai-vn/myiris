// Asserts the invariants openspec/specs/run-execution-queue/spec.md already
// states, driven purely through createRunQueue's public interface with
// injected fakes — no refactor needed, see design.md D1/D2 of
// add-test-harness-and-po-seam.
import { describe, it, expect, beforeEach } from "vitest";
import { createRunQueue, RUN_STATUS } from "./run-queue.mjs";

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

function makeQueue() {
  const events = [];
  const finalized = [];
  const { startRun, invoked } = makeStartRunFake();
  const queue = createRunQueue({
    startRun,
    emit: (event) => events.push(event),
    onFinalized: (run) => finalized.push(run.run_id),
  });
  return { queue, events, finalized, invoked };
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
});
