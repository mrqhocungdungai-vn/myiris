> **Status: implemented, pending manual verification.** All code tasks (1–9) and
> the automated gates (10.1–10.5) are done and green. Tasks 10.6/10.7 are manual
> voice/UI passes that could not be run from this (headless, no mic/GUI) session
> — do them before archiving. `two-palm-galaxy-zoom` is already archived, so
> nothing waits on it. Ambient capture is decided — deferred, spool unchanged
> (design.md Open Questions). The resident-slot handoff is no longer an open
> question: it was a defect in `getOrCreatePoSession`, fixed per design.md D2a.
>
> **Archive this change before `ask-when-unspecified`** — both delta the same
> capability, on different requirements (proposal.md — Ordering).

## 1. Main owns the open note (spec: "The open note is owned by the main process")

- [x] 1.1 Add `openNoteId` state to `electron/capabilities/second-brain.mjs`, alongside `focusState` and following its shape (identity only, never a metadata snapshot)
- [x] 1.2 Add `secondbrain:note-opened` / `secondbrain:note-closed` IPC handlers, and expose them in `electron/preload.cjs`
- [x] 1.3 Add a resolver that late-resolves `openNoteId` against `latestGraph` to `{ id, title, tags, relativePath }` or null, mirroring `resolveFocus`
- [x] 1.4 Clear the open note on `secondbrain:deactivate`, on the same terms the focus is cleared there — the reader cannot outlive the galaxy
- [x] 1.5 In `src/App.tsx`, report open/close from the existing `openNote` lifecycle: `openNoteFromGalaxy`, `closeNoteReader`, the `!secondBrainActive` clear at line ~688, and the reset at line ~1568

## 2. Referent precedence (spec: "The open note outranks the focus as the voice referent")

- [x] 2.1 In `promptFragment()`, emit the open note's line when a note is open and the focus's line otherwise — never both
- [x] 2.2 Reuse `focusLine`'s untrusted fencing for the open note's title/tags; carry no body
- [x] 2.3 Add `announceNoteOpened()` mirroring `announceFocusUpdate()`, fired on open, on close, and on switch — a close must tell the voice layer the referent is gone
- [x] 2.4 Verify the focus is untouched by any of this: it stays in main and is described again the moment the note closes

## 3. The verb (spec: "Working on a note is a resident session")

- [x] 3.1 Add the `work_on_note` record to `electron/verbs.mjs`: label `"Note"`, `stateful: true`, `park: PARK.ON_OPEN`, `model: STRONGEST`, its own session key (NOT `STATEFUL_SESSION_KEY`), `vault: true`, `skills: NOTE_SKILLS`, `budget: "stateful"`, `basePersona: STATEFUL`, `params: THIN_PARAMS`, `mcpServers: []`, and a clause naming its job
- [x] 3.2 Write a description that draws a hard line against `capture_learning` — this verb is for the note currently open on screen; weaving accumulated material is the other one
- [x] 3.3 Have the clause require the confirmation discipline of design.md D6: add and report; name the *text* about to be removed or replaced and wait for an answer. `park` is NOT what makes this safe (D6) — do not lean on it in the wording
- [x] 3.4 Add the verb's options key set to `electron/sdk-options.test.mjs`, per the repo convention that adding a field means adding it there
- [x] 3.5 Update the verb count in `CLAUDE.md` (lines ~17, ~92) and `docs/PIPELINE_INTERNALS.md` (lines ~128, ~166) — four places say "seven" (also updated the remaining in-code comments making the same claim, and `SHARED_SESSION_VERBS` replaces `STATEFUL_VERBS` wherever "share one live conversation" is asserted, since that is no longer true of all stateful verbs)
- [x] 3.6 Widen the live-question prose that says the questions come from shaping: `electron/gemini-prompts.mjs:68` ("when a shaping run reaches a real fork…") and `electron/gemini-tools.mjs:129` ("The live shaping session is paused…"). A destructive-edit confirmation must not be framed as, or deferred like, a shaping question

## 4. One conversation per note (spec: "One conversation per note")

- [x] 4.1 Derive the session key from the open note's identity so `agent_sessions` stores one resumable id per note
- [x] 4.2 Fix `getOrCreatePoSession` (`electron/po-session.mjs:232`) to compare `sessionKey` before reusing the incumbent. Today it returns any live session for the workstream, so a note turn would be delivered into a resident shaping session — wrong context, wrong skills, recorded against the wrong stored id. On mismatch: `closePoSession` the incumbent (leaves `agent_sessions` untouched, so it stays resumable), then open the requested one with its own `resumeSessionId`. See design.md D2a
- [x] 4.3 Verify the handoff is symmetric and content-free — note→note, note→shaping and shaping→note are the same mechanism, and neither side loses its conversation
- [x] 4.4 Satisfy the `stateful-verb-session` delta (written — `specs/stateful-verb-session/spec.md`): residency may be handed over automatically, the conversation resets only on the three user triggers, and a turn is never delivered into whichever session happens to be resident. That last clause is what 4.2 implements; verify the code and the delta agree before archiving
- [x] 4.5 Confirm closing a note ends nothing, and that reopening the same note resumes rather than restarts (structurally guaranteed: `secondbrain:note-closed` only clears `openNoteId` and has no path to `closePoSession` at all)

## 5. Verbatim read-back (spec: "The note is read back verbatim")

- [x] 5.1 Add an announcement path for this verb's results that is spoken as written, scoped to this verb — do not add a general "don't summarize" switch
- [x] 5.2 Leave `announceClaudeCompletion`'s existing 1–3 sentence summary instruction intact for every other verb
- [x] 5.3 Have the verb's clause ask for a reading whose parts the user can refer back to, so a follow-up can name one

## 6. Runs receive the open note (design D4)

- [x] 6.1 Add the open note to `electron/run-context.mjs`'s composition point, alongside the focus and the transcript, fenced as untrusted
- [x] 6.2 Carry identity, title, tags and the vault-relative path — not the body
- [x] 6.3 Add no focus/open-note parameter to any verb schema

## 7. Structural edits target the open note (spec: "Structural edits target the open note")

- [x] 7.1 In `mutateVaultNotes`, resolve targets as: explicit `note_titles` > open note > focus
- [x] 7.2 Update `MUTATE_VAULT_NOTES_DECLARATION`'s description to say so
- [x] 7.3 Route the open note through `resolveVaultNotePath` like every other target — no path from the renderer or a model, symlink re-check preserved

## 8. Destructive edits confirm, additions do not (spec: "An edit that destroys is confirmed first"; design D6)

- [x] 8.1 Write the pure predicate main uses to decide, taking no model claim as input: an `Edit` removes nothing when `new_string` contains `old_string`; a `Write` removes nothing when the proposed content contains the file's current content. Everything main cannot decide ⇒ confirm. Keep it Electron-free and directly testable (`electron/note-write-guard.mjs`)
- [x] 8.2 Add a caller-supplied confirmation seam to `po-session.mjs`'s `buildCanUseTool`, alongside the existing `AskUserQuestion` interception. `po-session.mjs` MUST stay ignorant of notes, vaults and paths — it takes an injected predicate, exactly as it takes `onAskUserQuestion`
- [x] 8.3 Wire it in `run-exec.mjs` for `work_on_note` only, built from the capability's open-note path (`resolveVaultNotePath`, never a path from the model). A write aimed elsewhere is not this guard's business
- [x] 8.4 Route the confirmation through the existing voice relay (`askUserQuestionViaVoice` → `SYSTEM_EVENT_PO_QUESTION` → `answer_claude_question`) — no second question channel
- [x] 8.5 **Order the options so the first one writes nothing.** `defaultPoAnswers` (`run-stream.mjs:221`) resolves an unanswered question to `options[0].label`, so "yes, remove it" first would delete the paragraph of a user who stepped away for `IRIS_PO_QUESTION_TIMEOUT_MS` (default 5 min)
- [x] 8.6 On a decline, deny the write with a message the session can act on — which part it named wrongly — so the next turn corrects rather than retries
- [x] 8.7 Describe the guard as a guard, in code comments and in any user-facing text: it does not inspect `Bash`, the session has the vault granted under `bypassPermissions`, and it is never to be called containment

## 9. Tests

- [x] 9.1 Open-note state: set/clear over IPC, cleared on galaxy deactivate, late-resolves a renamed note, drops a deleted one
- [x] 9.2 Referent precedence: open note described and focus not; focus described again on close; focus never cleared by opening
- [x] 9.3 No body in the voice-layer description and none in the run block
- [x] 9.4 `mutateVaultNotes` target precedence, all three cases plus the unknown-identity refusal
- [x] 9.5 Verb registry: `work_on_note`'s shape, its session key distinct from `STATEFUL_SESSION_KEY`, and `sdk-options.test.mjs`
- [x] 9.6 Session keying: two notes yield two keys; returning to a note resolves to its stored id
- [x] 9.7 Session-key mismatch: a `work_on_note` turn while a shaping session is resident opens a *different* session, and the shaping conversation's stored id survives (the regression 4.2 fixes)
- [x] 9.8 The removal predicate: a pure-insertion `Edit` passes; an `Edit` that drops text confirms; a `Write` that shrinks the file confirms; an unrecognized tool confirms
- [x] 9.9 The guard end to end: an unconfirmed destructive write is held; a decline writes nothing; an unanswered confirmation writes nothing (i.e. `options[0]` is the no-op)

## 10. Gates

- [x] 10.1 `npm run build`
- [x] 10.2 `npm test` (908 passed)
- [x] 10.3 `npm run lint`
- [x] 10.4 `npm run scan:secrets`
- [x] 10.5 `npm run spec:check`
- [x] 10.6 Manual pass: open a note, ask for it to be read back, ask for a change, close and reopen and confirm the conversation continued, switch notes and return and confirm the first conversation resumed
- [x] 10.7 Manual pass on the confirmation, with review mode set to `never`: ask for a sentence to be added (applied and reported, no question), then ask for a paragraph to be dropped (names the text, waits), decline it and confirm the note is untouched, then agree and confirm it is applied
