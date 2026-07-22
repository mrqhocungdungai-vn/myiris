## Why

`openspec/specs/run-execution-queue/spec.md` says stopping a queued run "SHALL remove it from the queue and **finalize it as `cancelled` immediately**." The code (`electron/run-queue.mjs:232-244`) deliberately does the opposite of the literal reading — it marks the run `cancelled`, sets `finished_at`, and emits the cancelled update, but does **not** call `finalize()`, with a comment explaining why. This is `docs/BUGFIX_PLAN.md` BUG K: a standing spec↔code contradiction.

The code is right and the spec is wrong. `finalize()` ends in `dequeueNext()`, which **unconditionally sets `active = null`** (`run-queue.mjs:176-177`) and starts the next queued run. A queued run being cancelled does **not** hold the slot, so routing it through `finalize()` would clear the slot out from under the run that *is* active and start a second run concurrently — the exact single-slot violation the idle-watchdog design (D2) flagged. So the silent, no-dequeue path is the correct behavior; the spec must bend to it.

There is one real defect hiding in the current code, though: because queued-cancel never calls `finalize()`, `run.finalized` is never set for that run, so the finalize-once guard (`run-queue.mjs:216`) does not protect it. The assumption "`finalized` ⇔ terminal" — which the watchdog work relied on staying benign — is literally false for this one class of run. No path exploits it today, but it is a latent trap and the last open item of Wave 0.

## What Changes

One bug, **one commit**.

- **Code (one line):** set `run.finalized = true` in the queued-cancel branch of `stop()`, so a run cancelled while queued is genuinely marked done and the finalize-once guard protects it. This makes "`finalized` ⇔ terminal" true for **all** runs, closing the gap without changing any observable behavior — the branch stays silent, still does not call `finalize()`/`dequeueNext()`, still emits exactly the one `cancelled` update.
- **Comment:** update the branch comment to state the real reason it must not call `finalize()` — `dequeueNext()` would clear the active run's slot — not just "no announcement to make."
- **Spec:** reword the "Stopping a run" requirement and its "Stop a queued run" scenario so they describe what actually (and correctly) happens: a queued-cancel reaches the `cancelled` terminal state, emits one cancelled update, and is marked done, but does **not** run the slot-release/dequeue/announcement path, because it never held the slot or started. Add scenarios pinning that it does not disturb the active run and cannot be re-finalized.
- **Test:** update the existing Wave 0.0 BUG K assertion (`run-queue.test.mjs:141-158`) to the new behavior (`finalized === true`, still no `onFinalized`), and add the two new guarantees.

Not in scope:
- PO-turn cancellation (BUG I.2) — a different requirement (`run-execution-queue` intentionally makes PO-stop a no-op); its own change.
- The `voice-decision-relay` "Voice answer resumes the same turn" duplication (flagged, separate hygiene task).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution-queue`: the "Stopping a run" requirement literally says a queued run is "finalize[d] ... immediately," contradicting the intentional (and necessary) silent, no-dequeue behavior. The requirement is reworded to match the code, and gains scenarios asserting that cancelling a queued run leaves the active run undisturbed and that a cancelled queued run cannot be re-finalized.

## Impact

- `electron/run-queue.mjs` — one line (`run.finalized = true`) plus the corrected comment in `stop()`'s queued branch.
- `electron/run-queue.test.mjs` — the existing BUG K test flips its `finalized` assertion and gains two guarantees; the module is in test scope, so this is fully covered automatically.
- `run-execution-queue` living spec — one MODIFIED requirement (spec bends to code) plus new scenarios.
- No new dependency, no data migration, no observable behavior change — this closes a latent inconsistency and removes a spec contradiction.
