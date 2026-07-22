## Context

`stop(runId)` in `run-queue.mjs` (`:232-261`) has three branches: queued (remove + mark cancelled + finalized, no slot release), active-with-child (mark cancelled + `killWithEscalation`, slot freed on close), and active-without-child — the PO turn — which `return run.status` as a deliberate no-op (`:258-260`). The queue is transport-agnostic: it receives `startRun` by injection and never references PO sessions or subprocesses directly.

A PO turn's lifecycle lives in `po-session.mjs`. `deliverPoTurn` (`:228-248`) returns a promise stored on `state.currentTurn`; `pump` (`:136-163`) drives the SDK's `for await`, resolving the turn on a `result` message (`onResult`, `:118-132`) and, in its `finally`, rejecting any still-pending turn when the stream ends — carrying `error.poEndReason` when `state.endReason` was set. `closePoSession` (`:255-272`) sets `endReason = { kind: "teardown" }`, closes the channel (which ends `pump`'s `for await`), and calls `query.return()`. `startPoRun`'s settle chain (`main.mjs:1697-1707`) finalizes on the turn promise: resolve → `finalize(result.status, ...)`; reject with `poEndReason.kind === "teardown"` → `finalize(CANCELLED, ...)`; otherwise `finalize(ERROR, ...)`.

So the machinery to end a PO turn already exists and is proven (session reset uses it); what is missing is a *stop*-triggered path into it, and a queue hook to invoke it.

## Goals / Non-Goals

**Goals:**

- `stop()` cancels an active PO turn: the run reaches `cancelled`, the slot is released via the normal finalize path, and the turn does not run to completion.
- Cross-turn continuity is preserved — the next PO turn continues the same conversation.
- The queue stays transport-agnostic (no PO knowledge in `run-queue.mjs`).
- The run-queue behavior is unit-tested with an injected fake, like the rest of the queue.

**Non-Goals:**

- I.3 (`detached` + process-group kill) and I.4 (`before-quit` await/`preventDefault`) — the next change.
- An in-place `query.interrupt()` that keeps the resident session live without any teardown (a possible future optimization; see D3).
- Changing DEV stop, queued stop, escalation, or the idle watchdog.

## Decisions

### D1 — Inject a `cancelRun` dependency into the queue

**Chosen:** `createRunQueue({ startRun, cancelRun, emit, onFinalized, idleTimeoutMs })` gains `cancelRun`. In `stop()`, the active-no-child branch becomes symmetric with the DEV branch:

```js
// active run, no child (a PO turn)
run.status = RUN_STATUS.CANCELLED;
cancelRun?.(run);
return run.status;
```

It marks the run `cancelled` (so the settle path can key on it, exactly as the DEV `child.on("close")` does) and delegates the actual turn-ending to the injected `cancelRun`. Crucially, `stop()` does **not** call `finalize()` itself — the slot is released when the turn settles and `startPoRun` finalizes, mirroring how the DEV branch relies on `child.on("close")`. This preserves the invariant that only the finalize-on-termination path advances the slot, so there is no double-start. `cancelRun` is optional (`?.`) so the queue degrades to today's no-op if a caller omits it.

### D2 — `cancelPoTurn` ends the turn via the proven teardown path, keeping the stored id

**Chosen:** add `cancelPoTurn(state)` to `po-session.mjs` that does what `closePoSession` does — set `state.endReason`, close the channel, `query.return()` — but with `endReason = { kind: "cancelled" }`. This reliably settles the turn: closing the channel ends `pump`'s `for await`, whose `finally` rejects the pending turn with `poEndReason.kind === "cancelled"`. `main.mjs`'s `cancelRun(run)` looks up the workstream's session state and calls `cancelPoTurn`; `startPoRun`'s settle `.catch` is extended to treat `kind === "cancelled"` like `"teardown"` → `finalize(CANCELLED, "Run was stopped before completion.")`.

The on-disk `agent_sessions.po` id is **not** cleared by this path (it is only rewritten on an explicit reset / new session), so the next PO turn's `getOrCreatePoSession` resumes with `resume: <stored id>` — the conversation continues, only the cancelled turn's partial work is lost. This is the same continuity guarantee a reset-then-resume already provides.

*Considered:* reusing `closePoSession` verbatim with the `teardown` reason. Rejected only for message clarity — a stopped run should read "Run was stopped," not "session was reset"; the mechanism is identical, so `cancelPoTurn` can share the teardown body and differ only in `endReason.kind`.

### D3 — Teardown-and-resume now; in-place interrupt only if verified

**Chosen:** use teardown (D2) as the guaranteed mechanism rather than `state.query.interrupt()`. Teardown is proven (session reset relies on it) and deterministically settles the turn, so the slot frees promptly without depending on the watchdog. `query.interrupt()` — which would end just the current turn and keep the resident session live (no respawn next turn) — is attractive but unverified against the installed SDK here; adopting it would risk a turn that never settles (slot held until the watchdog fires). If a later change verifies `interrupt()` behavior, `cancelPoTurn` can prefer it and fall back to teardown. The spec is written to allow either (session "survives, or is torn down in a way that preserves continuity").

## Risks / Trade-offs

**A cancelled turn's SDK query keeps running after teardown** → `query.return()` is the SDK's async-iterator termination, the same call `closePoSession` uses at shutdown/reset; it is the intended stop. If the subprocess lingers regardless, that is the orphan-hygiene concern handled by I.3 (next change), not this one; the idle watchdog also remains a backstop.

**Next PO turn pays a respawn/resume cost** → one resume from the stored session id, transparent to the user and identical to post-reset behavior; the alternative (uncancellable turn) is far worse.

**Double finalize** → prevented by `finalize`'s once-guard (`:216`); `stop()` marks `cancelled` but never finalizes, and only the settle path finalizes.

**Wrong terminal status** → the settle `.catch` maps the `cancelled` reason explicitly to `CANCELLED`; a turn that happens to emit a `result` before teardown resolves it normally (also terminal), and the once-guard makes the first finalize win.

**Coverage** → `run-queue.mjs` is in the Vitest harness (no refactor needed — `cancelRun` is just another injected dep). New cases assert the PO-stop path calls `cancelRun`, marks `cancelled`, does not itself release the slot, and that the slot frees only when the fake transport finalizes. The `po-session.mjs`/`main.mjs` wiring (real SDK) is verified manually: start a long PO turn, hit stop, confirm the run goes `cancelled` and the slot frees, then a follow-up PO turn continues the conversation.
