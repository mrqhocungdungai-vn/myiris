## Context

```js
// run-queue.mjs:188-198
function submit(run) {
  runs.set(run.run_id, run);
  if (active) { queue.push(run.run_id); emit(... QUEUED ...); return { status: "queued", position }; }
  emit(... STARTING ...);
  beginRun(run);                       // calls startRun SYNCHRONOUSLY
  return { status: "started" };        // ← blind: beginRun may have already finalized the run
}
```

`beginRun` → `startRun` (injected `startClaudeRun`) runs synchronously, and several start paths finalize the run inside it before `submit` returns:

- `main.mjs:1440` — agent not installed → `FAILED`
- `main.mjs:1469` — DEV run, no open change with tasks → `FAILED` (the routine one)
- `main.mjs:1535` — `spawn` throws → `ERROR`
- `startPoRun` billing gate → `FAILED`

Each finalizes *before* `run.started_at` is set (`main.mjs:1540` DEV, `1610` PO). So after `beginRun` returns, `run.finalized` is `true` and `run.status` is the terminal status — but `submit` ignores that and says `"started"`.

`submitClaudeTask` (`main.mjs:1695`) then branches only on `"queued"`; everything else becomes *"has started the task."* Gemini hears "started", then — via the finalize that already happened — the completion path. Historically that produced sequential double-speak; the fix must not turn it into simultaneous double-speak.

**Why that hazard is already gone:** BUG A' (Wave 0.3) gated `onFinalized` on `run.started_at` (`main.mjs:235`). A synchronously-rejected run has no `started_at`, so `onFinalized` returns early and no `announceClaudeCompletion` fires. The rejection therefore reaches Gemini through exactly one channel — the tool response — once this change makes that response carry it. This change is the second half of the three-step fix the plan recorded; step 1 (A') is done.

## Goals / Non-Goals

**Goals:**

- The submitter is never told a run `started` when it was rejected during start.
- The rejection reaches Gemini once, through the tool response, in the turn it is waiting on.
- The healthy "started" and "queued" paths are byte-for-byte unchanged.

**Non-Goals:**

- Changing *when* the completion announcement fires (A', done) or the `claude_task_update` event sequence (a synchronous rejection already emits `starting` → terminal).
- Touching any gate's own logic.
- Making start asynchronous — `beginRun` stays synchronous; the fix reads state after it, it does not restructure it.

## Decisions

### D1 — `submit` returns the run's real status after `beginRun`

**Chosen:** after `beginRun(run)`, inspect the run record. If `run.finalized` (it was rejected during start), return `{ status: run.status, output: run.output, run_id }`; otherwise return `{ status: "started", run_id }` as today.

`run.finalized` is the exact discriminator: the once-guard sets it in `finalize` (`run-queue.mjs:209`), so it is `true` iff a terminal path ran during `beginRun`. Reading the record is in keeping with the plan's invariant — *a function that invokes an injected callback must re-read state before reporting on it.* No new field, no new event.

*Returning a fixed `"failed"` sentinel considered and rejected:* the real status distinguishes `failed` (a gate said no) from `error` (a transport broke), which the submitter may phrase differently; the record already holds the right one.

### D2 — `submitClaudeTask` gets one terminal branch, worded for voice

**Chosen:** between the `"queued"` branch and the `"started"` branch, add: if `outcome.status` is a terminal status, return `{ status: "rejected", run_id, message: <the finalize output> }` (or `status: outcome.status` — a tool-response shape Gemini reads as "did not start"). The message is the reason `finalize` already produced (e.g. the DEV-gate sentence telling the user to have the PO propose first), so it is actionable spoken aloud.

The healthy `"started"` and `"queued"` branches are untouched, so nothing changes for the common paths.

*Discriminating in the prompt text alone (leaving `submit` returning "started") considered and rejected:* the plan showed a `run-queue`-only change is a no-op because `submitClaudeTask` reads only `"queued"`, and a `main.mjs`-only change cannot see that the run failed without the real status. Both halves are needed; that is why this is one coherent change, not two.

## Risks / Trade-offs

**A run that finalizes asynchronously right after `beginRun` returns** → not affected: `beginRun` for a healthy DEV run spawns a child and returns with the run `RUNNING` (not finalized), so `submit` correctly says `"started"`; the async completion flows through `onFinalized` as before. Only *synchronous* finalization changes the return value.

**A PO turn** → `startPoRun` sets `RUNNING` and delivers the turn asynchronously; unless the billing gate rejects synchronously, `run.finalized` is false at return, so PO still reports `"started"`. The billing-gate rejection now reports correctly, which is the intended improvement.

**Double-speak regression** → guarded by A' (see Context); a test asserting `onFinalized`'s `started_at` gate (added in Wave 0.3) protects it, and this change adds a test that a synchronously-finalized submit returns the terminal status.

**Coverage** → `run-queue.mjs` is in test scope; the return-value change is unit-testable with an injected `startRun` that finalizes synchronously. The `submitClaudeTask` wording lives in `main.mjs` (out of scope, Wave 0.0 D5) and is covered by the manual voice check.
