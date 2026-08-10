## Why

Gemini Live is a **voice-to-voice model with tool use**. It takes audio in, reasons
over it, and emits speech and function calls. `inputAudioTranscription` is not how
it understands anything — it is an optional side channel, opted into by one line of
session config (`live-config.mjs`), running a separate recognizer over the same
audio. Turn it off and the model works exactly as before; its comprehension never
passes through it.

This app treats that side channel as the authority. `run-context.mjs` attaches the
transcript to every run, and for a canvas or note turn it puts the transcript
**first** with the instruction *"prefer it over the reading below wherever the two
differ"*. The thing that actually heard the audio is demoted to "the reading". An
ASR pass whose errors are silent outranks the model whose errors are not.

The bill came due the first time the two diverged for a structural reason rather
than a transcription one. After a listening window, overheard speech is
deliberately kept out of the recent-utterance ring, and the ring holds ten minutes
where the window holds five — so the block that leads a canvas turn is **whatever
the user said before they engaged the mode**, presented as the instruction, with
Claude told to prefer it. Iris drew the previous topic, correctly, from what she
was told to trust.

That is not a listen-only bug. It is the general shape showing itself: the
transcript was never the model's understanding, and building the worker's
instruction out of it was backwards from the start. The channel that carries what
Gemini understood already exists and is already declared — `THIN_PARAMS.said` asks
the voice layer for what it heard, in its own words. The app collects that, then
overrides it.

## What Changes

- **The voice layer's tool call becomes the instruction, for every verb.** What
  Gemini passes in the call is what the run acts on. It is the output of the
  component that processed the audio, and nothing downstream outranks it.
- **BREAKING**: the leading-transcript path is removed. No run is told to prefer
  transcript text over the parameters of the call that started it. The two verbs
  that declared it (`shape_on_canvas`, `work_on_note`) lose the declaration.
- **The transcript stays, demoted and relabelled.** It remains attached, fenced and
  bounded, as corroboration — material that may catch a detail the call dropped. Its
  label stops calling it "the request to act on" and starts saying what it is: an
  automatic transcription that can be wrong.
- **The tool schema gets the room the override was compensating for.** `said` is
  widened to cover speech the user did not utter — the question an audience asked
  them — and a new optional field records who was speaking, so a canvas turn after a
  listening window is unambiguous about whose words it carries.
- **Transcript from before a listening window is not attached as recent context.**
  Speech separated from the request by a five-minute interruption is not the
  conversation the request came from.
- Verb descriptions stop telling the voice layer that the worker already knows what
  was discussed by voice. `shape_on_canvas` says its session "already knows whatever
  was discussed by voice" — Claude's session knows what Claude was told, not what
  Gemini overheard, and that sentence invites exactly the thin call this change
  makes load-bearing.

## Capabilities

### New Capabilities

None. This changes the standing of two channels that both already exist.

### Modified Capabilities

- `verb-tool-surface`: the requirement that the user's words reach the worker is
  reframed — the transcript is corroboration, never the instruction, and is not
  attached when it predates a listening window. A new requirement states that the
  voice layer's tool call carries the instruction and that the schema, not a second
  channel, is where a thin brief gets fixed.
- `voice-decision-relay`: the requirement that the user's verbatim utterance leads a
  live canvas turn is removed. Its flush-before-dispatch half is kept, on its own
  terms — the transcript should still be current when it is attached, it just no
  longer leads.

## Impact

**Modified**: `electron/run-context.mjs` (the leading-transcript branch goes; the
labels change; the listening-window boundary is applied), `electron/verbs.mjs`
(`wordsLead` removed from the registry and its two declarations; `THIN_PARAMS`
widened; `shape_on_canvas`'s description corrected), `electron/renderer-bridge.mjs`
(the ring records where a listening window ended).

**Unchanged**: fencing, on every path — this governs standing and order, not trust.
The transcript's bounds. The ring itself, and every other consumer of it. The
stateless verbs' concrete parameters, which were already the instruction. Everything
`listen-window-is-bounded` and `iris-answers-from-the-open-folder` settled — the
prepared-answer lookup already takes its question from a tool parameter rather than
the transcript, which is the pattern this change makes general.
