## 1. Budget and configuration

- [x] 1.1 Set `IRIS_RUN_IDLE_TIMEOUT_MS` to **1_800_000 (30 minutes)**, and record the reasoning in a comment next to the constant: the binding constraint is a sub-agent `Task` call, which appears in the parent stream as one `tool_use` → total silence → one `tool_result`, and which sits on DEV's standard path (the persona invokes `code-review`, whose skill runs two parallel sub-agents). Observed sub-agent durations: 263s / 365s / 380s. 30 min is ~4.7× the longest observed and 3× the Bash tool's own 600s ceiling. Erring long is cheap — the failure it bounds is currently unbounded — and the rollback is an env var, not a code change
- [x] 1.2 Read the budget the same way the other `IRIS_*` options are read, with the default applied when unset or unparseable
- [x] 1.3 Confirm a very large value effectively disables the bound (the documented rollback), rather than being special-cased
- [x] 1.4 Document `IRIS_RUN_IDLE_TIMEOUT_MS` in `.env.example` alongside the existing budgets

## 2. Slot-owned timer in `run-queue.mjs`

- [x] 2.1 Add a **single** timer owned by the slot — not a `Map` keyed by run id (design D2; a per-run map makes BUG K a live single-slot violation)
- [x] 2.2 Arm the timer in `beginRun` (`run-queue.mjs:87-94`), so a queued run is never timed
- [x] 2.3 Clear the timer in `finalize` (`run-queue.mjs:120-137`) on every path, so a run finalized by its transport leaves no stale timer behind
- [x] 2.4 Expose a reset call on the queue's interface for the active run's progress signal
- [x] 2.5 Expose suspend/resume for the active run's bound (design D3)
- [x] 2.6 Prefer a timer that does not hold the Node event loop open (design Risks)

## 3. Expiry and escalation

- [x] 3.1 On expiry, signal the active run's transport, wait a bounded grace period, then kill unconditionally (design D4/D5)
- [x] 3.2 Route expiry through the existing `finalize()` — never assign `active = null` directly — so the once-guard, terminal event, announcement and dequeue all still happen in one place (design D4)
- [x] 3.3 Finalize an expired run as `error`, with an output that names the budget and says what happened, so the message is actionable
- [x] 3.4 Reuse the same escalation for `stop()` (`run-queue.mjs:153-159`), which currently sends SIGTERM with no follow-up
- [x] 3.5 Verify the post-kill ordering: if the transport's own termination callback fires after the kill, the once-guard makes it a no-op and no second event or announcement is emitted (design D5)

## 4. Wiring in `main.mjs`

- [x] 4.1 Reset the bound from **all three** progress sinks — `pushActivity`, `pushToolStart` and `pushToolEnd` (`main.mjs:1049-1078`). `pushActivity` alone is not enough: per `claude-stream.mjs:44-49` a `tool_result` fires `onToolEnd` only and never `onActivity`, so resetting only on activity would stretch the measured window to `tool_use → next assistant message` (tool duration *plus* model thinking time) instead of the actual silence
- [x] 4.2 Suspend the bound in `PendingQuestion.raise` (`main.mjs:127-133`)
- [x] 4.3 Resume the bound in `PendingQuestion.settle` (`main.mjs:135-143`) — in `settle` itself, not at the individual call sites, so no future settlement path can miss it (design D3)
- [x] 4.4 Confirm `run-queue.mjs` gained no import of PO, DEV, Electron or SDK symbols — the suspension signal must arrive through its interface only

## 5. Tests

- [x] 5.1 Extend `electron/run-queue.test.mjs` using Vitest fake timers
- [x] 5.2 Test: a run producing progress at intervals shorter than the bound survives far past the bound (spec: "A healthy long run is not terminated")
- [x] 5.3 Test: a run silent past the bound is finalized once, emits one terminal event, and the slot is released so the next queued run starts (spec: "A silent run loses the slot")
- [x] 5.4 Test: a queued run sitting past the bound is unaffected and starts normally when the slot frees (spec: "A queued run is not timed")
- [x] 5.5 Test: a run finalized normally before the bound leaves no timer that fires afterwards (spec: "The bound is disarmed by normal termination")
- [x] 5.6 Test: while suspended, advancing time past the bound does not terminate the run (spec: "Turn paused on a question outlives the idle bound") — this is the change's largest risk, assert it rather than reason about it
- [x] 5.7 Test: the bound is active again after resume, via **each** settlement path (spec: "Suspension ends however the question settles"), and a run still silent after resume is finalized (spec: "A run that stays silent after being unblocked still loses the slot")
- [x] 5.8 Test: a signalled transport that never terminates is killed and finalized exactly once, releasing the slot (spec: "A signalled process ignores the signal")
- [x] 5.9 Test: the single-slot invariant holds across an expiry — assert no two runs are ever started concurrently, including when an expiry and a transport callback race

## 6. Verification

- [x] 6.1 `npm test` passes with no `.env`, no `claude` on `PATH`, no network
- [x] 6.2 `npm run build` passes with no new type errors
- [x] 6.3 Manually confirm a real DEV run still completes normally and is not terminated by the bound
- [x] 6.4 Manually confirm a PO turn paused on `AskUserQuestion` past the bound is not terminated, and completes after the answer
- [x] 6.5 Confirm no behavior change for runs that finalize normally — same events, same announcement, same ordering

## 7. Record

- [x] 7.1 Update the log table in `docs/BUGFIX_PLAN.md`: mark I.1 done, note the chosen default, and record that BUG K was re-examined and found not to gate this change (design D2) while remaining open
