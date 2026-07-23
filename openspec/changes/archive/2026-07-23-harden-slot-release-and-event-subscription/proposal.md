## Why

Two latent lifecycle hazards remain — the Wave 2 tail. Both are **safe today only by convention**, not by structure; each turns into a silent, hard-to-trace defect the moment a future edit crosses the convention. Wave 2's stated goal is to make lifecycle bugs *impossible*, not merely absent, so both are closed with minimal, zero-observable-change hardening.

- **BUG I.5 — `finalize()` releases the slot for the wrong run.** `finalize()` (`run-queue.mjs:217-239`) runs its slot side-effects — `clearIdleTimer()`, resetting `idleSuspended`, and `dequeueNext()` (which unconditionally nulls `active` and starts the next queued run) — for **any** not-yet-finalized run. The once-guard (`if (!run || run.finalized) return`) only prevents re-finalizing the *same* run; it does not prevent a `finalize()` on a run that does **not** hold the slot from clearing the *active* run's idle watchdog and clobbering its slot (double-start). No path does this today — every `finalize()` caller targets the active run, and a queued-then-cancelled run is marked finalized directly (BUG K, `reconcile-queued-cancel`) rather than via `finalize()`. So the correctness rests on caller discipline. The plan noted I.5 as "already satisfied, no code needed"; the code audit refines that: it is satisfied *by convention*, and a one-line structural guard makes it hold regardless of caller.
- **`handleSidecarEvent` stale closure.** The sidecar subscription (`App.tsx:282`) is registered once under a `[hasBridge]` effect, so the callback captures the render-0 instance of `handleSidecarEvent` for the app's lifetime. It survives only because every branch touches state exclusively through setters and functional updaters (whose identities React keeps stable). The first branch that reads a value directly — `pendingPoQuestion`, `sortedTasks`, etc. — would silently read render-0's value forever. The plan calls for "at minimum a warning comment."

## What Changes

- **I.5 — guard the slot side-effects on slot ownership.** In `finalize()`, the run-record mutation (`finalized`/`status`/`output`/`finished_at`/`child`) and its terminal `emit` + `onFinalized` stay unconditional — the run still reaches terminal and announces. The slot side-effects (`clearIdleTimer()`, `idleSuspended = false`, `dequeueNext()`) become conditional on `active === runId`, so finalizing a run that does not hold the slot can never disarm the active run's watchdog or steal its slot. Behavior is identical for every existing caller (all finalize the active run); the guard only removes the latent footgun.
- **Stale closure — a latest-handler ref + comment.** Keep a ref pointing at the current `handleSidecarEvent`, refreshed every render; the registered subscription calls `handlerRef.current(event)` so it always dispatches through the newest closure. A comment documents why the subscription must not read state directly. No observable behavior change — the handler already only uses stable setters today.

*Not in scope:* any other Wave 2 item (all landed), the `run-queue` public interface, or renderer behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-execution-queue`: **one MODIFIED requirement** — "A run finalizes exactly once". Its "release the execution slot" clause is qualified: finalization SHALL release the slot, disarm the idle bound, and advance the queue **only for the run that currently holds the slot**; finalizing a run that does not hold the slot SHALL bring that run to terminal and emit its one terminal update, but SHALL NOT disturb the active run, its slot, or its idle bound. A new scenario covers this.

## Impact

- `electron/run-queue.mjs` — `finalize()` wraps `clearIdleTimer()` + `idleSuspended = false` + `dequeueNext()` in `if (active === runId)`; run-record mutation and emit/onFinalized unchanged.
- `electron/run-queue.test.mjs` — new case: `finalize()` on a non-active (never-slot-holding) run marks it terminal and emits once, but the active run keeps its slot and its idle timer, and no queued run starts.
- `src/App.tsx` — add a `handlerRef` for `handleSidecarEvent`, refresh it each render, dispatch the subscription through it; add the warning comment. No spec/behavior change for the renderer.
- `run-execution-queue` living spec — one MODIFIED requirement. No new dependency, no env var, no data migration, no IPC-surface change.
