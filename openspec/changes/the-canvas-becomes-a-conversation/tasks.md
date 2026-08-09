## 1. The triggering sentence reaches the turn (fix first — correct regardless of the rest)

- [x] 1.1 `electron/live-messages.mjs` — flush transcripts before dispatching a tool call, so the utterance that caused the turn is in the ring the prompt is built from (`:197-207` currently runs before `:260-263`)
- [x] 1.2 Test (5 cases, `live-messages.test.mjs`): a tool call arriving in the same server message as a transcription fragment sees that fragment

## 2. The open canvas warms the conversation, and Iris says so

- [x] 2.1b The warm looked its workstream up with `findWorkstream(null)`, which matches no session — so every warm answered "no-workstream" and nothing was ever opened ahead of the first sentence. It takes the ACTIVE workstream now, and the test drives the real function rather than the mocked call site
- [x] 2.1 `canvas:activate` warms the shaping conversation. The session-config assembly was extracted out of `startStatefulRun` into `statefulSessionOptions` first — it could only be built as a side effect of somebody talking, so a session could only exist that way too
- [~] 2.2 DROPPED. Nothing consumes it. The requirement it was meant to serve — "closing the surface does not end the conversation" — is satisfied by residency having no idle teardown, i.e. by doing nothing. An IPC channel with no consumer is a seam that has to be maintained and can drift out of true, in exchange for nothing
- [~] 2.3 DROPPED with 2.2
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

- [x] 3.1a `run-dispatch` asks TWO predicates, not one: `hasLiveStatefulSession` (consent — has the user taken part?) for the review gate, `hasResidentSession` (mechanics — is there a session to deliver into?) for the lane. Conflating them left the first sentence after opening the canvas queueing behind unrelated work, which is the half of the cost warming does not remove
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
- [x] 4.2a WIRED to the resident path. The first attempt hooked `parseClaudeStreamMessage` via `handleClaudeStreamMessage`, which is the STATELESS route — po-session parses its own stream, so the canvas conversation, the one case this exists for, never spoke. Threaded through `po-session` → `deliverPoTurn` → `run-exec` now, with a test that goes red when the wire is cut
- [x] 4.2 Done WITHOUT `includePartialMessages`, so no SDK option was added and `sdk-options.test.mjs` needs no entry. An `assistant` message already arrives complete several times within a turn, which delivers the same property at the granularity of a thought rather than a token; the option is also settable only at session creation, which for a SHARED session means whichever verb opened it decides for the other. `docs/REFERENCE.md`'s audit row is rewritten, because its stated reason ("the voice layer speaks once at run end") is the premise this change removed
- [x] 4.3 Relay verbatim — generalized out of `work_on_note`'s hardcoded verb-name check into a registry field (`spokenResult`), so the announcement path can no longer disagree with the verb about how its own result is spoken
- [x] 4.4b The FIRST act of a turn is spoken at once; only the ones after it are paced. A purely trailing throttle held the opening act for the whole interval — so "she has started drawing" arrived three seconds late, and a turn shorter than the interval narrated NOTHING, because finalize cancels what is still pending. Short turns are most of a brainstorm
- [x] 4.4 Acts coalesce on a trailing throttle, so a burst is reported by its most recent act and the stale ones are dropped rather than queued. Prose is deliberately NOT throttled: an act is a status line the next one supersedes, whereas dropping a block of prose drops something the user was told and will not hear again
- [x] 4.5 Tests (8 in `run-stream.test.mjs`): acts spoken during the turn, silent for unwatched work, coalesced to the most recent act during a burst, dropped when the turn ends; prose spoken per block as it arrives, tool lines never read aloud, silent for unwatched work, and the worker's words fenced rather than passed as instructions

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
- [x] 7.2 Holds, by two existing mechanisms rather than a new one: a ceiling already finalizes its run as `limited` (`run-exec.mjs`), and the resident lane's own watchdog finalizes a wedged turn without touching the conversation. Residency is intact either way
- [~] 7.3 SCOPED OUT, with the reasoning rather than by silence. Re-reading the path: when a stream ends, the next turn opens a session that RESUMES the stored id, so the context carries and the conversation is continuous in the way that matters. The turn that was cut is already reported as `limited`. What remains unsaid is only that a ceiling was reached at all — worth fixing, but it is a truthfulness improvement to the ceiling story rather than part of making the canvas a conversation, and the user has said no spend ceiling is in play. Left for a separate change so it is decided on its own merits
- [x] 7.4 Tests for the per-turn watchdog are in `run-queue.test.mjs` (fires, says the conversation survives, resets only its own, cannot be held open by a chatty neighbour). No announcement test, because 7.3 is scoped out

## 8. Gates

- [x] 8.1 `npm run build` — green
- [x] 8.2 `npm test` — green, 1692 tests (was 1568 at the start of this work)
- [x] 8.3 `npm run lint` — green, 0 warnings
- [x] 8.4 `npm run scan:secrets` — green (and `gitleaks` run over each pushed range, since the staged-only gate is vacuous after a commit)
- [x] 8.5 `npm run spec:check` — green

## Answered by the user (2026-08-09) — no longer open

- [x] Q1 No spend ceiling to design around (Gemini Live free, Claude on subscription). The per-conversation MONEY ceiling is dropped as a residency-ending condition; the per-turn ceiling stays as a runaway guard, not as a cost control (D5)
- [x] Q2 Warm on canvas open — and Iris announces that canvas mode has begun, which is what makes the warm honest rather than hidden (D1)
- [x] Q3 Iris reads Claude's result IN FULL, not a summary, "so both the person and Claude understand". Her speech is also her own context, so a summary would compound into answering against a paraphrase of a paraphrase (D3)

## 9. The test that would have caught all three wiring bugs

- [x] 9.1 `electron/wiring-capabilities.effects.test.mjs` — builds the REAL capabilities wiring, the REAL run-exec and the REAL canvas capability, mocking only the process boundaries (the Agent SDK session, the MCP listener). Asks what the user asks: I opened the canvas; did anything actually happen?
- [x] 9.2 Verified by reintroducing each bug and watching it fail: the warm reaching for a lookup-by-id, the activate handler not warming, the activate handler not announcing. The first attempt did NOT catch the lookup-by-id bug, because the fake answered the same for both accessors — the test had the same blind spot as the code, and was fixed before being kept
- [x] 9.2b The objective's "the user's own words reach Claude" requirement checked where it LANDS — the text a resident turn is actually delivered — not only where it is composed. Verified by removing `wordsLead` from the verb and watching it fail
- [x] 9.2c Barge-in checked through the REAL message handler (`wiring-live.effects.test.mjs`), since `wiring-live.test.mjs` mocks live-messages and can only prove construction order. Verified by cutting the chain at both ends — `wiring-live`'s hookup and `live-messages`' call — and watching each fail
- [x] 9.2d "Read the result out in full" checked at the composition root (`wiring.test.mjs`). The announcements mock there had no `announceVerbatimResult` at all, which was itself the finding: no test had ever finalized a verb that takes that path, so the branch between summary and verbatim was never exercised. Verified by removing `spokenResult` from the verb, and separately by cutting the branch in wiring
- [x] 9.3 The pattern named, so it is not repeated: `wiring-capabilities.test.mjs` mocks both run-exec and the canvas capability, so it can only assert that things were constructed and called. Every one of the three bugs was a call that happened and an effect that did not

## 10. Making the claims checkable without a stopwatch

- [x] 10.1 `run-exec` records when a conversation was warmed and ready before the first turn; `run-dispatch` records which lane a stateful turn took. Both are facts the user cannot see from outside the process, and both are the difference between "it feels slow" having an explanation in the record or not — which is exactly how a warm that warmed nothing went unnoticed for a release
- [x] 10.2 Deliberately two lines, not a trace: each answers a "why did it do that" question the diagnostic log exists for. A failed warm still says nothing, because it is an optimisation nobody asked for by name and the first spoken turn opens the session as it always did
- [x] 10.3 Tests for both, including the silences

## 11. The understanding survives the session

- [x] 11.1 `docs/PIPELINE_INTERNALS.md` gains "The canvas is a conversation, not an errand" — the architecture in one place: warm on open, the two predicates and why conflating them costs the first sentence, the resident lane and its own watchdog, the tool confinement the lane made necessary, speaking while working, the verbatim result, Iris's conduit role, barge-in, and the two log lines
- [x] 11.2 "The user's own words reach the run" corrected — it still described the transcript as background only, which stopped being true for `wordsLead` verbs, and a doc that has become false is worse than a missing one
- [x] 11.3 `CLAUDE.md` gains its router line, since the file is a router and this capability had no entry at all
- [x] 11.4 The `.audit/` reports stay what they are: investigation snapshots with `file:line` evidence, not documentation
