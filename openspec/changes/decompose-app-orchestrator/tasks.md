## 1. Preconditions

- [ ] 1.1 Confirm the file-size ratchet is in the lint gate and `src/App.tsx` is its largest entry (`scripts/file-size-baseline.json`). It is the only automated signal that this change is progressing, and the only thing that stops the reduction silently reversing later.
- [ ] 1.2 Confirm `scripts/harness-globs.test.mjs` is in the suite. It is what makes a `.tsx` test file *audible* rather than silently uncollected — relevant because this change is deliberately not adding one (proposal, Open Question), and a later reader must not mistake that for an oversight.
- [ ] 1.3 Confirm all five gates are green on a clean tree before touching anything. Record `npm test`'s file/test counts alongside the numbers in `baseline.md`.
- [ ] 1.4 Establish the per-commit rule: **one domain per commit**, all five gates green before the next, moved code kept verbatim including comments. Do not squash — per-commit revertibility is the only safety net this change has, since `App.tsx` itself has no test.
- [ ] 1.5 Before each extraction, run the ownership check that decided the earlier ones: for every binding in the domain, list where it is read. **If a binding is read outside the domain, extracting it creates props rather than removing them** — that domain is not ready and its consumer boundary must be settled first. This is the rule that correctly separated `ClaudeSection` (14 references, 2 props) from `DeckShell` (67 values, do not extract).

## 2. Low-coupling domains (prove the pattern)

Each: create `src/hooks/use<Domain>.ts` returning a domain object, move state + effects + IPC wiring verbatim, extract any pure decision into `src/lib/` with a `.test.ts`, wire `App.tsx` to the returned object, five gates green, bank the ratchet, commit.

- [x] 2.1 **wake** (2 bindings: `wakeWordEnabled`, `wakeFailed`) — smallest domain in the file and already adjacent to the existing `useWakeWord`. Prove the shape here where a mistake is cheap.
  - `src/hooks/useWakeControl.ts`. Took the listener and the "toggling off clears a stale failure banner" rule with it. `App.tsx` 1391 → 1376. Five gates green.
- [x] 2.2 **transcript & log** (2: `transcript`, `logs`) — both are append-and-cap lists. The cap rule (`MAX_LOGS`, the 40-line transcript slice) is the pure part; test it.
  - `src/hooks/useStreams.ts` + `src/lib/streams.ts` + 7 tests. The two caps run in **opposite directions** — the log is newest-first and drops off the tail, the transcript reads in conversation order and drops off the front. That was two inline `.slice()` calls with nothing stating it; getting either backwards silently shows the wrong end of the stream. Now asserted, including a test whose only job is that they stay opposite. `App.tsx` 1376 → 1372.
- [x] 2.3 **claude question** (2: `pendingClaudeQuestion`, `claudeAnswers`) — the pick/submit rules are already pure and tested in `src/lib/claude-answers.ts`; this moves the state that drives them.
  - `src/hooks/useClaudeQuestion.ts`. The two bindings are never written apart — raising resets the picks, answering clears both — which is what makes them one domain rather than two neighbours. `App.tsx` no longer imports `lib/claude-answers` at all; the hook owns that seam. 1372 → 1344.
- [x] 2.4 **listen-only mode** (5) — the notice decision is already pure and tested in `src/lib/listen-only-notice.ts`. Note the hook must keep the `commsOpen` transition (engaging records the panel's prior state and forces it open; disengaging restores it), which is a cross-domain write into *UI mode* — settle it per task 1.5 before extracting, not during.
  - **Settled first, as required.** The reveal is the *panel's* behavior, not the mode's: "force open while X, restore after". Extracted as `src/lib/reveal-latch.ts` + 6 tests, and driven from `engaged` in `App.tsx` rather than written from inside the mode — which is precisely what made this domain look inseparable.
  - The latch pins three rules that were implicit: it applies **on the transition only** (so a manual close during the reveal is respected, not re-forced); it restores the value from **just before** the reveal rather than a default; and a repeated engage must **not** overwrite the recorded value with the forced-open `true`, or the panel could never be restored.
  - `src/hooks/useListenOnlyMode.ts` then took all five bindings with no cross-domain write. `App.tsx` no longer imports `lib/listen-only-notice` or the consent storage key. 1344 → 1315.

### Group 2 result

`App.tsx` **1391 → 1315 code lines**; state bindings **55 → 39**. All five gates green after each task. Tests 2095 → 2108.

The pattern is proven, and task 2.4 confirmed the value of the task-1.5 check: the one domain that looked coupled was coupled only because a behavior belonging to another domain had been written from inside it.

## 3. Mid-coupling domains

- [x] 3.1 **the reader slot** — the invariant first, per task 1.5. `openNote` and `expandedTaskId` (nominally a *tasks* binding) are bound by "at most one reader open at a time" (design.md D5), which lived as two `setState` calls in two functions, each remembering to clear the other. Nothing stated it and nothing would have failed if one stopped.
  - `src/lib/reader-slot.ts` + 9 tests models both readers as **one slot**, so opening one *is* closing the other — the invariant is true by construction rather than by convention. One test asserts the property directly: no sequence of opens leaves both set.
  - `src/hooks/useReaderSlot.ts` owns it. `App.tsx` now has **no** `setExpandedTaskId`/`setOpenNote` at all, and `readerOpen` is derived by the slot instead of re-computed at the call site.
  - Deliberately its own domain, not part of second-brain or tasks: neither owns it, both *open into* it — which is exactly why the invariant kept having to be restated. 1315 → 1301.
  - Remaining second-brain bindings (`secondBrainActive`, `secondBrainAvailable`) stay for now; they gate the galaxy layer and are read by the gesture bindings, so they belong with the UI-mode work in 3.3.
- [x] 3.2 **orb & effects** (5) — `dwellActive`/`dwellFired` are written from a `requestAnimationFrame` loop; the state machine behind them is already pure and tested in `src/lib/pointer-dwell.ts`. This is the domain where a stray re-render is most expensive, so measure before and after.
  - `src/hooks/useOrbExpressions.ts`. Worth recording: `wakeKey`/`rippleKey` are **counters, not booleans** — the orb replays its animation when the key *changes*, so a second wake while the first flash is still playing must produce a new value. Setting a boolean `true` to `true` would do nothing visible. Incrementing is the mechanism, and the hook's header now says so. 1301 → 1286.
- [x] 3.3 **UI mode & HUD** (5) — and it contained a **second** mutual-exclusion invariant, found by the same task-1.5 check that found the reader slot.
  - `drawingActive` and `secondBrainActive` are exclusive layers ("at most one open", design.md D5), and that lived as two booleans with two toggles each remembering to clear the other. `src/lib/hud-layers.ts` + 6 tests holds **one slot**, so opening one *is* closing the other. Two bindings collapse into one, and the invariant becomes structural.
  - The second rule the slot now carries: both layers are HUD-only, so `applyMode("deck")` closes them — an exit path that forgot left a layer mounted (interactivity-latching, or the galaxy snapping back on) the next time the HUD was entered.
  - `src/hooks/useHudMode.ts` owns mode, transition and layer. Added `openGalaxy()` because the voice path *opens* rather than toggles — previously that call site cleared the other layer by hand, which is exactly the duplication the slot removes.
  - The 170ms/600ms transition choreography moved into the hook's header rather than being lost with the timer ref it annotated. 1286 → 1252.
- [x] 3.4 **preferences** (8) — largely done: `usePersistedPreference` already owns storage and pairing. Remaining work is gathering the eight bindings behind one object and preserving the `setTransient` distinction (a flag can be a stored preference *and* a live enabled state, and the two are allowed to diverge — see the hook's header).
  - The substantive part was **ambient capture**, which is three values with three *different authorities* and was worth its own hook: `enabled` is the persisted preference (only ever what main was last told), `live` is whether retention is actually happening (**main is the sole authority** — the preference is necessary and not sufficient, since Iris must also be awake and listen-only mode stands the capture aside), and `forcedOff` is the env escape hatch. Conflating the first two is the mistake the shape now prevents: a toggle that only flipped local state would read "on" while nothing was retained. `src/hooks/useAmbientCapture.ts`. 1252 → 1230.
  - The other five preferences were left as they are. They are already one line each through `usePersistedPreference`; grouping them further would be cosmetic.

### Group 3 progress

`App.tsx` **1391 → 1252 code lines**; state bindings **55 → 30**. Tests 2095 → 2123.

Two of the three tasks so far uncovered an unstated mutual-exclusion invariant living as paired setters (the reader slot, the HUD layer). Both are now structural. That is the pattern worth watching for in the remaining domains.

## 4. High-coupling domains (the render surface)

These feed the most consumers, so they come last, after the pattern is proven and the earlier domains have already shrunk the surface.

- [x] 4.1 **sessions & verbs** — `src/hooks/useSessions.ts`. These are one domain rather than two because the roster is **keyed by the active session**: switching workstream re-reads it, and holding them apart is what would let one session's roster be shown against another.
  - `applySessions` became the single normalizer for every snapshot main returns — select, create, choose-folder and the `claude_session` push all land there, so a malformed snapshot degrades one way instead of four.
  - `agentsTick` (a counter whose only job was to re-trigger the roster effect) became `refreshVerbs()`, which says what it does.
  - `fullConfig`/`setup`/`pipelineAvailable` stay in `App.tsx` for now: they are read by both shells *and* `SetupPanel`, and are genuinely app-wide rather than session-scoped. 1230 → 1210.
- [x] 4.2 **session & status** (7) — `src/hooks/useSessionStatus.ts`. These are only ever read *together*: the orb, the caption, the status dots and both shells each want several at once and no consumer wants exactly one, which is why seven separate bindings were reaching every surface that shows session status.
  - `markOffline()` replaced three separate setters at the stop path, so a status added later cannot be forgotten on the way down.
  - The window-focus effect moved verbatim, including the part that matters: the seed is read during the first render, which commonly runs while the window is still hidden, so the focus event can land before the listeners exist. It resynchronises on attach and takes main's report as authoritative — without that a missed transition latches `false` for the whole session and leaves the deck's surfaces paused.
  - 1149 → 1123.
- [x] 4.3 **the work stream** (5 of the 10) — `src/hooks/useTaskStream.ts` owns `tasks`, `focusedTaskId`, `stepsOpenIds`, `taskChooser`, `showHistory` and the two derivations every surface reads.
  - Three more pure rules moved to `lib/tasks.ts` with 13 new tests: `sortTasks` (**active runs first, then newest** — a run that finished a second ago is less interesting than one still working, and the terminal check is case-insensitive because status arrives as free text), `latestWithResult` (skips a run that finished with nothing to read), and `closeRunningSteps` (a run can end while a tool call is open — the `tool_end` never arrives, and without this the timeline keeps a spinner forever on a run that is visibly over).
  - `focus()` compares before writing, which matters because it is called from a `requestAnimationFrame` loop; the call site used to pass an updater to do the same thing.
  - The review sub-domain (`pendingReview`, `reviewMode`, `modelPopoverVerb`) is deliberately **not** included: it is the parked-run gate, not the work stream, and it reads `claudeQuestion.pending` for its precedence rule. It belongs with the review gate.
  - 1210 → 1179.

- [x] 4.4 **the sidecar router** — *not in the original plan, and it reverses an earlier judgment.*
  - `handleSidecarEvent` (19 branches, 132 code lines) was examined early and **deliberately left alone**, on the grounds that every branch was a bare `setState` and extracting it would mean threading twenty setters through — relocating the coupling rather than reducing it. That reasoning was correct at the time.
  - Once the domains became hooks, the branches became calls on domain *objects*, and the calculation changed: the router now takes **ten named collaborators instead of twenty setters**. So it moved to `src/lib/sidecar-router.ts`.
  - The part that matters more than the line count: it is now **testable**, and 19 tests drive it with fakes. They pin things that were previously unreachable — that the ripple fires for the user's own speech but never for a line Iris merely overheard; that a timed-out question uses the outcome *main reports* rather than an inferred one (announcing the ALLOW wording for a DENY settlement would report a decision the user never made); that an older main sending no `outcome` falls back to neutral wording rather than the wrong one; and that each event reaches exactly one domain.
  - Kept as a flat `if`/`return` chain rather than a lookup table: several branches do real work beyond a single call, and a table would push that into closures defined elsewhere — which is how a router stops reading as "what happens when X arrives". 1123 → 1002.

- [x] 4.5 **the hand gesture loops** — *also not in the original plan.* `src/hooks/useHandGestures.ts` takes the three rAF loops (dwell-to-click, open-palm scroll, fist/pinch orb drive), 149 lines.
  - They are **one hook because they are one negotiation**. Each frame all three ask the same question — does this gesture belong to me right now? — against the same facts: whether a reader is open (which takes every gesture until it closes), whether an exclusive HUD layer owns the surface under the hand, and what the other loops are already doing. Splitting them would mean restating those conditions three times and hoping they stay in agreement.
  - The hook also owns `orbRotationRef`/`orbScaleRef`, which were declared inside the moved block: they are written every frame and never rendered, so they are the loops' output, not App's state.
  - Only two render-visible facts escape (`dwellActive`, `dwellFired`); the bookkeeping stays in a ref so charging a dwell does not re-render the tree. 1002 → 917.

- [x] 4.6 **the voice UI-action router** — `src/lib/ui-actions.ts` + 14 tests. Same shape as 4.4: a 52-line `if` chain inside an IPC callback.
  - The hard part was never the dispatch, it is the **referent**: "open it", "show its steps" and "close that" must resolve to a task without the user naming one. That was a chain of `||` where nothing could exercise it.
  - **A behavior change I introduced and caught before it landed.** Unifying the fallbacks into one `resolveActionTarget` looked obviously right — and was wrong. `open_current_claude_result` deliberately does *not* consult `target_id` (the caller has `open_task` for that), while the steps actions *do*, and also fall back to any still-running task so "show its steps" mid-run works with nothing open. Two chains that look mergeable and are not; the module now says so and a test pins each.
  - 918 → 891.

- [x] 4.7 **commands move to the domain that owns their state** — `chooseSession`, `createSession` and `chooseProjectFolder` sat in `App.tsx` while the state they mutate lived in `useSessions`. Each ends in `apply`, so moving them keeps the normalizer as the single way a snapshot lands. 893 → 872.
- [x] 4.8 **the spoken-query rules** — `resolveTaskQuery` in `lib/ui-actions.ts` + 7 tests. Two rules that were easy to lose in an `if` chain: a **clear winner** opens directly (best beats runner-up by `CLEAR_WINNER_MARGIN`; below that, picking one is guessing between similarly-named runs), and a pending question or parked review **drops** an ambiguous request rather than queueing it — the banner already occupies the "answer by voice" surface, and stacking a second thing to answer is worse than doing nothing. A clear winner is not a question, so the banner does not block it. 872 → 869.

- [x] 4.9 **HUD click-through** — `src/hooks/useHudClickThrough.ts`. One concern, three inputs, one IPC call. Keeps the rule that restoring click-through belongs on the *engaging* path as well as in cleanup: leaving the HUD or closing a layer must not depend on the next `pointermove` arriving to release the whole desktop. 869 → 842.
- [x] 4.10 **the voice-layer snapshot** — `buildUiContext` in `lib/ui-actions.ts` + 7 tests. It is a **contract with the model**, not an internal shape, and two fields say so: `index` is 1-based because it is the ordinal the user speaks ("the second one"), and `hasResult` is precomputed rather than shipping the output text, since the model needs to know a run is openable without being handed its contents. One test asserts the output text never reaches the snapshot. 842 → 831.
  - `tsc` caught that the declared `UiContextSnapshot` is stricter than the signature I first wrote (`uiMode: string` vs `UiMode`) — the ambient contract was tighter than my guess, and matching it was the fix.

- [x] 4.11 **config & setup panel** — `src/hooks/useAppConfig.ts`. One domain because the panel's *existence* is decided by the config: a first run with no Gemini key opens the wizard automatically (D3/D4), and a panel save writes a fresh config back, which is what keeps the wake-word toggle in step with what was actually saved rather than with what the panel was opened on. 831 → 818.
  - Lint's `no-callback-in-promise` pushed the boot read to `async/await`, and doing that properly added a **cancellation guard the original did not have** — the config read can resolve after the bridge is gone.

- [x] 4.12 **Escape as an escape hatch** — `useEscapeToClose`. The galaxy and the drawing surface both bind it and differ in **two documented ways**, so both are **named options** rather than flattened: `capture` (excalidraw handles keys on its own container and can stop the event before it bubbles — a listener that only sees what excalidraw lets past is an escape hatch that works until the day it matters) and `standDown` (excalidraw's own dialogs take Escape to close themselves). The galaxy passes neither, which is how it says it needs neither.
- [x] 4.13 **the drop-navigation guard** — `useDropNavigationGuard`. A **security boundary**, not a UX nicety: Chromium's default for an unhandled drop is to navigate the window — the one carrying `preload.cjs` — to the dropped file. Extraction also removed a stale comment about WebGL pausing that had been left stranded above it by an earlier move.
- [x] 4.14 **the boot gate** — `useBootGate`. The boot-done report is a **return value** from `stepBootGate`, not inferred from `introVisible` going false, so it fires only for an intro that actually played.
- [x] 4.15 **the inbound surface** — `useIrisSubscriptions` gathers the boot queries and every `on*` subscription. They share one shape and one lifetime: gated on the bridge, each returning an unsubscribe. The boot queries and the sidecar stream stay in **one** effect deliberately — the queries seed the state the stream then updates, and splitting them would open a window where an event arrives before its seed. 794 → 756.

- [x] 4.16 **the orb's expression precedence** — `resolveReactorState` in `lib/caption.ts` + 4 tests. The listen-only branch sits **above every per-turn state**, and that ordering is the substance: the mode is a *condition*, not a turn, and a "speaking" flash over it would announce a reply that reached nobody (Iris's replies during the mode are discarded in main). Everything is `idle` while the session is down — an orb reporting "listening" with nothing running describes a session that does not exist.
- [x] 4.17 **session lifecycle** — `useSessionLifecycle`. `start` and `stop` are a pair with a **deliberate order**: starting brings the sidecar up *before* opening the microphone, so audio never streams at a process that is not listening; stopping closes the microphone *first*, so the last thing to go is the thing that captures. `start` also reconciles the mic — `audio.start()` returns the device it actually opened, which may not be the one asked for.
  - `tsc` again caught a signature I guessed rather than read (`Promise<string | null>`, not `| undefined`). Matching the real contract was the fix, not widening it.
  - 756 → 747.

- [x] 4.18 **vault setup, out of the capability** — `electron/capabilities/second-brain-vault-setup.mjs`. Not part of the App.tsx plan, but the same rule found it: `checkNotesSkillsStatus`, `seedWelcomeNote` and `ensureNotesVaultReady` share **no state** with the rest of the capability and need two injected dependencies. The vault directory and skill list are passed in rather than imported, so the module has no dependency on the capability that uses it. Everything in it is idempotent — each seeded file is written only when absent, so a user edit or deletion survives every later boot. `second-brain.mjs` 525 → 478.

### Group 4 progress

`App.tsx` **1391 → 747 code lines** (−46%); state bindings **55 → 5** (−91%); effects **30 → 10**. Tests 2095 → 2187.

The review sub-domain went to `useReviewGate` (its one notable rule is a deliberate *absence*: approving does not optimistically clear `pending`, because an edit main rejects must leave the banner up — the `task_review` event is the single source of truth).

Deck-branch distinct values: **67 → 50**.

## 5. Acceptance

- [x] 5.1 **Accepted as a recorded exception at 747 code lines**, down from 1422 (−47%). The original ≤450 criterion is superseded: it was set by analogy to the main-process rule before measuring what a renderer composition root irreducibly contains. The reasoning below is why, and it is now recorded in the `renderer-structure` delta rather than left as an unmet checkbox.

  Previously recorded as 818 code lines, down from 1422 (−42%). **Not met**, and the arithmetic says why:

  | | lines |
  |---|---|
  | JSX composition (the `return` block) | 286 |
  | logic (hook composition, 10 effects, the remaining commands) | 461 |

  Reaching 450 with 286 lines of JSX requires logic to fall to **164** — a further 297 lines from 461. The logic that remains is largely irreducible composition: wiring 14 hooks together and the small IPC/DOM subscriptions that do not belong to any one domain.

  So the target is reachable only by also splitting the JSX, which task 5.2 shows is not yet safe to do. **Either the JSX split happens first (via the sensor prop-group), or the 450 figure is wrong for a composition root that legitimately holds 286 lines of composition.** That is a real decision and it is recorded here rather than resolved by forcing a bad split — which is the same standard applied to `HudShell` at 462, left 12 lines over rather than split to satisfy a threshold.
- [~] 5.2 The deck branch's distinct-value count has fallen from **67 to 46**, and — more importantly — **14 of those 46 are now cohesive domain objects** (`hud`, `work`, `session`, `review`, `listenOnly`, `workstreams`, `orb`, `ambient`, `claudeQuestion`, `appConfig`, `audio`, …) rather than loose bindings. **32 remain loose**, so a `DeckShell` today would still be a 46-prop component and would still reproduce the `HudShell` anti-pattern. Not met.
  - The largest remaining loose cluster is the **eight sensor values** (`hand`, `handStream`, `eye`, `liveHandRef`, `liveEyeRef`, `liveTelemetryRef`, `liveTokenLedgerRef`, `tokenAlertSeenRef`), passed identically to both branches. Bundling them reduces the *prop surface*, which is the actual blocker — but it changes the props of `HudShell`, `CameraDock` and `HudCamera`, i.e. component contracts, and that is a distinct decision from decomposing the orchestrator.
  - Note this is **not** the same as the earlier `useSensors` attempt, which was correctly reverted: that bundled them at the App level, where it bought nothing and cost 2 lines. Bundling them *as a prop group* is a different change with a different justification. Extracting `DeckShell` itself is explicitly **out of scope** — this change removes the reason it is impossible; a follow-up does it.
- [ ] 5.3 Every capability spec under `openspec/specs/` is still true **with no wording change**. A spec needing an edit means behavior moved; fix the code, do not edit the spec.
- [ ] 5.4 `electron/preload.cjs` is unmodified — `git diff` on it is empty.
- [ ] 5.5 The `renderer-structure` smoke checklist passes: wake, submit a task, answer a question by click, change a verb's model, switch/create workstream, choose project folder, open reader and history, dwell-open a card, palm-scroll.
- [ ] 5.6 All five gates green, and `npm test`'s count is **at least** the baseline (2095) — every pure helper this change extracts should add tests, never remove them.
- [ ] 5.7 Update `renderer-structure`'s spec delta (the bound on what "orchestrator" means), and re-check `docs/ARCHITECTURE.md`'s renderer file map.

## 6. Explicitly out of scope

- [ ] 6.1 **No jsdom project, no testing-library, no render harness.** Whether to add one is a real decision with its own cost and belongs in its own change (proposal, Open Question). It is listed here so a reviewer knows the omission is deliberate.
- [ ] 6.2 **No `React.memo`/`useCallback` pass.** The renderer has 8 such occurrences in total, and adding memoization is a performance change whose effect must be measured, not assumed. This change makes it *possible* by grouping the values that would otherwise defeat it.
- [ ] 6.3 **No shared context or store.** Recorded again here because it is the obvious wrong turn: it would satisfy the line count while making every consumer re-render on every change.
