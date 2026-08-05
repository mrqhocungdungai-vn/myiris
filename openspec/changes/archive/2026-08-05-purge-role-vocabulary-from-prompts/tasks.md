## 1. Fix the self-contradicting supplement instruction

- [x] 1.1 In `electron/announcements.mjs`, replace the context-supplement line
  `"- Do not set the agent field, let it route to whichever role is already active for this session."`
  There is no agent field and no active role. The line above it already says to
  call the verb that fits, so the replacement states the constraint that is
  actually true: choose the verb from what the user asked, not from anything
  carried over from the last request.
- [x] 1.2 Confirm the two lines now agree — read them as one instruction and check
  that nothing tells the model both to choose and not to choose.

## 2. Give the decisions follow-up a real addressee

- [x] 2.1 Thread the finalized run's verb into the completion-announcement builder
  if it is not already in scope there. Do not re-derive it from the brief text —
  the dispatch record is the source (see `run-dispatch.mjs`).
- [x] 2.2 Replace `"submit a follow-up task to the SAME role stating what was chosen"`
  in the structured-decisions branch so it names that verb.
- [x] 2.3 Replace the same phrasing in the prose `"Decisions needed"` fallback
  branch, so both paths route to the same place.
- [x] 2.4 If the verb is genuinely unavailable for a given announcement, say so
  plainly in the instruction rather than falling back to an implicit addressee.

## 3. Bind prompt prose to the verb surface

- [x] 3.1 Add a test asserting no prompt or announcement string instructs the model
  about an agent/role parameter, and none claims a worker is already active for the
  session. Drive it through the builders' public surface, not by reading the file
  as text, so it exercises the strings the app can actually send.
- [x] 3.2 Assert the prohibition over **both** announcement branches and the
  context-supplement builder — the defect this change fixes lived in three
  separate strings, so a test covering one would have passed throughout.
- [x] 3.3 Verify the test fails when a role-era line is reintroduced, by
  reintroducing one locally and watching it go red before removing it again.

## 4. Verify

- [x] 4.1 `npm test` — the new assertions pass and nothing else regressed.
- [x] 4.2 `npm run build`, `npm run lint`, `npm run scan:secrets`.
- [x] 4.3 `grep -nE "agent field|already active|SAME role" electron/*.mjs` returns
  nothing outside tests.
- [x] 4.4 Manual: paste a link into the supplement input and confirm Iris calls a
  verb chosen from what was pasted, without narrating anything about routing.
- [x] 4.5 Manual: let a run defer a decision, answer it by voice, and confirm the
  follow-up lands on the verb that produced it rather than on a different one.

## 5. Close out

- [x] 5.1 Re-read `openspec/specs/verb-tool-surface/spec.md` and
  `openspec/specs/session-announcements/spec.md` against the landed code; both
  deltas must be true before archiving.
- [x] 5.2 Note in the change that `electron/role-prompt.mjs` keeps its name by
  decision (design Non-Goals), so the next reader does not treat it as a miss.
