## Context

`pushActivity` (`electron/main.mjs:1107-1114`) is called for every DEV NDJSON activity line (`main.mjs:1154, 1670`) and every PO progress note. Its body does four things per line:

```js
run.activity.push(clean … slice(0,220));          // (a) buffer append
if (run.activity.length > 80) run.activity.splice… // (b) 80-line cap
emitEvent(toUpdateEvent(run, RUNNING,
  { output: run.activity.join("\n") }));           // (c) ≤17 KB IPC emit → renderer cascade
runQueue.heartbeat();                              // (d) idle-watchdog progress signal
```

(a), (b), (d) are cheap and in-process. Only (c) is expensive: it ships the whole joined buffer over IPC and, because the renderer has no memoization, cascades into a full-tree re-render plus the `sendUiContext` round-trip and the `onUiAction` listener re-registration (proposal (1)–(4)). The activity stream is the highest-frequency source of tasks-array identity churn.

The step timeline is a **separate** emit path — `tool_start`/`tool_end` phase updates at `main.mjs:1125,1136`, each a small payload, each keyed by Claude's own tool id. `task-step-timeline` requires those to update in realtime.

`runQueue.finalize` (`run-queue.mjs:227`) is the single funnel for the terminal `claude_task_update`; its `output` is the run's **real result**, not the activity buffer (this distinction is the whole point of the just-landed `show-real-result-not-activity-log`). `onFinalized` (`main.mjs:242`) fires once per run that reached the slot, after that terminal emit.

## Goals / Non-Goals

**Goals:**

- One renderer emit per ~150 ms of activity instead of one per line, coalescing bursts — removing the dominant tasks-identity churn and, with it, the `sendUiContext` and `onUiAction` per-line cascades.
- Zero behavior change to: the step timeline (stays realtime), the terminal result (never clobbered), and the idle watchdog (unchanged liveness cadence).
- No IPC-protocol change, no renderer/reducer change.
- Automated coverage for the tricky scheduler behavior via a pure helper.

**Non-Goals:**

- A per-line *delta* protocol (rejected — see D1).
- `memo`-ing the App tree (a later hardening; this change removes the per-line *trigger*, the root cause).
- The plan's "other renderer items" (allocations, `AudioWorklet`, `window.confirm`).
- Changing the 80-line buffer cap or the 220-char per-line clamp.

## Decisions

### D1 — Trailing-throttle the emit at the source, not a delta protocol

**Chosen:** wrap only the `emitEvent(...)` in (c) with a trailing throttle keyed to the active run: the first line schedules an emit at `now + interval`; subsequent lines within the window update the payload but do not add emits; on the trailing edge the latest `run.activity.join("\n")` is emitted once. Interval `IRIS_ACTIVITY_EMIT_INTERVAL_MS`, default **150 ms** (perceptually realtime for a free-text log; well under any human-noticeable lag and orders of magnitude under the 30-min idle bound).

*Per-line delta considered and rejected:* sending only the new line would require the renderer reducer to **append** rather than replace, moving the 80-line cap and the join across the IPC boundary and reopening `resolveMergedString`'s merge semantics that BUG D and `show-real-result-not-activity-log` just tuned. Trailing-throttle stays entirely in `main.mjs`, changes no contract, and additionally coalesces a burst (50 lines in 10 ms → 1 emit) that a delta would not.

### D2 — Keep buffer append, cap, and `heartbeat()` per-line; throttle only the emit

**Chosen:** (a), (b), (d) run on every call, synchronously, exactly as today; only (c) is deferred through the throttle. `heartbeat()` in particular MUST stay per-line: it is the run's idle progress signal to the watchdog (`run-execution-queue` "Slot is bounded by idle time" / `add-run-idle-watchdog`). If the emit's throttle also gated the heartbeat, a run emitting steadily but slower than the throttle would still be fine (150 ms ≪ 30 min), but coupling them is needless risk — the heartbeat is free and belongs on the raw line rate. The activity buffer must also stay current per-line so the trailing emit ships the *latest* buffer.

### D3 — Cancel the pending emit at terminal so it cannot clobber the result

**Chosen:** discard any pending trailing emit for a run when it finalizes. `finalize` emits the real result (`run-queue.mjs:227`), then `onFinalized` (`main.mjs:242`) runs synchronously in the same tick; a still-pending `setTimeout` is a future macrotask, so cancelling it in `onFinalized` deterministically prevents a stale activity emit from arriving *after* the terminal update and reverting `output` to the activity log (which would regress `task-step-timeline` "shows the run's result, never the activity log").

Because there is a single global execution slot, at most one run's activity throttle is ever live, so a single module-level throttle handle (cancelled on finalize and on the next run's first line) is sufficient. `onFinalized` is gated on `started_at` (BUG A'), but only a run that started could have pushed activity and armed a timer, so the gate never hides a live timer; to be defensive the cancel is placed so it always runs for the finalized run.

### D4 — Extract the scheduler as a pure, testable helper

**Chosen:** put the trailing-throttle in `electron/coalesce.mjs` — `createTrailingThrottle(fn, ms)` returning `{ schedule(...args), cancel() }`, where `schedule` remembers the latest args and ensures exactly one `fn(latestArgs)` fires per trailing edge, and `cancel()` drops any pending fire. `main.mjs` owns the payload (`() => emitEvent(toUpdateEvent(run, RUNNING, { output: run.activity.join("\n") }))`) and calls `schedule`/`cancel`; the helper owns only the timing. This isolates the two behaviors worth testing — burst coalescing and cancel-before-fire — into a module the Vitest harness already covers with fake timers (like `run-queue.mjs`). `main.mjs`'s wiring stays out of the harness (Wave 0.0 D5) and is verified manually.

## Risks / Trade-offs

**A stale activity emit clobbers the real result** → the highest-risk regression; D3 addresses it directly and it is a named verification step. The failure mode is specifically visible (a completed card shows a wall of tool-call text instead of the answer), so it is easy to catch manually.

**The last activity line before a fast finish is dropped** → intended and harmless: the terminal update replaces `output` with the real result anyway, so an un-emitted final progress frame changes nothing the user sees. `task-step-timeline` "shows the run's result, never the activity log" is the governing behavior.

**Idle watchdog starves a slow-but-alive run** → prevented by D2 (heartbeat stays per-line, untouched). Verified by the coalescing-does-not-slow-progress scenario.

**Step timeline lags behind coalescing** → prevented by scope: only `pushActivity`'s free-text emit is throttled; the `tool_start`/`tool_end` emits (`main.mjs:1125,1136`) are untouched and stay realtime.

**150 ms feels laggy** → tunable via `IRIS_ACTIVITY_EMIT_INTERVAL_MS`; 150 ms is below the threshold at which a scrolling text log reads as non-live, and the step timeline (the structured progress users actually watch) is unthrottled.
