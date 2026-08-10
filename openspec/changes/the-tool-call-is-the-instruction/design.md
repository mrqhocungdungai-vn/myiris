## Context

See proposal.md — Why. What the code does today, and the two facts the approach turns on:

- **`run-context.mjs` composes every brief**, and its `wordsLead` branch emits the transcript first under the line *"This is your instruction — follow it, and prefer it over the reading below wherever the two differ."* Two verbs declare it: `shape_on_canvas` and `work_on_note`.
- **`inputAudioTranscription: {}` is one line of session config** in `live-config.mjs`. It is opt-in, it runs a recognizer beside the conversation, and removing it would not change a single thing about how the model behaves. That is the whole argument: a channel the model does not need in order to work cannot be the channel that carries what the model understood.
- **The parameter channel already exists.** `THIN_PARAMS.said` asks the voice layer for "what the user just said, in their own words and as close to verbatim as you can manage". The app collects it, then overrides it.
- **`renderer-bridge.mjs` keeps the ring for 10 minutes** (`RECENT_UTTERANCE_MAX_AGE_MS`) and excludes overheard speech from it entirely, while a listening window runs at most 15 and by default 5. The overlap is structural, not incidental.

## Goals / Non-Goals

**Goals:**

- One authority per run: the call that started it.
- The transcript keeps the job it is actually good for — catching a dropped detail — and loses the one it was never qualified for.
- Where a call is too thin, the schema is what gets richer.

**Non-Goals:**

- Removing the transcript from runs. The problem `run-context.mjs` was built to solve is real: a voice layer asked to summarize does drop details. Subordination fixes the inversion; deletion would reintroduce the bottleneck.
- Any change to fencing. Every path stays fenced as untrusted, before and after.
- Touching `inputAudioTranscription` itself. It still drives the on-screen transcript, the live readout, and ambient capture, all of which are display or retention concerns where fallible text is acceptable and labelled.
- Re-litigating the stateless verbs. Their concrete parameters were already the instruction; this change only makes the general rule say so.

## Decisions

### D1: The transcript is demoted, not deleted

Its standing changes and its label changes; its presence, bounds, and fencing do not.

`TRANSCRIPT_LEADING_LABEL` goes. `TRANSCRIPT_LABEL` currently says "as background context only", which is nearly right but omits the fact that matters most: it can be wrong. The new label states that it is an automatic transcription and may be inaccurate, so a run that finds it disagreeing with its instruction knows which one to doubt.

Alternative considered: drop the transcript from briefs entirely, since the call now carries everything. Rejected — a voice layer under a thin schema genuinely does drop details, and a second, clearly-subordinate view of the same moment costs a bounded number of tokens and occasionally saves a turn. The failure here was standing, not presence.

### D2: `wordsLead` is removed from the registry, not fixed per verb

It is a registry field with two declarations, and its premise fails identically for both. A per-verb exemption would leave the inversion in place everywhere it had not yet produced a visible bug.

What the two verbs actually needed — the user's half-finished sentence rather than a tidied restatement — is a real need and does not go away. It is served by D3: the call itself carries the verbatim the voice layer heard, which is what `said` was always for.

### D3: `THIN_PARAMS` is where thinness gets fixed

This is the change's positive half, and the reason it is framed around tool use rather than around deleting a code path.

- `said` — its description is widened to admit speech the user did not utter. Today it says "what the user just said", which leaves the voice layer with nowhere legitimate to put a question an audience asked. It becomes: what was said, as you heard it, whoever said it, verbatim as far as you can manage, not tidied and not turned into a specification.
- `spoken_by` — new, optional: whether the words were the user's own or someone else's that the user was listening to. One token of provenance, so a canvas turn after a listening window is unambiguous about whose request it is carrying, without the run having to infer it.

Alternative considered: a larger structured schema enumerating context. Rejected on the registry's own reasoning — enumeration *is* summarization, and summarization is what drops things. The schema needs room for verbatim and provenance, not a form to fill in.

### D4: The listening-window boundary is recorded explicitly, not inferred

`renderer-bridge.mjs` gains a marker stamped when a listening window ends, and `run-context.mjs` drops utterances older than it.

Set explicitly by the mode's own writer (`setListenOnlyEngaged` in `live-session.mjs`, already the single authority for the transition) rather than inferred inside the bridge from an `isOverheard()` edge. The bridge observes that predicate only when text arrives, so an engagement during which nothing was heard would leave no edge to detect — and that is exactly the engagement after which stale context is most misleading.

With `wordsLead` gone this is no longer the difference between a right and a wrong drawing, but it is still unrelated speech presented as the conversation the request came from, and it costs one timestamp to be correct instead.

### D5: `shape_on_canvas`'s description is corrected in the same change

> *"It continues the SAME conversation as `shape_requirements`, so it already knows whatever was discussed by voice."*

Claude's resident session knows what Claude was told. It has no access to the voice conversation. The sentence tells the voice layer it can safely under-specify, which is harmless while a second channel is compensating and harmful the moment the call becomes the instruction. Correcting it belongs here, not in a follow-up.

## Risks / Trade-offs

**The canvas and note verbs lose the guarantee that the user's exact half-finished sentence outranks a tidied reading.** → That sentence still reaches the run, now through `said`, which was already asking for it verbatim; and the transcript is still attached to catch the case where the voice layer tidied anyway. What is lost is the instruction to *prefer* text the model never produced. If in practice the voice layer starts tidying `said` despite the schema, the fix is the schema's wording — which is where it should have been all along.

**Fixing a prompt-shaped problem with prompt-shaped means is not enforceable.** → True, and stated plainly rather than papered over. The schema is a contract the calling interface enforces; the description is advice. This change moves what it can into the contract (`spoken_by`, the widened `said`) and accepts advice for the rest, which is the same split the registry already lives with.

**Two changes land close together on the same listening path.** → `iris-answers-from-the-open-folder` takes its question from a tool parameter and never touches the transcript, so it is already on the far side of this change. The two do not overlap in code; this one touches `run-context`, `verbs`, and `renderer-bridge`, none of which the prepared-answer path uses.

## Migration Plan

No data or configuration migration. `wordsLead` disappears from the registry, so no verb can carry a stale declaration. Rollback is `git revert`, and the transcript's presence and bounds are unchanged in either direction — only its standing and its label move.
