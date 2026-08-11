# The sessions are named for their shape

## Why

"PO" (Product Owner) is a retired concept: the living spec is clean of it, the
personas were renamed for "the property that actually differs at runtime"
(PIPELINE_INTERNALS.md:694), and `spec:check` registers `PO` as retired
vocabulary. Only the code still says it — `po-session.mjs` and its 14 exports,
the renderer's `PoQuestion*` types, IPC channels, the `[IRIS][po-auth]` log
tag, and user-visible copy ("PO is waiting on you"). Worse, the name conflates
two things: the resident **stateful session** lifecycle, and the pipeline-wide
**ask/token/billing** machinery that serves stateless runs too (`execute` may
ask; billing is one policy for both shapes). And the stateless half of the
pair has no module of its own — it hides inside `run-exec.mjs` (1040 lines).

## What Changes

- **Two rename families, by what each thing actually is:**
  - Session lifecycle → `stateful*`: `po-session.mjs` → `stateful-session.mjs`,
    `getOrCreatePoSession` → `getOrCreateStatefulSession`, `deliverPoTurn` →
    `deliverStatefulTurn`, …, `error.poEndReason` → `error.statefulEndReason`.
  - Ask/token/billing → the existing `claude` family (`answer_claude_question`,
    `SYSTEM_EVENT_CLAUDE_COMPLETE` already live there): `poBillingStatus` →
    `claudeBillingStatus` (moves to `worker-env.mjs`), `poQuestionTimeoutMs` →
    `claudeQuestionTimeoutMs` (moves to `run-stream.mjs`), `savePoToken` →
    `saveClaudeToken`, `PoQuestionBanner` → `ClaudeQuestionBanner`, log tag
    `[IRIS][claude-auth]`, and the user-visible copy reworded.
- **Protocol strings renamed** (in-process, one bundle, no compat window):
  `SYSTEM_EVENT_PO_QUESTION` → `SYSTEM_EVENT_CLAUDE_QUESTION` (model-facing
  prompt text), sidecar event `po_question` → `claude_question`, IPC
  `po:answer-question` → `claude:answer-question`, `config:save-po-token` /
  `config:remove-po-token` → `config:save-claude-token` / `-remove-claude-token`.
- **Env var renamed with a back-compat alias:** `IRIS_PO_QUESTION_TIMEOUT_MS` →
  `IRIS_CLAUDE_QUESTION_TIMEOUT_MS`, old name still read, mirroring the
  `IRIS_PO_MODEL` → `IRIS_STATEFUL_MODEL` alias pattern.
- **The stateless path becomes a module:** `startStatelessRun` and its
  exclusive helpers extract from `run-exec.mjs` into `stateless-session.mjs`,
  so the stateful/stateless pair is visible on the file tree. `run-exec.mjs`
  keeps its name and its returned interface; it remains the shared preamble
  and policy layer delegating to both session modules symmetrically.
- **One latent defect fixed while renaming it:** `poTurnRunning()`
  (user-config.mjs:367) guards credential changes with `run.agent === "po"`,
  but no production code sets `run.agent` — the guard is dead, kept green only
  by a test fixture. It becomes `claudeTurnRunning()` with an honest predicate
  (any running run), test rewritten first.

## Non-goals (frozen surface)

- `session-store.mjs:133-187` — the one-way migration reading `sessions.po`,
  `models.po`, `last_agent_used === "po"`: those literals name on-disk legacy
  data. Unchanged verbatim.
- `IRIS_PO_MODEL` / `IRIS_DEV_MODEL` alias reads (session-store.mjs:44-45) and
  their spec (`per-verb-model-selection`). Unchanged.
- `RETIRED_AGENTS = [..., "po", "dev"]` (wiring.mjs:199) — names real files an
  older Iris wrote; it is the cleanup mechanism, not the vocabulary.
- `openspec/changes/archive/**` and `.audit/**` — history, never edited.
- Historical prose that explains why the current names exist
  (PIPELINE_INTERNALS.md:89, :694, :699) stays.

## Impact

- Affected specs: `workflow-quality-gates` (retired-vocabulary rationale
  recast onto the identifiers that survive), `run-execution-queue` (timeout
  var citation), `renderer-structure` (sidecar event vocabulary).
- Affected code: `electron/po-session.mjs` (+test), `run-exec.mjs`,
  `run-stream.mjs`, `worker-env.mjs`, `user-config.mjs`, `live-session.mjs`,
  `wiring*.mjs`, `ipc.mjs`, `preload.cjs`, `main.mjs`, `session-store.mjs`,
  `pipeline-probes.mjs`; renderer `vite-env.d.ts`, `App.tsx`, `HudShell.tsx`,
  `PoQuestionBanner.tsx`, `SetupPanel.tsx`, `styles/claude.css`; three
  `vi.mock` blocks and the `ipc.test.mjs` channel roster;
  `scripts/check-spec-drift.mjs` allowance anchors; docs + `.env.example`.
- No behavior change except the `claudeTurnRunning` fix and the env alias.
  Session resume is safe: the persisted key namespace is already `"stateful"`,
  `note:<id>`, `execute` — no on-disk artifact carries "po" after first-load
  migration.
