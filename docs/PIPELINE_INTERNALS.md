# Pipeline Internals (PO → DEV)

[← Back to README](../README.md) · [Architecture](ARCHITECTURE.md) · [User-facing pipeline guide](PIPELINE_GUIDE.md)

Implementation-level reference for the Gemini↔Claude bridge: how the pipeline is
detected and gated, how a task is dispatched and streamed, how the PO's voice
question relay works, how sessions and context ownership are scoped, and how PO
billing/auth is kept on the subscription path.

Read this before changing anything in `electron/main.mjs` or
`electron/po-session.mjs`. The corresponding living specs are in
`openspec/specs/` (`pipeline-availability`, `voice-decision-relay`,
`per-role-model-selection`, `agent-subscription-auth`, `openspec-native-pipeline`,
`run-execution-queue`, `setup-panel`) — if this doc and a spec disagree, the spec
wins and this doc needs fixing.

## Two roles, two deliberately different mechanisms

Iris splits the pipeline by **state model**, and the two halves evolve separately:

- **PO — stateful module.** A persistent `@anthropic-ai/claude-agent-sdk` session
  (`electron/po-session.mjs`) kept alive across turns: one continuous context
  window, no respawn/replay per turn. It can pause mid-turn via
  `AskUserQuestion` and get a voice answer back before continuing (see
  "Voice decision relay" below).
- **DEV — stateless module.** Unchanged one-shot `claude -p --resume` subprocess
  per issue, exactly as before this module split — fire-and-forget, never asks.

(A third role, **STUDY** — a second-brain learning assistant — existed in an
earlier version and was removed for the community release; see
`openspec/changes/archive/` and git history to resurrect it.)

## Pipeline availability (chat-only mode)

- `pipelineAvailable` (module-level in `main.mjs`) is the single source of truth for whether the PO → DEV pipeline is on. Set by `probePipelineAvailability()`, which reuses `checkClaudeStatus()`'s `claude --version` probe — the `claude` binary resolving is the **only** input; `CLAUDE_CODE_OAUTH_TOKEN` never affects it (that only gates individual PO turns via `poBillingStatus()`).
- Probed at app boot (fire-and-forget) and at the top of every `connectLive()` call (fresh connect or Live's periodic reconnect) — Live tool declarations are fixed per session, so a just-installed CLI only takes effect on the next (re)connect. Also re-probed by `checkClaudeHealth()`, the SetupPanel's "Check Claude" / re-check path.
- Gates three things from one flag, no separate toggles: `buildClaudeTools()` only spreads in `buildPipelineToolDeclarations()` when true (interface-control tools from `buildAlwaysToolDeclarations()` are always declared); `buildSystemInstructionText()` includes the pipeline paragraphs (delegation rules, PO control, agent pipeline, brief writing, …) only when true, with a short chat-only alternative otherwise — one builder, not two maintained prompts; `executeClaudeTool` additionally guards `PIPELINE_ONLY_TOOLS` at call time as a defensive backstop.
- The renderer learns the value via `window.iris.getPipelineStatus()` (IPC `pipeline:status`, read at mount) and the `pipeline_availability` sidecar event (emitted only when the value changes). `App.tsx` holds it as `pipelineAvailable` state and conditionally renders Work Stream, PipelineBar, the workstream switcher (nested inside WorkStream), TaskChooser, and — inside `HudShell` via a passed-down prop — the HUD tasks column and PO question banner.
- See `openspec/specs/pipeline-availability/spec.md` for the full requirement set.

## The delegation model (key mental model)

1. Gemini decides routing: quick facts → built-in Google Search; real work → Claude tools (only declared when `pipelineAvailable`, see above). Gemini's pipeline tools: `check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model`.
2. `submit_claude_task` dispatches by role. **DEV** (and plain Claude) spawn `claude -p "<task>" --output-format stream-json --verbose --permission-mode bypassPermissions --append-system-prompt "…"` and **return a `run_id` immediately** — Gemini 3.1 Live function calls are synchronous, so a tool call must never block on long work. **PO** delivers the task as a new turn into its resident Agent SDK session (`getOrCreatePoSession`/`deliverPoTurn` in `po-session.mjs`), created on the first PO turn in a workstream.
3. Both paths report progress through the same shape: DEV's NDJSON stream is parsed line-by-line; PO's SDK messages are routed the same way internally. Each tool call/note is pushed to the Work Stream panel in realtime. On completion (process exit for DEV, turn `result` message for PO) the final result is shown.
4. On completion, main injects `SYSTEM_EVENT_CLAUDE_COMPLETE` into the Gemini session so it proactively announces the result. Other internal events follow the same `SYSTEM_EVENT_*` convention (`SESSION_START`, `WORKSPACE_UPDATE`, `AGENT_SELECT`, `PO_QUESTION`).
5. `runQueue` still enforces "Claude does one thing at a time" globally — a PO turn and a DEV run share the same execution slot and queue behind each other exactly like two DEV runs would, via the same `finalizeRun`/`startNextInQueue`. The PO's resident session itself is a separate, independent piece of state (in `po-session.mjs`) that is never touched while a turn is merely queued — only `startPoRun` reads/delivers into it.

## Voice decision relay (PO only)

- PO may call `AskUserQuestion` mid-turn (its persona and `appendSystemPrompt` say so explicitly — the opposite of DEV's "never ask"). The SDK's `canUseTool` callback in `po-session.mjs` intercepts it and awaits an answer from `askUserQuestionViaVoice` in `main.mjs`.
- `askUserQuestionViaVoice` emits `SYSTEM_EVENT_PO_QUESTION` (and a `po_question` sidecar event for the UI) and registers a single global `pendingPoQuestion` — at most one can ever be in flight, since `runQueue` allows only one PO turn/DEV run system-wide at a time.
- Two paths can answer it: the Gemini tool `answer_po_question` (primary, voice) or `window.iris.answerPoQuestion` (secondary, UI click) via `ipcMain.handle("po:answer-question", ...)`. Whichever resolves first wins; `resolvePendingPoQuestion` is a no-op once already settled.
- Unanswered after `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000ms/5min): resolves with the first-listed ("recommended") option per question. Session reset (see below) settles any pending question the same way before tearing down.
- PO's tool-use permission mode stays `bypassPermissions` — only `AskUserQuestion` pauses; every other tool call auto-allows exactly as before. See design.md's "Verified against the installed SDK" note for the residual doc ambiguity this relies on.

## Sessions, workstreams, and context ownership

- Context is **user-controlled**. Each "workstream" (session) has a project folder (`cwd`) and an active pipeline role. **DEV** tasks **`--resume`** the stored Claude session for that role; **PO** tasks deliver into the resident SDK session, which itself was opened with `resume: <stored id>` if one existed. Either way follow-ups build on prior work. Tasks run **one at a time** (queued if Claude is busy) — see `runQueue` above.
- Sessions never reset on their own — only on explicit user action (New button, voice "new session", or picking a different project folder; Claude scopes conversations per directory). Persisted to `~/.iris/claude-sessions.json`. Each of these actions also closes any resident PO session bound to the workstream/cwd being left (`closePoSession`) so no subprocess is orphaned.
- Sessions are stored **per agent role**: PO and DEV each own their own continuous conversation within a workstream. The **only** context that crosses the PO → DEV gate is the **OpenSpec change** the PO writes to disk (`openspec/changes/<name>/`) — never a shared conversation.
- Default Claude working dir is `~/.iris/workspace` (override `IRIS_CLAUDE_CWD`).
- Rollback: `IRIS_PO_LIVE_SESSION=0` reverts PO to the pre-SDK one-shot behavior (identical to DEV's mechanism) with no data migration — both paths share the same `agent_sessions.po` id.

## The PO → DEV agent pipeline

- Role personas live in `resources/personas/iris-po.md` and `iris-dev.md`. On demand they are **installed to `~/.claude/agents/iris-<role>.md`** (`installIrisAgents`) and run via `claude --agent iris-<role>` (DEV, CLI flag) or `agent: "iris-po"` (PO, SDK option) — same underlying persona file either way. `AGENT_PREFIX = "iris-"`, `AGENT_LABELS = { po: "PO", dev: "DEV" }`.
- **The pipeline runs on OpenSpec — it is the single SDD surface (no `.scratch/` PRD).** Iris's PO is the **voice controller**: the Gemini voice layer sends the Claude-side PO short **control intents** (start-and-grill / propose / "are there tasks left?" / archive), never a hand-written PRD. **PO** grills the request first (the `grilling` skill; questions surface via `AskUserQuestion` voice relay), then runs the OpenSpec propose flow to create `openspec/changes/<name>/` with a `tasks.md`. **DEV** runs headless and implements the **remaining unchecked tasks of an open change** (`openspec-apply-change` + `tdd`, then verifies itself and uses `code-review`), then archives it to sync `openspec/specs/`. DEV never asks — it records "Decisions needed" that Iris reads aloud at run end. Global skills (OpenSpec + mattpocock) in `~/.claude/skills` are a **prerequisite**; the PO SDK session enables them with `skills: 'all'` (see `po-session.mjs`), so both roles work on any `cwd`.
- **DEV is gated on the spec.** `startClaudeRun` refuses a DEV run when `openChangesWithTasks(cwd)` is empty (no open change with unchecked `- [ ]` tasks) — DEV never free-codes without a proposed change.
- The first role run in a fresh project makes it OpenSpec-ready via `ensureProjectScaffold` → `openspec init <cwd> --tools claude` (non-interactive; no-op if `openspec/` already exists). The `openspec` CLI is resolved by `openspecBinary()` (probes `~/.local/bin` etc.; override `IRIS_OPENSPEC_BIN`). If editing the pipeline, keep the persona files and this scaffold/gate logic in sync.
- **Bundled prerequisite installer.** `resources/skills/` vendors snapshots of the required third-party skills (mattpocock's `grilling`/`tdd`/`code-review`/`diagnosing-bugs`, plus the OpenSpec-generated skills + `/opsx` commands — see `resources/skills/ATTRIBUTION.md` for sources/versions/refresh steps). `installPipelinePrereqs()` (`main.mjs`) runs `installIrisAgents()` unchanged (sync-overwrite — Iris owns the personas), then copies each bundled skill dir / command file into `~/.claude` **only where nothing already exists** (`pathExists()` uses `lstatSync` so a `skills.sh`-managed symlink counts as present and is never touched). Exposed via IPC `pipeline:install-prereqs` → preload `installPipelinePrereqs()` → SetupPanel's "Install missing" button; runs only on that explicit user action, never at startup. `REQUIRED_SKILLS`/`checkSkillsStatus()` and the new `checkAgentsStatus()` back the SetupPanel's prerequisite rows — kept in sync with exactly what the personas invoke (no phantom entries).
- **Per-role model choice.** Each workstream stores an `agent_models: { po?, dev? }` map beside `agent_sessions`. Resolution order: workstream choice → `IRIS_PO_MODEL`/`IRIS_DEV_MODEL` env → hardcoded default (PO=`claude-fable-5`, DEV=`claude-sonnet-5`); plain Claude never gets a model choice. Model is resolved at **run start**, not submit time, so a change made while a task is queued still applies. DEV gets it via `--model` on the spawn; PO gets it via SDK `options.model` at session creation and `query.setModel()` on an already-live session (context preserved, no resume/respawn). No automatic fallback — an unavailable model fails the run loudly like any other error. Set from the UI (chip's model segment, separate click zone from the role-select label) or by voice (`set_agent_model` tool) — both funnel through the same `setAgentModel()` in `main.mjs`. See `openspec/changes/per-role-model-selection/`.

## PO subscription auth (stateful module only)

- The Agent SDK does **not** inherit the interactive `claude` `/login` session. The PO session authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (generate once with `claude setup-token`) so usage bills against the subscription, not the metered API.
- `computePoSessionEnv` (in `po-session.mjs`) strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the PO session's environment unconditionally — `ANTHROPIC_API_KEY` outranks the OAuth token in the SDK's own auth precedence, so a stray key left in `.env` would otherwise silently switch PO usage to per-token API billing. This scrubbing is **PO-scoped only**; DEV's subprocess env (`process.env`, unchanged) is never touched.
- `logPoBillingPathOnce()` logs which path is active at startup; `poBillingStatus()` gates `startPoRun` with an actionable error if no token is configured.
- The token is settable from the app: SetupPanel's Claude section (shown only when the `claude` binary resolves) has a masked field plus Save/Remove, routed through `savePoToken()` in `main.mjs` (IPC `config:save-po-token` / `config:remove-po-token`). It writes the same `.env` as every other setting, which is the only editable location in a packaged build (`~/.iris/.env`). Two rules make this safe: the value never reaches the renderer (`getFullConfig()` exposes only `poTokenSet`, and an empty token in an ordinary `config:save` is ignored via `KEEP_ON_EMPTY_CONFIG_KEYS` so the global Save can't blank it), and because `computePoSessionEnv` snapshots the environment at session creation, a token change calls `closeAllPoSessions()` — stored session ids are kept, so the next PO turn resumes the same conversation with the new credential. A change is refused while a PO turn is `RUNNING`. See `openspec/specs/setup-panel/` and `agent-subscription-auth/`.
