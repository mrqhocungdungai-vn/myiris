# Deepen the Claude run executor

## Why

The "Claude does one thing at a time" invariant — the rule the whole delegation model and `PendingQuestion` structurally depend on — is currently emergent across six functions in `electron/main.mjs` mutating two module-level globals (`runQueue`, `claudeRuns`), with the run status machine expressed as two overlapping stringly vocabularies and the `claude_task_update` event projection hand-copied at six call sites. The same scattered-mutation shape already produced a real bug one level up (the pre-`PendingQuestion` double-resolve), and `main.mjs` keeps growing (~1,880 lines); this was explicitly deferred by the `a0429a7` deepening round and the friction has only increased since.

## What Changes

- Extract a `RunQueue` module (new file `electron/run-queue.mjs`) that owns the execution slot (`{active, queue}`), the runs map, the run status state machine, the finalize-once guard, and the skip-cancelled dequeue loop behind a small interface: `submit(run)` / `finalize(id, outcome)` / `stop(id)` / `status(id)`.
- The module takes injected dependencies — `startRun(run)` (the executor) and `emit(event)` (the sidecar sink) — so it holds no Electron, Gemini, or transport knowledge. DEV's one-shot subprocess and PO's resident SDK session remain separate transports behind the injected `startRun`; the CLAUDE.md PO/DEV module boundary is untouched.
- Consolidate the six hand-copied `claude_task_update` projections into one projection function owned by the module (`toUpdateEvent(run, status, extra)`).
- Declare ONE run-status vocabulary (`queued | starting | started | running | completed | failed | error | cancelled`), splitting it explicitly into stored statuses (on the run record) and emitted-only statuses (`starting`, `started` — event-stream lifecycle markers), instead of today's two undeclared overlapping sets.
- Make the implicit "cancelling the active run releases the slot via the child close handler" path explicit in the module's contract (documented and asserted, not left as an accident of DEV's `close` handler).
- Behavior-preserving refactor: no new user-facing capability, no change to `~/.iris/claude-sessions.json`, no new env vars, no change to the events the renderer receives. Known quirks preserved as-is: stopping an active PO turn remains a no-op (PO has no child process), and completion announcements still fire from finalization.

## Capabilities

### New Capabilities

- `run-execution-queue`: Names the execution behavior that already exists but has no spec: one Claude run mid-execution system-wide; submitted tasks queue FIFO behind the active run; cancelled queued runs are skipped at dequeue; a run finalizes exactly once; finalization releases the slot and starts the next eligible run; each lifecycle transition emits exactly one `claude_task_update` with a defined status vocabulary.

### Modified Capabilities

<!-- none — per-role-model-selection (model resolved at run start), po-live-session (PO transport), session-announcements (completion announcement on finalize), and voice-decision-relay requirements are all preserved unchanged; this change only relocates the mechanism that satisfies them. -->

## Impact

- `electron/main.mjs`: `runQueue`/`claudeRuns` globals and `submitClaudeTask`, `startClaudeRun` (slot-acquire half), `finalizeRun`, `startNextInQueue`, `stopClaudeTask`, `serializeRun`, and the six inline `claude_task_update` literals migrate into / call through the new module. `startDevRun`/`startPoRun` stay in `main.mjs` as the injected `startRun` dispatch.
- New file: `electron/run-queue.mjs` (no Electron imports — testable headless, like `claude-stream.mjs`).
- No changes to: `electron/po-session.mjs`, `electron/preload.cjs`, the renderer, persisted session-store shape, or any `IRIS_*` env vars.
- Verification: `npm run build` (only automated check in this repo) plus manual runs of one DEV task, one PO turn, a queued task, and a cancel — same Work Stream panel output as before.
