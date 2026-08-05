## Why

A knowledge graph is worthless until it has content, and deliberate note-taking
will not fill it. The evidence is on the developer's own machine: `~/iris-second-brain`
does not exist. The person who built the second brain does not use it.

Capture is now instant and free (`vault-write-path`), which removes the cost
barrier but not the effort barrier — the user still has to decide, mid-thought,
that something is worth keeping. Most of what is worth keeping is not recognized as
such at the time.

Meanwhile Iris already has the material and throws it away. The verbatim utterance
ring in `renderer-bridge.mjs` is RAM-only and pruned by age, so **every
conversation Iris has is discarded**. Iris is an always-on voice companion that
remembers nothing it said yesterday. That is the gap: not a better note editor, but
memory that accumulates from what the user already does all day.

This change makes that accumulation possible **as an explicit opt-in**, because the
mechanism is a microphone transcript written to disk and that is not something to
switch on for someone by default.

## What Changes

- **A new opt-in ambient session capture**, default off, persisted, and revocable.
  While enabled, the conversation's already-retained utterance text is spooled into
  the vault's machine-written spool, so what was discussed survives the session.
- **Text only, never audio.** What is spooled is the transcript Iris already keeps
  in memory to give runs context. No audio is written, kept, or transmitted anywhere
  new.
- **Visible whenever it is on.** The interface indicates that the session is being
  recorded to the vault, and offers a way to stop, whenever capture is active — a
  preference agreed to once is not standing consent for an indicator-free
  microphone log.
- **Flushed as it goes, not only at the end**, with a watermark so a flush cannot
  append the same utterance twice and a crash cannot lose the session.
- **Nothing is captured while Iris is asleep** — capture follows the microphone,
  so what is not being streamed is not being retained.
- **The curator reads it.** The existing notes verb's scope widens to the session
  spool, and the backlog that drives its "worth weaving in?" offer counts it, so
  accumulated conversation becomes curated pages when the user asks.
- **It is a transcript of the room, not of the user.** The microphone does not
  distinguish who is speaking near it. This is stated in the interface, in the
  documentation, and in the spec, because a user deciding whether to enable it needs
  to know that other people's speech may land in the file.

Non-goals: speaker identification or diarization; capturing anything the utterance
ring does not already hold; automatic synthesis (the existing rule that synthesis is
deliberate and offered rather than imposed continues to hold); and any transmission
of the spool anywhere — it is a local file in a folder the user already owns.

## Capabilities

### New Capabilities

- `ambient-session-capture`: the opt-in retention of conversation text into the
  vault — its consent model, its visibility, what it may and may not retain, when it
  flushes, and how it is revoked.

### Modified Capabilities

- `personal-knowledge-notes`: the machine-written spool gains a third kind of
  content (session transcripts alongside captures and run-outcome records), and the
  curator's scope and backlog count widen to include it.

`second-brain-galaxy-view` is deliberately **not** modified: the spool exclusion it
already carries is root-scoped at `inbox/`, so a session spool inside it is excluded
by the rule that is already there. That is the exclusion earning its keep rather
than needing an amendment.

## Impact

**New:** `electron/session-capture.mjs` (+ tests) — Electron-free, the watermark and
the flush policy; a preference row in the SetupPanel; a recording indicator in the
renderer.

**Changed:** `electron/renderer-bridge.mjs` (expose the retained utterances for
flushing without changing the ring's existing bounds); `electron/user-config.mjs` or
the session store (the persisted preference, however the sibling sound/camera
preferences are stored); `electron/capabilities/second-brain.mjs` (the session spool
directory, wiring the flush, the backlog count); `electron/verbs.mjs`
(`capture_learning`'s clause names the session spool); `.env.example` (the new
`IRIS_*` variable); `docs/` (what is retained, where, and how to turn it off).

**Privacy surface — the whole point of the change being separate.** This is the only
feature in Iris that writes what was said near the microphone to disk. It is
default-off, indicated while active, revocable, plain-text and prunable by hand,
and never leaves the machine. It is reviewed on its own rather than riding in on
another change.

**User-visible:** with it off, nothing changes at all. With it on, the second brain
fills from conversation, an indicator shows while it is recording, and the notes
verb has real material to weave.
