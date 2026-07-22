## 1. Commit 1 — BUG A: always settle the PO turn, with a reason (`po-session.mjs` + `main.mjs`)

- [x] 1.1 Move the turn settlement in `pump` (`electron/po-session.mjs:127-141`) from `catch` into `finally`: capture `state.currentTurn` into a local, null it, then `turn?.reject(...)`. Keep `catch` recording `state.error`. A turn already resolved by `routeMessage` has cleared `currentTurn`, so `finally` only settles turns that would otherwise hang (design D1)
- [x] 1.2 In `closePoSession` (`po-session.mjs:233-247`), set a teardown marker on the state (e.g. `state.endReason = { kind: "teardown" }`) **before** `state.channel.close()`, so `pump`'s `finally` can read it. Do the same in `closeAllPoSessions`'s path if it doesn't route through `closePoSession` (it does — confirm)
- [x] 1.3 Have `finally`'s rejection carry the reason: reject with an error tagged from `state.endReason` when present, else the generic "PO session ended before the turn completed". `state.error` (a thrown error) still takes precedence for the throw path
- [x] 1.4 At the settle site (`main.mjs:1613-1614`), map the rejection: a teardown-tagged reason → `runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, ...)`; anything else → `RUN_STATUS.ERROR` (today's behavior). Read the reason off the rejected error, not off session state (the session may already be deleted from the map)
- [x] 1.5 Confirm no new plumbing is needed: the existing `.catch` at `main.mjs:1614` reaches `finalize`, which releases the slot via `dequeueNext` — verify by reading, not by adding

## 2. Commit 1 — tests (`po-session.test.mjs`, new)

- [x] 2.1 Create `electron/po-session.test.mjs` using the Wave 0.0 injected `query` seam — a fake async generator, no subprocess, no Electron
- [x] 2.2 Test (the BUG A regression): deliver a turn, then call `closePoSession`; assert the `deliverPoTurn` promise **settles** (rejects) rather than hanging — use a bounded `Promise.race` / fake timers so a hang fails the test instead of stalling it
- [x] 2.3 Test: after `closePoSession`, the rejection carries the teardown marker (so the main-side mapping would produce `cancelled`)
- [x] 2.4 Test: a fake stream that ends on its own with no `result` message rejects **without** a teardown marker (so mapping produces `error`) — this is BUG A's more-likely real trigger, assert it explicitly
- [x] 2.5 Test: a healthy turn that produces a `result` message resolves normally and `finally` does not re-settle it (guards the double-settle risk, design D1)

## 3. Commit 2 — BUG A': discriminate the completion announcement (`main.mjs`)

- [x] 3.1 Gate `onFinalized` (`main.mjs:227`) on `run.started_at` being set — a run that never started produces no spoken announcement. Mirror the wording already at `run-queue.mjs:148-150` in a comment so the two stay obviously the same rule (design D3)
- [x] 3.2 In `announceClaudeCompletion` (`main.mjs:1878`), always emit the `claude_completion` sidecar event, but branch voice delivery on status: `RUN_STATUS.CANCELLED` → do not send the proactive "Claude has returned" `notifyIris` (send nothing, or a short distinct note — design D4 open question); every other status → unchanged (design D4)
- [x] 3.3 Confirm the existing DEV-stop wart is fixed by 3.2 as a side effect: stopping a DEV run no longer announces a returned result aloud (it still shows the card)

## 4. Commit 2 — tests

- [x] 4.1 In `run-queue.test.mjs`, assert `onFinalized` is not invoked for a run finalized without `started_at` (queued-cancel path), and is invoked for a started run — the started_at gate, at the queue's own boundary
- [x] 4.2 If the voice-branch in `announceClaudeCompletion` is extractable as a pure helper (status → should-speak), add a small unit test for it; otherwise cover via manual verification (task 6) since `main.mjs` is out of automated scope (Wave 0.0 D5) — chose manual verification: the branch is a single-line early return inline in `announceClaudeCompletion`, not worth extracting solely for testability given D5 already puts `main.mjs` out of scope

## 5. Spec sync check

- [x] 5.1 `openspec validate settle-and-attribute-po-turn` passes
- [x] 5.2 Re-read the two delta specs against the landed code: the three `po-live-session` settle scenarios and the two attribution scenarios are all true; the two `session-announcements` scenarios are all true

## 6. Verification

- [x] 6.1 `npm test` passes with no `.env`, no `claude` on `PATH`, no network
- [x] 6.2 `npm run build` passes with no new type errors
- [ ] 6.3 Manual (the plan's BUG A verify): submit a long PO turn (e.g. a grilling task); mid-run press "New"; submit a fresh DEV run → it starts immediately, does not queue behind the old turn; the old PO run shows `CANCELLED` (not stuck `RUNNING`, not `ERROR`); SetupPanel → Save PO token works (no "A PO turn is running") — NOT verified this session (needs the real app + Gemini voice + Claude subscription); mechanism covered by `po-session.test.mjs` scenario 2.2/2.3
- [ ] 6.4 Manual: let a PO turn's subprocess/stream die without teardown (or simulate) → the run shows `ERROR` and Iris announces the failure aloud (the loud path A' must preserve) — NOT verified this session; mechanism covered by `po-session.test.mjs` scenario 2.4
- [ ] 6.5 Manual: a normally-completing PO turn and a normally-completing DEV run are announced aloud exactly as before — no regression in the healthy path — NOT verified this session; mechanism covered by `po-session.test.mjs` scenario 2.5

## 7. Commit and record

- [x] 7.1 Two commits on `develop`, one per bug: commit 1 = BUG A (tasks 1-2), commit 2 = BUG A' (tasks 3-4). Do not squash — one commit per bug is the plan's rule. End messages with the Co-Authored-By trailer
- [x] 7.2 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG A and BUG A' done, note the reason-tag mapping (teardown→CANCELLED, else→ERROR) and the started_at announcement gate as landed
