## 1. Settlement descriptor (`main.mjs`)

- [x] 1.1 `PendingQuestion.answer(answers)` settles with `{ behavior: "allow", answers }` (design D1)
- [x] 1.2 `PendingQuestion.expire()` settles with `{ behavior: "allow", answers: defaultPoAnswers(this.current.questions) }` — same default + log as today, only the wrapper shape changes
- [x] 1.3 `PendingQuestion.abandon(workstreamId)` settles with `{ behavior: "deny", message: "The session was reset; this question was abandoned." }` and status `"abandoned"` (design D1)
- [x] 1.4 Leave `settle()` itself — including `runQueue.resume()` and the once-guard — unchanged; only what each path passes as `resolvedValue` changes

## 2. Descriptor translation (`po-session.mjs`)

- [x] 2.1 In `canUseTool` (`po-session.mjs:88-95`), `const result = await onAskUserQuestion(...)`; if `result?.behavior === "deny"` return `{ behavior: "deny", message: result.message ?? "Question abandoned." }`; otherwise return `{ behavior: "allow", updatedInput: { ...input, answers: result.answers ?? {} } }` (design D2)
- [x] 2.2 Update the `onAskUserQuestion` contract comment: it now returns a `{ behavior, answers?, message? }` descriptor, not a bare answers map
- [x] 2.3 Confirm `po-session.mjs` still knows nothing about "reset" vs "timeout" — it only translates allow/deny (module split preserved)

## 3. Confirm composition, no call-site edits

- [x] 3.1 Verify the three teardown sites (`main.mjs:477`, `496`, `515`) still call `abandon(id)` then `closePoSession(id)` — no edit needed; `abandon` denying is the whole fix (design D3)
- [x] 3.2 Confirm composition with BUG A: after the deny, `closePoSession` closes the channel and `pump`'s `finally` settles the turn as `CANCELLED` — one terminal outcome, slot released

## 4. UI/event status

- [x] 4.1 Confirm the deck PO-question banner dismisses on the new `"abandoned"` status (it should clear on any non-`"pending"` status, not specifically `"timed_out"`/`"answered"`)
- [x] 4.2 Confirm the same in HUD mode (the `voice-decision-relay` HUD requirement lists "settlement on session reset" as expected behavior)

## 5. Verification

- [x] 5.1 `npm test` passes (no automated change expected; confirm nothing regressed)
- [x] 5.2 `npm run build` passes with no new type errors
- [x] 5.3 Manual (the plan's BUG J ritual): start a PO turn that asks a question; while it is pending, reset the session (New / different project folder) → the question is denied, the turn ends as `CANCELLED`, and the PO does NOT write files into the abandoned folder on the strength of a default answer
- [x] 5.4 Manual: let a real question sit unanswered past `IRIS_PO_QUESTION_TIMEOUT_MS` (or a shortened value) → the recommended default is still applied and logged (timeout unchanged)
- [x] 5.5 Manual: answer a question normally by voice and by UI click → both still resume the same turn with the selection (allow path unchanged)

## 6. Spec and record

- [x] 6.1 `openspec validate deny-pending-question-on-reset` passes
- [x] 6.2 Re-read the `voice-decision-relay` delta: the three scenarios (reset denies, no action on a fabricated answer, timeout unchanged) are true against the landed code
- [ ] 6.3 One commit on `develop` (single bug), Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG J done, note reset now settles as `deny` (status `"abandoned"`) while timeout keeps the default; note a new uniquely-named `voice-decision-relay` requirement was added (deviation from the drift-vs-gap table's "no spec" for J, justified) and that the spec's pre-existing duplication was left as a separate follow-up
