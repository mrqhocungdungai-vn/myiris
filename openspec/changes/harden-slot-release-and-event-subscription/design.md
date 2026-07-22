## Context

The Wave 2 lifecycle-hardening pass is complete except two latent hazards that are safe today only by convention.

**I.5 — `finalize()` and slot ownership.** `finalize(runId, status, output)` (`run-queue.mjs:217-239`): the once-guard `if (!run || run.finalized) return` (`:225`) prevents re-finalizing the *same* run. Everything after runs for any first-time finalize: it mutates the run record, then `clearIdleTimer()` (`:234`), `idleSuspended = false` (`:235`), `emit(...)` (`:236`), `onFinalized?.(run)` (`:237`), `dequeueNext()` (`:238`). `dequeueNext()` (`:185`) unconditionally sets `active = null` and starts the next queued run. The idle timer is slot-owned (armed in `beginRun`, cleared here). So a `finalize()` on a run that is *not* the slot-holder would (a) clear the active run's watchdog and (b) null `active` and start a queued run while the real active run is still executing — a silent double-start. Audit of all callers — DEV `child.on("close"/"error")`, `killWithEscalation`'s grace timer, `onIdleExpiry`, `startPoRun`'s settle, and the synchronous start-time gates inside `startRun` — shows every one targets the active run, and a queued run cancelled via `stop()` is marked finalized directly (BUG K) rather than through `finalize()`. So no path triggers the hazard today; the safety is caller discipline, not structure.

**Stale closure.** `App.tsx:271-283`: a `[hasBridge]` effect subscribes `window.iris.onSidecarEvent((event) => handleSidecarEvent(event))` once. `handleSidecarEvent` (`:612`) is a fresh closure each render, but the subscription keeps the render-0 instance for the app's lifetime. It only touches state through setters and functional updaters (stable identities), so it works — but any future branch that reads a state value directly reads render-0's snapshot forever.

## Goals / Non-Goals

**Goals:**

- Make "finalize only affects the slot of the run that holds it" structural, with zero observable change for existing callers.
- Make the sidecar subscription always dispatch through the current handler closure, so future state reads are correct by construction; document the constraint.

**Non-Goals:**

- Changing the queue's public interface, DEV/PO/queued stop semantics, the idle bound, or any renderer behavior.
- Refactoring `handleSidecarEvent` itself or its branches.

## Decisions

### D1 — Guard the slot side-effects on slot ownership

**Chosen:** in `finalize()`, keep the terminal transition unconditional (record mutation + `emit` + `onFinalized` — the run always reaches terminal and announces), and gate only the slot side-effects:

```js
run.finalized = true;
run.status = status;
run.output = output;
run.finished_at = Date.now() / 1000;
run.child = null;
emit(toUpdateEvent(run, status, { output }));
onFinalized?.(run);
if (active === runId) {
  // Slot side-effects belong to the run that holds the slot. Guarding them
  // means a finalize targeting any other run can never disarm the active
  // run's watchdog or steal its slot (double-start). No caller finalizes a
  // non-slot run today; this makes the invariant structural, not conventional.
  clearIdleTimer();
  idleSuspended = false;
  dequeueNext();
}
```

`clearIdleTimer()` and `idleSuspended` move inside the guard alongside `dequeueNext()` — critically, because the idle timer is slot-owned: clearing it for a non-active run would silently disarm the *active* run's watchdog. For every current caller `active === runId` holds, so the emitted sequence and slot behavior are byte-identical to today.

*Considered:* leaving `clearIdleTimer()` unconditional and guarding only `dequeueNext()`. Rejected — that would still let a stray non-active finalize cancel the active run's idle bound, i.e. a partial fix.

*Considered:* throwing/logging when `finalize()` is called on a non-active unfinalized run. Rejected as scope creep — the guard already makes the outcome safe; a diagnostic can be added later if such a call is ever observed.

### D2 — Latest-handler ref for the sidecar subscription

**Chosen:** hold the handler in a ref refreshed on every render, and dispatch the once-registered subscription through it:

```js
const sidecarHandlerRef = useRef(handleSidecarEvent);
useEffect(() => { sidecarHandlerRef.current = handleSidecarEvent; }); // no deps: after every render
// ...in the [hasBridge] effect:
return window.iris.onSidecarEvent((event) => sidecarHandlerRef.current(event));
```

The subscription stays registered once (unchanged lifecycle — no churn of the native listener), but always calls the newest closure, so a future branch reading `pendingPoQuestion`/`sortedTasks` sees current state. A comment on the subscription records why it must route through the ref. The no-dep effect that refreshes the ref runs after commit each render — the standard "latest ref" pattern.

*Considered:* adding `handleSidecarEvent` (or its state deps) to the `[hasBridge]` effect's dependency array. Rejected — it would re-subscribe/unsubscribe the native listener on every render, churn we don't want, and `handleSidecarEvent` isn't memoized. The ref keeps a single stable registration.

## Risks / Trade-offs

**D1 changes emit ordering** → no: the only move is `clearIdleTimer()`/`idleSuspended` from before `emit` to after it, inside the guard. Nothing between them awaits or yields, and neither affects the emitted event; the terminal `claude_task_update` and announcement are unchanged. `emit`/`onFinalized` remain unconditional so a non-active finalize still reports terminal.

**D1 masks a real bug if some caller *should* have been finalizing the active run** → the guard only skips slot side-effects when the target isn't the slot-holder; that is exactly the case where advancing the slot would be wrong. If a caller mistakenly finalizes the wrong run, the active run correctly survives — strictly safer than today.

**D2 ref write timing** → the ref is refreshed in a no-dep effect (after commit), so between a render committing and its effect running, an event dispatched would use the *previous* handler — the same one-render lag React's own event patterns accept, and strictly better than the permanent render-0 capture today.

**Coverage** → `run-queue.mjs` is in the Vitest harness: a new test finalizes a non-active run's id and asserts it reaches terminal + emits once while the active run keeps its slot and idle timer and no queued run starts; the existing single-slot / finalize-once / escalation tests stay green (identical behavior). The renderer ref change is not in the harness (React/DOM) and is verified by `npm run build` plus manual smoke (sidecar events still update the UI); it has no spec/behavior delta.
