## 1. Enumerate before moving anything

- [x] 1.1 List every `SHALL` statement across `verb-tool-surface`,
  `stateful-verb-session`, and `run-execution-queue`, with its current capability.
  Save the list — it is the acceptance check for this change, not a formality.
- [x] 1.2 Mark each as: stays, moves, or is a duplicate to drop. Every entry must
  get exactly one mark.

## 2. Drop the duplicate

- [x] 2.1 In `openspec/specs/stateful-verb-session/spec.md`, remove the cancellation
  paragraph and its two scenarios from "An in-flight stateful turn always settles".
- [x] 2.2 Keep the settle guarantee, and state why it is session-specific: a
  resident session's stream can end without throwing, so a turn awaiting it hangs
  with nothing reporting an error. Add the scenario covering that case explicitly —
  it is the defect that bricked the app and it deserves its own scenario rather than
  living inside prose.
- [x] 2.3 Add the pointer that cancellation is specified by `run-execution-queue`,
  so a reader who looks here is not left thinking it is unspecified.

## 3. Move the shared-session rule

- [x] 3.1 Copy "Verbs that continue one conversation share one live session" into
  `stateful-verb-session` **verbatim**, both scenarios included, before deleting the
  original. Do not reword during the move.
- [x] 3.2 Add the one sentence explaining why it lives there (registry declares the
  session key; this capability owns what follows from sharing one).
- [x] 3.3 Delete it from `verb-tool-surface`.
- [x] 3.4 Diff the moved text against the original to confirm it is byte-identical
  apart from the added rationale sentence.

## 4. Retitle the queue's cancellation requirement

- [x] 4.1 Rename "Both roles cancel through one path" to "Cancellation is one path for
  every run shape".
- [x] 4.2 Leave the body's rules unchanged. It is the surviving copy of a
  de-duplicated rule, and rewording a survivor during de-duplication is how meaning
  quietly changes.
- [x] 4.3 Add the note recording that the rule used to exist twice, so a future reader
  does not re-add the second copy to the session capability.

## 5. Leave the skill-scoping overlap alone

- [x] 5.1 Confirm `verb-tool-surface`'s "A verb sees only the capabilities its work
  needs" and `stateful-verb-session`'s "The live session enables skills explicitly"
  are untouched by this change.
- [x] 5.2 Confirm the deferral is stated in the proposal, so it reads as a decision.

## 6. Verify

- [x] 6.1 Re-run the task 1.1 enumeration against the landed specs. **The set of
  `SHALL` statements must be identical; only their distribution changes.** A missing
  rule fails this change.
- [x] 6.2 `openspec validate --specs --strict` — 43 passed, 0 failed.
- [x] 6.3 `grep -rniE '\broles?\b' openspec/specs/run-execution-queue/spec.md` — the
  retitled requirement no longer uses the deleted noun.
- [x] 6.4 `grep -rn 'po-live-session\|share one live session' docs/ CLAUDE.md` — update
  any cross-reference in `docs/PIPELINE_INTERNALS.md` that points at a moved
  requirement.
- [x] 6.5 `npm test`, `npm run build`, `npm run lint`, `npm run scan:secrets` — all
  four must stay green. No code is touched, so any change here is a signal something
  went wrong.

## 7. Close out

- [x] 7.1 Read all three capability specs end to end and confirm each answers exactly
  one of: what a verb is, how a session behaves, what happens to a run.
