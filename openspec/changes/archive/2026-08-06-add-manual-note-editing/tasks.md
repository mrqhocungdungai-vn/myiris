## 1. Main-process write surface

- [x] 1.1 Add a `revision` (SHA-256 hex of the exact content served) to `secondbrain:read-note`'s success result in `electron/capabilities/second-brain.mjs` (design.md D2)
- [x] 1.2 Add a `secondbrain:write-note` handler taking `{ id, content, revision, force }`: resolve through the existing `resolveVaultNotePath(id)`, re-read and re-hash the file, refuse with a `stale` reason on mismatch unless `force`, then write and return the new revision (design.md D1/D2)
- [x] 1.3 Type/bound-check `content` like every other renderer-supplied value the module already checks, and refuse anything that is not a string
- [x] 1.4 Add `announceNoteEdited()` mirroring `announceNoteOpened()`'s shape — silent, "remember this, do not speak", stating the open note's text changed and any earlier reading is superseded — and call it from the write handler **only** when the saved id is the currently-open note (design.md D6)
- [x] 1.5 Accept an injected `openPathExternally` collaborator in `createSecondBrainCapability`, and add a `secondbrain:open-note-externally` handler that resolves the path through `resolveVaultNotePath(id)` and hands it to that collaborator — no `electron` import in this module (design.md D3)
- [x] 1.6 Supply `openPathExternally` from `electron/wiring-capabilities.mjs` using Electron's `shell.openPath`
- [x] 1.7 Extend `electron/capabilities/second-brain.test.mjs`: read-note returns a revision; write-note writes on a matching revision; write-note refuses on a stale revision and leaves the file untouched; `force` overwrites; a ghost id, an unknown id and a symlink-escaping note are all refused; the open-note announcement fires only when the saved note is the open one; the external opener is handed the resolved path and never a renderer-supplied one
- [x] 1.8 `npm test` green

## 2. Renderer bridge

- [x] 2.1 Add `writeSecondBrainNote(id, content, revision, force)` and `openSecondBrainNoteExternally(id)` to `electron/preload.cjs`, beside the existing second-brain calls
- [x] 2.2 Update the `window.iris` types in `src/vite-env.d.ts` (not `src/types.ts` — that is where the bridge is actually declared): the two new calls, and `revision` on `readSecondBrainNote`'s result
- [x] 2.3 `npm run build` (typecheck) clean

## 3. Reader close guard

- [x] 3.1 Add an optional `closeGuard?: () => boolean` prop to `src/components/ReaderCore.tsx`, consulted at the top of `closeWithSnap()` — returning false leaves the reader open (design.md D4)
- [x] 3.2 Confirm all three close routes funnel through `closeWithSnap()` (the `Escape` listener, the `hand?.fist` effect, and the × control) so one guard covers them all, and that the task run-reader — which passes no guard — is unaffected

## 4. Note editor

- [x] 4.1 Give `src/components/NoteReader.tsx` its three render states — read / edit / confirm-discard — plus `noteId`, `revision`, and an `onSaved` callback in its props
- [x] 4.2 Read mode: unchanged rendered markdown, plus an Edit control and an open-externally control
- [x] 4.3 Edit mode: a `<textarea>` seeded with the note's raw text (frontmatter included), Save and Cancel controls, and a footer hint describing the keyboard rather than the gestures
- [x] 4.4 Suspend gestures while editing by passing `hand={null}` and `gesturesEnabled={false}` down to `ReaderCore` (design.md D4)
- [x] 4.5 Wire `closeGuard`: pending edits switch to confirm-discard and refuse the close; no pending edits close normally
- [x] 4.6 Confirm-discard state: "Discard unsaved changes?" with discard and keep-editing actions, no blocking dialog (design.md D5)
- [x] 4.7 Save: call the write bridge, and on `stale` keep the draft and show what happened with an explicit overwrite action that re-saves with `force`
- [x] 4.8 On a successful save, exit edit mode, adopt the new revision, and report the saved text upward so `App.tsx`'s `openNote` stops being stale

## 5. App wiring

- [x] 5.1 Store the `revision` alongside `openNote`'s `{ id, title, markdown }` in `src/App.tsx` and pass id + revision into `NoteReader`
- [x] 5.2 Handle `onSaved` by updating `openNote`'s markdown and revision in place — without reopening the reader or re-fetching
- [x] 5.3 Style the editor field, the two new controls and the discard prompt in `src/styles/`, on the existing reader tokens

## 6. Documentation

- [x] 6.1 Document the two new IPC calls and the revision token wherever the second-brain IPC surface is described (`docs/ARCHITECTURE.md` and/or `docs/PIPELINE_INTERNALS.md` — check which)
- [x] 6.2 Record in the same place that the user-authored write is deliberately absent from every model-facing surface, with a pointer to the `personal-knowledge-notes` requirement that now says so

## 7. Manual verification

- [x] 7.1 Open a note, Edit, change a word, Save → the file on disk contains the change and the reader shows it
- [x] 7.2 Confirm the editor shows raw frontmatter for a note that has it, and that saving it back unchanged leaves the file byte-identical
- [x] 7.3 Edit, then Cancel → the file is untouched
- [x] 7.4 Edit, then press `Esc` → the reader does not close and the discard prompt appears with the text intact; then Esc again → the prompt is answered, the reader closes, and nothing was written
- [x] 7.5 Edit with hand control on and make a fist → the reader does not close
- [x] 7.6 Edit a note, change the same note on disk in another app, then Save → the save is refused with the draft preserved; then Overwrite → the file is written
- [x] 7.7 Save an edit that changes a title/tag/`[[wikilink]]` while the galaxy is open → the graph updates after the debounce and the layout is not re-randomised
- [x] 7.8 Open a note externally → it opens in the default markdown application
- [x] 7.9 With a note open, ask Iris by voice to read it back, then edit it by hand, then ask for a change to a named paragraph → the change lands against the current text, not the superseded reading
- [x] 7.10 Confirm no model-facing surface gained a write: check the verb registry and the notes tool surface for any arbitrary-content write — verified statically and guarded by a test asserting the exact tool-declaration roster

## 8. Gates

- [x] 8.1 `npm run build`
- [x] 8.2 `npm test`
- [x] 8.3 `npm run lint`
- [x] 8.4 `npm run scan:secrets`
- [x] 8.5 `npm run spec:check`
