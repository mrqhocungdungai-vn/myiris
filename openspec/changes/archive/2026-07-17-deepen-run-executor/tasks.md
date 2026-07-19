## 1. Create the RunQueue module (no call-site changes yet)

- [x] 1.1 Add `electron/run-queue.mjs` exporting `RUN_STATUS`, `EMIT_STATUS`, `TERMINAL_STATUSES` constants and a `@typedef {Object} Run` JSDoc documenting the run-record shape (design D4, D7)
- [x] 1.2 Implement `toUpdateEvent(run, status, extra)` — the single `claude_task_update` projection (always `run_id`/`task`/`agent`/`model`/`claude_session_id`, extras for `position`/`urgency`/`output`) and export it (design D3)
- [x] 1.3 Implement `createRunQueue({ startRun, emit, onFinalized })` returning `{ submit, finalize, stop, status, get, serialize }`: runs map in closure, slot acquire inside submit/dequeue before calling `startRun` (design D1, D2, D6)
- [x] 1.4 Implement `finalize(id, status, output)`: assert terminal status, finalize-once guard, terminal `toUpdateEvent` emit, `onFinalized(run)` hook, slot release + skip-cancelled FIFO dequeue (spec: "A run finalizes exactly once", "Dequeue skips cancelled runs")
- [x] 1.5 Implement `stop(id)`: queued → remove from queue + inline `cancelled` terminalization WITHOUT `onFinalized` (preserves today's no-announcement behavior, design Risks); active with `child` → mark `cancelled` + SIGTERM, slot released only via finalize (design D5); active without `child` (PO) → return current status unchanged
- [x] 1.6 Verify the module imports nothing from Electron/main.mjs/po-session.mjs (headless like `claude-stream.mjs`), then run `npm run build`

## 2. Wire main.mjs through the module

- [x] 2.1 Construct the queue in `main.mjs` with `startRun` = existing `startClaudeRun` dispatch minus its `runQueue.active =` line, `emit` = `emitEvent`, `onFinalized` = the `announceClaudeCompletion` call currently inside `finalizeRun`
- [x] 2.2 Route `submitClaudeTask` through `queue.submit` preserving exact event order (queued event with position when busy; `starting` event then start when idle) and unchanged Gemini tool return shapes
- [x] 2.3 Replace `finalizeRun`/`startNextInQueue`/`serializeRun` free functions and the `runQueue`/`claudeRuns` globals; update `getClaudeTaskStatus` → `queue.serialize`, `stopClaudeTask` → `queue.stop`, DEV close/error handlers and `startPoRun`'s promise chain → `queue.finalize` (transport keeps diagnosing WHICH terminal status, design D4)
- [x] 2.4 Replace the six inline `claude_task_update` literals (finalize, pushActivity, DEV started, PO started, queued, cancelled) with `toUpdateEvent` calls; `pushActivity` stays in main.mjs but emits via the projection
- [x] 2.5 Grep main.mjs to confirm no remaining direct mutation of slot/queue/runs state outside the module, then `npm run build`

## 3. Verify behavior is preserved (manual — no test runner exists)

- [x] 3.1 Run one DEV task and one PO turn (with an `AskUserQuestion` mid-turn): Work Stream panel activity, terminal output, completion announcement, and stored `claude_session_id` all match pre-change behavior
- [x] 3.2 Submit a task while another is running: `queued` event carries position, task auto-starts when the slot frees
- [x] 3.3 Cancel a queued task (leaves queue silently, skipped at dequeue) and cancel an active DEV task (SIGTERM → `cancelled` finalize releases the slot; next queued task starts)
- [x] 3.4 Trigger the missing-agent synchronous failure (role run with agents uninstalled): run fails loudly and the slot is released for the next task
- [x] 3.5 Confirm the one deliberate payload delta (superset fields with `null`s, design D3) is the ONLY `claude_task_update` difference, by comparing panel rendering and a console dump of events for one full lifecycle
