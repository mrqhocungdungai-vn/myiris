## Context

Two shutdown/orphan defects remain after I.1 (idle watchdog) and I.2 (PO cancellation):

- **Spawn (`main.mjs:1588`)** creates the DEV `claude -p` child with `{ cwd, stdio, env }` — no `detached`. On POSIX the child shares the parent's process group, so `claude`'s own tool subprocesses (bash under `bypassPermissions`, editors, MCP servers) are siblings we have no handle to. `killWithEscalation` (`run-queue.mjs:140-151`) does `run.child.kill("SIGTERM")` then `SIGKILL` — reaching only the direct child. Descendants orphan.
- **`before-quit` (`main.mjs:2772-2781`)** is synchronous: it calls `stopLive()` (an `async` function) without `await`, sends `SIGTERM` to each `run.child` via `runQueue.list()`, and calls `closeAllPoSessions()` (which fires `state.query.return()` — an async iterator teardown — without awaiting). It never calls `event.preventDefault()`, so Electron proceeds to exit immediately; the teardown promises are abandoned mid-flight.

The queue is deliberately transport-agnostic (it received `startRun` and, since I.2, `cancelRun` by injection). It does hold `run.child` and call `.kill` directly today, but adding process-group and platform (`taskkill`) knowledge to it would break that separation. `po-session.mjs` already owns PO teardown (`closePoSession` → `endReason`, `channel.close()`, `query.return()`); it just doesn't expose the teardown promise.

`po-live-session`'s living spec already promises a clean shutdown (`spec.md:39-42`), so I.4 is drift against an existing requirement — the fix makes code conform; no edit to that spec is needed. Nothing in the specs describes the *orchestration* of quit (ordering, deadline, re-entrancy) or process-group termination — those are new.

## Goals / Non-Goals

**Goals:**

- Terminating a run (stop, escalation, or shutdown) terminates the run's whole subprocess tree — no orphaned tool subprocesses.
- Quit blocks until Gemini + DEV children + PO sessions are torn down, or a hard deadline elapses; then force-exits. The teardown runs once.
- `run-queue.mjs` stays free of process-group/platform knowledge (kept behind an injected hook, like `startRun`/`cancelRun`).
- The queue's kill escalation stays unit-tested via the injected hook.

**Non-Goals:**

- DEV/queued stop semantics, PO cancellation (I.2), the idle watchdog (I.1).
- Reaching the PO SDK's own subprocess via process-group kill — PO teardown goes through `query.return()` (the SDK owns that subprocess); shutdown awaits it. Process-group kill is the DEV-subprocess mechanism.
- The `handleSidecarEvent` stale-closure comment (rides a later change).

## Decisions

### D1 — Inject a `killChild(child, signal)` hook into the queue

**Chosen:** `createRunQueue({ startRun, cancelRun, killChild, emit, onFinalized, idleTimeoutMs })` gains `killChild`, defaulting to `(child, signal) => child.kill(signal)` (today's behavior when omitted). `killWithEscalation` calls `killChild(run.child, "SIGTERM")`, then `killChild(run.child, "SIGKILL")` after `STOP_GRACE_MS`. `main.mjs` supplies a group-aware implementation. This mirrors the I.2 `cancelRun` precedent exactly and keeps platform/process-group logic where the spawn lives, so the two stay in sync (a negative-pid kill is only valid because the spawn set `detached`).

*Considered:* extending `killWithEscalation` in-place with `process.kill(-pid, sig)`. Rejected — it couples the queue to POSIX semantics and to the spawn's `detached` flag across two files, and needs a Windows branch (`taskkill`) that has no business in the queue.

### D2 — Spawn detached; kill the group, cross-platform

**Chosen:**
- **Spawn:** add `detached: true` to the DEV `spawn` (`main.mjs:1588`). We do **not** `unref()` — the parent keeps managing the child (stdio pipes, `close` handler). On POSIX `detached` makes the child a process-group leader (pgid = pid), so its tool subprocesses join that group.
- **`killChild`:** on POSIX, `process.kill(-child.pid, signal)` signals the whole group (guarded in try/catch — the group may already be gone, and a bare `child.kill(signal)` is the fallback if `pid` is unavailable). On Windows, `detached` groups don't take POSIX signals, so kill the tree with `spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"])` (`/T` = tree, `/F` = force); `signal` is advisory there.

### D3 — Bounded, awaited, once-only `before-quit`

**Chosen:** rewrite `before-quit` as:

```js
let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;          // re-entrant guard (D3)
  shuttingDown = true;
  event.preventDefault();            // don't exit yet
  const deadline = new Promise((r) => setTimeout(r, shutdownDeadlineMs()).unref?.());
  Promise.race([shutdownTeardown(), deadline]).finally(() => app.exit(0));
});
```

`shutdownTeardown()` awaits `stopLive()`, then group-kills every live DEV child via `killChild` over `runQueue.list()`, then `await closeAllPoSessions()`. `app.exit(0)` bypasses `before-quit` entirely (no second event to guard, but the flag covers a platform that re-emits before `exit`). The deadline is `IRIS_SHUTDOWN_DEADLINE_MS` (default **8000ms** — comfortably above a SIGTERM→SIGKILL grace of 5000ms plus SDK `query.return()` settle, while never wedging quit).

### D4 — `closePoSession`/`closeAllPoSessions` return the teardown promise

**Chosen:** `closePoSession` returns `state.query?.return?.()` (a promise or undefined); `closeAllPoSessions` returns `Promise.all([...].map(closePoSession))`. Existing fire-and-forget callers (reset, workstream switch) ignore the return value — unaffected. Shutdown now `await`s it. `endReason` is still set to `{ kind: "teardown" }` before `channel.close()` (ordering unchanged — see po-session design D2).

## Risks / Trade-offs

**`process.kill(-pid)` throws if the group is already gone** → wrapped in try/catch (the escalation path already tolerates a dead child); the `close` handler / finalize once-guard still governs the terminal transition.

**Windows `taskkill` is a subprocess, not synchronous** → shutdown awaits it like any teardown; the hard deadline bounds it. On failure the process still force-exits at the deadline.

**`detached` without `unref` still lets the parent exit** → correct: we want the parent to manage the child while alive and to kill its group on stop/quit; `unref` would only matter if we wanted the child to outlive the parent, which is the opposite of the goal.

**Deadline too short kills a slow-but-legitimate teardown** → 8s is generous for `query.return()` + a SIGTERM/SIGKILL cycle; it is only a backstop for a *stuck* teardown, and it is env-configurable.

**Coverage** → `run-queue.mjs`'s escalation is unit-tested by injecting a fake `killChild` and asserting SIGTERM-then-SIGKILL (updating the existing escalation test to spy on the injection instead of `run.child.kill`). The platform `killChild`, `detached` spawn, and `before-quit` orchestration are outside the harness (real subprocesses / Electron app lifecycle) and verified manually: start a DEV run that spawns a child shell, stop it, and confirm via `ps` that no descendant survives; quit the app mid-run and mid-PO-turn and confirm no orphaned `claude`/tool process remains and the app still exits promptly.
