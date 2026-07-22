## 1. Queue — injected `cancelRun` (`run-queue.mjs`)

- [x] 1.1 Add `cancelRun` to `createRunQueue({ startRun, cancelRun, emit, onFinalized, idleTimeoutMs })` and document it in the deps JSDoc (parallel to `startRun`; must not touch the slot itself) (design D1)
- [x] 1.2 In `stop()`, replace the active-no-child no-op (`:258-260`) with: `run.status = RUN_STATUS.CANCELLED; cancelRun?.(run); return run.status;` — do NOT call `finalize()` here (slot releases via the settle path, mirroring the DEV branch) (design D1)
- [x] 1.3 Keep the queued branch and the active-with-child (`killWithEscalation`) branch unchanged

## 2. PO session — `cancelPoTurn` (`po-session.mjs`)

- [x] 2.1 Add `cancelPoTurn(state)`: set `state.endReason = { kind: "cancelled" }`, close the channel, `state.query?.return?.()` — the teardown body `closePoSession` uses, differing only in `endReason.kind`. Do NOT delete the stored on-disk session id (design D2)
- [x] 2.2 Confirm `pump`'s `finally` rejects the pending turn carrying `poEndReason.kind === "cancelled"` (channel close ends the `for await`)

## 3. Wiring + terminal status (`main.mjs`)

- [x] 3.1 Pass `cancelRun` to `createRunQueue`: `(run) => { const state = getPoSessionState(run.workstream_id); if (state) cancelPoTurn(state); }` (route by workstream; no-op if no live session) (design D1/D2)
- [x] 3.2 Extend `startPoRun`'s settle `.catch` (`:1698-1707`) so `error?.poEndReason?.kind === "cancelled"` finalizes `RUN_STATUS.CANCELLED` with "Run was stopped before completion." (treat like the existing `teardown` case, distinct message)
- [x] 3.3 Confirm a DEV run's stop path is untouched and still finalizes via `child.on("close")`

## 4. Tests (`run-queue.test.mjs` — in the Vitest harness)

- [x] 4.1 `stop()` on a no-child active run calls the injected `cancelRun` with that run and marks it `cancelled`, and does NOT itself emit a terminal event or release the slot
- [x] 4.2 After the (fake) transport then finalizes the cancelled run, the slot is released and the next queued run starts — exactly once, no double-start
- [x] 4.3 Regression: the PO-stop path is no longer a no-op (the pre-change test asserting "returns status unchanged, turn continues" is updated to the new behavior) — no such prior test existed in `run-queue.test.mjs`; new tests (4.1/4.2) cover the new behavior directly
- [x] 4.4 DEV stop (with child) still uses `killWithEscalation` and finalizes on close — unchanged (covered by the existing SIGTERM/SIGKILL escalation test, still green)
- [x] 4.5 `npm test` green

## 5. Verification (manual — the PO SDK path is out of the harness)

- [x] 5.1 Start a long PO turn; hit stop (voice `stop_claude_task` and/or the UI stop): the run reaches `cancelled` and the execution slot is released promptly (not only after the idle watchdog)
- [x] 5.2 A queued run behind it then starts, once
- [x] 5.3 Submit a follow-up PO turn in the same workstream: it continues the same conversation (resumes the stored session id), confirming continuity was preserved
- [x] 5.4 `npm run build` passes

## 6. Spec and record

- [x] 6.1 `openspec validate make-po-turns-cancellable` passes
- [x] 6.2 Re-read the MODIFIED `run-execution-queue` "Stopping a run": the PO-stop clause and its scenario now describe cancellation (not a no-op); DEV / queued / escalation / consistency clauses unchanged and still true
- [x] 6.3 One commit on `develop` (BUG I.2 is a single fix; the queue seam, PO cancel, and wiring land together as they are meaningless apart). Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG I.2 done; note `stop()` now cancels an active PO turn via an injected `cancelRun` → `cancelPoTurn` teardown (stored id preserved → next turn resumes), with the run-queue MODIFIED requirement and new Vitest coverage. Note the remaining Wave 2 items: I.3 (`detached` + kill process group) and I.4 (`before-quit` `preventDefault` + awaited teardown) — plus the trivial `handleSidecarEvent` stale-closure comment
