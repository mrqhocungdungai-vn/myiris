## 1. `submit` returns the real status (`run-queue.mjs`)

- [x] 1.1 In `submit` (`run-queue.mjs:188-198`), after `beginRun(run)`, return `{ status: run.status, output: run.output, run_id: run.run_id }` when `run.finalized`; otherwise return `{ status: "started", run_id: run.run_id }` as today (design D1)
- [x] 1.2 Leave the `"queued"` branch and the `STARTING` emit untouched — the event stream does not change, only the return value
- [x] 1.3 Add a one-line comment tying the read-after-`beginRun` to the invariant: a function that invokes an injected callback must re-read state before reporting on it

## 2. `submitClaudeTask` reports the rejection (`main.mjs`)

- [x] 2.1 In `submitClaudeTask` (`main.mjs:1695`), add a branch before the `"started"` return: if `outcome.status` is a terminal status (`failed`/`error`), return a tool response Gemini reads as "did not start" — carry `run_id` and the `outcome.output` reason as the message (design D2)
- [x] 2.2 Leave the `"queued"` and healthy `"started"` branches byte-for-byte unchanged
- [x] 2.3 Confirm the reason surfaced is the `finalize` output the gate already wrote (e.g. the DEV "no open change… ask the PO to propose first" sentence), so it is actionable spoken aloud

## 3. Tests (`run-queue.test.mjs`)

- [x] 3.1 Test: submit while idle with an injected `startRun` that finalizes the run synchronously as `failed` → `submit` returns `{ status: "failed", ... }`, not `"started"`; the slot is released (the next submit starts)
- [x] 3.2 Test: submit while idle with an injected `startRun` that leaves the run `running` (does not finalize) → `submit` returns `{ status: "started", ... }` (healthy path unchanged)
- [x] 3.3 Test: submit while busy still returns `{ status: "queued", position }` (regression guard)
- [x] 3.4 (Guard for the double-speak the plan warned about) assert `onFinalized` is NOT called for a run finalized without `started_at` during start — reuse/extend the Wave 0.3 started_at-gate assertion so this stays wired

## 4. Verification

- [x] 4.1 `npm test` passes with no `.env`, no `claude` on `PATH`, no network
- [x] 4.2 `npm run build` passes with no new type errors
- [x] 4.3 Manual (the plan's BUG E ritual): in a project with no open change that has unchecked tasks, submit a DEV task by voice → Iris says plainly that it was rejected (with the reason), **once**, and never says "has started the task"
- [x] 4.4 Manual: a healthy DEV run (open change with tasks present) still announces "started" then completes normally — no regression
- [x] 4.5 Manual: a queued task (submitted while another run is active) still reports "queued at position N"

## 5. Spec and record

- [x] 5.1 `openspec validate report-synchronous-start-failure` passes
- [x] 5.2 Re-read the delta: the three "Single execution slot" scenarios (idle-starts, synchronous-rejection, busy-queues) are all true against the landed code
- [x] 5.3 One commit on `develop` (single bug), Co-Authored-By trailer
- [x] 5.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG E done, note it depended on A' (already landed) and that the fix is `submit` returning the real status + the `submitClaudeTask` rejection branch
