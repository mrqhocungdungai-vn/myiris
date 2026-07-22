## Why

`runQueue.submit` returns `{ status: "started" }` unconditionally after acquiring the slot (`electron/run-queue.mjs:196-197`), but `beginRun` calls `startClaudeRun` **synchronously**, and several start paths `finalize(... FAILED/ERROR ...)` *inside* that synchronous call before `submit` returns: the DEV "no open change with tasks" gate (`main.mjs:1469-1476`), the "agent not installed" gate (`main.mjs:1440-1447`), a spawn failure (`main.mjs:1535`), and the PO billing gate (`startPoRun`). So `submit` reports `"started"` for a run that has *already failed*.

`submitClaudeTask` (`main.mjs:1695-1711`) then branches only on `"queued"` — every other value falls through to *"Claude's DEV agent has started the task."* The result: for the DEV gate (a routine, frequently-hit path), Iris tells the user *"DEV has started the task"* and then, a beat later, *"…it failed, there's no open change"* — the voice layer contradicts itself. This is `docs/BUGFIX_PLAN.md` BUG E.

This is now safe to fix cleanly because **BUG A' (Wave 0.3) already landed**: `onFinalized` is gated on `run.started_at` (`main.mjs:235`), and every synchronous-fail gate finalizes *before* `started_at` is set (`main.mjs:1540` for DEV, `1610` for PO). So a synchronously-rejected run fires **no** spoken completion announcement — the rejection can be reported to Gemini exactly once, through the tool response, in the turn Gemini is waiting on. Without A' the naive fix would have delivered the same error on two channels simultaneously; that hazard is gone.

## What Changes

One bug, **one commit**.

- `runQueue.submit` returns the run's **real** status after `beginRun`: if the run was finalized synchronously during start (`run.finalized`), return that terminal status and its output; otherwise return `"started"` as today. Queued runs are unchanged.
- `submitClaudeTask` (`main.mjs:1695`) gains a branch for a terminal-status outcome: report the rejection to Gemini as a failure with the reason (the `finalize` output), not *"has started the task."* The `"queued"` and healthy-`"started"` branches are unchanged.

Not in scope:
- BUG A' itself (Wave 0.3, done) — this change depends on it but does not touch it.
- Any change to *when* announcements fire or to the `claude_task_update` event stream — a synchronous rejection already emits `starting` → terminal today; only `submit`'s **return value** and the tool-response wording change.
- The DEV gate's own logic, the billing gate, or the agent-install gate — all correct; this change only fixes how their synchronous rejection is *reported to the submitter*.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution-queue`: the "Single execution slot" requirement currently states that a task submitted while idle always yields `status: "started"` to the submitter (spec line 13). That is literally wrong when the run fails synchronously at start. The requirement is modified so the submitter receives `"started"` only when the run actually begins running, and receives the run's terminal status when it is rejected synchronously during start.

## Impact

- `electron/run-queue.mjs` — `submit`'s return value reads the run record after `beginRun` instead of hardcoding `"started"`. This module is in automated test scope, so the behavior is covered by a Vitest test with an injected `startRun` that finalizes synchronously.
- `electron/main.mjs` — `submitClaudeTask` branches on a terminal outcome and phrases the rejection for voice.
- `run-execution-queue` living spec — one MODIFIED requirement plus a new scenario for synchronous rejection.
- No new dependency, no data migration, no env budget.
