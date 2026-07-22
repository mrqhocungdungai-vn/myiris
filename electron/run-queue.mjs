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

// The binding constraint is a sub-agent `Task` call: from the parent stream
// it appears as one `tool_use` -> total silence -> one `tool_result`, and it
// sits on DEV's standard path (the persona invokes the `code-review` skill,
// which runs two parallel sub-agents). Measured sub-agent durations on a
// mid-size codebase: 263s / 365s / 380s. 30 minutes is ~4.7x the longest
// observed and 3x the Bash tool's own 600s self-timeout. Erring long is
// cheap — the failure this bounds is currently unbounded — and the rollback
// is this env var, not a code change. See design.md D6.
export const DEFAULT_RUN_IDLE_TIMEOUT_MS = 1_800_000; // 30 minutes

// Read the same way every other IRIS_* budget is read (see po-session.mjs's
// poQuestionTimeoutMs). A very large value is not special-cased — it is
// passed straight through to setTimeout, which is what makes "set it high
// enough to never fire" a valid rollback (keep it under ~24.8 days, Node's
// setTimeout ceiling).
export function runIdleTimeoutMs(env = process.env) {
  const raw = Number(env.IRIS_RUN_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_IDLE_TIMEOUT_MS;
}

// Grace period between SIGTERM and SIGKILL — seconds, not minutes (design
// D5/D6). Shared by the idle watchdog's expiry path and stop()'s escalation.
const STOP_GRACE_MS = 5000;

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
 * @param {(run: Run) => void} [deps.cancelRun] - ends an active run whose transport has no child process (a PO turn); must not touch the slot itself — the slot is released when the run is later finalized through the normal settle path, exactly like the DEV kill-signal branch. Optional: if omitted, stop() on such a run remains a no-op.
 * @param {(child: import("node:child_process").ChildProcess, signal: string) => void} [deps.killChild] - signals a run's subprocess transport; defaults to `(child, signal) => child.kill(signal)`. Injected (parallel to cancelRun) so process-group/platform knowledge (e.g. a negative-pid group kill, or Windows taskkill) lives in the caller, not here.
 * @param {(event: Object) => void} deps.emit - the sidecar event sink
 * @param {(run: Run) => void} [deps.onFinalized] - fires once per run, after a terminal claude_task_update (e.g. the voice completion announcement); NOT called for a queued run cancelled before it ever started
 * @param {number} [deps.idleTimeoutMs] - overrides runIdleTimeoutMs() for testing; production callers should omit this and let it read IRIS_RUN_IDLE_TIMEOUT_MS
 */
export function createRunQueue({
  startRun,
  cancelRun,
  killChild = (child, signal) => child.kill(signal),
  emit,
  onFinalized,
  idleTimeoutMs = runIdleTimeoutMs(),
}) {
  const runs = new Map();
  const queue = [];
  let active = null;
  // Single timer owned by the slot, not a Map keyed by run id — see design
  // D2. A per-run timer would arm even for a run cancelled while still
  // queued (it never reaches beginRun), later firing finalize() against
  // whatever run holds the slot by then and breaking the single-slot
  // invariant. A queued run is simply never timed.
  let idleTimer = null;
  let idleSuspended = false;

  function armIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (idleSuspended) return;
    idleTimer = setTimeout(onIdleExpiry, idleTimeoutMs);
    // Don't hold the Node event loop open on account of a watchdog timer —
    // see design.md Risks.
    idleTimer.unref?.();
  }

  function clearIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Kills the run's transport (if it has one) and always finalizes — used by
  // both the idle watchdog's expiry (D4) and stop()'s escalation (D5). The
  // once-guard inside finalize() (not a check here) is what makes this safe
  // if the transport's own termination callback also reaches finalize() —
  // whichever gets there first wins, and the loser is a no-op.
  function killWithEscalation(run, terminalStatus, output) {
    if (!run.child) {
      finalize(run.run_id, terminalStatus, output);
      return;
    }
    killChild(run.child, "SIGTERM");
    const graceTimer = setTimeout(() => {
      if (run.child) killChild(run.child, "SIGKILL");
      finalize(run.run_id, terminalStatus, output);
    }, STOP_GRACE_MS);
    graceTimer.unref?.();
  }

  function onIdleExpiry() {
    idleTimer = null;
    if (!active) return;
    const run = runs.get(active);
    if (!run) return;
    const minutes = Math.round(idleTimeoutMs / 60000);
    killWithEscalation(
      run,
      RUN_STATUS.ERROR,
      `No progress for ${minutes} minutes (IRIS_RUN_IDLE_TIMEOUT_MS) — the run was terminated automatically and the slot released.`,
    );
  }

  function beginRun(run) {
    // Slot acquisition lives here and nowhere else — see design D2. A run
    // that finalizes synchronously inside startRun (missing agent, PO
    // billing failure) is safe because finalize() is already re-entrant via
    // the finalize-once guard below.
    active = run.run_id;
    idleSuspended = false;
    armIdleTimer();
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
    // beginRun calls startRun synchronously, and a start-time gate (missing
    // agent, DEV with no open change, a transport that fails to launch) can
    // finalize the run before this line runs — a function that invokes an
    // injected callback must re-read state before reporting on it, so the
    // real status is read back rather than assumed.
    if (run.finalized) {
      return { status: run.status, output: run.output, run_id: run.run_id };
    }
    return { status: "started", run_id: run.run_id };
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
    // Clear on every path — a run finalized by its transport must leave no
    // stale timer behind to fire later against whichever run holds the slot
    // by then (design D2/D5).
    clearIdleTimer();
    idleSuspended = false;
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
      run.finalized = true;
      emit(toUpdateEvent(run, RUN_STATUS.CANCELLED, {}));
      // Deliberately NOT finalize(): dequeueNext() would clobber the active
      // run's slot, since a queued run never held it. Marked finalized
      // directly instead, so the once-guard protects it — nothing to
      // announce (never started), no slot to release (never held it).
      return run.status;
    }
    if (run.child) {
      run.status = RUN_STATUS.CANCELLED;
      // Normally the slot is released by finalize(), invoked by the
      // transport's own termination callback once the process actually
      // closes. killWithEscalation only forces things (SIGKILL + finalize
      // itself) if that callback hasn't fired within the grace period — see
      // design D5. Doing it unconditionally here would risk a double-start.
      killWithEscalation(run, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return run.status;
    }
    // Active run with no child (a PO turn has no subprocess to signal):
    // delegate the actual turn-ending to the injected cancelRun, mirroring
    // the DEV branch above. Deliberately NOT finalize() here — the slot is
    // released when the turn settles and the transport's own settle path
    // finalizes it, exactly as the DEV branch relies on child.on("close").
    run.status = RUN_STATUS.CANCELLED;
    cancelRun?.(run);
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

  // Resets the idle bound for the active run's progress signal (design D1).
  // A no-op if no run is active, so a stray/late signal can't arm a timer
  // that outlives its run.
  function heartbeat() {
    if (!active) return;
    armIdleTimer();
  }

  // Suspends the idle bound while the active run is legitimately blocked
  // awaiting a human (design D3) — e.g. a PO turn paused on
  // AskUserQuestion. Must be paired with resume(); see the interface docs
  // on PendingQuestion in main.mjs for why that pairing is safe.
  function suspend() {
    idleSuspended = true;
    clearIdleTimer();
  }

  function resume() {
    idleSuspended = false;
    if (active) armIdleTimer();
  }

  return { submit, finalize, stop, status, get, serialize, list, heartbeat, suspend, resume };
}
