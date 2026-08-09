## 1. The triggering sentence reaches the turn (fix first — correct regardless of the rest)

- [x] 1.1 `electron/live-messages.mjs` — flush transcripts before dispatching a tool call, so the utterance that caused the turn is in the ring the prompt is built from (`:197-207` currently runs before `:260-263`)
- [x] 1.2 Test (5 cases, `live-messages.test.mjs`): a tool call arriving in the same server message as a transcription fragment sees that fragment

## 2. The open canvas warms the conversation, and Iris says so

- [ ] 2.1 `electron/capabilities/canvas.mjs` — `canvas:activate` warms the shaping session (scaffold + session + canvas MCP attached) behind the availability gate it already applies to the MCP server
- [ ] 2.2 New `canvas:deactivate` from the renderer: marks the conversation idle; does NOT close it
- [ ] 2.3 `src/components/DrawingCanvas.tsx` — emit deactivate on unmount alongside the existing activate on mount
- [ ] 2.4 Review gate is asked at warm time (`PARK.ON_OPEN` keeps its meaning); a declined warm is not silently retried by the next utterance
- [x] 2.5 Iris announces canvas mode when it opens — the announcement is what makes warming honest rather than a hidden cost (Q2)
- [~] 2.6 PARTIAL — announcement tests done (silent with no pipeline, once per opening, again on reopen). Session-warming tests wait on 2.1. Originally: warm with pipeline unavailable opens nothing AND says nothing; close/reopen resumes the same session; a declined park is not re-asked per utterance; the announcement fires once per opening, not per utterance

## 3. A resident turn stops queueing behind unrelated work

- [ ] 3.1 `electron/run-queue.mjs` — the slot governs jobs (stateless run, plain task, conversation OPEN); a turn into a live conversation is not a job
- [ ] 3.2 Serialize turns per conversation (the message channel already does this — make it the stated rule, and make a second utterance mid-turn wait for the conversation rather than the system)
- [ ] 3.3 Confine a resident turn to its declared tools/skills, and refuse a turn that would begin repository work (D2's hazard — this is the mitigation the spec promises)
- [ ] 3.4 Tests: a canvas turn answered while a long run holds the slot; two utterances serialize within the conversation; a turn attempting out-of-scope work is refused and reported

## 4. The user hears the work as it happens

- [ ] 4.1 `electron/run-stream.mjs` — put acts (tool start/end) on a spoken path for this mode, as short acts rather than tool names
- [ ] 4.2 Enable `includePartialMessages` for resident canvas turns only; speak sentence-completed partials. Add the option to `electron/sdk-options.test.mjs` (it asserts each run shape's complete option key set — a field added without it is silently dropped)
- [x] 4.3 Relay verbatim — generalized out of `work_on_note`'s hardcoded verb-name check into a registry field (`spokenResult`), so the announcement path can no longer disagree with the verb about how its own result is spoken
- [ ] 4.4 Degrade to acts-only when speech falls behind; drop stale narration rather than queueing it
- [ ] 4.5 Tests: acts are spoken during the turn; partial text is spoken as it forms; falling behind drops rather than lags

## 4bis. Iris's own skill for being the conduit

- [x] 4b.1 `electron/capabilities/canvas.mjs` — extend the capability's `promptFragment` into a canvas-mode voice instruction (D8): announce the mode, pass the user's words through as spoken rather than as a specification, read Claude's result in full, narrate acts without inventing progress, never claim to see the canvas
- [x] 4b.2 Assert it is a VOICE instruction, not a Claude skill — Claude's side keeps `SHAPING_SKILLS`; describing one agent's job in another's briefing is the mistake to avoid
- [x] 4b.3 Tests: the fragment is present only while canvas mode is engaged, and names the conduit rules

## 5. Barge-in ends the turn, not the conversation

- [ ] 5.1 Wire Gemini Live's interruption signal to `interrupt()` (never `abort`, which takes the conversation down — `po-session.mjs:434-456`)
- [ ] 5.2 The interrupted turn settles as interrupted: not completed, not failed
- [ ] 5.3 Test: barge-in mid-turn leaves the conversation live and what was drawn intact

## 6. The user's words lead

- [x] 6.1 `electron/run-context.mjs` — registry field `wordsLead`; — for resident canvas turns, the verbatim utterance is the instruction and Gemini's reading is labelled as a reading (today: transcript is background that "never overrides the instruction", `:187`)
- [x] 6.2 Fencing unchanged and asserted. The transcript's fence LABEL had to change though: it said "as background context only", which would have contradicted the line above it calling the same block the instruction
- [x] 6.3 Tests (5, `run-context.test.mjs`): the words lead, are not repeated twice, every other verb's prompt is byte-for-byte as it was, leading is still fenced, and no transcript falls back to the brief alone

## 7. Ceilings: the turn ends, the conversation continues

- [ ] 7.1 `electron/run-budget.mjs` + `po-session.mjs` — a per-turn ceiling distinct from the conversation's lifetime; a runaway guard, not a cost control (Q1)
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
