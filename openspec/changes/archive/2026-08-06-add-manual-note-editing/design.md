## Context

See proposal.md — Why, and its "The rule this change has to change" section for
the spec conflict this resolves rather than bypasses.

The constraints that shape the approach:

- **The write guard already exists and already anticipates a writer.**
  `resolveVaultNotePath(id)` in `electron/capabilities/second-brain.mjs`
  type/bound-checks the id, resolves it through the single graph cache (never a
  ghost, never an unknown id), realpaths it, and re-asserts containment in the
  vault. Its own comment says "before the caller may read OR write it. Shared by
  read-note and the structural-edit surface below so the guard exists in exactly
  one place." Nothing new needs inventing; a new caller joins it.
- **`second-brain.mjs` is Electron-free**, and `main-process-structure` confines
  Electron API access to `main.mjs`, `ipc.mjs`, `window.mjs` and
  `renderer-security.mjs`. Opening a file in another app needs `shell.openPath`.
- The capability is built by `wiring-capabilities.mjs` with injected
  collaborators (`emitEvent`, `emitToRenderer`, `notifyIris`, `irisPluginDir`,
  …), and it returns IPC channel descriptors that `ipc.mjs` registers.
- `notifyIris` + the `SYSTEM_EVENT_NOTE_OPENED` / `_CLOSED` pattern in
  `announceNoteOpened()` is the established way to tell the voice layer
  something about the open note, silently, without spending a run.
- `ReaderCore` owns all three close routes: an `Escape` key listener, an effect
  on `hand?.fist`, and the × control, all funnelling through one
  `closeWithSnap()`.
- `App.tsx` owns `openNote = { id, title, markdown }` and fetches content via
  `readSecondBrainNote(id)`, which returns `{ ok, content }` — the **raw file
  text, frontmatter included**, which is already what the reader is handed.
- `main-thread-budget` forbids blocking the renderer on synchronous modal
  dialogs, so `window.confirm` is not available for the discard prompt.

## Goals / Non-Goals

**Goals:**

- One new write caller, guarded by the existing resolver, invisible to models.
- No lost work on any close route, without a blocking dialog.
- Concurrent-write safety that refuses rather than guesses.

**Non-Goals:**

- No autosave, no draft persistence across reader close, no undo history beyond
  what a `<textarea>` gives for free.
- No markdown preview-while-editing, no syntax highlighting, no WYSIWYG. The
  external-editor route is the answer for anything the field is too small for.
- No rename (the note's identity derives from its path, so renaming is a
  different operation with graph-identity consequences — out of scope).
- No new-note creation from the reader; capture already owns that.
- No change to how the note session edits a note. This change only tells the
  voice layer the note changed; making the session re-read is its own behaviour,
  already required by `open-note-session`.

## Decisions

### D1 — The write is a new caller of the existing guard, not a new guard

`secondbrain:write-note` resolves its target through `resolveVaultNotePath(id)`,
exactly like `read-note`, and writes only if that returns a path. A ghost node,
an unknown id, a since-deleted file and a symlink escaping the vault are all
already refused by that function, so the write inherits every one of those
refusals rather than restating them — which is the point of the resolver having
been written as shared in the first place.

The channel is registered in the same descriptor list as `read-note`, so it is
reachable only over IPC from the renderer. It is not a verb, not an MCP tool, and
not in the skills surface — which is what keeps the modified
`personal-knowledge-notes` requirement true.

### D2 — Revision token: a content hash, not an mtime

The token is a SHA-256 of the exact bytes served, returned by `read-note` and
required by `write-note`, which re-reads the file, re-hashes it, and refuses on
mismatch.

Rejected: `mtimeMs`. It is cheaper but it answers a slightly different question
(when was it touched, not what does it contain), it can collide within a
millisecond, and it can change without the content changing — which would refuse
a save the user should have been allowed to make. Hashing a note-sized file is
irrelevant next to the IPC round trip.

Rejected: locking the file while the reader is open. The whole design of this
vault is that other writers exist and are welcome; a lock would make Iris the
obstacle rather than a participant.

The overwrite path is the same channel with an explicit force flag — one code
path, one guard, with the refusal skipped only when the user has said so.

### D3 — The external opener is injected, not imported

`second-brain.mjs` gains an injected `openPathExternally` collaborator, supplied
by `wiring-capabilities.mjs` from Electron's `shell.openPath`. The capability
stays Electron-free (so it stays importable in a plain vitest file, per
`main-process-structure`), the Electron dependency stays in the wiring layer, and
the behaviour is testable with a fake that records what path it was handed.

Rejected: registering the channel directly in `ipc.mjs`. It would split the
second-brain IPC surface across two files and put the path-resolution call site
away from the resolver it must use.

### D4 — `ReaderCore` gains a close guard, rather than `NoteReader` re-implementing close

An optional `closeGuard?: () => boolean` is consulted by `closeWithSnap()`:
returning false means the guard has handled the attempt and the reader must stay
open. One hook covers `Escape`, the fist gesture and the × control together,
because they already funnel through that one function.

Rejected: `NoteReader` adding its own key listener and fist effect. Two components
would then decide when the reader closes, and the note reader's listener would
race `ReaderCore`'s on the same `Escape`.

Gesture suspension while editing is separate and simpler: `NoteReader` passes
`hand={null}` and `gesturesEnabled={false}` downward while the editor is active,
which is the same mechanism that already turns the reader's gesture bindings off
when hand control is off. Nothing new in `ReaderCore` for that.

### D5 — The discard prompt is inline reader state

A third render state in the note reader — read / edit / confirm-discard — showing
"Discard unsaved changes?" with a discard and a keep-editing action.
`window.confirm` is unavailable (`main-thread-budget` forbids blocking the
renderer on a synchronous modal), and the app already has the pattern for inline
banners that ask something (`ReviewBanner`, `PoQuestionBanner`).

### D6 — Announce, do not reconcile

A successful save that targeted the **currently open** note pushes one
`notifyIris` event mirroring `announceNoteOpened`'s shape: silent, "remember
this, do not speak", stating that the open note's text changed and that any
earlier reading of it is superseded. A save while no note is open announces
nothing.

Iris deliberately does not try to reconcile the session's prior paragraph
division with the new text. There is no correct way to do that from outside the
session, and a wrong reconciliation is exactly the failure the
read-back-verbatim requirement exists to prevent — being told to re-read is both
cheaper and honest.

### D7 — The galaxy needs no change at all

The vault watcher already rebuilds the graph on any file change under the vault
and pushes the full position-free graph, and the renderer already reconciles it
against its own positions. A hand-edited title, tag or `[[wikilink]]` therefore
lands in the galaxy by the path every other write already uses. Worth stating
because "the graph must be told" is the obvious-looking wiring that would have
been redundant.

## Risks / Trade-offs

- **The modified security requirement is the real risk of this change.** The
  mitigation is structural rather than procedural: the write is not exposed on
  any model-reachable surface, and the spec now carries a scenario asserting
  exactly that, so a future change that exposed it would have to fail a stated
  scenario rather than merely be in poor taste.
- **A `<textarea>` is a poor editor for a long note** → that is what the
  external-editor route is for, and it ships in the same change rather than
  being promised later.
- **The revision check refuses a save the user may feel entitled to make** (e.g.
  they edited in Obsidian and then in Iris) → the refusal preserves their draft
  and the overwrite is one explicit action away; the alternative, silently
  clobbering a concurrent write, is the failure that cannot be undone.
- **Frontmatter can be broken by hand**, producing a malformed note → already a
  supported state: the graph parser yields an untagged node for a note with
  invalid frontmatter and does not fail the build, per
  `second-brain-galaxy-view`. Editing raw text means the user can see and fix
  what they broke, which a hidden-frontmatter editor would not allow.
- **Editing while the note session holds the note in context** → D6's
  announcement is what makes that visible instead of silent. It does not make the
  session re-read; that is the session's own required behaviour.
