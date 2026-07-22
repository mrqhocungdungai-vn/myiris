## Why

**BUG I.3 + I.4 — the app leaks live processes.** Two related lifecycle defects survive after the watchdog (I.1) and PO cancellation (I.2) landed:

- **I.3 — orphaned tool subprocesses.** `main.mjs:1588` spawns `claude -p` without `detached: true`, so the DEV subprocess is not a process-group leader. Under `bypassPermissions` that `claude` spawns its own tool subprocesses (bash, editors, MCP servers). When the queue terminates a run, `killWithEscalation` (`run-queue.mjs:145-147`) signals only the direct child — its descendants survive as orphans. This is a desktop-hygiene defect with a security flavor (leftover shells running with the user's privileges after Iris "stopped" the work).
- **I.4 — shutdown doesn't wait for teardown.** `before-quit` (`main.mjs:2772`) never calls `event.preventDefault()`, does not `await` the async `stopLive()`, and calls `closeAllPoSessions()` which only fires `query.return()` (async teardown) without awaiting it. The process can exit before any of this completes, orphaning the Gemini socket, DEV children, and the PO SDK subprocess. This is **drift**, not a gap: `po-live-session`'s living spec already requires "the session is closed without leaving an orphaned Claude process" on shutdown (`spec.md:39-42`) — the code simply doesn't honor it.

Both compound the single-global-slot design: a run that "ended" from Iris's point of view can still be consuming the machine.

## What Changes

Make process termination reach the whole tree, and make app shutdown block until teardown finishes (or a hard deadline).

- **I.3 — spawn detached, kill the group.** DEV runs spawn in their own process group (`detached: true` on POSIX). The queue's kill path is given an injected `killChild(child, signal)` (parallel to the existing `startRun`/`cancelRun` injections, keeping `run-queue.mjs` free of platform/process-group knowledge); `main.mjs` supplies a group-aware, cross-platform implementation (POSIX `process.kill(-pid, sig)`; Windows `taskkill /pid <pid> /T /F`). Terminating a run now terminates its descendant tool subprocesses too — no orphans.
- **I.4 — bounded, awaited shutdown.** `before-quit` calls `event.preventDefault()` on the first invocation (guarded against re-entry), then runs an async teardown that awaits `stopLive()`, the group-kill of every live DEV child, and `closeAllPoSessions()` — the whole sequence raced against a hard deadline (`IRIS_SHUTDOWN_DEADLINE_MS`, documented default). When teardown finishes (or the deadline elapses) it force-exits via `app.exit(0)`. `closePoSession`/`closeAllPoSessions` return the teardown promise so it can be awaited (callers that ignore it are unaffected).

*Not in scope:* changing DEV/queued stop semantics, PO cancellation (I.2, done), the idle watchdog (I.1, done), or the trivial `handleSidecarEvent` stale-closure comment (rides a later change).

## Capabilities

### New Capabilities

- `app-shutdown`: the app blocks quit until every live transport (Gemini socket, DEV subprocess groups, resident PO sessions) is torn down, bounded by a hard deadline after which it force-exits; the teardown runs once even if `before-quit` fires again.

### Modified Capabilities

- `run-execution-queue`: **one MODIFIED requirement** — "Stopping a run". The escalation clause currently signals only "its transport (SIGTERM for a subprocess)"; it is broadened so that signalling/killing a subprocess transport targets the run's whole **process group**, so descendant tool subprocesses are terminated too and never orphaned. The queue delegates the actual kill to an injected `killChild` hook so it stays transport-agnostic. Queued-stop, PO-cancel, and the idle bound are unchanged.

## Impact

- `electron/main.mjs` — add `detached: true` to the DEV `spawn` (POSIX); implement a cross-platform group-aware `killChild` and pass it to `createRunQueue`; rewrite `before-quit` to `preventDefault` + async bounded teardown + `app.exit(0)`.
- `electron/run-queue.mjs` — add optional `killChild` dep; `killWithEscalation` calls it instead of `run.child.kill` directly (default `(c, sig) => c.kill(sig)` preserves current behavior).
- `electron/po-session.mjs` — `closePoSession`/`closeAllPoSessions` return the `query.return()` promise so shutdown can await teardown; behavior otherwise unchanged.
- `electron/run-queue.test.mjs` — assert `killWithEscalation` uses the injected `killChild` (SIGTERM then SIGKILL after grace); existing escalation test updated to spy on the injection.
- `run-execution-queue` living spec — one MODIFIED requirement; new `app-shutdown` capability spec.
- New env var `IRIS_SHUTDOWN_DEADLINE_MS` (documented in `.env.example`). No new dependency, no data migration, no IPC-surface change.
