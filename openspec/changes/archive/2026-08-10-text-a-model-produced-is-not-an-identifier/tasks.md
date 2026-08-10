## 1. The answer relay stops keying on text

- [x] 1.1 In `electron/gemini-tools.mjs`, change `answer_claude_question`'s per-answer entry: add a required question number naming which relayed question is being answered, and demote the existing `question` text field to optional corroboration. Its description must say the number is what files the answer and the text is only there to explain a mismatch (design D1)
- [x] 1.2 In `electron/run-stream.mjs`'s `askUserQuestionViaVoice`, make the number an explicit handle in the relayed instructions rather than an incidental artefact of the numbered list. The instruction currently says "question text verbatim" — it must say to answer by number
- [x] 1.3 Rewrite `resolvePendingPoQuestion` (`run-stream.mjs:513`): resolve each entry's handle against `PendingQuestion.current.questions`, and build the SDK map using **the verb's own question text** taken from that pending question. The string the SDK asked with never round-trips through the voice layer (design D2)
- [x] 1.4 Give `resolvePendingPoQuestion` a failure path: an entry whose handle names no pending question returns an error result naming what did not match, and the pending question is **left pending** rather than settled. It currently returns `{ status: "ok" }` unconditionally (design D3, spec: "An unmatchable answer is refused, not absorbed")
- [x] 1.5 Extend `electron/run-stream.test.mjs`: an answer by handle files against the right question with the SDK-facing key intact; an answer whose text differs from the verb's wording still files correctly; an unknown handle returns an error and leaves the question pending; a partially-matching batch settles nothing
- [x] 1.6 Extend `electron/gemini-tools.test.mjs` for the schema change, and check whether `electron/sdk-options.test.mjs` covers this surface — it asserts complete option key sets, so a schema change must be reflected there rather than discovered later

## 2. The ambient spool says what it is

- [x] 2.1 Add the accuracy clause to the self-describing header in `electron/session-capture.mjs`: the text is an automatic transcription made alongside the conversation and may be inaccurate. One clause beside the existing "record of the room" wording (design D4)
- [x] 2.2 Update `electron/session-capture.test.mjs` — the header assertion is the test that pins this, so it should assert the new clause rather than be loosened to tolerate it

## 3. Documentation

- [x] 3.1 Note the relay's handle rule in `docs/PIPELINE_INTERNALS.md` where the voice relay is described — an answer names its question by number, and the app owns the mapping back to text
- [x] 3.2 Add the ambient spool's new self-description to `docs/PIPELINE_GUIDE.md` if it quotes the header

## 4. Gates

- [x] 4.1 `npm run build`
- [x] 4.2 `npm test`
- [x] 4.3 `npm run lint`
- [x] 4.4 `npm run scan:secrets`
- [x] 4.5 `npm run spec:check`

## 5. Verify in the running app

- [ ] 5.1 `npm run dev`, start a shaping conversation and get it to ask a question. Answer by voice: the run resumes with the answer that was actually given
- [ ] 5.2 Answer a multi-select question with several options: every option still reaches the verb — this is the existing behaviour most at risk from the schema change
- [ ] 5.3 Speak to Iris in Vietnamese while the question is written in English, and answer by voice. This is the case the change exists for: the answer lands even though the question was never retyped
- [ ] 5.4 Answer from the UI instead of by voice: unchanged, since that path never went through text matching
- [ ] 5.5 Open a session spool written after this lands: it says its text is an automatic transcription that may be inaccurate
