## 1. The triggering sentence reaches the turn (fix first — correct regardless of the rest)

- [ ] 1.1 `electron/live-messages.mjs` — flush transcripts before dispatching a tool call, so the utterance that caused the turn is in the ring the prompt is built from (`:197-207` currently runs before `:260-263`)
- [ ] 1.2 Test: a tool call arriving in the same server message as a transcription fragment sees that fragment

## 2. The open canvas warms the conversation

- [ ] 2.1 `electron/capabilities/canvas.mjs` — `canvas:activate` warms the shaping session (scaffold + session + canvas MCP attached) behind the availability gate it already applies to the MCP server
- [ ] 2.2 New `canvas:deactivate` from the renderer: marks the conversation idle; does NOT close it
- [ ] 2.3 `src/components/DrawingCanvas.tsx` — emit deactivate on unmount alongside the existing activate on mount
- [ ] 2.4 Review gate is asked at warm time (`PARK.ON_OPEN` keeps its meaning); a declined warm is not silently retried by the next utterance
- [ ] 2.5 Tests: warm with pipeline unavailable opens nothing; close/reopen resumes the same session; a declined park is not re-asked per utterance

## 3. A resident turn stops queueing behind unrelated work

- [ ] 3.1 `electron/run-queue.mjs` — the slot governs jobs (stateless run, plain task, conversation OPEN); a turn into a live conversation is not a job
- [ ] 3.2 Serialize turns per conversation (the message channel already does this — make it the stated rule, and make a second utterance mid-turn wait for the conversation rather than the system)
- [ ] 3.3 Confine a resident turn to its declared tools/skills, and refuse a turn that would begin repository work (D2's hazard — this is the mitigation the spec promises)
- [ ] 3.4 Tests: a canvas turn answered while a long run holds the slot; two utterances serialize within the conversation; a turn attempting out-of-scope work is refused and reported

## 4. The user hears the work as it happens

- [ ] 4.1 `electron/run-stream.mjs` — put acts (tool start/end) on a spoken path for this mode, as short acts rather than tool names
- [ ] 4.2 Enable `includePartialMessages` for resident canvas turns only; speak sentence-completed partials. Add the option to `electron/sdk-options.test.mjs` (it asserts each run shape's complete option key set — a field added without it is silently dropped)
- [ ] 4.3 Relay verbatim, on the `work_on_note` path (`announcements.mjs:244-278`), not the 1-3-sentence summarizing path
- [ ] 4.4 Degrade to acts-only when speech falls behind; drop stale narration rather than queueing it
- [ ] 4.5 Tests: acts are spoken during the turn; partial text is spoken as it forms; falling behind drops rather than lags

## 5. Barge-in ends the turn, not the conversation

- [ ] 5.1 Wire Gemini Live's interruption signal to `interrupt()` (never `abort`, which takes the conversation down — `po-session.mjs:434-456`)
- [ ] 5.2 The interrupted turn settles as interrupted: not completed, not failed
- [ ] 5.3 Test: barge-in mid-turn leaves the conversation live and what was drawn intact

## 6. The user's words lead

- [ ] 6.1 `electron/run-context.mjs` — for resident canvas turns, the verbatim utterance is the instruction and Gemini's reading is labelled as a reading (today: transcript is background that "never overrides the instruction", `:187`)
- [ ] 6.2 Fencing unchanged — assert it stays
- [ ] 6.3 Tests: a reading that contradicts the utterance does not replace it

## 7. Ceilings: the turn ends, the conversation continues

- [ ] 7.1 `electron/run-budget.mjs` + `po-session.mjs` — a per-turn ceiling distinct from the per-conversation one
- [ ] 7.2 Per-turn exhaustion finalizes that turn `limited` and leaves residency intact
- [ ] 7.3 Per-conversation exhaustion ends residency, says so, and is not silently re-opened by the next utterance (today: `po-session.mjs:178` ends the stream and the next turn opens a new session under the same name)
- [ ] 7.4 Tests for both ceilings and for the announcement

## 8. Gates

- [ ] 8.1 `npm run build`
- [ ] 8.2 `npm test`
- [ ] 8.3 `npm run lint`
- [ ] 8.4 `npm run scan:secrets`
- [ ] 8.5 `npm run spec:check`

## Open questions for the user (do not implement past these)

- [ ] Q1 The per-conversation spend ceiling in money. $6 is today's whole-session figure, set for a working session rather than a conversation (D5)
- [ ] Q2 Whether warming on canvas open is acceptable given it spends a session for a user who opens the board and draws in silence (D1)
- [ ] Q3 How much Iris should speak while working — every act, or only acts that change the canvas (D3)
