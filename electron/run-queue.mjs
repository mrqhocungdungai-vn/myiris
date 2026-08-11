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
// sits on the stateless path's standard route (the persona invokes the `code-review` skill,
// which runs two parallel sub-agents). Measured sub-agent durations on a
// mid-size codebase: 263s / 365s / 380s. 30 minutes is ~4.7x the longest
// observed and 3x the Bash tool's own 600s self-timeout. Erring long is
// cheap — the failure this bounds is currently unbounded — and the rollback
// is this env var, not a code change. See design.md D6.
export const DEFAULT_RUN_IDLE_TIMEOUT_MS = 1_800_000; // 30 minutes

// Read the same way every other IRIS_* budget is read (see run-stream.mjs's
// claudeQuestionTimeoutMs). A very large value is not special-cased — it is
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
 * @param {(run: Run) => void} deps.startRun - launches the transport (a stateless run or a stateful turn); must not touch the slot itself
 * @param {(run: Run) => void} [deps.cancelRun] - ends an active run's transport (aborting a stateless query, cancelling a stateful turn); must not touch the slot itself — the slot is released when the run is later finalized through the normal settle path. Optional: if omitted, stop() on an active run remains a no-op.
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

  // The resident lane (the-canvas-becomes-a-conversation D2). A turn pushed
  // into a conversation that is ALREADY open is not the start of a job: it
  // shares a context window with the previous turn and cannot begin a second
  // worker. The slot exists to stop two jobs running at once, so making a
  // five-second "make that box blue" wait behind a twenty-minute `execute`
  // buys nothing and costs the conversation — in a brainstorm, an answer that
  // arrives after the thought has passed is not slow, it is wrong.
  //
  // Serialized PER CONVERSATION rather than globally: `deliverStatefulTurn`
  // overwrites the in-flight turn's handle unconditionally, so two turns of
  // one conversation must never be in flight together.
  //
  // These timers ARE per run, which the slot's watchdog deliberately is not
  // (see `idleTimer` above). The hazard that ruled a per-run timer out there
  // was a QUEUED run arming a timer it might never start under; a resident
  // turn either starts immediately or waits without a timer, so it cannot
  // reach that state. Without a timer of its own a resident turn would run
  // with no watchdog at all, since the slot's is keyed to `active` — trading
  // "your turn waits too long" for "your turn wedges forever unnoticed".
  const residentTimers = new Map(); // run_id -> timer
  const residentActive = new Map(); // workstream_id -> run_id
  const residentQueues = new Map(); // workstream_id -> run_id[]
  let residentSuspended = false;

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

  function armResidentTimer(runId) {
    clearResidentTimer(runId);
    if (residentSuspended) return;
    const timer = setTimeout(() => onResidentExpiry(runId), idleTimeoutMs);
    timer.unref?.();
    residentTimers.set(runId, timer);
  }

  function clearResidentTimer(runId) {
    const timer = residentTimers.get(runId);
    if (timer) clearTimeout(timer);
    residentTimers.delete(runId);
  }

  function onResidentExpiry(runId) {
    residentTimers.delete(runId);
    const run = runs.get(runId);
    if (!run || run.finalized) return;
    const minutes = Math.round(idleTimeoutMs / 60000);
    cancelAndFinalize(
      run,
      RUN_STATUS.ERROR,
      `No progress for ${minutes} minutes (IRIS_RUN_IDLE_TIMEOUT_MS) — the turn was terminated automatically. The conversation is still open.`,
      0,
    );
  }

  // A resident turn ending releases its conversation, never the slot — it
  // never held one. The next turn of the SAME conversation starts here.
  function releaseResident(run) {
    const workstreamId = run.workstream_id;
    clearResidentTimer(run.run_id);
    if (residentActive.get(workstreamId) !== run.run_id) return;
    residentActive.delete(workstreamId);
    const waiting = residentQueues.get(workstreamId);
    while (waiting && waiting.length > 0) {
      const next = runs.get(waiting.shift());
      if (next && next.status === RUN_STATUS.QUEUED) {
        beginResident(next);
        return;
      }
    }
  }

  function beginResident(run) {
    residentActive.set(run.workstream_id, run.run_id);
    armResidentTimer(run.run_id);
    startRun(run);
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
    // that finalizes synchronously inside startRun (missing agent, a resident session
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
    // agent, a transport that fails to launch) can
    // finalize the run before this line runs — a function that invokes an
    // injected callback must re-read state before reporting on it, so the
    // real status is read back rather than assumed.
    if (run.finalized) {
      return { status: run.status, output: run.output, run_id: run.run_id };
    }
    return { status: "started", run_id: run.run_id };
  }

  /**
   * Submit a turn into a conversation that is already open. It does not take
   * the execution slot and does not wait for it; it waits only for the
   * previous turn OF ITS OWN CONVERSATION.
   *
   * Safe against the slot by construction rather than by convention:
   * `finalize` already guards every slot side-effect behind
   * `active === runId`, so a run that never holds the slot cannot disarm the
   * active run's watchdog or steal its place in the queue.
   */
  function submitResident(run) {
    runs.set(run.run_id, run);
    if (residentActive.has(run.workstream_id)) {
      const waiting = residentQueues.get(run.workstream_id) ?? [];
      waiting.push(run.run_id);
      residentQueues.set(run.workstream_id, waiting);
      run.status = RUN_STATUS.QUEUED;
      emit(toUpdateEvent(run, RUN_STATUS.QUEUED, { position: waiting.length }));
      return { status: "queued", position: waiting.length };
    }
    emit(toUpdateEvent(run, EMIT_STATUS.STARTING, {}));
    beginResident(run);
    // Same reason as submit()'s: startRun is synchronous and a start-time gate
    // can finalize the run before this line, so the status is read back rather
    // than assumed.
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
    // The resident lane's equivalent, on the same terms: scoped to the run's
    // own conversation, so finalizing one conversation's turn can never start
    // another's.
    releaseResident(run);
  }

  function stop(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    // "Waiting" is decided by lane membership, not by status alone. A run that
    // has been started still reads QUEUED until its transport says otherwise,
    // and `startRun` reaches an `await` before it does — so there is a real
    // window where a started run looks queued. Taking the waiting branch for
    // one of those would mark it cancelled without ending its transport and
    // without releasing what it holds, stranding the slot or the conversation
    // lane permanently. Barge-in lands inside exactly that window.
    const holdsSomething = active === runId || residentActive.get(run.workstream_id) === runId;
    if (run.status === RUN_STATUS.QUEUED && !holdsSomething) {
      const index = queue.indexOf(runId);
      if (index !== -1) queue.splice(index, 1);
      // A turn waiting behind its own conversation is queued in the resident
      // lane instead, and has to be lifted out of there or it would start
      // after being cancelled.
      const waiting = residentQueues.get(run.workstream_id);
      const residentIndex = waiting ? waiting.indexOf(runId) : -1;
      if (residentIndex !== -1) waiting.splice(residentIndex, 1);
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
  function heartbeat(runId = null) {
    // A resident turn's progress resets its OWN watchdog, not the slot's: the
    // two runs are unrelated, and letting a chatty conversation keep an
    // unrelated long job alive forever is exactly the coupling the separate
    // lane exists to remove.
    if (runId && residentTimers.has(runId)) {
      armResidentTimer(runId);
      return;
    }
    if (runId && residentActive.get(runs.get(runId)?.workstream_id) === runId) return;
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
    // Applies to the resident lane too. There is one pending question in the
    // app at a time, and whichever lane's turn is waiting on it is blocked on
    // a human for exactly the reason the watchdog must not count — the same
    // rule, not a second policy.
    residentSuspended = true;
    // Deleting the entry currently being visited is well-defined for a Map,
    // so this iterates the live keys rather than a copy of them.
    for (const runId of residentTimers.keys()) clearResidentTimer(runId);
  }

  function resume() {
    idleSuspended = false;
    if (active) armIdleTimer();
    residentSuspended = false;
    for (const runId of residentActive.values()) armResidentTimer(runId);
  }

  /**
   * The user spoke over Iris. End whichever turn is currently talking, and
   * leave the conversation open.
   *
   * Scoped to the resident lane on purpose. Barge-in is a signal about the
   * conversation the user is having, not a general stop button: an unrelated
   * job holding the slot has nothing to do with them interrupting, and
   * cancelling it because they started a new sentence would be a destructive
   * reading of an ordinary act.
   *
   * Routed through `stop`, so the turn ends the way every other cancellation
   * does — `cancelRun` for a resident turn interrupts it rather than aborting
   * it, which is what keeps the context window and everything already drawn.
   *
   * @returns {string[]} the run ids that were interrupted
   */
  function interruptResidentTurns() {
    const interrupted = [];
    for (const runId of residentActive.values()) {
      const run = runs.get(runId);
      if (!run || run.finalized) continue;
      interrupted.push(runId);
    }
    for (const runId of interrupted) stop(runId);
    return interrupted;
  }

  return {
    submit,
    submitResident,
    finalize,
    stop,
    interruptResidentTurns,
    status,
    get,
    serialize,
    list,
    heartbeat,
    suspend,
    resume,
  };
}
