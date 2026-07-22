## 1. Close the once-guard gap (`run-queue.mjs`)

- [x] 1.1 In `stop()`'s queued branch (`run-queue.mjs:232-244`), add `run.finalized = true;` alongside the existing status/`finished_at`/emit — do NOT call `finalize()` (design D1)
- [x] 1.2 Do not add a `dequeueNext()` or `onFinalized` call here — the run never held the slot and never started (design D1)
- [x] 1.3 Replace the branch comment with the real reason (design D2): must not call `finalize()` because `dequeueNext()` would clear the active run's slot; the run is marked finalized directly so the once-guard protects it; nothing to announce (never started), no slot to release (never held it)

## 2. Tests (`run-queue.test.mjs`)

- [x] 2.1 Update the existing BUG K test (`run-queue.test.mjs:141-158`): assert `queue.get(queuedRun.run_id).finalized === true` (flipped), keep asserting status is `CANCELLED` and that `onFinalized` was NOT called for it. Update the comment — the reconciliation is now decided here, not deferred
- [x] 2.2 Add: cancelling a queued run while another run is active leaves the active run holding the slot — the queued-cancel does not start a second run (submit active, submit queued, `stop(queued)`, then assert a further `submit` still queues rather than starting, i.e. the slot is still held)
- [x] 2.3 Add: after cancelling a queued run, calling `finalize(queuedRunId, ...)` is a no-op — no new event emitted, `onFinalized` not called, and the active run/queue are undisturbed (the once-guard now protects it)
- [x] 2.4 Confirm the pre-existing "cancelled queued run is skipped on dequeue" behavior still holds (the `dequeueNext` filter on `status === QUEUED` already covers it; the `finalized` flag does not change it)

## 3. Verification

- [x] 3.1 `npm test` passes with no `.env`, no `claude` on `PATH`, no network
- [x] 3.2 `npm run build` passes with no new type errors
- [x] 3.3 Manual: submit a task while one is running (so the second queues), then stop the queued one → its card shows `cancelled`, Iris says nothing about it (no completion announced), and the active run keeps running and completes normally
- [x] 3.4 Manual: confirm no regression to the active-run stop and PO-stop paths (stopping the active DEV run still cancels via SIGTERM; stopping an active PO turn is still a no-op that reports current status)

## 4. Spec and record

- [x] 4.1 `openspec validate reconcile-queued-cancel` passes
- [x] 4.2 Re-read the `run-execution-queue` "Stopping a run" delta: all scenarios (queued-cancel is silent + marked finalized, active undisturbed, re-finalize no-op, active DEV stop, PO no-op, escalation) are true against the landed code
- [x] 4.3 One commit on `develop` (single bug), Co-Authored-By trailer
- [x] 4.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG K done — spec reworded to match code (silent, no-dequeue queued-cancel), `run.finalized = true` set in the queued branch so "finalized ⇔ terminal" holds for all runs and the once-guard protects a queued-cancel; note this closes Wave 0
