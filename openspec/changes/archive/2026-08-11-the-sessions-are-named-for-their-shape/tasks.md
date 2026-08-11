# Tasks — the sessions are named for their shape

Every numbered task leaves all five gates green (`/gates`). Only 1.1 and 3.4
have a red-first step, because only they change behavior.

## 0. Before touching anything

- [x] 0.1 Confirm the starting inventory still holds:
      `grep -rn "getOrCreatePoSession\|deliverPoTurn\|poBillingStatus\|savePoToken\|po_question\|po:answer-question\|save-po-token\|\[po-auth\]\|PoQuestion\|poTokenSet" electron/ src/ | wc -l`
      lands near the counts in design.md; `ls openspec/changes/` shows no open
      change referencing po-session (declared-bounds-reach-the-runtime was
      withdrawn at f011778).
- [x] 0.2 Confirm nothing named `claude_question`, `ClaudeQuestion`,
      `claudeBillingStatus`, `claudeTokenSet`, `statefulEndReason`,
      `stateful-session.mjs`, `stateless-session.mjs` exists yet (collision
      check, design.md D1).

## 1. Claude-family moves out of po-session (shrinks the rename's blast radius)

- [x] 1.1 Question timeout → run-stream.mjs. Red first: a test beside the
      `MODEL_ENV_VARS` alias pattern (session-store.test.mjs:173 region)
      asserting `IRIS_CLAUDE_QUESTION_TIMEOUT_MS` wins and
      `IRIS_PO_QUESTION_TIMEOUT_MS` still works as fallback. Then move
      `poQuestionTimeoutMs`/`DEFAULT_PO_QUESTION_TIMEOUT_MS` from
      po-session.mjs:12,35 into run-stream.mjs as
      `claudeQuestionTimeoutMs`/`DEFAULT_CLAUDE_QUESTION_TIMEOUT_MS` with the
      alias read. run-stream.mjs:15 stops importing po-session. Delete the
      symbol from the two vi.mock blocks that carry it
      (wiring-capabilities.effects.test.mjs:28,
      run-exec.stateful-wiring.test.mjs:22). Update .env.example:166,172
      (alias documented the way :237 documents the model aliases) and
      README.md:161.
- [x] 1.2 Billing → worker-env.mjs. `poBillingStatus` (po-session.mjs:29)
      becomes `claudeBillingStatus` in worker-env.mjs; update
      pipeline-probes.mjs:11,232, live-session.mjs:34,262, run-exec.mjs:16,
      791,977, the wiring-capabilities mock :20, run-exec.test.mjs:716's note.
      Delete `computePoSessionEnv` (po-session.mjs:19-21) — callers use
      `computeClaudeWorkerEnv` directly. Rename `logPoBillingPathOnce` →
      `logClaudeBillingPathOnce` (live-session.mjs:261,528; wiring-live.mjs:
      154,158; wiring-live.test.mjs:22,162-165), tag `[IRIS][po-auth]` →
      `[IRIS][claude-auth]` (also user-config.mjs:405), and reword the two
      message bodies at live-session.mjs:264,267 to current vocabulary (no
      "PO turns", no "DEV").

## 2. The module rename

- [x] 2.1 `git mv electron/po-session.mjs electron/stateful-session.mjs` and
      `git mv electron/po-session.test.mjs electron/stateful-session.test.mjs`.
      Rename the nine session exports per design.md D1.1, plus
      `error.poEndReason` → `error.statefulEndReason` (producer :197,491,498
      AND consumer run-exec.mjs:928,932,936 in this same commit). Reword the
      internal "PO turn/session" strings (:167,:193-195,:424,:497) — they are
      user-visible run output.
- [x] 2.2 Update every importer in the same commit: run-exec.mjs:15-23,
      wiring.mjs:13, main.mjs:14, user-config.mjs:10, session-store.mjs:12,
      pipeline-probes.mjs, live-session.mjs, sdk-options.test.mjs:21, and all
      three vi.mock blocks (wiring.test.mjs:3-6,
      wiring-capabilities.effects.test.mjs:19-29 + `await import` :41,
      run-exec.stateful-wiring.test.mjs:11-23 + :29). Cosmetics: `PO_KEYS` →
      `STATEFUL_KEYS` (sdk-options.test.mjs:289,342,373-375), suite names in
      stateful-session.test.mjs (:113,178,229,442,493,558,605). The demand
      graph test (electron-graph.demand.test.mjs:123-140) is the closure
      check; fix its stale comment at :55-56 while there.

## 3. Protocol strings

- [x] 3.1 `SYSTEM_EVENT_PO_QUESTION` → `SYSTEM_EVENT_CLAUDE_QUESTION` in ONE
      commit: run-stream.mjs:481 (emitter), gemini-prompts.mjs:117,
      gemini-tools.mjs:132, verbs.mjs:169,290 (prompt text). No alias — the
      name is compiled into each session's prompt, never persisted.
- [x] 3.2 Sidecar event `po_question` → `claude_question`: run-stream.mjs:
      454-456 (delete the back-compat comment — it guarded the restructure
      change, not an external contract), run-stream.test.mjs:158,176,
      App.tsx:1324. Rename `emitPoQuestionEvent`/`defaultPoAnswers`
      (run-stream.mjs:455,427) and `resolvePendingPoQuestion` →
      `resolvePendingClaudeQuestion` (run-stream.mjs:513; dep names through
      wiring.mjs:314,347,519, run-dispatch.mjs:44,71,550, ipc.mjs:53,96,
      main.mjs:129,227, run-dispatch.test.mjs, run-stream.test.mjs suite :38).
- [x] 3.3 IPC + preload + renderer lockstep, one commit:
      `po:answer-question` → `claude:answer-question`, `config:save-po-token`
      → `config:save-claude-token`, `config:remove-po-token` →
      `config:remove-claude-token` (ipc.mjs:158,190,193 ↔ preload.cjs:17,
      112-113 ↔ ipc.test.mjs:48,56,57 roster). `window.iris` methods
      `answerPoQuestion`/`savePoToken`/`removePoToken` →
      `answerClaudeQuestion`/`saveClaudeToken`/`removeClaudeToken`
      (vite-env.d.ts:408,467-468, App.tsx:1147, SetupPanel.tsx:190-191).
      `savePoToken` → `saveClaudeToken` in user-config.mjs:376,493 and its
      injection sites (ipc.mjs:60,103,191,194, main.mjs:136,234,
      wiring.mjs:291,527, wiring.test.mjs:48, ipc.test.mjs:110,
      user-config.test.mjs:199-271 suite). Verification step of this task:
      `grep -rn '"po:\|save-po-token\|remove-po-token' electron/ src/` → 0.
- [x] 3.4 `poTurnRunning` → `claudeTurnRunning` **with the fix** (design.md
      D5). Red first: rewrite user-config.test.mjs:221-226 to feed a
      real-shaped running run (verb-keyed, no `agent` field) and expect
      refusal — it must FAIL against the current `run.agent === "po"`
      predicate. Then change user-config.mjs:366-367 to refuse while any run
      is `RUN_STATUS.RUNNING`, and reword the message (user-config.mjs:387;
      the old test pin `/PO turn is running/` :225 dies with it).
- [x] 3.5 Renderer sweep, one commit (the dead-CSS gate makes TSX + CSS
      atomic — design.md D7.2): `PoQuestionBanner.tsx` →
      `ClaudeQuestionBanner.tsx` + the 10 `po-question-*` classNames (:24-57)
      + their `src/styles/claude.css` selectors (17 occurrences) →
      `claude-question-*`; prop `poQuestion` → `claudeQuestion`
      (HudShell.tsx:24,215,305,379-386; App.tsx:39); types `PoQuestion*`,
      `PoTokenResult`, `poTokenSet` → `ClaudeQuestion*`, `ClaudeTokenResult`,
      `claudeTokenSet` (vite-env.d.ts:123-143,181,190; user-config.mjs:267;
      SetupPanel.tsx:101-104,184-198,356-382); App.tsx state names (:207,215,
      1120,1141); UI copy — "PO is waiting on you" (banner :27), "The PO's
      question went unanswered…" (App.tsx:1346-1349), "Pipeline enabled —
      PO/DEV tools…" (SetupPanel.tsx:340,342,716).

## 4. The extraction

- [x] 4.1 Shared failure-account helpers → run-output-format.mjs:
      `createStderrBuffer` (run-exec.mjs:49-71), `withStderr` (:95-120 part),
      `STRUCTURED_OUTPUT_FAILURE` (:47), parameterizing `STDERR_TAIL_LINES`.
      Their assertions move with them.
- [x] 4.2 Extract `electron/stateless-session.mjs`:
      `createStatelessSession(deps)` returning `{ startStatelessRun }` — a
      verbatim move of `startStatelessRun` (run-exec.mjs:374-713) plus its
      exclusive helpers `effectiveDisallowedTools` (:73-93, stays exported),
      `describeUnansweredQuestion`, `forgetSession`. `createRunExec`
      constructs it internally; the returned interface of run-exec.mjs
      (:1033-1039) is byte-identical. Rewrite run-exec.mjs's header comment:
      shared preamble + policy layer, delegating to stateful-session.mjs and
      stateless-session.mjs symmetrically.
- [x] 4.3 Proof obligations: sdk-options.test.mjs assertions pass
      **content-unchanged** (the complete options key set per run shape is
      the proof the extraction preserved behavior); both graph tests green
      with zero edits (supply count is computed; demand verifies the new
      module's import closure); a thin `stateless-session.test.mjs` asserts
      the factory surface (main-process-structure spec.md:184-198 spirit).

## 5. Docs, specs, and the drift gate

- [x] 5.1 Spec deltas land (this change's `specs/`):
      workflow-quality-gates (retired-vocabulary rationale recast onto
      `IRIS_PO_MODEL` + the timeout alias — KEEPING the anchored phrase
      ``cannot be right for all of them: `PO` matches`` so
      check-spec-drift.mjs:230-233 needs no edit), run-execution-queue
      (timeout var citation), renderer-structure (sidecar vocabulary:
      `claude_*` including `claude_question`, and `agent_*`). Also update the
      comment at check-spec-drift.mjs:35-38, which cites
      `SYSTEM_EVENT_PO_QUESTION` as an identifier the code reads — after this
      change the surviving examples are `IRIS_PO_MODEL` and the
      `IRIS_PO_QUESTION_TIMEOUT_MS` alias (comment only; the pattern itself
      is already correct).
- [x] 5.2 Docs sweep: ARCHITECTURE.md:56,137,201; PIPELINE_INTERNALS.md:15,
      77,119,129,149,172,257,263-266,328,352,357-358,368,543,705 (delete the
      `computePoSessionEnv` alias sentence),706,707 — KEEP :89,:544,:694,
      :699,:700 as history (design.md D6); TESTING.md:41-42 (mirror the
      workflow-quality-gates rewording); comment sweep in electron/ and src/
      per design.md D1.2's list (module paths must change; genuinely
      historical "replaced PO/DEV" framing stays: verbs.mjs:4,
      role-prompt.mjs:5-8, worker-env.mjs:50).
- [x] 5.3 Final verification grep:
      `grep -rn "\bPo[A-Z]\|PO_QUESTION\|po_question\|po:answer\|save-po-token\|po-auth\|po-session\|PoSession\|PoTurn" electron/ src/ scripts/ docs/ README.md .env.example`
      — every remaining hit is on the frozen list (session-store.mjs aliases +
      migration, wiring.mjs:199, pipeline-install.test.mjs:29, the
      `IRIS_PO_QUESTION_TIMEOUT_MS` alias read + its .env.example/docs alias
      notes, historical doc lines).

## 6. Gates and real-app verification

- [x] 6.1 All five gates (`/gates`) green; `npm run build` proves tsc closure
      over every renderer rename.
- [x] 6.2 Live smoke (packaged or `npm run dev`): (a) trigger a run that asks —
      the question banner renders, a voice answer lands through
      `answer_claude_question`, the run completes with the choices (the
      `SYSTEM_EVENT_CLAUDE_QUESTION` + `claude_question` + IPC path
      end-to-end); (b) Settings → save and remove a Claude token
      (`config:save-claude-token` round trip, `claudeTokenSet` renders);
      (c) a note turn on the stateful session resumes its prior conversation
      (session-key continuity across the rename); (d) log shows
      `[IRIS][claude-auth]` at startup.
- [x] 6.3 Archive; deltas sync into `openspec/specs/`. Synced at 5.1 rather
      than here, so the archive's own spec update was a no-op — it reported
      `+ 0, ~ 0, - 0` and the three spec files hash identically before and
      after. The living spec and the delta agreed before either was merged.
