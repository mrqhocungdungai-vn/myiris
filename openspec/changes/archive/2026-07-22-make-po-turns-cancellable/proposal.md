## Why

**BUG I.2 — an active PO turn cannot be stopped.** `run-queue.mjs`'s `stop()` handles a queued run (remove + cancel) and an active DEV run (SIGTERM → SIGKILL escalation, slot freed on close). But the active-run branch for a transport with no child process — a PO turn — is a deliberate **no-op** (`run-queue.mjs:258-260`): the turn runs to completion and there is no way for the user to abort it.

This is the sharpest remaining lifecycle gap and it compounds with the queue's single global slot: a PO turn that is wandering, stuck, or simply unwanted holds the slot with no exit. The only "escape" a user reaches for — switching workstream or hitting New — is a session reset, which is a heavier, separate action; there is no "stop this run." Wave 0/1 already added the idle watchdog (`add-run-idle-watchdog`, I.1) as the *automatic* backstop, but a user-initiated stop still silently does nothing for PO. The living spec even codifies the no-op as intentional — so this is a contradiction to resolve, not just a missing feature.

## What Changes

Make `stop()` cancel an active PO turn, symmetric with how it cancels a DEV run — the slot is freed through the normal finalize path, and the resident conversation is preserved for the next turn.

- **`run-queue.mjs` gains an injected `cancelRun` dependency** (parallel to `startRun`; the queue stays transport-agnostic — it never learns what a "PO session" is). In `stop()`, the active-no-child branch stops being a no-op: it marks the run `cancelled` and calls `cancelRun(run)`, mirroring the DEV branch's `run.status = CANCELLED` + signal. The slot is still released by the normal finalize-on-termination path (the PO turn's settle handler in `startPoRun`), never by the stop call itself — so there is no double-start risk, exactly as for DEV.
- **`po-session.mjs` gains `cancelPoTurn(state)`** that ends the in-progress turn using the proven teardown machinery: it sets an endReason `{ kind: "cancelled" }`, closes the user-message channel, and returns the SDK query — the same path a session reset already uses, which reliably settles the turn via `pump`'s `finally` (rejecting the pending turn). The stored on-disk session id is **not** deleted, so the next PO turn resumes the same conversation (`getOrCreatePoSession` with `resume: <stored id>`) — cross-turn continuity is preserved; only the cancelled turn's in-flight work is discarded.
- **`main.mjs` wires `cancelRun`** into `createRunQueue`: for a PO run it calls `cancelPoTurn` for that workstream. `startPoRun`'s existing settle handler already maps the resulting teardown-reject to `finalize(..., CANCELLED, ...)` (`main.mjs:1702-1704`); it is extended to recognize the new `cancelled` reason with a "Run was stopped" message. The idle watchdog remains the ultimate backstop if a turn somehow fails to settle.

*In-place interrupt as a future optimization (non-goal here):* if the installed SDK's `query.interrupt()` is verified to reliably end just the current turn while keeping the resident session live, `cancelPoTurn` could prefer it (no respawn on the next turn). This change uses the guaranteed teardown-and-resume path so cancellation is robust today; the resumed session is functionally continuous either way.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution-queue`: **one MODIFIED requirement** — "Stopping a run" currently states that stopping an active run with no child process (a PO turn) "SHALL leave the run running and report its current status — the existing no-op behavior is preserved intentionally," with a matching "Stop an active PO turn" scenario. The fix directly contradicts that text, so the requirement is updated: stopping an active PO turn SHALL cancel it, bring the run to `cancelled`, and release the slot through the normal finalize path, while the resident PO session survives or is resumable (continuity preserved). The DEV, queued, escalation, and consistency clauses are unchanged.

## Impact

- `electron/run-queue.mjs` — add `cancelRun` to `createRunQueue` deps; `stop()`'s active-no-child branch marks `cancelled` + calls `cancelRun(run)` instead of no-op.
- `electron/po-session.mjs` — add `cancelPoTurn(state)` (teardown with `{ kind: "cancelled" }`, keep stored id); may share code with `closePoSession`.
- `electron/main.mjs` — pass `cancelRun` to `createRunQueue` (routes to `cancelPoTurn` by workstream); extend `startPoRun`'s settle `.catch` to map the `cancelled` reason to `finalize(CANCELLED)`.
- `electron/run-queue.test.mjs` — new cases: `stop()` on a no-child active run calls the injected `cancelRun`, marks the run `cancelled`, does not itself release the slot, and the slot frees only when the (fake) transport finalizes; the PO-stop path is no longer a no-op.
- `run-execution-queue` living spec — one MODIFIED requirement.
- No new dependency, no data migration, no IPC-surface change.
