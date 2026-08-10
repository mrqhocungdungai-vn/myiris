## Why

`listen-window-is-bounded` gave the listening mode its real purpose: the user is
presenting, someone asks a question, Iris takes it in, and the mode ends minutes
later. It stopped there — Iris holds the question and can talk about it, and that
is all.

But the reason to hold a question is to answer it, and in a sharing session the
answer usually already exists. The user prepared it. It is sitting in the folder
they are working out of, written the way they want it said.

Today Iris cannot reach it. Her note surface is deliberately narrow:
`find_note_by_name` matches titles and its own declaration says it "never reads
what a note says"; the open note in the reader reaches the voice layer as title
and tags only. **Every route to the contents of a prepared answer runs through the
`capture_learning` verb — a Claude run.** In front of a live audience that is wrong
on all four counts that matter: it costs a run, it costs money, it takes seconds
that everyone is watching, and it comes back in Claude's words rather than the
words the user wrote.

The material Iris needs is three things and no more: what the person said, what the
machine's speakers played, and the folder the user has open. None of the three
needs an agent. So none of this should be a verb.

## What Changes

- A new voice-callable function, `find_prepared_answer`, that searches the open
  workspace folder for material answering a question and returns it **verbatim**.
  No Claude run, no tokens, no execution slot, no credential — the same worker-free
  class as `capture_note` and `find_note_by_name`.
- **A settling step between listening and acting.** When the mode ends, Iris looks
  in the prepared folder straight away, before any verb is considered. Answering
  from what the user already wrote is the fast path, and it should be tried first
  rather than reached after a detour through an agent.
- **When something is found**, Iris says so in one short line and reads it out on the
  user's cue. She does not begin reading unprompted — the user turns the mode off
  intending to answer some questions themselves, and Iris talking over a live
  presentation is a worse failure than one extra beat.
- **When nothing is found**, Iris says so and offers the two routes that do cost
  something: search the folder properly with Claude Code, or retrieve from the notes
  vault. She asks; she does not pick.
- **BREAKING** (small): disengaging listen-only mode may now produce exactly one
  short line, where the current rule is that it produces none. Only a found
  prepared answer earns it; a miss stays silent until the user speaks.
- `find_note_by_name` plays no part in any of this. It matches titles and never
  reads contents, so pointing this flow at it would answer a question about
  contents from a filename — the exact failure its own declaration warns against.

## Capabilities

### New Capabilities

- `prepared-answers`: what Iris may read out from the folder the user has open,
  how she is asked to look, what she does when she finds nothing, and the bound on
  how much prepared material can reach the voice layer at once.

### Modified Capabilities

- `listen-only-mode`: the rule that disengaging produces no reply gains its single
  exception — one short line, only when a prepared answer was found for what was
  just heard. Everything else about the transition is unchanged, including that a
  miss volunteers nothing.

## Impact

**New**: a prepared-material reader under `electron/capabilities/` contributing a
`find_prepared_answer` declaration and prompt fragment on the existing capability
contract (`toolDeclarations` / `promptFragment` / `probe`), plus a pure matching
module with an injected `fs`.

**Modified**: `electron/run-dispatch.mjs` (one more worker-free case in the tool
switch, deliberately outside `PIPELINE_ONLY_TOOLS`); `electron/gemini-prompts.mjs`
(`LISTEN_ONLY_DISENGAGE_REQUEST` now points Iris at the folder instead of telling
her to wait); `electron/wiring-capabilities.mjs`.

**Unchanged**: the listening window and everything `listen-window-is-bounded`
settled; the notes vault and every existing note tool; the verb registry — this
adds no verb, and the two fallbacks route to verbs that already exist.
