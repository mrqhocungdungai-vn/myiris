> **Status: draft.** Written to be handed to another machine. Before implementing,
> read design.md's Open Questions (ambient capture — undecided, non-blocking) and
> D2's open implementation question (the resident-session handoff on note switch,
> the one piece with no existing precedent). Archive `two-palm-galaxy-zoom` first
> so the living spec is settled.

## 1. Main owns the open note (spec: "The open note is owned by the main process")

- [ ] 1.1 Add `openNoteId` state to `electron/capabilities/second-brain.mjs`, alongside `focusState` and following its shape (identity only, never a metadata snapshot)
- [ ] 1.2 Add `secondbrain:note-opened` / `secondbrain:note-closed` IPC handlers, and expose them in `electron/preload.cjs`
- [ ] 1.3 Add a resolver that late-resolves `openNoteId` against `latestGraph` to `{ id, title, tags, relativePath }` or null, mirroring `resolveFocus`
- [ ] 1.4 Clear the open note on `secondbrain:deactivate`, on the same terms the focus is cleared there — the reader cannot outlive the galaxy
- [ ] 1.5 In `src/App.tsx`, report open/close from the existing `openNote` lifecycle: `openNoteFromGalaxy`, `closeNoteReader`, the `!secondBrainActive` clear at line ~688, and the reset at line ~1568

## 2. Referent precedence (spec: "The open note outranks the focus as the voice referent")

- [ ] 2.1 In `promptFragment()`, emit the open note's line when a note is open and the focus's line otherwise — never both
- [ ] 2.2 Reuse `focusLine`'s untrusted fencing for the open note's title/tags; carry no body
- [ ] 2.3 Add `announceNoteOpened()` mirroring `announceFocusUpdate()`, fired on open, on close, and on switch — a close must tell the voice layer the referent is gone
- [ ] 2.4 Verify the focus is untouched by any of this: it stays in main and is described again the moment the note closes

## 3. The verb (spec: "Working on a note is a resident session")

- [ ] 3.1 Add the verb record to `electron/verbs.mjs`: `stateful: true`, its own session key (NOT `STATEFUL_SESSION_KEY`), `vault: true`, `skills: NOTE_SKILLS`, `budget: "stateful"`, `park`, `model`, `basePersona: STATEFUL`, `params: THIN_PARAMS`, and a clause naming its job
- [ ] 3.2 Write a description that draws a hard line against `capture_learning` — this verb is for the note currently open on screen; weaving accumulated material is the other one
- [ ] 3.3 Add the verb's options key set to `electron/sdk-options.test.mjs`, per the repo convention that adding a field means adding it there
- [ ] 3.4 Update the verb count in `CLAUDE.md` (lines ~17, ~92) and `docs/PIPELINE_INTERNALS.md` (lines ~128, ~166) — four places say "seven"

## 4. One conversation per note (spec: "One conversation per note")

- [ ] 4.1 Derive the session key from the open note's identity so `agent_sessions` stores one resumable id per note
- [ ] 4.2 Implement the resident-slot handoff on note switch: retain the outgoing session's id, resume the incoming note's if it has one — **see design.md D2's open question first**
- [ ] 4.3 Confirm closing a note ends nothing, and that reopening the same note resumes rather than restarts
- [ ] 4.4 Determine whether `stateful-verb-session` needs a delta describing the handoff (a handoff retains the outgoing id, so it is not a reset — the spec may still need to say so). If it does, add it to this change's specs and re-validate

## 5. Verbatim read-back (spec: "The note is read back verbatim")

- [ ] 5.1 Add an announcement path for this verb's results that is spoken as written, scoped to this verb — do not add a general "don't summarize" switch
- [ ] 5.2 Leave `announceClaudeCompletion`'s existing 1–3 sentence summary instruction intact for every other verb
- [ ] 5.3 Have the verb's clause ask for a reading whose parts the user can refer back to, so a follow-up can name one

## 6. Runs receive the open note (design D4)

- [ ] 6.1 Add the open note to `electron/run-context.mjs`'s composition point, alongside the focus and the transcript, fenced as untrusted
- [ ] 6.2 Carry identity, title, tags and the vault-relative path — not the body
- [ ] 6.3 Add no focus/open-note parameter to any verb schema

## 7. Structural edits target the open note (spec: "Structural edits target the open note")

- [ ] 7.1 In `mutateVaultNotes`, resolve targets as: explicit `note_titles` > open note > focus
- [ ] 7.2 Update `MUTATE_VAULT_NOTES_DECLARATION`'s description to say so
- [ ] 7.3 Route the open note through `resolveVaultNotePath` like every other target — no path from the renderer or a model, symlink re-check preserved

## 8. Tests

- [ ] 8.1 Open-note state: set/clear over IPC, cleared on galaxy deactivate, late-resolves a renamed note, drops a deleted one
- [ ] 8.2 Referent precedence: open note described and focus not; focus described again on close; focus never cleared by opening
- [ ] 8.3 No body in the voice-layer description and none in the run block
- [ ] 8.4 `mutateVaultNotes` target precedence, all three cases plus the unknown-identity refusal
- [ ] 8.5 Verb registry: the new record's shape, its session key distinct from `STATEFUL_SESSION_KEY`, and `sdk-options.test.mjs`
- [ ] 8.6 Session keying: two notes yield two keys; returning to a note resolves to its stored id

## 9. Gates

- [ ] 9.1 `npm run build`
- [ ] 9.2 `npm test`
- [ ] 9.3 `npm run lint`
- [ ] 9.4 `npm run scan:secrets`
- [ ] 9.5 `npm run spec:check`
- [ ] 9.6 Manual pass: open a note, ask for it to be read back, ask for a change, close and reopen and confirm the conversation continued, switch notes and return and confirm the first conversation resumed
