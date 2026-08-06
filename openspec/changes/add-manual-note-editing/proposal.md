## Why

A note can be opened and read in Iris, and it can be changed by talking to
Claude. It cannot be changed by hand. `NoteReader.tsx` renders
`<ReactMarkdown>` and nothing else; there is no editor, no save, and **no write
channel from the renderer at all** — the second-brain preload surface is
`availability`, `get-graph`, `read-note`, `activate`/`deactivate`,
`graph-updated`, `note-opened`/`note-closed` and the three focus calls. Every
byte the vault has ever received was written by the main process on a model's or
a capture's behalf.

That is a strange gap for a personal knowledge vault. Fixing a typo means
dictating a correction to an LLM and hoping it edits the right sentence, or
leaving Iris entirely and opening the folder in another app. The user can *see*
their note in the reader and cannot touch it.

## What Changes

- **The note reader gains an edit mode.** A control switches the body from
  rendered markdown to the note's raw text in an editable field; Save writes it
  to the vault; Cancel discards. The rendered view is what it is today.
- **Unsaved edits cannot be lost by any close route.** While edits are pending,
  Esc, the × button, and the fist-closes-reader gesture all stop closing the
  reader and ask instead — inline, never a blocking dialog. Hand gestures are
  suspended entirely while the editor has focus, so a `Closed_Fist` cannot
  discard what is being typed.
- **A save cannot silently clobber a concurrent change.** `read-note` starts
  returning a revision token for the content it served; a save carries that
  token back and is **refused** if the file on disk no longer matches — because
  Claude's note session, a capture, or another app may have written it in
  between. The refusal keeps the user's draft and offers an explicit overwrite;
  it never picks a winner on its own.
- **A hand edit invalidates the note session's reading.** The resident session
  for a note reads it back and then edits it by paragraph reference. If the file
  changes underneath that reading, "drop the second paragraph" resolves against
  text that is no longer there. A manual save therefore tells the voice layer
  the open note changed, so the next turn re-reads rather than acting on a stale
  division.
- **A second route out: open the note in the system's default editor.** One
  control, resolved by note identity in the main process like every other vault
  path. The full power of Obsidian or any editor, for the cases the in-app field
  is the wrong tool for — and useful immediately, independent of how good the
  in-app editor is.
- **BREAKING (spec, deliberate):** `personal-knowledge-notes` currently forbids
  exactly this. See below.

## The rule this change has to change

`personal-knowledge-notes`, "A structural edit targets a note by identity, never
by a supplied path", says:

> "The operations Iris will perform SHALL be an enumerated set. A general 'apply
> this content to this note' primitive would make every future caller —
> including a model — able to write arbitrary bytes anywhere the vault reaches,
> which is not a bound that can be audited."

…with a scenario asserting the write surface exposes "no general
arbitrary-content write". An in-app editor **is** that primitive, so this change
cannot be built without reckoning with the rule rather than quietly working
around it.

The reasoning it gives is about **who the caller is**: "every future caller —
including a model — able to write arbitrary bytes". A user typing into their own
note is not that caller. The bytes are authored by the person who owns the
vault, in a field they opened, replacing content they are looking at.

So the rule is **split by caller rather than dropped**:

- The **model-facing** write surface stays exactly as it is — an enumerated set
  of named structural operations, no arbitrary-content primitive. Nothing a model
  can call changes.
- A **user-authored content write** is added, reachable only from the note
  reader's editor, carrying the identical identity resolution, symlink
  resolution and in-vault containment guard, and explicitly **not** exposed as a
  tool, a verb, or any other model-reachable surface.

What the original rule protects — that a model cannot write arbitrary bytes into
the vault — is unchanged. What it incidentally also forbade — that the vault's
owner cannot type in their own note — is what this change lifts.

## Capabilities

### New Capabilities

<!-- none: three existing capabilities change -->

### Modified Capabilities

- `personal-knowledge-notes`: the enumerated-operations rule is split by caller
  as above — the model-facing surface unchanged, a user-authored content write
  permitted under the same path guard and barred from every model surface.
- `second-brain-galaxy-view`: "Opening a node shows the note's content" becomes
  read *and* edit — the reader's editing mode, the no-lost-edits rule, the
  stale-write refusal, and the hand-off to an external editor.
- `open-note-session`: gains the rule that a hand edit to the open note
  invalidates the session's reading of it, so a paragraph-referring follow-up
  cannot act on text that has since changed.

## Impact

- `electron/capabilities/second-brain.mjs` — a `write-note` handler and an
  `open-externally` handler, both resolved through the existing
  `resolveVaultNotePath(id)` (whose own comment already anticipates a writer:
  "before the caller may read OR write it"); `read-note` gains the revision
  token; a `notifyIris` announcement mirroring `announceNoteOpened`.
- Opening a file in another app needs Electron's `shell`, which the
  `main-process-structure` rule confines to four modules — so the opener is
  **injected into the capability factory** like its other collaborators, keeping
  `second-brain.mjs` Electron-free and the behaviour testable with a fake.
- `electron/preload.cjs`, `src/types.ts` — the two new calls and the revision on
  the existing read.
- `src/components/NoteReader.tsx` — edit mode, the discard prompt, the two new
  controls, gesture suspension while editing.
- `src/components/ReaderCore.tsx` — an optional close guard so the note reader
  can intercept all three close routes in one place rather than reimplementing
  Esc/fist/× handling.
- `src/App.tsx` — passes the note id and revision it already fetched; updates its
  `openNote` state after a save.
- `src/styles/` — the editor field and the discard prompt.
- `docs/ARCHITECTURE.md`, `docs/PIPELINE_INTERNALS.md` — whichever documents the
  second-brain IPC surface gains the two calls.
- No new dependency; no change to the Claude pipeline, the verb registry, or any
  model-facing tool.
