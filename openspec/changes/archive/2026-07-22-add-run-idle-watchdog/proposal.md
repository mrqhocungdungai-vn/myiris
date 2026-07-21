## Why

The global execution slot has no upper bound on how long a run may hold it.

`electron/run-queue.mjs` releases the slot in exactly one place — `finalize()` at line 136 — and `finalize()` is only ever reached from a transport's own termination callback. Every budget elsewhere in the system is explicit (`IRIS_PO_QUESTION_TIMEOUT_MS`, the reconnect backoff, `MAX_RECONNECT_ATTEMPTS`); the run is the one unbounded thing, and it holds a **system-wide singleton**. If a transport never calls back, the slot is held forever and every subsequent PO turn and DEV run queues behind a corpse until the app restarts.

This is not hypothetical. `docs/BUGFIX_PLAN.md` BUG A is one confirmed way to reach that state (a PO turn's promise is settled only on the `catch` path, so a normally-ended SDK stream never finalizes). Three more are known and unfixed: a `claude` subprocess that ignores SIGTERM (`run-queue.mjs:155` has no escalation), a subprocess that wedges on a network call, and an SDK session that stays alive but silently stops emitting.

Fixing BUG A closes **two known exit paths of one module**. A bound on the slot closes **every member of the class, including the ones nobody has found yet** — and converts "app bricked until restart, `savePoToken` bricked too" into "one stalled run, a loud error, slot free". It is the only fix in the plan with that property, which is why it lands before BUG A rather than after.

`electron/main.mjs:121-124` records that this project already learned this invariant once, on the pending-question slot, after a bare-global version hung forever in production. This change generalizes it to the execution slot.

## What Changes

- Add an **idle timeout** to the execution slot in `electron/run-queue.mjs`. The bound is on *silence*, not on total runtime: a legitimate forty-minute DEV run must not be killed, but a run that has produced nothing for the timeout window must not hold the slot indefinitely.
- Reset the idle timer on each progress signal the run produces. `pushActivity` (`electron/main.mjs:1049-1055`) already fires per tool call for **both** transports, so the signal already exists and no new plumbing crosses the seam.
- On expiry: signal the transport, escalate if it does not die, and finalize the run so the slot is released and the user is told. This also gives `stop()` the SIGTERM→SIGKILL escalation it currently lacks.
- Add the ability to **suspend** the idle timer while a run is legitimately blocked awaiting a human. A PO turn paused on `AskUserQuestion` emits no activity for up to `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000). Without suspension the watchdog would kill precisely the turns that are working correctly — this is the single largest risk in the change.
- Add `IRIS_RUN_IDLE_TIMEOUT_MS` as an explicit, documented env budget alongside the existing `IRIS_*` options.

Not in scope:

- BUG A itself (Wave 0.2). The watchdog bounds the *consequence* of an unsettled turn; it does not settle the turn. Both are needed and they land separately so a regression is attributable.
- PO turn cancellation (`cancelActive()`, BUG I.2). That contradicts an existing requirement and needs its own change.
- `detached: true` / process-group kill and the `before-quit` teardown (BUG I.4/I.5).
- BUG K. See Impact — the blocker recorded in the 0.0 design does not survive contact with the code.

## Capabilities

### Modified Capabilities

- `run-execution-queue`: adds a bounded-lifetime requirement to the execution slot, and changes the stop path to escalate a signal that is ignored. Today the spec says the slot "SHALL be released through the normal finalize-on-termination path" with no statement about what happens when termination never comes; that gap is what this change closes.

### New Capabilities

None. This is a bound on behavior the `run-execution-queue` capability already owns; giving it its own capability would split one invariant across two specs.

## Impact

- `electron/run-queue.mjs` — the timer, its arm/reset/disarm points, and the escalation path. All three arm/disarm sites (`beginRun`, `finalize`, `dequeueNext`) are within a 50-line neighbourhood.
- `electron/main.mjs` — reset the timer where progress is already observed (`pushActivity`), and suspend/resume it around the pending-question lifecycle (`PendingQuestion.raise` / `settle`, `main.mjs:127-143`).
- `.env.example` and the config documentation — the new `IRIS_RUN_IDLE_TIMEOUT_MS` budget.
- `electron/run-queue.test.mjs` — extended with fake-timer coverage. The net added in `add-test-harness-and-po-seam` exists for exactly this change; the timer behavior is testable without a real subprocess because `startRun` is already injected.
- **BUG K is not a blocker, contrary to the open question recorded in the `add-test-harness-and-po-seam` design.** That question assumed the watchdog would rely on `run.finalized` implying terminal, which is false for a run cancelled while queued. Reading the code: `dequeueNext` (`run-queue.mjs:101`) skips entries on `status`, not on `finalized`, and a queued run never reaches `beginRun`, so no timer is ever armed for one. The inconsistency stays latent and stays tracked as BUG K. **This change must not arm timers per-run in a map** — doing so would make the blocker real. See design D2.
- Follow-on: BUG A (Wave 0.2) lands inside this bound, so its verification becomes a test rather than a manual GUI ritual.
