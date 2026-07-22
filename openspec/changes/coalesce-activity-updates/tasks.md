## 1. Pure helper — `electron/coalesce.mjs` (new)

- [x] 1.1 Add `createTrailingThrottle(fn, ms)` returning `{ schedule(...args), cancel() }`: `schedule` stores the latest args and arms a single timer if none is pending; on the trailing edge it calls `fn(latestArgs)` exactly once and clears the pending state; a `schedule` while a timer is pending only updates the args (no extra timer). `cancel()` clears any pending timer without calling `fn` (design D1, D4)
- [x] 1.2 `ms` from `IRIS_ACTIVITY_EMIT_INTERVAL_MS` is resolved by the caller (`main.mjs`), not the helper — the helper takes a plain number so it is trivially testable

## 2. Test — `electron/coalesce.test.mjs` (new, Vitest fake timers)

- [x] 2.1 Burst coalesces: many `schedule` calls inside one interval → `fn` called once on the trailing edge with the LAST args
- [x] 2.2 Successive intervals: `schedule`, advance past interval (fires), `schedule` again, advance again → `fn` called twice
- [x] 2.3 `cancel()` before the trailing edge → `fn` never called; a later `schedule` still works
- [x] 2.4 `npm test` green

## 3. Wire into `pushActivity` — `electron/main.mjs`

- [x] 3.1 Keep `run.activity.push(...)`, the 80-line cap, and `runQueue.heartbeat()` per-line and synchronous — do NOT move them behind the throttle (design D2; `heartbeat()` is the idle-watchdog progress signal)
- [x] 3.2 Create one module-level trailing throttle (single global slot ⇒ one live run) with `ms = IRIS_ACTIVITY_EMIT_INTERVAL_MS` (default 150); replace the direct `emitEvent(toUpdateEvent(run, RUNNING, { output: run.activity.join("\n") }))` in `pushActivity` with `throttle.schedule(run)`, where the throttle's `fn` reads the run's current buffer and emits (design D1)
- [x] 3.3 Do NOT touch the `tool_start`/`tool_end` phase emits (`main.mjs:1125,1136`) — the step timeline stays realtime (design scope; `task-step-timeline` realtime requirement)

## 4. Cancel-on-terminal — `electron/main.mjs`

- [x] 4.1 In `onFinalized` (`main.mjs:242`), call `throttle.cancel()` so a pending trailing activity emit cannot fire after `finalize` emitted the run's real result (design D3). Place it so it runs for the finalized run regardless of the `started_at` gate
- [x] 4.2 Confirm the terminal `claude_task_update` (real result) is the last update the renderer sees for that run — no later `running` emit

## 5. Config + docs

- [x] 5.1 Document `IRIS_ACTIVITY_EMIT_INTERVAL_MS` (default 150) in `.env.example` with a one-line note (activity-log emit coalescing interval; does not affect the step timeline or the idle watchdog)

## 6. Verification (manual — `main.mjs` wiring is out of the Vitest harness)

- [x] 6.1 `npm run build` passes; `npm test` passes (incl. the new `coalesce.test.mjs`)
- [ ] 6.2 Run a chatty DEV task; with a temporary render counter / React DevTools Profiler, confirm App re-renders at ~emit rate (≤~7/s), not per activity line — and that `sendUiContext` IPC and `onUiAction` re-registration no longer fire per line
- [ ] 6.3 The activity log still scrolls live in the reader (deck AND HUD); the per-step timeline still ticks in realtime (tool calls appear immediately, not batched at 150 ms)
- [ ] 6.4 On completion, the card shows the run's REAL result, never the activity log — including a fast run that finishes right after a burst of activity (the D3 regression case)
- [ ] 6.5 A long, steadily-chatty DEV run is NOT killed by the idle watchdog (heartbeat still per-line)

## 7. Spec and record

- [x] 7.1 `openspec validate coalesce-activity-updates` passes
- [x] 7.2 Re-read the `task-step-timeline` ADDED requirement against the landed code: activity coalesces, step timeline stays realtime, no post-terminal activity emit, idle progress unaffected — all true
- [ ] 7.3 One commit on `develop` (BUG H is a single bug: source-side emit coalescing). Co-Authored-By trailer
- [x] 7.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG H done; note it is a source-side trailing-throttle of `pushActivity`'s emit only (heartbeat + buffer stay per-line; step timeline untouched; pending emit cancelled at terminal), with a new pure `electron/coalesce.mjs` + Vitest coverage, and one ADDED `task-step-timeline` requirement pinning the timing contract. Note this closes the Wave 1 render-path items; the "other renderer items" table (ReactorCore allocations, AudioWorklet, window.confirm) remains
