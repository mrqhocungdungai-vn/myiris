## 1. The triggering sentence reaches the turn (fix first — correct regardless of the rest)

- [x] 1.1 `electron/live-messages.mjs` — flush transcripts before dispatching a tool call, so the utterance that caused the turn is in the ring the prompt is built from (`:197-207` currently runs before `:260-263`)
- [x] 1.2 Test (5 cases, `live-messages.test.mjs`): a tool call arriving in the same server message as a transcription fragment sees that fragment

## 2. The open canvas warms the conversation, and Iris says so

- [x] 2.1 `canvas:activate` warms the shaping conversation. The session-config assembly was extracted out of `startStatefulRun` into `statefulSessionOptions` first — it could only be built as a side effect of somebody talking, so a session could only exist that way too
- [ ] 2.2 New `canvas:deactivate` from the renderer: marks the conversation idle; does NOT close it
- [ ] 2.3 `src/components/DrawingCanvas.tsx` — emit deactivate on unmount alongside the existing activate on mount
- [x] 2.4 The review gate is NOT bypassed, which needed the trap fixing rather than the gate moving: `shouldPark` asks whether a live session exists, so a warmed transport would have answered yes and sent the first sentence through unreviewed. `po-session` now distinguishes a warmed transport from a conversation that has happened (`warm`, cleared by the first turn), and `hasLiveStatefulSession` reads the latter
- [x] 2.5 Iris announces canvas mode when it opens — the announcement is what makes warming honest rather than a hidden cost (Q2)
- [~] 2.6 PARTIAL — announcement tests done (silent with no pipeline, once per opening, again on reopen). Session-warming tests wait on 2.1. Originally: warm with pipeline unavailable opens nothing AND says nothing; close/reopen resumes the same session; a declined park is not re-asked per utterance; the announcement fires once per opening, not per utterance

## 3. A resident turn stops queueing behind unrelated work

> **Sized, not started.** Two findings from reading `run-queue.mjs` decide the shape:
> (a) the slot side-effects are ALREADY guarded — `finalize` only disarms the watchdog and
> dequeues when `active === runId` (`:268-276`), and its comment says this makes the
> invariant "structural, not conventional". So a run that never takes the slot cannot
> corrupt the one that has it. The lane is feasible without touching that guarantee.
> (b) the idle watchdog is keyed to `active` (`:194-205`), so a resident turn would run
> with NO watchdog at all. That is why this is one unit of work with 7.1: a lane without a
> per-turn ceiling replaces "your turn waits too long" with "your turn can wedge forever
> and nothing notices". Additionally `deliverPoTurn` overwrites `state.currentTurn`
> unconditionally, so per-conversation serialization has to be enforced before two
> utterances can ever be in flight.

- [x] 3.1 `electron/run-queue.mjs` — `submitResident`: registers and starts without taking the slot. Safe against the slot by construction, not convention — `finalize` already guards every slot side-effect behind `active === runId`
- [x] 3.2 Serialized per conversation (`residentActive` / `residentQueues`). Not merely stated: `deliverPoTurn` overwrites the in-flight turn's handle unconditionally, so two turns of one conversation genuinely must not overlap
- [x] 3.3 Confined at the registry: `shape_on_canvas` withholds Write/Edit/NotebookEdit/Bash. It withheld NOTHING before — which never mattered while one slot made overlap impossible, and became the lane's hazard the moment it did. AskUserQuestion stays available; the conversation still asks freely
- [x] 3.4 Tests (8 in `run-queue.test.mjs`, 4 in `run-dispatch.test.mjs`): answered beside a long job; the slot is not released by a resident finalize; same-conversation turns serialize; different conversations do not; the watchdog fires and says the conversation survives; a turn resets only its own watchdog; a chatty turn cannot keep a silent job alive; a queued turn cancelled while waiting does not start later. 3.3 (tool confinement) still open

## 3bis. Consequences of the lane, found by following it

- [x] 3b.1 `run-stream.mjs` — the activity throttle was a single module-level handle, justified in its own comment by "the single execution slot means at most one run's activity is ever live". The lane retired that premise: a trailing throttle keeps only the LATEST args, so two interleaved runs swallowed each other's updates, and `cancel()` on either finalizing discarded the other's pending emit. Now one throttle per run, cancelled by run
- [x] 3b.2 `run-queue.mjs` — `stop()` decided "is this waiting?" from status alone, but a started run reads QUEUED until its transport flips it and `startRun` awaits before that. Stopping in that window marked the run cancelled without ending its transport or releasing what it held. Now decided by lane membership
- [x] 3b.3 Tests for both (2 in `run-stream.test.mjs`, 4 in `run-queue.test.mjs`)

## 4. The user hears the work as it happens

- [x] 4.1 `run-stream.mjs` — acts reach the voice during the turn, gated by a registry field (`narrateActs`) so only work the user is WATCHING is narrated. Throttled at 3s, slower than the deck's updates: the deck is glanced at, speech is listened to, and a voice reporting every tool call talks over the work it describes. A pending narration is dropped when the turn ends rather than spoken after the result
- [ ] 4.2 Enable `includePartialMessages` for resident canvas turns only; speak sentence-completed partials. Add the option to `electron/sdk-options.test.mjs` (it asserts each run shape's complete option key set — a field added without it is silently dropped)
- [x] 4.3 Relay verbatim — generalized out of `work_on_note`'s hardcoded verb-name check into a registry field (`spokenResult`), so the announcement path can no longer disagree with the verb about how its own result is spoken
- [ ] 4.4 Degrade to acts-only when speech falls behind; drop stale narration rather than queueing it
- [~] 4.5 PARTIAL — 4 tests for acts (`run-stream.test.mjs`): spoken during the turn, silent for unwatched work, coalesced during a burst to the most recent act, dropped when the turn ends. Partial-text tests wait on 4.2

## 4bis. Iris's own skill for being the conduit

- [x] 4b.1 `electron/capabilities/canvas.mjs` — extend the capability's `promptFragment` into a canvas-mode voice instruction (D8): announce the mode, pass the user's words through as spoken rather than as a specification, read Claude's result in full, narrate acts without inventing progress, never claim to see the canvas
- [x] 4b.2 Assert it is a VOICE instruction, not a Claude skill — Claude's side keeps `SHAPING_SKILLS`; describing one agent's job in another's briefing is the mistake to avoid
- [x] 4b.3 Tests: the fragment is present only while canvas mode is engaged, and names the conduit rules

## 5. Barge-in ends the turn, not the conversation

- [x] 5.1 `live-messages.mjs` → `onUserInterrupted` → `run-queue.interruptResidentTurns()` → `stop` → `cancelPoTurn`, which already prefers `interrupt()` and keeps the context window. Scoped to the resident lane: an unrelated job has nothing to do with the user starting a sentence
- [x] 5.2 Settles as `cancelled`, which is neither completed nor failed and which the announcement path already declines to read aloud — the user interrupted precisely because they did not want to hear it
- [x] 5.3 Tests (3 in `live-messages.test.mjs`, 3 in `run-queue.test.mjs`), plus 4 more for a bug they exposed: a started run still reads QUEUED until its transport flips it, so `stop` inside that window took the "waiting" branch and stranded the slot or the lane. Barge-in lands in exactly that window

## 6. The user's words lead

- [x] 6.1 `electron/run-context.mjs` — registry field `wordsLead`; — for resident canvas turns, the verbatim utterance is the instruction and Gemini's reading is labelled as a reading (today: transcript is background that "never overrides the instruction", `:187`)
- [x] 6.2 Fencing unchanged and asserted. The transcript's fence LABEL had to change though: it said "as background context only", which would have contradicted the line above it calling the same block the instruction
- [x] 6.3 Tests (5, `run-context.test.mjs`): the words lead, are not repeated twice, every other verb's prompt is byte-for-byte as it was, leading is still fenced, and no transcript falls back to the brief alone

## 7. Ceilings: the turn ends, the conversation continues

- [x] 7.1 Delivered as the resident lane's per-turn watchdog rather than as a second budget: the runaway guard a turn needed was a silence bound of its own, and `run-budget`'s ceilings are cumulative over a `query()` lifetime by design. Bundled with task 3 because a lane without it trades one failure for a worse one
- [ ] 7.2 Per-turn exhaustion finalizes that turn `limited` and leaves residency intact
- [ ] 7.3 A conversation does not end for being long. Where residency does end for one of its real reasons, that is said out loud and not silently re-opened under the same name by the next utterance (today: `po-session.mjs:178` ends the stream and the next turn opens a new session)
- [ ] 7.4 Tests for the per-turn ceiling and for the announcement

## 8. Gates

- [ ] 8.1 `npm run build`
- [ ] 8.2 `npm test`
- [ ] 8.3 `npm run lint`
- [ ] 8.4 `npm run scan:secrets`
- [ ] 8.5 `npm run spec:check`

## Answered by the user (2026-08-09) — no longer open

- [x] Q1 No spend ceiling to design around (Gemini Live free, Claude on subscription). The per-conversation MONEY ceiling is dropped as a residency-ending condition; the per-turn ceiling stays as a runaway guard, not as a cost control (D5)
- [x] Q2 Warm on canvas open — and Iris announces that canvas mode has begun, which is what makes the warm honest rather than hidden (D1)
- [x] Q3 Iris reads Claude's result IN FULL, not a summary, "so both the person and Claude understand". Her speech is also her own context, so a summary would compound into answering against a paraphrase of a paraphrase (D3)
