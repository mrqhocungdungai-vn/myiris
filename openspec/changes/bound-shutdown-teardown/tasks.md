## 1. Queue — injected `killChild` (`run-queue.mjs`)

- [x] 1.1 Add `killChild` to `createRunQueue({ startRun, cancelRun, killChild, emit, onFinalized, idleTimeoutMs })`, default `(child, signal) => child.kill(signal)`; document it in the deps JSDoc (parallel to `cancelRun`; platform/process-group logic lives in the caller, not here) (design D1)
- [x] 1.2 In `killWithEscalation`, replace `run.child.kill("SIGTERM")` with `killChild(run.child, "SIGTERM")` and the grace-timer `run.child?.kill("SIGKILL")` with `killChild(run.child, "SIGKILL")` — no other change to the escalation/finalize flow (design D1)
- [x] 1.3 Leave the queued-stop branch, the PO `cancelRun` branch (I.2), the idle watchdog, and the finalize once-guard untouched

## 2. PO teardown returns its promise (`po-session.mjs`)

- [x] 2.1 `closePoSession(workstreamId)` returns the `state.query?.return?.()` value (a promise or `undefined`); keep `endReason = { kind: "teardown" }` set BEFORE `channel.close()` (ordering unchanged) and keep both wrapped in try/catch (design D4)
- [x] 2.2 `closeAllPoSessions()` returns `Promise.all([...sessions.keys()].map(closePoSession))` so shutdown can await every session's teardown; fire-and-forget callers (reset, workstream switch) ignore the return value — confirm they still compile and behave identically (design D4)

## 3. Detached spawn + cross-platform `killChild` (`main.mjs`)

- [x] 3.1 Add `detached: true` to the DEV `spawn(claudeBinary(), args, { cwd, stdio, env })` (`:1588`); do NOT `unref()` — the parent keeps managing the child (design D2)
- [x] 3.2 Implement a module-level group-aware `killChild(child, signal)`: POSIX → `process.kill(-child.pid, signal)` in try/catch with a `child.kill(signal)` fallback when `pid` is missing; Windows (`process.platform === "win32"`) → `spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"])` (`signal` advisory) (design D2)
- [x] 3.3 Pass `killChild` to `createRunQueue(...)` alongside `startRun`/`cancelRun`

## 4. Bounded, awaited, once-only shutdown (`main.mjs`)

- [x] 4.1 Add a `shutdownDeadlineMs()` reader for `IRIS_SHUTDOWN_DEADLINE_MS` (default 8000) following the existing `IRIS_*` env-budget pattern (design D3)
- [x] 4.2 Add an `async shutdownTeardown()`: `await stopLive()`; group-kill every live DEV child via `killChild` over `runQueue.list()` (only runs with a `child`); `await closeAllPoSessions()` (design D3)
- [x] 4.3 Rewrite the `before-quit` handler: a module-level `shuttingDown` guard (return if already set), `event.preventDefault()`, set the guard, then `Promise.race([shutdownTeardown(), <deadline>]).finally(() => app.exit(0))` — deadline timer `unref()`'d (design D3)
- [x] 4.4 Confirm `will-quit`'s `globalShortcut.unregisterAll()` still runs (unaffected) and no other quit path regresses

## 5. Tests (`run-queue.test.mjs` — in the Vitest harness)

- [x] 5.1 Update the existing SIGTERM→SIGKILL escalation test to inject a fake `killChild` and assert it is called `(child, "SIGTERM")` then `(child, "SIGKILL")` after the grace period (was spying on `run.child.kill`)
- [x] 5.2 Assert `killChild` defaults to `child.kill` when the dep is omitted (back-compat), so a queue built without the hook still terminates the child
- [x] 5.3 `npm test` green

## 6. Verification (manual — spawn/platform/Electron are out of the harness)

- [x] 6.1 Start a DEV run whose task spawns a child shell (e.g. a long `sleep`); `stop` it; confirm via `ps`/Activity Monitor that neither `claude` nor its descendant shell survives (no orphan)
- [x] 6.2 Quit the app while a DEV run is active and a PO turn is resident; confirm the app exits promptly and no orphaned `claude`/tool process remains afterward
- [x] 6.3 Set `IRIS_SHUTDOWN_DEADLINE_MS` low and simulate a stuck teardown (or reason through it): the app still force-exits at the deadline rather than hanging
- [x] 6.4 `npm run build` passes; `npm run package:mac` still launches (detached spawn + taskkill guard don't break packaging)
- [x] 6.5 Sanity on Windows if available (or note as untested): `taskkill /T /F` path terminates the tree

## 7. Spec and record

- [x] 7.1 `openspec validate bound-shutdown-teardown` passes
- [x] 7.2 Re-read the MODIFIED `run-execution-queue` "Stopping a run": the group-kill clause and DEV/escalation scenarios now describe process-group termination via the injected hook; queued-stop, PO-cancel, and the idle bound are unchanged and still true. Confirm `po-live-session`'s shutdown scenario (`spec.md:39-42`) is now honored by code (drift resolved, no spec edit)
- [x] 7.3 Add `IRIS_SHUTDOWN_DEADLINE_MS` to `.env.example` with a one-line comment
- [ ] 7.4 Two commits on `develop`: (a) I.3 — detached spawn + group-aware `killChild` + queue injection + tests; (b) I.4 — bounded awaited `before-quit` + `closeAllPoSessions` returning its promise. Do NOT squash. Co-Authored-By trailer
- [x] 7.5 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG I.3 and I.4 done; note the queue's new `killChild` injection, the detached/group-kill mechanism, the bounded `before-quit`, and the new `app-shutdown` capability + MODIFIED run-execution-queue requirement. Note the only remaining Wave 2 tail: I.5 (finalize idempotent for a non-active run — already satisfied by the finalize once-guard; verify and close) and the trivial `handleSidecarEvent` stale-closure comment
