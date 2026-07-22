## 1. Guard slot side-effects on ownership (`run-queue.mjs`) — BUG I.5

- [x] 1.1 In `finalize()`, keep the run-record mutation (`finalized`/`status`/`output`/`finished_at`/`child = null`) and the `emit(...)` + `onFinalized?.(run)` calls unconditional (the run always reaches terminal and announces) (design D1)
- [x] 1.2 Wrap `clearIdleTimer()`, `idleSuspended = false`, and `dequeueNext()` in `if (active === runId) { ... }` — moving `clearIdleTimer()`/`idleSuspended` from before the `emit` to inside this guard after `emit`/`onFinalized`; leave their relative order otherwise unchanged (design D1)
- [x] 1.3 Add the comment explaining slot side-effects belong to the slot-holder (structural invariant, not caller discipline)
- [x] 1.4 Confirm no other function reads/writes `active`, `idleSuspended`, or the idle timer in a way this reorders (only `beginRun`/`dequeueNext`/`onIdleExpiry`/`clearIdleTimer` touch them)

## 2. Latest-handler ref for the sidecar subscription (`App.tsx`)

- [x] 2.1 Add `const sidecarHandlerRef = useRef(handleSidecarEvent);` and a no-dependency `useEffect(() => { sidecarHandlerRef.current = handleSidecarEvent; });` that refreshes it after every render (design D2)
- [x] 2.2 Change the `[hasBridge]` effect's subscription to `return window.iris.onSidecarEvent((event) => sidecarHandlerRef.current(event));` — the registration lifecycle (once per `hasBridge`) is unchanged
- [x] 2.3 Add a comment on the subscription: it dispatches through the ref so it always uses the current closure; therefore `handleSidecarEvent` may safely read live state (`pendingPoQuestion`, `sortedTasks`, …) in future without a stale-render-0 read

## 3. Tests (`run-queue.test.mjs` — in the Vitest harness)

- [x] 3.1 New case: with run A holding the slot (active) and run B queued, call `finalize(<a third, non-active, unfinalized run id>)` (or a run submitted but not started) — assert that target run reaches its terminal status and emits exactly one terminal update, while A keeps the slot, A's idle timer is not cleared, and B is not started
- [x] 3.2 Regression: the existing single-execution-slot, finalize-once, dequeue-skips-cancelled, and SIGTERM→SIGKILL escalation tests remain green (behavior identical for slot-holding finalizes)
- [x] 3.3 `npm test` green

## 4. Verification

- [x] 4.1 `npm run build` passes (typecheck + build)
- [ ] 4.2 Manual smoke (real app): sidecar-driven UI still updates — task cards, session list, gemini/claude status, PO question banner — confirming the ref dispatch didn't break the subscription
- [ ] 4.3 Manual smoke: submit a task while one is running, let the active run finish → the queued run starts exactly once (single-slot behavior unchanged by the guard)

## 5. Spec and record

- [x] 5.1 `openspec validate harden-slot-release-and-event-subscription` passes
- [x] 5.2 Re-read the MODIFIED `run-execution-queue` "A run finalizes exactly once": the slot-release clause now scopes side-effects to the slot-holder; double-finalize and slot-release scenarios unchanged and still true; new non-slot-holder scenario matches the guard
- [ ] 5.3 Two commits on `develop` (independent concerns, do NOT squash): (a) I.5 — `finalize()` slot-ownership guard + run-queue test + the spec delta; (b) `App.tsx` sidecar latest-handler ref + comment. Co-Authored-By trailer
- [x] 5.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG I.5 done (structural slot-ownership guard in `finalize()`; refines the earlier "no code needed" note — safe by convention today, now safe by construction) and the `handleSidecarEvent` stale-closure item done (latest-handler ref + comment). Note this closes the Wave 2 tail — confirm whether any waves remain in the plan
