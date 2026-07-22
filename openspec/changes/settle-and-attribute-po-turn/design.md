## Context

`electron/po-session.mjs` runs the PO turn as `pump(state)` iterating the SDK query with `for await`. The turn promise (`state.currentTurn`, resolved/rejected in `deliverPoTurn`) is settled in exactly one place — the `catch` block:

```js
async function pump(state) {
  try {
    for await (const message of state.query) { routeMessage(state, message); }
  } catch (error) {
    if (state.currentTurn) { state.currentTurn.reject(error); state.currentTurn = null; }
    state.error = error;
  } finally {
    state.ended = true;                 // normal-exit path: currentTurn never settles
  }
}
```

`closePoSession` calls `state.channel.close()` then `state.query?.return?.()`. Closing the channel makes the async iterable return `done`, so `for await` exits **normally** — no throw, `catch` skipped, the turn hangs. The identical ending occurs when the `claude` subprocess dies quietly or the stream stops emitting without a `result` message. `main.mjs:1613-1614` finalizes the run only from that promise's `.then`/`.catch`, so a hung promise means `runQueue.finalize` is never reached and the single execution slot is held until restart.

`add-run-idle-watchdog` (Wave 0.1) now bounds this to `IRIS_RUN_IDLE_TIMEOUT_MS` (30 min), but the bound is a backstop, not a fix: the slot is still dead for up to 30 minutes, and the watchdog attributes the end as a timeout `error` even when the user deliberately tore the session down. This change settles the turn at its real end with the real reason.

`add-test-harness-and-po-seam` (Wave 0.0) made the SDK `query` an injected parameter of `getOrCreatePoSession`, so `pump`'s settlement is now testable with a fake async generator, no subprocess and no Electron.

## Goals / Non-Goals

**Goals:**

- A PO turn always settles — normal end, teardown, or throw — so the slot is never held by an unsettled promise (BUG A).
- The settlement carries *why* it ended, so a deliberate reset (`cancelled`) is distinguishable from a silent fault (`error`) everywhere downstream (BUG A, reason tag).
- The completion announcement is spoken only for runs that ran, and never reads a user-cancelled run aloud as a returned result — while a faulted run stays loud (BUG A').
- All of it covered by fast tests using the Wave 0.0 seam.

**Non-Goals:**

- The idle watchdog (Wave 0.1). This change settles the turn *inside* that bound; it does not touch the timer or its escalation.
- BUG J — `abandon`'s default-answer-then-teardown race (`main.mjs:159-162`). Same category (attribute the reason correctly at teardown), one layer down, its own change.
- BUG B — draining the offline announcement buffer. A' changes *what* is announced, not *whether the buffer is drained*.
- BUG K — the queued-cancel spec/code contradiction. Still tracked; A' actually leans on today's queued-cancel behavior (never-started ⇒ no announcement) as the precedent it generalizes.

## Decisions

### D1 — Settle in `finally`, not `catch`; reject on every non-result ending

**Chosen:** move the settlement into `finally` so the single normal-exit path also settles the turn:

```js
} catch (error) {
  state.error = error;
} finally {
  state.ended = true;
  const turn = state.currentTurn;
  state.currentTurn = null;
  turn?.reject(state.error || new Error(state.endReason?.message || "PO session ended before the turn completed"));
}
```

A turn that produced its own `result` message has already been resolved by `routeMessage` and cleared `state.currentTurn`, so `turn?.reject` is a no-op for the healthy case — `finally` only settles turns that would otherwise hang. Reject (not resolve) is correct: reaching `finally` with `currentTurn` still set means the turn ended *without* producing a result, which is a failure of that turn regardless of cause. The **reason** (not resolve-vs-reject) is what distinguishes teardown from fault — see D2.

*Resolving with `{status:"failed"}` considered and rejected:* it moves the reason into a payload the `.then` at `main.mjs:1613` would have to inspect, duplicating the mapping the `.catch` already does; and it obscures that this is an abnormal end. Reject-with-reason keeps one settle path and one mapping site.

### D2 — Attribute the reason at teardown, map it to status at the settle site

**Chosen:** `closePoSession` stamps a teardown marker on the state **before** `state.channel.close()`:

```js
export function closePoSession(workstreamId) {
  const state = sessions.get(workstreamId);
  if (!state) return;
  sessions.delete(workstreamId);
  state.endReason = { kind: "teardown" };   // BEFORE close, so pump's finally sees it
  try { state.channel.close(); } catch {}
  try { state.query?.return?.(); } catch {}
}
```

The mapping lives at the one settle site in `main.mjs`, keyed off the reason the rejection carries:

- teardown marker present → `runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, ...)`
- anything else → `RUN_STATUS.ERROR` (unchanged from today's `.catch`)

Both statuses already exist and are already terminal (`run-queue.mjs`), so `finalize` accepts either and releases the slot identically. The marker must be set *before* `channel.close()` because closing the channel is what ends the stream and runs `finally`; setting it after would race the settlement.

*Ordering must be exact:* `closePoSession` sets `endReason` synchronously before any await, and `pump`'s `finally` reads it. There is no interleaving point between them because `channel.close()` only *schedules* the iterator's completion — `finally` runs on a later microtask, by which time `endReason` is already set.

### D3 — Gate the spoken announcement on `run.started_at`, in one place

**Chosen:** `onFinalized` (`main.mjs:227`) does not call `announceClaudeCompletion` for a run whose `started_at` is unset. This is the exact rule `run-queue.mjs:148-150` already applies to queued-cancel ("a queued run never started, so there is no announcement to make"); generalizing it to `onFinalized` covers every never-started path (including any future gate-reject) in one predicate instead of at each call site.

`started_at` is set in `beginRun` (the sole slot acquisition), so "started ⇔ held the slot ⇔ has a result worth speaking" is exactly the property we want.

### D4 — `cancelled` shows on the UI but is not read aloud; `error` stays loud

**Chosen:** `announceClaudeCompletion` always emits the `claude_completion` sidecar event (the UI card is correct for any terminal status), but branches the *voice* delivery on status: `cancelled` → no `notifyIris` (or a short distinct "run cancelled" note), everything else → the existing proactive-summary announcement.

This is why A' is not merely cosmetic on top of A: without it, A's teardown→`cancelled` tag would still be read aloud as "Claude is back with a result" — actively worse than today's silent hang. It also removes an existing wart unrelated to PO: stopping a DEV run currently announces a returned result for a run the user just killed.

*Discriminating inside the instruction text (telling Gemini "this was cancelled, be brief") considered and rejected:* `announceClaudeCompletion` already passes `status: ${status}` as prose and the model does not reliably change register from it — the plan's analysis of BUG A. Suppression at the source is deterministic; prompt-steering is not.

### D5 — Testing rests on the Wave 0.0 seam, not on Electron

**Chosen:** `electron/po-session.test.mjs` injects a fake async generator as `query` and asserts:

- deliver a turn, then close the session → the `deliverPoTurn` promise settles (rejects) rather than hanging — the BUG A regression, three lines as the plan predicted.
- after `closePoSession`, the rejection carries the teardown marker (so the main-side mapping would produce `cancelled`).
- a stream that ends on its own without a result → rejection with no teardown marker (so mapping produces `error`).

The reason→status mapping and the announcement gate live in `main.mjs`, which is permanently out of test scope (Wave 0.0 design D5). They are covered by the `run-queue.test.mjs` started_at behavior and by the manual verification in tasks — the same split the watchdog used.

## Risks / Trade-offs

**A resolved-then-`finally` double settle** → guarded by clearing `state.currentTurn` on resolve in `routeMessage` (already the case) and re-reading it into a local in `finally` before nulling; `turn?.reject` on an already-settled promise is a no-op anyway. Low risk, but asserted by the "healthy turn is unaffected" test.

**`endReason` leaking across turns** → the marker is set only by `closePoSession`, which also deletes the session from the map, so the state object is never reused for a later turn. A fresh session gets a fresh state with no marker. Worth an assertion that a normal turn on a fresh session maps to `error`, not `cancelled`.

**A' suppressing an announcement the user wanted** → only `cancelled` (user-initiated) is suppressed from voice; `error` and normal completion are unchanged. The UI card still appears for `cancelled`, so nothing is *hidden* — only not spoken. This matches the user's actual intent (they just stopped/reset it).

**Interaction with the watchdog's own `error` finalize** → if the watchdog fires first (turn genuinely silent, no teardown), it finalizes `error` and the later `finally` rejection hits the once-guard as a no-op. If teardown fires first, the turn settles `cancelled` and the watchdog's timer is cleared by `finalize`. Both orderings are safe because the slot is released in exactly one place; asserted by a test that a teardown after the watchdog window still yields one terminal event.

## Open Questions

- For a `cancelled` run, send *nothing* to voice, or a one-line "the previous run was cancelled" note? Leaning toward nothing (the user initiated it and already sees the card), but a one-liner may read as less abrupt if Iris was mid-sentence about that run. Deferred to implementation; either satisfies the spec ("not read aloud as a returned result").
