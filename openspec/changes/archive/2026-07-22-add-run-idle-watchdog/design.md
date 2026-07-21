## Context

`electron/run-queue.mjs` is a closure-encapsulated module with one private slot (`active`, line 85) acquired in exactly one place (`beginRun`, 87-94) and released in exactly one place (`finalize`, 136). That discipline is why this change is small: there is a single point to bound.

The gap is that release is only ever *reached* from a transport's own termination callback — `child.on("close")` for DEV (`main.mjs:1525`), the turn promise's `.then`/`.catch` for PO (`main.mjs:1611-1612`). Nothing guarantees either fires. `docs/BUGFIX_PLAN.md` documents one confirmed path where the PO promise never settles (BUG A), and three unfixed paths where a subprocess can outlive its signal.

The system already models this invariant correctly once. `PendingQuestion` (`main.mjs:125-163`) funnels every settlement through one `settle()` that is reachable from a `setTimeout` armed at `raise()`. The comment at 121-124 records that an earlier version without that funnel hung forever in production. This change gives the execution slot the same property.

Constraints:

- `run-queue.mjs` must not learn about PO, DEV, Electron, or the SDK. Its whole value is that it takes `{startRun, emit, onFinalized}` by injection and knows nothing else. The suspension signal must arrive through its interface, not through an import.
- The net from `add-test-harness-and-po-seam` covers this module with an injected `startRun` fake, so timer behavior is testable with Vitest fake timers and no subprocess.
- `IRIS_PO_QUESTION_TIMEOUT_MS` defaults to 300000 (`po-session.mjs:9`). Any bound below that will kill healthy PO turns unless suspension works.

## Goals / Non-Goals

**Goals:**

- No run can hold the execution slot forever, regardless of which transport it uses or how that transport fails.
- A long-but-healthy run is never terminated for being long.
- A run blocked on a human is never terminated for being blocked.
- `stop()` gains the escalation it lacks, so a cancel request cannot be quietly ignored.
- All of it is covered by tests that run in milliseconds with no subprocess.

**Non-Goals:**

- Settling the PO turn promise (BUG A, Wave 0.2). This change bounds the *consequence* of a promise that never settles; it does not fix the promise. Both land, separately.
- PO turn cancellation (BUG I.2) — contradicts an existing requirement and needs its own change.
- Process-group ownership and the `before-quit` teardown (BUG I.4/I.5).
- Reconciling BUG K. See D2: it is latent and stays latent, provided D2 is honored.

## Decisions

### D1 — Idle timeout, not wall-clock deadline

**Chosen:** bound the interval since the run last produced progress. Reset on each progress signal.

A wall-clock deadline is the obvious implementation and it is wrong here. DEV runs implement whole OpenSpec changes and legitimately take tens of minutes; a deadline long enough not to kill them (say an hour) is too long to be useful as a liveness bound, and a deadline short enough to be useful would kill real work. That trade has no good setting.

Idle time has a good setting, because the two populations separate cleanly: a healthy run emits constantly (every tool call), a wedged one emits nothing at all. The signal already exists and already covers both transports — `pushActivity` (`main.mjs:1049-1055`) is fed by `parseClaudeStreamMessage` for DEV and by the PO session's message routing, so no new plumbing crosses the seam.

*Wall-clock considered and rejected* as above. *A hybrid (idle bound plus a generous absolute cap) considered:* deferred — it adds a second budget to reason about for a failure mode nobody has observed. Add it if one appears.

### D2 — One timer for the slot, not a map of timers per run

**Chosen:** a single timer owned by the slot, armed in `beginRun`, cleared in `finalize`, re-armed by `dequeueNext` through `beginRun`.

This is the decision that keeps BUG K latent, and it is worth being explicit about because the 0.0 design recorded the opposite conclusion.

The 0.0 open question asserted that the watchdog would be built on "`run.finalized` implies terminal", which is false for a run cancelled while queued (`stop` at `run-queue.mjs:142-151` sets `status` but deliberately does not call `finalize`, so `finalized` stays unset). Re-reading the code, that assertion does not survive:

- `dequeueNext` (line 101) filters on `status === QUEUED`, not on `finalized`. A queued-cancelled run is already skipped correctly.
- `finalized` is read in exactly one place — the once-guard at line 128.
- A queued run never reaches `beginRun`, so with a slot-owned timer no timer is ever armed for one.

So the hazard is not present **as long as timers are not armed per-run**. If they were — a `Map<runId, timer>` armed at `submit` — then a queued-cancelled run would keep a live timer, the timer would later call `finalize()`, the once-guard would pass because `finalized` is unset, and `dequeueNext()` would run *while a different run holds the slot*, clearing `active` and potentially starting a second run concurrently. That would break the single-slot invariant the whole system rests on.

**This is the trap in this change.** A slot-owned timer avoids it structurally rather than by remembering to check. BUG K remains a real latent inconsistency (two sources of truth for "this run is done") and stays tracked, but it does not gate this work.

### D3 — Suspension is an explicit call on the queue's interface, tied to the pending-question lifecycle

**Chosen:** the queue exposes suspend/resume for the active run's bound; `main.mjs` calls them from `PendingQuestion.raise` and `PendingQuestion.settle`.

`run-queue.mjs` cannot import `PendingQuestion` without learning about PO, which would undo the module split. So the signal has to come in through the interface. Tying it to `raise`/`settle` rather than to individual call sites matters: `settle()` is already the single funnel every settlement path goes through (answered, expired, abandoned), so resume cannot be missed by adding a new way to answer a question later. The spec scenario "Suspension ends however the question settles" is asserting exactly that property.

*Flooring the timeout above `IRIS_PO_QUESTION_TIMEOUT_MS` considered:* far simpler, no interface change. Rejected because it makes the bound useless for its main job — a wedged DEV run would take five minutes plus to detect, and the floor silently breaks if someone raises the question timeout.

*Treating the question event as activity considered:* would reset the timer once at `raise` and then let it expire mid-wait. Wrong.

**Failure mode to guard:** a suspend without a matching resume leaves the slot unbounded again — reintroducing the exact bug this change fixes, but harder to see. The resume must be in `settle()` itself (which is once-only and covers every path), not at the call sites. This deserves a test.

### D4 — Expiry finalizes through the same path as everything else

**Chosen:** on expiry, signal the transport, escalate after a grace period, and call the existing `finalize()`.

Expiry must not release the slot by assigning `active = null` directly. Going through `finalize()` gets the once-guard, the terminal `claude_task_update`, the `onFinalized` announcement and `dequeueNext` for free, and keeps "the slot is released in exactly one place" true — which is the property that made this change small in the first place.

Terminal status on expiry is `error`, not `cancelled`: the user did not ask for this, something went wrong, and it should read as a fault. The output should say what happened and name the budget, so the message is actionable rather than mysterious.

### D5 — Escalation belongs with the watchdog, not only with `stop()`

The same "signal, wait, kill harder" machinery serves both expiry (D4) and the missing escalation in `stop()` (`run-queue.mjs:155` sends SIGTERM and hopes). Implementing it once and using it from both is why the spec change modifies the "Stopping a run" requirement in the same breath as adding the bound.

Note the ordering subtlety: after SIGKILL the transport's `close` callback normally still fires and finalizes the run. The escalation path must therefore finalize *only if* the transport has not, which the once-guard already handles — but the timer must be cleared on the transport's path too, or a dead run's timer fires later against a slot that has moved on.

### D6 — The default is 30 minutes, set by the sub-agent silence window

**Chosen:** `IRIS_RUN_IDLE_TIMEOUT_MS = 1_800_000`.

What resets the bound is narrower than it first appears. Per `claude-stream.mjs:26-53`, only a complete `assistant` message (text or `tool_use`) and a `tool_result` produce a signal; `system/init` does not. Assistant messages arrive whole, not as streaming deltas. So a healthy run has exactly three silence windows: spawn → first assistant message, `tool_use` → `tool_result`, and `tool_result` → next assistant message.

The binding constraint is the second window, and specifically the **sub-agent** case. `resources/personas/iris-dev.md` line 22 directs DEV to use the `code-review` skill, and that skill runs its two axes as parallel sub-agents via the `Agent` tool. From the parent stream's perspective a sub-agent is one `tool_use`, then total silence, then one `tool_result` — no intermediate messages. This is not an edge case; it is on DEV's standard path for every run.

Measured sub-agent durations on a mid-size codebase: **263s, 365s, 380s**. Three samples, so treat the maximum as a lower bound on the true spread, not a ceiling.

Margins at 30 minutes: 4.7× the longest observed sub-agent, 3× the Bash tool's own 600s self-timeout (which caps that whole class of tool call), ~400× this repo's 4.4s `npm run build`.

*10 minutes considered:* only 1.6× the observed maximum, leaving no margin for a larger diff or a slower machine. Rejected. *60 minutes considered:* safe, but far enough out to stop functioning as a liveness bound. Rejected.

Two things make 30 minutes safer than it looks: D3 removes the `AskUserQuestion` wait from consideration entirely, so `IRIS_PO_QUESTION_TIMEOUT_MS` does not enter the calculation; and the rollback is an env var rather than a code change, so a single credible report of a healthy run being killed can be answered immediately.

The cost asymmetry justifies erring long: too short kills healthy work routinely, on the standard path; too long merely delays detection of a state that is *currently unbounded*, where any finite value is a strict improvement.

The SIGTERM→SIGKILL grace period (D5) is a separate, much shorter number — seconds, not minutes.

## Risks / Trade-offs

**Killing healthy PO turns blocked on a question** → the single largest risk. Mitigated by D3, and the mitigation must be tested with fake timers advancing past the bound while suspended, not reasoned about.

**Suspend without resume** → silently restores the unbounded state. Mitigated by putting resume in `settle()`, the once-only funnel, and by a test that asserts the bound is active again after each settlement path.

**A stale timer firing against a slot that has moved on** → would clear `active` while another run holds it and break the single-slot invariant. Mitigated structurally by D2 (one timer, owned by the slot) and by clearing it in `finalize` regardless of which path got there first.

**Default too aggressive** → an unusual but legitimate quiet stretch inside a run gets killed. The default should be chosen with room to spare above the longest plausible silence in a healthy run, and it is env-overridable. Erring long is cheap: the bug it prevents currently has no bound at all.

**Timer keeps the Node event loop alive** → an interval or timeout that is never cleared can delay process exit. Clear on `finalize`, and prefer a timer that does not hold the loop open.

**Scope creep into BUG A** → the seam and the net are now in place and BUG A is five lines away. Landing it here would mean landing an undecided design (the settlement-reason tag, still open in `docs/BUGFIX_PLAN.md`) under cover of this change, and would make a regression in either un-attributable.

## Migration Plan

No data migration. The new budget has a default, so an existing install with no `.env` change behaves identically except that a previously-permanent hang now ends in a reported error.

Rollback is setting `IRIS_RUN_IDLE_TIMEOUT_MS` high enough to never fire, which restores today's behavior without a code change — worth ensuring the implementation honors a very large value rather than special-casing zero.

## Open Questions

- ~~What default?~~ **Resolved: 1_800_000 ms (30 minutes).** See D6.
- Should expiry attempt to capture any partial output the run produced before going silent, so the error message carries context? `run.activity` is available on the record; whether it belongs in the terminal `output` is a UX call that interacts with BUG D (`App.tsx:668` currently treats activity as result when the result is empty). Deferring until BUG D lands avoids making that confusion worse.
