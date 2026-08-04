## Why

Capturing a note is a filesystem append, but Iris implements it as an agentic
Claude run: the `capture_learning` verb, a cold one-shot `query()` carrying six
`wiki-*` skills. So writing one line costs seconds of latency and tokens, and it
is **unavailable entirely without a Claude credential** — the advertised second
brain does not exist on a `GEMINI_API_KEY`-only install.

The living spec already carries two requirements that exist only to defend
against using an agent for a file write: pre-seeding `wiki-config.md` so the run
does not stall asking the user to complete an interactive setup step it cannot
answer, and verifying a file appeared on disk because the worker's own claim of
success is not trustworthy. Both are correct, and both treat the symptom.

The repo already states the right doctrine, in `electron/run-inbox.mjs`: *"This
is a file append, not a run. … Raw capture is a log; synthesis is the learning."*
That doctrine was applied to Iris's own run records and never to the user's own
thoughts. This change removes that asymmetry.

It also fixes a verified defect that the same split caused. `run-inbox.mjs`
appends to `inbox/runs/<date>.md`, but the user-note predicate excludes only
`templates/`, `raw/`, `archive/`, and `ingested/` — so **every day Iris is used
adds a junk galaxy node named after a date**, growing forever, in direct
contradiction of the galaxy spec's stated intent that only user notes become
nodes.

## What Changes

- **Capture becomes a direct write.** A new Electron-free vault write module
  appends a capture to the vault's machine-written spool and creates a
  schema-conformant note page, using the existing atomic-write helper. No run, no
  tokens, no execution slot.
- **A new voice-layer tool captures a thought synchronously.** It returns after
  the file exists, so the existing "confirm only after verifying the file" rule
  becomes true by construction rather than by inspection after the fact.
- **Capture stops being gated on the Claude pipeline.** It needs no worker, so it
  is declared in chat-only mode alongside the interface-only tools. Curation
  remains gated, because curation is a real run.
- **`capture_learning` becomes the curator, not the way notes get in.** It keeps
  its name, its six skills, and its cheapest-model budget; its job narrows to
  crystallizing and integrating what has accumulated. That is the work those
  skills were written for, and the one place their setup ceremony is affordable.
- **The vault's machine-written spool is declared not-a-user-note**, so it never
  becomes galaxy nodes. Fixes the date-node pollution above.

Non-goals, deliberately deferred so this change stays small and reviewable:
renderer→vault write IPC and the shared Focus (change `shared-focus`); opt-in
session-transcript spooling, which carries a privacy surface that deserves its
own review (change `ambient-memory`); the galaxy↔canvas bridge; and replacing or
forking the vendored `wiki-*` skills.

## Capabilities

### New Capabilities

None. This change deepens existing capabilities rather than adding a surface —
the write path is a mechanism serving `personal-knowledge-notes`, and the
behavior belongs to that capability rather than to a new one.

### Modified Capabilities

- `personal-knowledge-notes`: capture is a direct file write rather than a worker
  run; it is available without a Claude credential; the notes verb narrows to
  curation; and the vault's machine-written spool areas are declared not user
  notes.
- `second-brain-galaxy-view`: the user-note exclusion the scan applies gains the
  spool folder, so automatically-appended bookkeeping never becomes nodes.
- `pipeline-availability`: the chat-only exception broadens from "interface-only
  (UI control) tools" to also cover tools that need no Claude worker at all, so
  capture survives chat-only mode while every Claude-delegating tool stays gated.

## Impact

**New:** `electron/vault-write.mjs` (+ tests) — Electron-free, injected `fs`,
never throws, mirroring `run-inbox.mjs`.

**Changed:** `electron/capabilities/second-brain.mjs` (own the write path, expose
the capture tool declaration and its handler, narrow the prompt fragment's offer
language); `electron/vault-graph-parse.mjs` (`NOTES_PLUMBING_FOLDERS` gains the
spool folder); `electron/verbs.mjs` (`capture_learning`'s description and clause
narrow to curation); `electron/gemini-tools.mjs` (declare the capture tool
outside the pipeline gate); `electron/run-inbox.mjs` (write through the new
module rather than its own `appendFileSync`).

**Depends on:** `electron/atomic-file.mjs`, the existing vault-readiness
(`ensureNotesVaultReady`) and pre-seeding logic.

**Not touched:** the galaxy renderer, the gesture layer, the run queue, the
canvas, and `~/.claude` isolation.

**User-visible:** capture is instant and free; notes work with only
`GEMINI_API_KEY`; the galaxy stops accumulating date-named junk nodes. Existing
vaults keep working — previously-created date nodes simply stop being rendered.
