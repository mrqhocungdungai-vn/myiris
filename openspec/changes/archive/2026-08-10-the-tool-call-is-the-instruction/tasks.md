## 1. The call becomes the instruction

- [x] 1.1 Remove the leading-transcript branch from `electron/run-context.mjs`: the `wordsLead` read, the `leadingTranscript` block, the "This is your instruction — follow it, and prefer it over the reading below" preamble, and `TRANSCRIPT_LEADING_LABEL`. Every verb composes as the non-leading path already does — brief first, transcript attached after (design D1)
- [x] 1.2 Rewrite `TRANSCRIPT_LABEL` so it states what the block is: a recent automatic transcription of what was said near the user's microphone, which may be inaccurate, present as corroboration and not as the request to act on (spec: "The transcript is labelled as fallible")
- [x] 1.3 Remove `wordsLead` from `electron/verbs.mjs` — the field from the record shape and its two declarations on `shape_on_canvas` and `work_on_note` (design D2)
- [x] 1.4 Update `electron/run-context.test.mjs` and `electron/verbs.test.mjs`: no composition path emits a leading transcript; the brief precedes the transcript for every verb including the two that used to lead; the new label appears and the old one is gone. A test asserting `wordsLead` behaviour should be deleted, not adjusted — the behaviour is gone
- [x] 1.5 `buildRunPrompt` has **two** call sites in `electron/run-exec.mjs` — `:612` (one-shot) and `:885` (resident turn). Both compose through `run-context.mjs`, so 1.1 covers both, but the comment at `:606-608` states the old rationale ("so the voice layer's summary is no longer the only thing this run sees") and must be rewritten. Verify both paths in test rather than assuming the shared composition point covers them

## 2. Widening the tool channel

- [x] 2.1 Widen `THIN_PARAMS.said` in `electron/verbs.mjs`: it currently reads "What the user just said, in their own words". It must admit speech the user did not utter — what was said, as you heard it, whoever said it, verbatim as far as you can manage, not tidied and not turned into a specification (design D3)
- [x] 2.2 Add optional `spoken_by` to `THIN_PARAMS`: whether the words were the user's own or someone else's the user was listening to. Optional, so no existing call becomes invalid; described so the voice layer knows it is provenance, not attribution of blame (design D3)
- [x] 2.3 Correct `shape_on_canvas`'s description: drop "so it already knows whatever was discussed by voice". Claude's resident session knows what Claude was told and has no access to the voice conversation; the sentence invites exactly the thin call this change makes load-bearing (design D5)
- [x] 2.4 Extend `electron/gemini-tools.test.mjs` and `electron/sdk-options.test.mjs` as the schema shape requires — `sdk-options.test.mjs` asserts complete option key sets, so a parameter change must be reflected rather than discovered

## 3. The listening-window boundary

- [x] 3.1 Add a boundary marker to `electron/renderer-bridge.mjs`: a stamped timestamp, set through an explicit setter rather than inferred from an `isOverheard()` edge — an engagement during which nothing was heard produces no edge, and that is the case where stale context misleads most (design D4)
- [x] 3.2 Call it from `setListenOnlyEngaged` in `electron/live-session.mjs`, the single writer for the transition, on disengage
- [x] 3.3 Apply it in `electron/run-context.mjs`: drop utterances older than the boundary before the transcript is bounded and fenced (spec: "Speech from before a listening window is not attached")
- [x] 3.4 Cover it in `electron/renderer-bridge.test.mjs` and `electron/run-context.test.mjs`: an engagement that heard nothing still sets the boundary; utterances from before it are excluded; utterances after it are kept; with no engagement ever, nothing is excluded

## 4. Documentation

- [x] 4.1 Update the run-context reasoning in `docs/PIPELINE_INTERNALS.md` — the transcript's role changes from "so a bad summary is not the only thing the worker sees" to "corroboration beside an instruction that comes from the call"
- [x] 4.2 State the principle in `docs/REFERENCE.md` beside the pinned Gemini Live identifiers: `inputAudioTranscription` is an optional side channel, not the model's understanding, and nothing downstream may treat it as authoritative
- [x] 4.3 Update the `CLAUDE.md` conventions list if the verb-registry line needs it — `wordsLead` leaving is a registry field disappearing, and the registry is documented as the single definition

## 5. Gates

- [x] 5.1 `npm run build`
- [x] 5.2 `npm test`
- [x] 5.3 `npm run lint`
- [x] 5.4 `npm run scan:secrets`
- [x] 5.5 `npm run spec:check`
- [x] 5.6 `grep -rn wordsLead electron docs openspec/specs` returns nothing outside `openspec/changes/archive/`

## 6. Verify in the running app (for the user — these need a live session and a second speaker)

- [ ] 6.1 `npm run dev`. Open the canvas, ask for a diagram by voice: it draws what was asked, as before — this is the regression to watch, since the canvas is what the removed rule was built for
- [ ] 6.2 Say something the voice layer is likely to tidy ("take out the bit about the deadline"): the exact instruction still lands, now carried by `said`
- [ ] 6.3 The reproduction of the original bug: talk about topic A, engage listen-only, have someone ask about topic B, disengage, ask Iris to draw what was just asked. It draws B — not A, which is what it drew before this change
- [ ] 6.4 Repeat 6.3 with an engagement during which nothing at all was heard: no stale block is attached, and the boundary is still set
- [ ] 6.5 Check the diagnostic log (`~/.myiris/logs/iris.log`) for one of these dispatches: the brief leads with the call's parameters and the transcript follows under the new label
