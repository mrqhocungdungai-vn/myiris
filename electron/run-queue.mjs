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
 * @property {string} [verb]
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
 * @property {(() => void)|null} [cancel] - set by the transport; ends it early
 * @property {Object} [result]
 * @property {{ cost_usd: number|null, num_turns: number|null, usage: any, model_usage: any }|null} [usage] - what the run cost, off its result message
 * @property {Array<{ question: string, recommendation?: string, options?: Array<{ label: string, description?: string }> }>} [decisions] - decisions the run deferred, from its structured output
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
  // A run that reached its turn or spend ceiling (run-budget.mjs). Deliberately
  // its own terminal status rather than FAILED: a run that hit a limit and a run
  // that broke need different responses from the user, and collapsing the two
  // hides which happened. Everything that treats a run as over reads
  // TERMINAL_STATUSES, so this participates automatically.
  LIMITED: "limited",
  // A run that asked the user a question its work depended on and got no
  // answer (ask-when-unspecified D3). Its own terminal status for the same
  // reason LIMITED is: it did not break, and the user did not stop it — it
  // stopped at a fork it was right not to guess at, and wrote nothing further.
  // Reporting that as FAILED sends the user looking for a bug; reporting it as
  // CANCELLED claims they abandoned it; reporting it as COMPLETED is the worst
  // of the three. Everything that treats a run as over reads TERMINAL_STATUSES,
  // so this participates automatically.
  UNANSWERED: "unanswered",
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
  RUN_STATUS.LIMITED,
  RUN_STATUS.UNANSWERED,
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
    // What the run cost, once its result message has landed (null until then).
    // Carried on the same projection as everything else rather than a second
    // event type, so the deck and the voice layer read it the same way they read
    // status — see the run-execution-queue spec.
    usage: run.usage ?? null,
    ...extra,
  };
}

/**
 * @param {Object} deps
 * @param {(run: Run) => void} deps.startRun - launches the transport (DEV subprocess or PO turn); must not touch the slot itself
 * @param {(run: Run) => void} [deps.cancelRun] - ends an active run's transport (aborting a DEV query, cancelling a PO turn); must not touch the slot itself — the slot is released when the run is later finalized through the normal settle path. Optional: if omitted, stop() on an active run remains a no-op.
 * @param {(event: Object) => void} deps.emit - the sidecar event sink
 * @param {(run: Run) => void} [deps.onFinalized] - fires once per run, after a terminal claude_task_update (e.g. the voice completion announcement); NOT called for a queued run cancelled before it ever started
 * @param {number} [deps.idleTimeoutMs] - overrides runIdleTimeoutMs() for testing; production callers should omit this and let it read IRIS_RUN_IDLE_TIMEOUT_MS
 */
export function createRunQueue({
  startRun,
  cancelRun,
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

  // Ends the run's transport, then finalizes. Both transports are now Agent SDK
  // queries with no subprocess handle of their own, so cancelling is uniform and
  // the old SIGTERM→SIGKILL escalation is gone.
  //
  // The two callers want different finalize timing, which is why `graceMs` is a
  // parameter rather than a constant:
  //   - stop() (D5) waits out STOP_GRACE_MS first, giving the transport a chance
  //     to unwind and report its own terminal status; the timer is only the
  //     backstop for a transport that never settles.
  //   - the idle watchdog (D4) finalizes immediately — it has already declared
  //     the run dead, and the spec says a silent run loses the slot at expiry,
  //     not five seconds later.
  //
  // The once-guard inside finalize() (not a check here) is what makes both safe
  // when the transport's own settle path also reaches finalize() — whichever
  // gets there first wins, and the loser is a no-op.
  function cancelAndFinalize(run, terminalStatus, output, graceMs) {
    cancelRun?.(run);
    if (!graceMs) {
      finalize(run.run_id, terminalStatus, output);
      return;
    }
    const graceTimer = setTimeout(() => {
      finalize(run.run_id, terminalStatus, output);
    }, graceMs);
    graceTimer.unref?.();
  }

  function onIdleExpiry() {
    idleTimer = null;
    if (!active) return;
    const run = runs.get(active);
    if (!run) return;
    const minutes = Math.round(idleTimeoutMs / 60000);
    cancelAndFinalize(
      run,
      RUN_STATUS.ERROR,
      `No progress for ${minutes} minutes (IRIS_RUN_IDLE_TIMEOUT_MS) — the run was terminated automatically and the slot released.`,
      0,
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
    // Drop the transport handle so a finalized run holds nothing live.
    run.cancel = null;
    emit(toUpdateEvent(run, status, { output }));
    onFinalized?.(run);
    // Slot side-effects belong to the run that holds the slot. Guarding them
    // means a finalize targeting any other run can never disarm the active
    // run's watchdog or steal its slot (double-start). No caller finalizes a
    // non-slot run today; this makes the invariant structural, not conventional.
    if (active === runId) {
      clearIdleTimer();
      idleSuspended = false;
      dequeueNext();
    }
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
    // Marked CANCELLED before the transport is touched, because that is what
    // the transport's own settle path reads to tell a cancellation apart from a
    // failure. Deliberately NOT finalize() here — the slot is released when the
    // transport settles and finalizes itself; forceFinalize only steps in if
    // that hasn't happened within the grace period (design D5). Finalizing
    // unconditionally here would risk a double-start.
    run.status = RUN_STATUS.CANCELLED;
    cancelAndFinalize(run, RUN_STATUS.CANCELLED, "Run was stopped before completion.", STOP_GRACE_MS);
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
    // Named only to keep them out of `rest` — omit-by-destructuring, not dead bindings.
    const { cancel: _cancel, result: _result, ...rest } = run;
    return rest;
  }

  // Not part of the design's core interface, but the runs map is otherwise
  // fully private to this closure and app shutdown (electron/main.mjs
  // before-quit) needs to reach every live run to end its transport.
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
  // awaiting a human (design D3) — a resident turn paused on AskUserQuestion,
  // or a one-shot run that was permitted to ask and did. Deliberately reads
  // only `active` and never the run's SHAPE: a paused headless run is the
  // active run, so it is suspended on identical terms, and this pair needed no
  // change when ask-when-unspecified made that case reachable. Must be paired
  // with resume(); see the interface docs on PendingQuestion in run-stream.mjs
  // for why that pairing is safe.
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
