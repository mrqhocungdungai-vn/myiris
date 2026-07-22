## Context

```js
// run-queue.mjs — stop(), queued branch (232-244)
if (run.status === RUN_STATUS.QUEUED) {
  const index = queue.indexOf(runId);
  if (index !== -1) queue.splice(index, 1);
  run.status = RUN_STATUS.CANCELLED;
  run.finished_at = Date.now() / 1000;
  emit(toUpdateEvent(run, RUN_STATUS.CANCELLED, {}));
  // Deliberately NOT finalize(): a queued run never started, so there is
  // no announcement to make. Preserves today's silent queued-cancel.
  return run.status;
}

// dequeueNext (176-186) — the reason finalize() is unsafe here
function dequeueNext() {
  active = null;                          // ← unconditional; clobbers the current slot owner
  while (queue.length > 0) { ... beginRun(next); return; }
}
```

The spec (`run-execution-queue`) says a queued run is "finalize[d] ... immediately." Read literally against the `finalize()` function, that is wrong and dangerous: `finalize()` ends in `dequeueNext()`, which sets `active = null` and starts the next queued run. Calling it for a run that does **not** hold the slot would evict whatever run actually holds it and start a second run concurrently — a single-slot violation. The code correctly avoids this; the spec's wording is the defect.

The genuine code defect is narrower: the queued branch never sets `run.finalized`, so the finalize-once guard (`if (!run || run.finalized) return`, line 216) does not protect a queued-cancelled run. "`finalized` ⇔ terminal" — the property the watchdog work leaned on being harmless — is false for exactly this class. No current path calls `finalize()` on such a run (transport callbacks, `killWithEscalation`, and `onIdleExpiry` all reference started/active runs; a double-`stop()` falls through to a no-op because the status is no longer `queued`), so the trap is latent — but it is the last loose thread of Wave 0.

## Goals / Non-Goals

**Goals:**

- Remove the spec↔code contradiction by making the spec describe the correct behavior.
- Make "`finalized` ⇔ terminal" true for all runs, so the finalize-once guard protects a queued-cancelled run too.
- Zero observable behavior change: queued-cancel stays silent, emits one `cancelled` update, and never disturbs the slot.
- Full automated coverage (the module is in test scope).

**Non-Goals:**

- Making queued-cancel go through `finalize()` (unsafe — see Context).
- Changing the active-run stop path, PO-stop no-op, or the SIGTERM→SIGKILL escalation (all correct and unchanged).
- PO-turn cancellation (BUG I.2, separate requirement and change).

## Decisions

### D1 — Set `run.finalized = true` in the queued branch; do not call `finalize()`

**Chosen:** add one line — `run.finalized = true;` — in `stop()`'s queued branch, alongside the existing status/`finished_at`/emit. Do **not** call the `finalize()` function.

This makes the flag mean "has reached a terminal state; do not re-finalize," uniformly across every run, which is what the once-guard already tests. The branch keeps skipping the `finalize()` function on purpose, because `dequeueNext()` inside it would clear the active run's slot (Context). So the fix decouples "this run is done" (the flag) from "run the full finalize path" (the function) — correct, because a queued-cancel is done but has no slot to release and no started run to announce.

*Broadening the once-guard to `TERMINAL_STATUSES.includes(run.status)` instead considered:* also closes the gap, but changes the guard's contract for every caller to defend a case only this branch creates. Setting the flag at the one site that omits it is more local and makes the invariant true at the source rather than papering over it at the check.

*Calling `finalize()` and guarding `dequeueNext()` on `active` instead considered and rejected:* a larger change to a hot path, and `onFinalized` would then fire for the queued-cancel (early-returning on no `started_at` after A', but still needless churn). The one-line flag is strictly smaller and changes nothing observable.

### D2 — Update the comment to the real reason

The current comment ("no announcement to make") is now only half the story and, after A' gated announcements on `started_at`, no longer the load-bearing reason. Replace it with: the branch must not call `finalize()` because `dequeueNext()` would release the active run's slot; the run is instead marked finalized directly so the once-guard protects it, with nothing to announce (never started) and no slot to release (never held it).

### D3 — Spec bends to code

Per the plan's drift-vs-gap verdict for K ("existing contradiction; fix the spec to match the code"), the "Stopping a run" requirement is reworded so "finalize ... immediately" becomes an accurate description: reach `cancelled`, emit one update, mark finalized, but no slot-release/dequeue/announcement. New scenarios pin the two guarantees that make this safe — the active run is undisturbed, and a re-finalize is a no-op.

## Risks / Trade-offs

**A future caller that does want the slot advanced on queued-cancel** → there is none (the slot was never held); if one is ever added it would be a bug this spec now names explicitly.

**Someone reads `finalized = true` as "went through finalize()"** → mitigated by the corrected comment and by the flag's actual contract (guard input), which is about "don't re-finalize," not "did the full path run." The spec now states this outcome directly.

**The existing Wave 0.0 test asserted the old behavior** (`finalized` not true) → intentionally flipped here; the test's comment already noted the reconciliation was "deferred to BUG K's own change," which is this one.

**Coverage** → `run-queue.mjs` is in test scope; the new invariants (flag set, no `onFinalized`, active undisturbed, re-finalize no-op) are all assertable with the injected `startRun`/`onFinalized` fakes already in `run-queue.test.mjs`.
