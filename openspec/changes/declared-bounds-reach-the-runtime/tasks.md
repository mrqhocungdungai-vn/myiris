## 0. Before touching anything

- [ ] 0.1 Confirm the defect as design.md states it: `statefulSessionOptions`
      (`run-exec.mjs:740-783`) passes no `disallowedTools`;
      `sdk-options.test.mjs` pins the absence on both resident shapes; the
      stateless path sets and mirrors it (`run-exec.mjs:553`, :586-591).
- [ ] 0.2 Confirm the SDK still has no `setDisallowedTools` on `Query`
      (`sdk.d.ts` of the installed `@anthropic-ai/claude-agent-sdk`) — if a
      newer SDK added one, stop and reconsider design.md D1 before coding.

## 1. po-session: the per-turn policy (test-first)

- [ ] 1.1 `po-session.test.mjs` (red): the four cases of design.md D5.1 —
      deny-with-message / allow-unlisted; per-turn non-stickiness across two
      turns; denied Edit never reaches `confirmWrite`; `AskUserQuestion` in the
      turn's list is denied without invoking the relay.
- [ ] 1.2 `po-session.mjs` — `deliverPoTurn` accepts and stores
      `disallowedTools` + optional `denyToolMessage` on `state.currentTurn`;
      `buildCanUseTool` checks the turn policy FIRST, then the AskUserQuestion
      relay, then `confirmWrite`, then allow. Default message:
      `"This turn cannot use ${toolName}."` No registry import — the module
      stays verb-ignorant (design.md D1).

## 2. run-exec: the wiring

- [ ] 2.1 Wiring test (red): a `shape_on_canvas` turn hands `deliverPoTurn`
      exactly `resolveVerb("shape_on_canvas").disallowedTools`;
      `shape_requirements` and `work_on_note` hand `[]`.
- [ ] 2.2 `run-exec.mjs` — the stateful `deliverPoTurn` call site (~:885)
      passes the resolved verb's `disallowedTools` and a deny message in the
      stateless wording (:590) plus the clause-primed way forward ("say what
      needs building or writing down, and let the user start that work").
      `statefulSessionOptions` untouched.

## 3. The record keeps telling the truth

- [ ] 3.1 `verbs.mjs:211-219` — comment: "enforced by configuration" →
      "enforced per turn at the tool gate (canUseTool); the shared session's
      option set cannot carry a per-verb value".
- [ ] 3.2 `sdk-options.test.mjs` — rewrite the comments beside the two
      `not.toHaveProperty("disallowedTools")` assertions per design.md D2; add
      sibling assertions for the per-turn behavior. The pinned assertions
      themselves do not change.

## 4. Gates and real-app verification

- [ ] 4.1 All five gates (`/gates`).
- [ ] 4.2 Live, single session, in order: (a) open the canvas, ask Iris to
      "write that to a file" — refusal is spoken with the alternative, the
      turn completes, the run does not fail; (b) same conversation by voice,
      ask to propose the change — `/iris:opsx:propose` still works (Bash
      alive on the voice turn); (c) open a note and ask for an edit —
      `confirmWrite` still fires on `work_on_note` (its bound is `[]`, the
      guard is independent).
- [ ] 4.3 Watch one canvas turn's transcript for refusal churn (repeated
      denied calls); if present, tune the deny message before archiving —
      design.md's risk section names the lever.

## 5. Close out

- [ ] 5.1 Archive; deltas sync into `verb-tool-surface` and
      `stateful-verb-session`.
