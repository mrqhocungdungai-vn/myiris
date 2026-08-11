# Design — the sessions are named for their shape

Everything below was verified on this tree at commit f011778 (2026-08-11) by
reading the files cited. The implementing machine should not need to re-derive
any of it; where a line number has drifted, the surrounding identifier is the
anchor.

## Verified starting state

- The living spec is already clean: `stateful-verb-session/spec.md` has zero
  occurrences of PO/po-session/Product Owner. Its vocabulary — "live session",
  "resident", "stateful turn" vs "stateless run", "run shape" — is the target
  lexicon.
- Docs narrate in the new vocabulary but cite the old identifiers:
  ARCHITECTURE.md:201 literally reads "**`electron/po-session.mjs`** — the
  stateful run shape", a sentence contradicting its own subject.
- `scripts/check-spec-drift.mjs:38` registers `PO` as retired vocabulary
  (case-sensitive, word-boundary — `_` is a word char, so
  `IRIS_PO_QUESTION_TIMEOUT_MS` and `po_question` never trip it; only bare
  "PO" does).
- Persistence is safe: `STATEFUL_SESSION_KEY = "stateful"` (verbs.mjs:114);
  `~/.myiris/claude-sessions.json` keys are `stateful`, `execute`,
  `execute__superseded`, `note:<id>` — "po" appears only as *input* to the
  one-way migration `migrateRolesToVerbs` (session-store.mjs:135-187), which
  must stay verbatim.
- "Product Owner" is never expanded anywhere in code; it survives only in
  three negative assertions that forbid it reaching the model
  (agent-definitions.test.mjs:111, verbs.test.mjs:312, gemini-tools.test.mjs:89).
  Those assertions pass before and after this change.

## D1 — Two families, not one: `stateful*` and `claude*`

The single name "PO" conflated two responsibilities, and the rename must not
re-conflate them under "stateful":

- The **ask relay is shape-agnostic**. run-stream.mjs:466-468 calls itself
  "The ONE relay, for every asking run"; stateless `execute` asks when no
  change is open (run-exec.mjs:554-584, `effectiveDisallowedTools` :73-93).
- The **billing/env policy is one policy for both shapes**:
  `computePoSessionEnv` (po-session.mjs:19-21) is a pure re-export of
  `computeClaudeWorkerEnv` (worker-env.mjs), stated as such in
  PIPELINE_INTERNALS.md:705.

So: session lifecycle → `stateful*`; ask/token/billing → `claude*`, joining
the family that already exists (`answer_claude_question` gemini-tools.mjs:130,
`SYSTEM_EVENT_CLAUDE_COMPLETE` announcements.mjs:181, `claude_task_update`
run-queue.mjs:109). Collision check done: nothing named `claude_question`,
`ClaudeQuestion*`, `claudeBillingStatus`, `claudeTokenSet`,
`answerClaudeQuestion`, `statefulEndReason`, `stateful-session.mjs`, or
`stateless-session.mjs` exists anywhere, specs included.

### D1.1 `stateful*` — the module rename

`electron/po-session.mjs` → `electron/stateful-session.mjs` (test file moves
with it). Exports:

| Old (line) | New |
|---|---|
| `getOrCreatePoSession` (:232) | `getOrCreateStatefulSession` |
| `deliverPoTurn` (:417) | `deliverStatefulTurn` |
| `cancelPoTurn` (:476) | `cancelStatefulTurn` |
| `closePoSession` (:521) | `closeStatefulSession` |
| `closeAllPoSessions` (:551) | `closeAllStatefulSessions` |
| `getPoSessionState` (:448) | `getStatefulSessionState` |
| `hasUsedPoSession` (:460) | `hasUsedStatefulSession` |
| `setPoSessionModel` (:394) | `setStatefulSessionModel` |
| `setPoSessionMcpServers` (:406) | `setStatefulSessionMcpServers` |
| `error.poEndReason` (:197,:491,:498) | `error.statefulEndReason` |
| `computePoSessionEnv` (:19-21) | **deleted** — call `computeClaudeWorkerEnv` directly; the module already imports it (:10) and nothing else imports the alias (only comments cite it: user-config.mjs:362, PIPELINE_INTERNALS.md:705) |

Internal strings ("PO turn failed" :167, "PO session has ended" :424, "PO
session was torn down/ended before the turn completed" :193-195, "PO turn was
interrupted" :497) reach run output via run-exec.mjs:921 — reword to the
stateful vocabulary, don't just substitute the acronym.

Importers to update in the same commit (the demand graph test,
electron-graph.demand.test.mjs:123-140, verifies every named import resolves —
it is the safety net): run-exec.mjs:15-23 (7 symbols), wiring.mjs:13,
main.mjs:14, user-config.mjs:10, session-store.mjs:12, pipeline-probes.mjs:11,
live-session.mjs:34, run-stream.mjs:15, sdk-options.test.mjs:21 (direct
import), and the three `vi.mock` blocks (D7.1).

### D1.2 `claude*` — and two symbols move modules

| Old | New | New home, and why |
|---|---|---|
| `poBillingStatus` (po-session.mjs:29) | `claudeBillingStatus` | **worker-env.mjs** — it reads the same two credentials the strip rule there reasons about (worker-env.mjs:50). Ends the smell of the voice layer importing the stateful module (live-session.mjs:34 imports it today). Consumers: pipeline-probes.mjs:11,232; live-session.mjs:262; run-exec.mjs:791,977. |
| `poQuestionTimeoutMs` (:35) + `DEFAULT_PO_QUESTION_TIMEOUT_MS` (:12) | `claudeQuestionTimeoutMs` + `DEFAULT_CLAUDE_QUESTION_TIMEOUT_MS` | **run-stream.mjs** — its only consumer (:15,:477). After the move, run-stream imports nothing from the stateful module: the shape-agnostic relay finally looks shape-agnostic. Also deletes the symbol from two of the three vi.mock blocks before the rename touches them. |
| `resolvePendingPoQuestion` (run-stream.mjs:513) | `resolvePendingClaudeQuestion` | stays; injected through wiring.mjs:314,347,519; run-dispatch.mjs:44,71,550; ipc.mjs:53,96; main.mjs:129,227 |
| `emitPoQuestionEvent` / `defaultPoAnswers` (run-stream.mjs:455,:427) | `emitClaudeQuestionEvent` / `defaultClaudeAnswers` | internal |
| `savePoToken` (user-config.mjs:376,:493) | `saveClaudeToken` | stays; injected ipc.mjs:60,103,191,194; main.mjs:136,234; wiring.mjs:291,527 |
| `poTurnRunning` (user-config.mjs:366) | `claudeTurnRunning` **+ fix** (D5) | stays |
| `poTokenSet` (user-config.mjs:267 → vite-env.d.ts:181 → SetupPanel.tsx:102ff) | `claudeTokenSet` | computed at read time from env, never persisted — pure main↔renderer coordination, tsc catches both ends |
| `logPoBillingPathOnce` (live-session.mjs:261,:528) | `logClaudeBillingPathOnce` | stays; wiring-live.mjs:154,158; mock wiring-live.test.mjs:22,162-165 |
| log tag `[IRIS][po-auth]` (live-session.mjs:264,267; user-config.mjs:405) | `[IRIS][claude-auth]` | undocumented externally (REFERENCE.md has zero PO log lines — verified), no doc edit needed. The :267 message body still says "PO turns will fail… DEV is unaffected" — reword to current vocabulary while there. |
| types `PoQuestion`/`PoQuestionOption`/`PoQuestionAnswer`/`PoTokenResult` (vite-env.d.ts:123-143,:190) | `ClaudeQuestion`/… /`ClaudeTokenResult` | |
| `PoQuestionBanner.tsx` + prop `poQuestion` (App.tsx:39; HudShell.tsx:24,215,305) | `ClaudeQuestionBanner.tsx`, prop `claudeQuestion` | see D7.2 for the CSS coupling |
| App.tsx state `pendingPoQuestion`/`poAnswers`/`pickPoAnswer`/`submitPoAnswers` (:207,:215,:1120,:1141) | `pendingClaudeQuestion`/`claudeAnswers`/`pickClaudeAnswer`/`submitClaudeAnswers` | |
| UI copy: "PO is waiting on you" (PoQuestionBanner.tsx:27), "The PO's question went unanswered…" (App.tsx:1346-1349), "Pipeline enabled — PO/DEV tools…" (SetupPanel.tsx:340,342,716), "A PO turn is running right now…" (user-config.mjs:387) | "Claude is waiting on you", "Claude's question went unanswered…", "…the build pipeline…", "A Claude run is in flight…" | user-config.test.mjs:225 pins `/PO turn is running/` — rewrite with the fix in D5 |

## D2 — The env alias

`IRIS_PO_QUESTION_TIMEOUT_MS` → `IRIS_CLAUDE_QUESTION_TIMEOUT_MS`, old name
read as fallback. The new name joins the existing `IRIS_CLAUDE_*` worker
family (`IRIS_CLAUDE_MAX_TURNS`, `IRIS_CLAUDE_MAX_BUDGET_USD`,
`IRIS_CLAUDE_PERMISSION_MODE` — .env.example:185-198). Alias mechanism mirrors
`MODEL_ENV_VARS` (session-store.mjs:43-46): read new first, fall back to old.
Document in .env.example the way :237 documents the model aliases; update
README.md:161.

Considered and rejected: `IRIS_QUESTION_TIMEOUT_MS` (it times a human, not
Claude) — but `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (.env.example:226) shows the
family is named for *what is waiting*, and the waiter is a Claude run.

## D3 — Protocol strings: why a hard cutover is safe

All three protocol renames are in-process contracts where both ends ship in
one bundle; there is no persisted or cross-version reader, so no alias window:

1. `SYSTEM_EVENT_PO_QUESTION` → `SYSTEM_EVENT_CLAUDE_QUESTION` — the name is
   compiled into the Gemini system prompt per session (gemini-prompts.mjs:117,
   gemini-tools.mjs:132, verbs.mjs:169,290) and emitted by run-stream.mjs:481.
   Emitter and prompt rename in ONE task; a session always sees a consistent
   pair. No persistence anywhere.
2. Sidecar event `type: "po_question"` → `"claude_question"`
   (run-stream.mjs:454-456 → App.tsx:1324; pinned by run-stream.test.mjs:158,176
   and by `renderer-structure/spec.md:35` — the spec delta in this change
   retires that pin). The :454 comment "stays `po_question` for renderer/IPC
   back-compat" guarded the *restructure* change's zero-behavior promise, not
   an external contract; delete it with the rename.
3. IPC channels `po:answer-question` → `claude:answer-question`,
   `config:save-po-token`/`config:remove-po-token` →
   `config:save-claude-token`/`config:remove-claude-token` — preload.cjs:17,
   112-113 ↔ ipc.mjs:158,190,193 ↔ ipc.test.mjs:48,56,57 roster, plus
   `window.iris.answerPoQuestion`/`savePoToken`/`removePoToken` →
   `answerClaudeQuestion`/`saveClaudeToken`/`removeClaudeToken`
   (vite-env.d.ts:408,467-468; App.tsx:1147; SetupPanel.tsx:190-191). Channel
   strings have no type system — the roster test and a task-level grep are the
   guards (D7.3).

## D4 — The extraction seam

run-exec.mjs today (1040 lines), by disposition:

| Lines | Content | Disposition |
|---|---|---|
| 49-71 | `createStderrBuffer` | shared → `run-output-format.mjs` |
| 73-93 | `effectiveDisallowedTools` (exported) | stateless-only → moves |
| 95-120 | `describeUnansweredQuestion`, `withStderr` | moves / shared → `run-output-format.mjs` |
| 122-181 | `buildNoteWriteGuard` (exported) | stateful-only → stays (wired :828-830) |
| 183-291 | `createRunExec` deps, `runProjectDir`, `forgetSession` | stays / `forgetSession` moves (only use :429) |
| 293-372 | `startClaudeRun` — shared preamble, fork at :367-371 | stays |
| 374-713 | `startStatelessRun` (~340 lines) | **moves** |
| 715-783 | `statefulSessionOptions` | stays |
| 785-952 | `startStatefulRun` | stays |
| 954-1031 | `warmStatefulConversation` | stays |

- **New `electron/stateless-session.mjs` (~430-450 lines):**
  `createStatelessSession(deps)` returning `{ startStatelessRun }`, taking the
  stateless subset of `createRunExec`'s deps. Electron-free by construction
  (its inputs already are — run-exec.mjs:4-8). `effectiveDisallowedTools`
  stays exported (run-exec.test.mjs asserts it standalone).
- **Shared failure-account helpers → `run-output-format.mjs`:**
  `createStderrBuffer`, `withStderr` (parameterize `STDERR_TAIL_LINES`),
  `STRUCTURED_OUTPUT_FAILURE`. Both shapes already import that module
  (run-exec.mjs:27, po-session.mjs:9), and "how a run's outcome is worded" is
  its responsibility. This avoids both bad options: a run-exec ↔
  stateless-session cycle, or the stateful path importing stderr helpers from
  the stateless module.
- **run-exec.mjs keeps its name and its returned interface**
  (`runProjectDir, startClaudeRun, startStatelessRun, startStatefulRun,
  warmStatefulConversation` — :1033-1039). `createRunExec` constructs
  `createStatelessSession` internally and re-exposes its `startStatelessRun`.
  Residual ≈ 540-570 lines — above the 450 target, down from 1040. Stated
  openly: the residual is the stateful *driver* (~290 lines); moving it too
  would bloat stateful-session.mjs to ~850 or mint a third module nobody asked
  for. Recorded as an explicit non-goal, the way main-process-structure
  records canvas-mcp.mjs (spec.md:13).

**Proof the extraction changed nothing:** sdk-options.test.mjs captures each
run shape's complete options key set via the injected `queryImpl` fake
(:27-40, `optionsFor` :92-96) and via the `query` option handed to the session
factory (:332-337). Its assertions (:152,:216,:261,:342,:432) must pass
**content-unchanged** after the extraction; only rename-driven edits are
allowed there (import :21, `PO_KEYS` → `STATEFUL_KEYS` :289, comments
:373-375).

**Graph tests absorb it:** electron-graph.supply.test.mjs:29,61-67 pins only
the four Electron-dependent modules; the candidate count is computed
(`allMjs.length - 4`). electron-graph.demand.test.mjs mentions po-session only
in a comment (:55-56, already stale) but genuinely verifies import closure
(:123-140). package.json `build.files` globs `electron/**` minus tests — the
new module ships with no packaging edit.

A thin `stateless-session.test.mjs` asserting the factory's own surface lands
with the module (main-process-structure's "each extracted module lands with
its test" spirit, spec.md:184-198); the behavioral coverage stays where it is
(run-exec.test.mjs, sdk-options.test.mjs).

## D5 — `poTurnRunning` is a dead guard; rename it honestly

user-config.mjs:367 guards credential changes with `run.agent === "po"`, but
no production code sets `run.agent` on a run record — the only other
occurrence is run-queue.mjs:113 projecting `run.agent ?? null` (always null;
runs carry `verb`). The guard exists because `computeClaudeWorkerEnv`
snapshots env at session creation (user-config.mjs:361-364), and it is kept
green only by user-config.test.mjs:222 injecting `{ agent: "po", status:
"running" }`. A blind rename would preserve a dead guard under a new name.

Fix, test-first: `claudeTurnRunning()` returns true when any run is
`RUN_STATUS.RUNNING` (the honest condition — the env snapshot concern applies
to every running run, both shapes). Rewrite user-config.test.mjs:221-226 to
feed a real-shaped run record (verb-keyed, no `agent` field) and assert the
refusal message (reworded per D1.2).

## D6 — What is frozen, verbatim

- session-store.mjs:44-45 (`IRIS_PO_MODEL`/`IRIS_DEV_MODEL` aliases) and
  :133-187 (migration: `sessions.po`, `models.po`, `last_agent_used === "po"`).
- wiring.mjs:199 `RETIRED_AGENTS` and pipeline-install.test.mjs:29.
- `openspec/changes/archive/**` (1,171 matching lines across 218 files — the
  drift gate never walks it, check-spec-drift.mjs:17-20 scope).
- `.audit/**` — six dated investigation reports; history, same status as the
  archive. Their po-session line references stay as written.
- Historical prose: PIPELINE_INTERNALS.md:89 ("what made 'PO' and 'DEV' each
  mean two things"), :694, :699, :700 (alias mention), :544 (describes the
  frozen migration). TESTING.md:41-42 is NOT frozen — it mirrors the
  workflow-quality-gates requirement this change modifies.
- The three negative assertions banning "Product Owner" from model-facing text
  (agent-definitions.test.mjs:111, verbs.test.mjs:312, gemini-tools.test.mjs:89)
  stay — they are the fence, not the vocabulary.

## D7 — Gate couplings the implementer must not discover mid-flight

1. **Three vi.mock blocks hand-list the po-session surface**:
   wiring.test.mjs:3-6 (2 symbols), wiring-capabilities.effects.test.mjs:19-29
   (10 symbols incl. `DEFAULT_PO_QUESTION_TIMEOUT_MS`, ~15 usages :41-202),
   run-exec.stateful-wiring.test.mjs:11-23 (8 symbols, local binding :29). A
   vi.mock of a renamed path silently mocks nothing and the real module then
   fails loudly — update in the same commit as the file rename. Phase 1's
   moves (timeout → run-stream, billing → worker-env) run FIRST precisely to
   shrink two of these blocks before the rename touches them.
2. **The dead-CSS gate**: `PoQuestionBanner` uses 10 `po-question-*`
   classNames (PoQuestionBanner.tsx:24-57) matched against
   `src/styles/claude.css` (17 occurrences) by scripts/dead-claude-css.mjs,
   run inside the lint gate (scripts/gates.mjs:225). Renaming TSX literals
   without the CSS selectors in the same commit reds the gate. Rename both
   sides together.
3. **spec-drift allowance anchors**: check-spec-drift.mjs:230-233 anchors the
   workflow-quality-gates allowance on the exact phrase
   ``cannot be right for all of them: `PO` matches`` — the delta in this
   change KEEPS that phrase verbatim, so the script needs no anchor edit. The
   four per-verb-model-selection allowances (:56-79 region) anchor on spec
   lines this change does not touch. If the implementer rewords the anchored
   line anyway, the gate re-flags by design (:52-54) — that is the signal to
   update the anchor in the same commit, not to exempt more.
4. **`error.statefulEndReason`**: an ad-hoc property on a thrown Error crossing
   from the session pump/cancel (stateful-session) to run-exec.mjs:928-936. No
   type system catches a half-rename; the teardown/cancel account tests in
   both suites do ("was reset before the turn completed").
5. **Gemini behavioral note**: the model has only ever been prompted with
   `SYSTEM_EVENT_PO_QUESTION`. The event name and every prompt mention rename
   in one task, so a session never sees a mixed pair; the live smoke test
   (tasks §6) confirms the voice announcement still fires on a real question.

## D8 — One change, and rename-before-extraction

- The rename can land green alone (tsc covers both halves of every symbol,
  the three spec deltas are exactly the citations). The extraction has zero
  spec surface of its own — as a standalone change it would carry an empty
  delta set, which is a refactor phase, not a change. One change, two phases.
- Rename FIRST, so every line the extraction moves is already clean and the
  extraction commit stays reviewable as a verbatim move. Extracting first
  would mint the pair `po-session.mjs` / `stateless-session.mjs` — 
  institutionalizing the exact asymmetry this change removes.
- `declared-bounds-reach-the-runtime` was withdrawn (commit f011778) before
  this change was authored — no open-change artifacts reference the old names;
  nothing to reconcile.
