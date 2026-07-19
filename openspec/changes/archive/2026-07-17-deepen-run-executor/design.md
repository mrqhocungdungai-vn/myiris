## Context

The execution slot ("Claude does one thing at a time") is enforced today by two module-level globals in `electron/main.mjs` — `runQueue = { active, queue }` (line 177) and `claudeRuns` (line 79) — mutated from six functions: `submitClaudeTask` (create + enqueue-or-start), `startClaudeRun` (slot acquire), `finalizeRun` (finalize-once + terminal event + announcement), `startNextInQueue` (slot release + skip-cancelled dequeue), `stopClaudeTask` (queue filter / SIGTERM), plus DEV's `close` handler (terminal-status decision). The run record grows fields imperatively in five places; `serializeRun` strips `child`/`result` by destructuring (implicit knowledge of which fields are internal); the `claude_task_update` payload is hand-built at six sites; and the status vocabulary is two undeclared overlapping sets (stored vs emitted). `PendingQuestion` (main.mjs:82–89) structurally depends on the one-at-a-time invariant but can only cite it in a comment.

This was deferred by the `a0429a7` deepening round (see `openspec/changes/archive/2026-07-16-architecture-deepening-refactors/design.md`, Non-Goals). There is still no test runner; `npm run build` (`tsc --noEmit` + vite) is the only automated check, so decisions below favor changes that are easy to verify manually.

## Goals / Non-Goals

**Goals:**
- Concentrate the slot invariant, finalize-once guard, skip-cancelled dequeue, status vocabulary, and task-update projection in one module with a small interface (deletion test: deleting the module must re-scatter all five, not just relocate code).
- Keep the module free of Electron/Gemini/transport imports, like `electron/claude-stream.mjs`, so it is testable headless once a runner exists.
- Preserve every observable behavior: identical `claude_task_update` sequences and payloads, identical Gemini tool-call return shapes, identical announcement timing, identical `~/.iris/claude-sessions.json` writes.
- Keep DEV's one-shot subprocess and PO's resident SDK session as separate transports behind the injected `startRun` — the CLAUDE.md PO/DEV boundary stays at the dispatch level, exactly as today.

**Non-Goals:**
- No cancel support for active PO turns (today's no-op stands; would need SDK interrupt support — separate change).
- No watchdog for a run whose transport never reports termination (same exposure as today).
- No change to `runQueue`'s FIFO policy, no priorities, no concurrency > 1.
- Not adding the test runner itself; this change only opens the seam.
- No renderer or preload changes (the typed-`SidecarEvent` candidate remains separate).

## Decisions

### D1 — Factory with injected edges, not a class over globals
`electron/run-queue.mjs` exports `createRunQueue({ startRun, emit, onFinalized })` returning `{ submit, finalize, stop, status, get, serialize }`. `startRun(run)` is main.mjs's existing dispatch (install check → scaffold → PO/DEV split — unchanged, stays in main.mjs); `emit(event)` is `emitEvent`; `onFinalized(run)` is where main.mjs wires `announceClaudeCompletion` (voice announcement is a main.mjs concern — the module must not know Gemini exists).
- **Alternative considered**: move `startClaudeRun`'s preamble (agent-install check, scaffold seeding) into the module too. Rejected — those are role/workspace concerns with fs and persona knowledge; pulling them in would give the module a second reason to change and drag `installIrisAgents`/`ensureProjectScaffold` dependencies along. The module's job is the slot, not what a run does.
- **Alternative considered**: keep `finalize` as a free function operating on the run object (today's shape) with a shared guard. Rejected — that preserves the scattered-mutation shape; the review's point is that the invariant should be a construction, not a convention.

### D2 — Slot acquisition moves inside the module
Today `startClaudeRun` sets `runQueue.active = run.run_id` itself. After: `submit` (and the internal dequeue) sets `active` *before* invoking the injected `startRun`, so no code outside the module ever touches the slot. `startRun` failures that finalize synchronously (missing agent, PO billing) work unchanged because `finalize` is already re-entrant-safe via the finalize-once guard.

### D3 — One projection, status-specific extras
`toUpdateEvent(run, status, extra = {})` builds every `claude_task_update` from the run record: always `run_id`, `task`, `agent ?? null`, `model ?? null`, `claude_session_id ?? null`; `extra` carries the per-status fields (`position` for `queued`, `urgency` for `starting`/`started`, `output` override for `running`/terminal). The six current literals (main.mjs:643, 696, 1050, 1127, 1211, 1255) become calls. `pushActivity` stays in main.mjs (it owns `run.activity` trimming today) but emits via the exported projection.
- **Behavior note**: the current six literals are *not* field-identical (e.g. the `queued` event omits `model`/`claude_session_id`; `cancelled` omits `agent`). The projection will emit the superset with `null`s where today the key is absent. The renderer already reads every field through `readString(...) ?? fallback`, so absent-vs-null is indistinguishable to it — verified against `App.tsx`'s `claude_task_update` branch. This is the one deliberate payload delta; anything beyond it is a bug.

### D4 — Status vocabulary declared once, split stored vs emitted
The module exports `RUN_STATUS` (stored: `queued|running|completed|failed|error|cancelled`), `EMIT_STATUS` (adds `starting|started`), and `TERMINAL_STATUSES`. `finalize(id, status, output)` asserts `status` is terminal. DEV's close handler keeps deciding *which* terminal status applies (it owns transport knowledge: exit code, stderr, dead-`--resume` detection) and passes it to `finalize` — the module owns the vocabulary, not the diagnosis.

### D5 — Explicit cancel-release contract
`stop(id)` on the active run marks it `cancelled` and signals the transport (SIGTERM via `run.child` when present), but does NOT release the slot — release happens only in `finalize`, invoked by the transport's termination callback. This is today's implicit path made a documented contract of the interface (and a comment in `stop`), including the PO no-op case (no `child` → return current status). Making it explicit is the fix; making it *different* (e.g. stop-releases-slot) would risk double-start if the close handler then finalized.

### D6 — Runs map and serialization live inside
`claudeRuns` moves into the factory closure; `getClaudeTaskStatus` uses `queue.serialize(id)` (today's `serializeRun` — strip `child`/`result`). The "which fields are internal" knowledge moves next to the record it describes.

### D7 — Plain `.mjs` with JSDoc typedefs
Same convention as `claude-stream.mjs`/`po-session.mjs` — no TS conversion in this change. A `@typedef {Object} Run` documents the record shape that today exists only as scattered assignments. (One adapter today — a hypothetical seam until a test runner adds the second.)

## Risks / Trade-offs

- **[Risk]** Payload drift in the unified projection breaks the Work Stream panel subtly. → **Mitigation**: D3's field-by-field diff against all six literals is done at design time (above); after wiring, run one DEV task, one PO turn, one queued task, one cancel and compare panel output to pre-change behavior.
- **[Risk]** Slot-acquisition reordering (D2) changes behavior when `startRun` finalizes synchronously (missing agent, PO billing failure). → **Mitigation**: the finalize path already handles this today (`startClaudeRun` → `finalizeRun` → `startNextInQueue` while `active` is set); preserve exact ordering: set `active` → emit `starting` → call `startRun`. Verify with the missing-agent failure case manually.
- **[Risk]** `stopClaudeTask`'s queued-cancel today does NOT call `finalizeRun` (it sets fields and emits inline — no announcement, no `onFinalized`). Routing it through `finalize` would add an announcement that doesn't exist today. → **Mitigation**: `stop` on a queued run keeps the inline terminalization (no `onFinalized` call), preserving today's silence; the spec's "finalize as cancelled" is satisfied by the status/event contract, not by invoking the announcement hook. Documented in the module.
- **Trade-off**: `startRun`, `emit`, `onFinalized` as three separate injections is a wider constructor than one context object, but each names a real, separately-testable edge; collapsing them would re-hide the seams this change exists to open.

## Migration Plan

1. Add `electron/run-queue.mjs` (factory, vocabulary, projection) — no call-site changes; `npm run build`.
2. Wire `submitClaudeTask`/`getClaudeTaskStatus`/`stopClaudeTask` and the slot half of `startClaudeRun` through the module; delete `runQueue`/`claudeRuns` globals and `finalizeRun`/`startNextInQueue`/`serializeRun` free functions.
3. Replace the six event literals with the projection.
4. `npm run build`, then manual verification: DEV task, PO turn (with an AskUserQuestion), submit-while-busy (queued → auto-start), cancel a queued task, cancel an active DEV task, missing-agent failure.
Rollback: revert the commit(s); no data or config migration exists to undo.

## Open Questions

- None blocking. If the typed-`SidecarEvent` change lands later, `toUpdateEvent` is the natural single producer for the `claude_task_update` variant — design that union against this projection.
