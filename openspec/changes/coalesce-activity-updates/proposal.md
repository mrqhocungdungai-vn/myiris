## Why

**BUG H — `pushActivity` re-sends the whole ~17 KB activity buffer on every activity line.** `pushActivity` (`electron/main.mjs:1107-1114`) keeps a rolling buffer capped at 80 lines × ≤221 chars (`:1110-1111`) ≈ **17.7 KB**, and on **each new line** emits `toUpdateEvent(run, RUNNING, { output: run.activity.join("\n") })` — the entire joined buffer, every line. A subprocess that dumps stdout fast fires this many times a second, each time carrying the whole buffer over IPC.

The renderer folds each such `claude_task_update` into the tasks array (`src/App.tsx:650-683`), replacing `output` and producing a **new task object** → a new `sortedTasks` identity (`App.tsx:939`). App has no `memo` anywhere, so each emit cascades into:

1. A full-tree re-render (`CenterStage → ReactorCore → <Canvas>`, Work Stream + up to 20 cards, Comms, HudShell).
2. The `sendUiContext` effect (`App.tsx:982-1017`, deps include `sortedTasks`) → an IPC call **back up to main** serializing all 20 tasks — per activity line.
3. The `onUiAction` effect (`App.tsx:1024-1075`, deps include `tasks, sortedTasks`) → tears down and re-registers the `iris:ui-action` IPC listener (`preload.cjs`) — per activity line.
4. `useHandoffFx` (`src/hooks/useHandoffFx.ts`) rebuilds its per-task state `Map`.

All four are triggered by the tasks array changing identity, and the activity stream changes it the most often. Fixing the source — the emit rate — collapses (2) and (3) with it, because both fire only when `tasks`/`sortedTasks` change identity.

Note (from the plan): re-sorting 20 cards (`App.tsx:939-947`) is microseconds — **not** the cost; do not touch it.

## What Changes

Coalesce the activity emit at its source in `pushActivity`, entirely inside `electron/main.mjs`. No IPC-protocol change, no renderer change, no reducer change (the merge semantics `resolveMergedString` were just tuned by BUG D and `show-real-result-not-activity-log` — do not reopen them).

- **Throttle only the `emitEvent(...)` call** (the ≤17 KB IPC + renderer cascade) with a **trailing throttle** (~150 ms, `IRIS_ACTIVITY_EMIT_INTERVAL_MS`): a burst of activity lines produces at most one emit per interval instead of one per line, always emitting the latest buffer on the trailing edge. Chosen over a per-line *delta* protocol because delta would move the 80-line cap and the append/merge logic across the IPC boundary and reopen the reducer's merge semantics; trailing-throttle stays at the source and changes no contract.
- **Keep `run.activity.push(...)`, the 80-line cap, and `runQueue.heartbeat()` per-line and synchronous** — they are cheap (no IPC) and, critically, `heartbeat()` is the run's idle progress signal to the execution-slot watchdog (`run-execution-queue` "Slot is bounded by idle time"). Throttling it would slow the liveness signal; it must fire on every line exactly as today.
- **Do not throttle the step-timeline emits** (`tool_start`/`tool_end` phase updates at `main.mjs:1125,1136`). `task-step-timeline` requires the step timeline to update "in realtime"; only the free-text activity `output` is coalesced.
- **Cancel any pending trailing emit when the run reaches a terminal status.** `runQueue.finalize` emits the run's *real result* as the terminal `claude_task_update` (`run-queue.mjs:227`); a throttled activity emit firing *after* that would overwrite the result with the activity log — a direct regression against `task-step-timeline` "A completed card shows the run's result, never the activity log" (just landed via `show-real-result-not-activity-log`). The pending timer is discarded in the `onFinalized` path (`main.mjs:242`), which fires once per started run and shares the single global slot.
- **Extract the trailing-throttle scheduler as a small pure helper** (`electron/coalesce.mjs`) so its two tricky behaviors — burst coalescing and cancel-before-fire — carry Vitest fake-timer coverage, like `run-queue.mjs`. The `main.mjs` wiring itself stays out of the harness (Wave 0.0 D5); verified manually.

Not in scope (the plan's "other renderer items" table — separate follow-ons): `ReactorCore` per-frame `THREE.Color`/`Vector3` allocations, the `ScriptProcessorNode`→`AudioWorklet` migration, and the `window.confirm` main-thread block.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-step-timeline`: **one ADDED requirement** pinning the activity-emission timing contract this change introduces — the free-text activity log MAY be rate-bounded/coalesced, but doing so SHALL NOT delay the step timeline, SHALL NOT let a coalesced emit land after the terminal update (which would clobber the real result), and SHALL NOT reduce the run's idle progress signal to the slot watchdog. This is a genuinely new observable concern (a delivery-timing contract), not a change to any existing requirement's behavior — hence ADDED, not MODIFIED. It hardens three subtle invariants a future maintainer could easily break (throttle the wrong emit, drop the cancel-on-terminal, or throttle the heartbeat).

The fix is otherwise drift-free: it violates no existing requirement. `run-execution-queue` (status vocabulary `running` for activity; slot bounded by idle progress) and `glass-hud-mode` (HUD cards get realtime updates) all stay true — the source-side throttle is transport-symmetric (deck and HUD get the identical coalesced stream) and preserves the `running` status semantics.

## Impact

- `electron/main.mjs` — `pushActivity` (`1107-1114`): keep buffer push + cap + `heartbeat()` per-line; route the `emitEvent` through a trailing throttle. `onFinalized` (`242`): cancel the pending activity emit for the finalized run.
- `electron/coalesce.mjs` — **new** small pure module: `createTrailingThrottle(fn, ms)` with `{ schedule, cancel }` (or equivalent). Unit-tested.
- `electron/coalesce.test.mjs` — **new** Vitest fake-timer test: burst coalesces to one trailing call; `cancel()` before the trailing edge suppresses the call.
- `.env.example` — document `IRIS_ACTIVITY_EMIT_INTERVAL_MS` (default 150).
- `task-step-timeline` living spec — one ADDED requirement (activity-emission timing contract).
- No new dependency, no data migration. Renderer untouched.
