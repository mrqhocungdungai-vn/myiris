## Why

A PO turn's promise is settled on exactly one path — the `catch` in `pump` (`electron/po-session.mjs:127-141`). When the SDK stream ends *without throwing* — which is precisely what `closePoSession` triggers (`channel.close()` → `for await` exits normally, no throw) and also what a silently-dying subprocess produces — the `finally` runs `state.ended = true` but never settles `state.currentTurn`. The promise `deliverPoTurn` returned hangs forever, so `main.mjs:1613-1614` never calls `runQueue.finalize`, the execution slot is never released, and every subsequent PO turn and DEV run queues behind a corpse until the app restarts. `savePoToken` is bricked too, because `poTurnRunning()` stays `true` forever. This is `docs/BUGFIX_PLAN.md` BUG A — the highest-severity defect in the plan, and the one the Wave 0.0 `query` seam and Wave 0.1 watchdog were staged to let us fix and verify cheaply.

The watchdog (Wave 0.1) now *bounds* this hang to an idle timeout, but it does not *fix* it: a torn-down turn still hangs the slot for up to 30 minutes before the watchdog fires, and it reports the wrong story (a run the user deliberately abandoned gets finalized as a timeout `error`). Settling the turn at its real end, with the real reason, is the actual fix.

## What Changes

This change lands as **two commits**, one per bug, because the fixes are coupled — BUG A's fix is reason-tagged, and the tag is meaningless (indeed harmful) unless the announcement path reads it.

**Commit 1 — BUG A: a PO turn always settles, with an attributed reason.**
- Move the turn settlement from the `catch` to the `finally` in `pump` (`po-session.mjs`), so a stream that ends *without throwing* still settles `state.currentTurn` (reject) instead of hanging it. The `.catch` already wired at `main.mjs:1614` then finalizes and releases the slot with no new plumbing.
- Record a **teardown reason** on the session state in `closePoSession` **before** `state.channel.close()` (`po-session.mjs:238`), so the settlement carries *why* it ended: a user-initiated teardown vs. a fault.
- Map that reason at the settle site (`main.mjs:1613-1614`): a teardown-initiated end → `CANCELLED`; anything else (silent stream end, subprocess death, real error) → `ERROR`. `CANCELLED` and `ERROR` both already exist and are both terminal in `run-queue.mjs`.

**Commit 2 — BUG A': the completion announcement discriminates on whether the run actually ran.**
- Gate `onFinalized` (`main.mjs:227`) on `run.started_at` being set: a run that never started produces no spoken *"Claude has returned"* announcement. This is the exact rule already applied to queued-cancel at `run-queue.mjs:148-150` ("a queued run never started, so there is no announcement to make"), generalized in one place.
- For a run finalized as `CANCELLED` (user tore it down / stopped it): keep the `claude_completion` sidecar event so the UI card reads correctly, but do not read it aloud as a returned result — send nothing to voice, or a short distinct note. This also removes an existing wart: stopping a DEV run today announces *"Claude is back with a result"* for a run the user just killed.
- A genuinely faulted or silent run (`ERROR`) is still announced — that is the case that **must** stay loud, since a silently-dying subprocess is BUG A's more-likely real-world trigger.

Out of scope (each lands separately, per the plan ordering):
- BUG J — `abandon` answering the user's question with defaults on a *deliberate* reset and letting the SDK act on it (`main.mjs:159-162`). Related category error, one layer down; Wave 0.7.
- BUG B — the never-drained offline announcement buffer (Wave 0.4).
- The watchdog itself (Wave 0.1, done) — this change settles the turn *inside* that bound; it does not touch the timer.
- BUG K — the queued-cancel spec/code contradiction; still tracked, still not a blocker here.

## Capabilities

### New Capabilities

None. Both bugs are corrections to behavior existing capabilities already own.

### Modified Capabilities

- `po-live-session`: adds a requirement that an in-flight PO turn **always settles** — on normal stream end, on user-initiated teardown, and on fault — and that its terminal status attributes the reason (teardown → cancelled, fault → error). Today the spec says the session "is ended" on reset and "closed without leaving an orphaned Claude process" on shutdown, but says nothing about the *turn in flight* when that happens — the gap BUG A lives in.
- `session-announcements`: adds a requirement that a completion is announced aloud only for a run that actually started, and that a user-cancelled/torn-down run is not read aloud as a returned result (while still surfacing on the UI). Today "task completion" is listed as an announcement kind with no statement that it is conditional on the run having run.

## Impact

- `electron/po-session.mjs` — `pump`'s `finally` settles the turn; `closePoSession` records a teardown reason on state before closing the channel. Both are within the 128-247 neighbourhood. The `add-test-harness-and-po-seam` `query` seam makes this directly testable with a fake async generator (deliver a turn, close the session, assert the promise settles) — no subprocess, no Electron.
- `electron/main.mjs` — the settle site (`1613-1614`) maps reason→status; `onFinalized` (`227`) gates on `run.started_at`; `announceClaudeCompletion` (`1878`) branches voice delivery on terminal status.
- `electron/po-session.test.mjs` — new; the three-line BUG A regression test plus teardown-reason attribution. `run-queue.test.mjs` may gain a started_at-gate assertion for A'.
- No new dependency, no data migration, no env budget. `IRIS_PO_LIVE_SESSION=0` (the pre-SDK rollback) is unaffected — that path shares DEV's mechanism and never hit BUG A.
