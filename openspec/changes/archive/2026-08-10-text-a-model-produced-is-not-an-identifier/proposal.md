## Why

`the-tool-call-is-the-instruction` settles which of two channels a run should
believe. Auditing the rest of the app for the same mistake turned up two more
places where text is asked to do a job text cannot do. Both are the same error in
different clothing: **treating a string that a model produced, or that a recognizer
guessed, as though it were structured truth.**

**An answer is keyed by the question text, retyped by a model.** When a run pauses
to ask, the app relays the questions to the voice layer and gets answers back
through `answer_claude_question`, whose schema asks for *"the exact question text,
copied verbatim from the event"*. `resolvePendingPoQuestion` builds the answers map
with that string as the key, and `po-session.mjs` hands the map straight to the SDK
as `answers`. If the key does not match the question the SDK asked, that question
is simply not in the map — no error, no warning. The run proceeds as though nobody
answered, and depending on the verb's expiry policy either a default is applied or
the run stops, and the user is told a story about their answer that is not true.

The event that carries the question already carries two stable handles — a 1-based
ordinal and a short `header` label — and both are relayed to the voice layer. Neither
is used to key the answer. Instead the app depends on a speech model retyping a
sentence character-for-character, in a conversation where that model is speaking a
different language to the user than the sentence is written in, having just read the
question aloud in translation.

**A record of speech does not say that it is a guess.** Ambient session capture
writes `inputAudioTranscription` output to the vault, and the `capture_learning`
verb later reads those spools to weave durable wiki pages. This is the same
foundation `listen-window-is-bounded` removed meeting capture from. It survives for
a good reason — continuous retention has no better source, and a mishearing gets
caught during curation rather than read aloud to an audience — but the spool says
nothing about being an automatic transcription. The `ambient-session-capture` spec
already forbids presenting it as the user's own words; it says nothing about it
possibly being wrong.

## What Changes

- **The answer relay stops keying on question text.** The relayed question's stable
  ordinal becomes what an answer refers to. The voice layer reports which question
  it is answering by its number, not by retyping it.
- **An answer that matches no pending question is an error, not a silence.** The
  relay reports it, and the app does not proceed as though the question were
  unanswered when in fact it was answered and misfiled.
- **BREAKING** (tool schema): `answer_claude_question`'s per-answer entry takes the
  question's number. The verbatim-text field is kept as an optional corroborating
  field so a mismatch is diagnosable, but it no longer decides anything.
- **The ambient session spool says what it is** — an automatic transcription made
  while the conversation happened, which can be wrong — in the same self-describing
  header that already states it is a transcript of the room.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-decision-relay`: the relay gains a stable per-question handle and the rule
  that an answer is matched by it; an unmatchable answer becomes a reported error
  rather than an unanswered question.
- `ambient-session-capture`: the spool's self-description gains the fact that its
  text is an automatic transcription and may be inaccurate, alongside the existing
  rule that it is not the user's own words.

## Impact

**Modified**: `electron/run-stream.mjs` (`askUserQuestionViaVoice` relays a stable
handle; `resolvePendingPoQuestion` matches on it and rejects what it cannot match),
`electron/gemini-tools.mjs` (`answer_claude_question`'s parameter schema),
`electron/session-capture.mjs` (the spool header).

**Unchanged**: the SDK-facing shape — `po-session.mjs` still hands the SDK an
answers map keyed the way the SDK expects; only how the app *arrives* at that map
changes. The UI's own answer path, which never went through text matching. Every
expiry and timeout policy. What ambient capture retains, and under what consent.

**Not in scope, and checked**: `capture_note` takes the thought as a parameter the
voice layer writes from what it heard — already the pattern this family of changes
is establishing. `find_note_by_name`, `mutate_vault_notes`, `set_verb_model`,
`control_ui`, `get_ui_context` and the pre-dispatch review gate all decide from
parameters or from app state, never from transcript text. `mutate_vault_notes` does
match model-supplied note titles against the live graph, which is the same family —
but a title is the user-facing name of the thing, matching is accent- and
case-insensitive, and an ambiguous match is specified to be handed back to the user
rather than guessed. That one is mitigated where these two are not.
