// Owns the "Claude does one thing at a time" execution slot: the runs map,
// the FIFO queue, the finalize-once guard, the skip-cancelled dequeue loop,
// and the single claude_task_update projection. No Electron, Gemini, or
// transport knowledge — like electron/claude-stream.mjs, this module is
// headless and testable on its own once a test runner exists. The caller
// (electron/main.mjs) injects the transport (startRun), the sidecar sink
// (emit), and the voice-announcement hook (onFinalized) — see
// openspec/changes/deepen-run-executor/design.md D1.

/**
 * @typedef {Object} Run
 * @property {string} run_id
 * @property {string} workstream_id
 * @property {string} session_label
 * @property {string} task
 * @property {string} urgency
 * @property {string|null} agent
 * @property {string|null} [model] - resolved at run start, not submit time
 * @property {string} status - one of RUN_STATUS
 * @property {string} output
 * @property {string[]} activity
 * @property {number} queued_at
 * @property {number} [started_at]
 * @property {number} [finished_at]
 * @property {string} [cwd]
 * @property {string|null} [claude_session_id]
 * @property {import("node:child_process").ChildProcess|null} child
 * @property {Object} [result]
 * @property {boolean} [finalized]
 */

// Stored on the run record.
export const RUN_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  ERROR: "error",
  CANCELLED: "cancelled",
});

// Superset of RUN_STATUS: adds the event-stream-only lifecycle markers that
// never land on a run record (a run is never "stored" as starting/started).
export const EMIT_STATUS = Object.freeze({
  ...RUN_STATUS,
  STARTING: "starting",
  STARTED: "started",
});

export const TERMINAL_STATUSES = Object.freeze([
  RUN_STATUS.COMPLETED,
  RUN_STATUS.FAILED,
  RUN_STATUS.ERROR,
  RUN_STATUS.CANCELLED,
]);

// The single claude_task_update projection: every emission carries the same
// core fields drawn from the run record, plus status-specific extras
// (`position` for queued, `urgency` for starting/started, `output` for
// running/terminal). See design.md D3 for the one deliberate payload delta
// this introduces versus the six literals it replaces (superset fields with
// `null`s where a call site used to omit the key entirely).
export function toUpdateEvent(run, status, extra = {}) {
  return {
    type: "claude_task_update",
    status,
    run_id: run.run_id,
    task: run.task,
    agent: run.agent ?? null,
    model: run.model ?? null,
    claude_session_id: run.claude_session_id ?? null,
    ...extra,
  };
}

/**
 * @param {Object} deps
 * @param {(run: Run) => void} deps.startRun - launches the transport (DEV subprocess or PO turn); must not touch the slot itself
 * @param {(event: Object) => void} deps.emit - the sidecar event sink
 * @param {(run: Run) => void} [deps.onFinalized] - fires once per run, after a terminal claude_task_update (e.g. the voice completion announcement); NOT called for a queued run cancelled before it ever started
 */
export function createRunQueue({ startRun, emit, onFinalized }) {
  const runs = new Map();
  const queue = [];
  let active = null;

  function beginRun(run) {
    // Slot acquisition lives here and nowhere else — see design D2. A run
    // that finalizes synchronously inside startRun (missing agent, PO
    // billing failure) is safe because finalize() is already re-entrant via
    // the finalize-once guard below.
    active = run.run_id;
    startRun(run);
  }

  function dequeueNext() {
    active = null;
    while (queue.length > 0) {
      const nextId = queue.shift();
      const next = runs.get(nextId);
      if (next && next.status === RUN_STATUS.QUEUED) {
        beginRun(next);
        return;
      }
    }
  }

  function submit(run) {
    runs.set(run.run_id, run);
    if (active) {
      queue.push(run.run_id);
      emit(toUpdateEvent(run, RUN_STATUS.QUEUED, { position: queue.length }));
      return { status: "queued", position: queue.length };
    }
    emit(toUpdateEvent(run, EMIT_STATUS.STARTING, {}));
    beginRun(run);
    return { status: "started" };
  }

  function finalize(runId, status, output) {
    if (!TERMINAL_STATUSES.includes(status)) {
      throw new Error(`run-queue: finalize() called with non-terminal status "${status}"`);
    }
    const run = runs.get(runId);
    // Some transports report termination twice (e.g. a spawn failure firing
    // both "error" and "close") — finalize exactly once. Spec: "A run
    // finalizes exactly once."
    if (!run || run.finalized) return;
    run.finalized = true;
    run.status = status;
    run.output = output;
    run.finished_at = Date.now() / 1000;
    run.child = null;
    emit(toUpdateEvent(run, status, { output }));
    onFinalized?.(run);
    dequeueNext();
  }

  function stop(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    if (run.status === RUN_STATUS.QUEUED) {
      const index = queue.indexOf(runId);
      if (index !== -1) queue.splice(index, 1);
      run.status = RUN_STATUS.CANCELLED;
      run.finished_at = Date.now() / 1000;
      emit(toUpdateEvent(run, RUN_STATUS.CANCELLED, {}));
      // Deliberately NOT finalize(): a queued run never started, so there is
      // no announcement to make. Preserves today's silent queued-cancel —
      // see design.md Risks.
      return run.status;
    }
    if (run.child) {
      run.status = RUN_STATUS.CANCELLED;
      run.child.kill("SIGTERM");
      // The slot is released only by finalize(), invoked by the transport's
      // own termination callback once the process actually closes — see
      // design D5. Doing it here would risk a double-start.
      return run.status;
    }
    // Active run with no child (a PO turn has no subprocess to signal): the
    // existing no-op stands — the turn runs to completion.
    return run.status;
  }

  function status(runId) {
    return runs.get(runId)?.status ?? null;
  }

  function get(runId) {
    return runs.get(runId) ?? null;
  }

  function serialize(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    const { child, result, ...rest } = run;
    return rest;
  }

  // Not part of the design's core interface, but the runs map is otherwise
  // fully private to this closure and app shutdown (electron/main.mjs
  // before-quit) needs to reach every live child process to signal it.
  function list() {
    return [...runs.values()];
  }

  return { submit, finalize, stop, status, get, serialize, list };
}
