# Pipeline Internals (PO → DEV)

[← Back to README](../README.md) · [Architecture](ARCHITECTURE.md) · [User-facing pipeline guide](PIPELINE_GUIDE.md)

Implementation-level reference for the Gemini↔Claude bridge: how the pipeline is
detected and gated, how a task is dispatched and streamed, how the PO's voice
question relay works, how sessions and context ownership are scoped, and how PO
billing/auth is kept on the subscription path.

Read this before changing anything in the pipeline modules under `electron/`
(`pipeline-probes.mjs`, `pipeline-install.mjs`, `run-dispatch.mjs`,
`run-stream.mjs`, `run-exec.mjs`, `session-store.mjs`, `user-config.mjs`) or
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
- **DEV — stateless module.** One-shot `query()` per issue, resuming the stored
  session id — fire-and-forget, never asks. (It was a `claude -p --resume`
  subprocess until the app began shipping the CLI itself; the lifetime is the
  same, only the transport changed.)

(A third role, **STUDY** — a second-brain learning assistant — existed in an
earlier version and was removed for the community release; see
`openspec/changes/archive/` and git history to resurrect it.)

## Pipeline availability (chat-only mode)

- `pipelineAvailable` (owned by `electron/pipeline-probes.mjs`) is the single source of truth for whether the PO → DEV pipeline is on. Set by `probePipelineAvailability()`, which reuses `checkClaudeStatus()`'s `claude --version` probe — the `claude` binary resolving is the **only** input; `CLAUDE_CODE_OAUTH_TOKEN` never affects it (that only gates individual PO turns via `poBillingStatus()`).
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

- PO may call `AskUserQuestion` mid-turn (its persona and its system prompt say so explicitly — the opposite of DEV's "never ask"). The SDK's `canUseTool` callback in `po-session.mjs` intercepts it and awaits an answer from `askUserQuestionViaVoice` in `run-stream.mjs`.
- **The asymmetry is enforced, not just stated.** Measured: `AskUserQuestion` is only offered to the model when a `canUseTool` callback is present, and `disallowedTools` removes it even then. DEV sets `disallowedTools: ["AskUserQuestion"]` **and** a `canUseTool` that aborts the run with a diagnostic if it is ever reached, so a headless run can never wait for an answer nobody is listening for. The prompt is the explanation; the configuration is the guarantee.
- A question is relayed **without losing its shape**: its `header` (short topic label) and `multiSelect` flag both reach the voice layer and the UI. `AskUserQuestion`'s `answers` map takes one string per question with multi-select answers **comma-separated**, and every answer path — voice, click, and the timeout default — encodes through the one `encodeAnswer` in `run-stream.mjs`, so none of them can silently reduce a multi-select question to a single choice.
- `askUserQuestionViaVoice` emits `SYSTEM_EVENT_PO_QUESTION` (and a `po_question` sidecar event for the UI) and registers a single global `pendingPoQuestion` — at most one can ever be in flight, since `runQueue` allows only one PO turn/DEV run system-wide at a time.
- Two paths can answer it: the Gemini tool `answer_po_question` (primary, voice) or `window.iris.answerPoQuestion` (secondary, UI click) via `ipcMain.handle("po:answer-question", ...)`. Whichever resolves first wins; `resolvePendingPoQuestion` is a no-op once already settled.
- Unanswered after `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000ms/5min): resolves with the first-listed ("recommended") option per question, encoded in the shape the question asked for. Session reset (see below) settles any pending question the same way before tearing down.
- PO's tool-use permission mode stays `bypassPermissions` — only `AskUserQuestion` pauses; every other tool call auto-allows exactly as before. The SDK warns that `bypassPermissions` shadows `canUseTool`; measured, it fires for `AskUserQuestion` anyway, which is the asymmetry PO depends on.
- **End-of-run decisions travel as data, not prose.** Role runs declare an `outputFormat` schema (`electron/run-output-format.mjs`) with a `summary` and an optional `decisions[]`. Note the trap this creates and `readRunOutput` defuses: once `outputFormat` is set, `result.result` becomes the raw **JSON string**, and that field is what finalizes a run and gets read aloud — so the speakable text must come from `structured_output.summary`. The prose `## Decisions needed` block stays as the fallback for one release (a session resumed from before the schema cannot produce structured output, and plain Claude declares no schema).

## One system-prompt policy, one budget policy

Both roles route through the same two modules, for the same reason
`worker-env.mjs` exists: a policy each role implements at its own call site is a
policy that will drift.

- **`electron/role-prompt.mjs`** produces the base prompt for `po`, `dev`, and
  plain Claude. No call site builds prompt text. The two roles differ by exactly
  one documented clause (PO is a live session that may pause and ask; DEV is
  headless and cannot), and a test asserts that stripping each role's clause
  leaves two identical strings.
  - It emits `systemPrompt: { type: "preset", preset: "claude_code", append }` —
    **the only delivery mechanism the SDK reads.** PO previously carried its
    live-session instruction on a top-level `appendSystemPrompt`, which is not a
    declared field and was silently discarded, so PO ran with no base prompt at
    all while DEV got a full one. See `docs/REFERENCE.md` for the measurement.
  - Caveat that is invisible at the call site: on a run with `agent` set — every
    PO and DEV run — the definition's prompt replaces the base, so the
    `claude_code` preset half is dropped and only `append` survives. The persona
    body *is* the base prompt for a role. Plain-Claude runs get both halves.
- **`electron/run-budget.mjs`** gives every run a turn ceiling and a spend
  ceiling (`maxTurns`, `maxBudgetUsd`), overridable by `IRIS_CLAUDE_MAX_TURNS` /
  `IRIS_CLAUDE_MAX_BUDGET_USD`. Defaults come from measurement, not intuition: a
  representative PO propose turn took **28 turns / $0.97**, a DEV implementation
  run **29 turns / $0.78**, both on a small real project. Ceilings sit at ~4–6×
  that, because **a cap that fires during ordinary work gets switched off**,
  which is worse than no cap. Note what the measurement overturned: PO is *not*
  the cheaper role.
  - A run that hits a ceiling finalizes as its own terminal status, `limited` —
    **not** `failed` — with a message naming which ceiling, its value, and the
    env var that raises it. A run that hit a limit and a run that broke need
    different responses from the user.
  - Cost is **recorded, never estimated**: `total_cost_usd`, `usage`,
    `modelUsage`, and `num_turns` are captured off the result message onto the
    run, projected on `claude_task_update`, shown on the run card, and answerable
    by voice through `get_claude_task_status`. `modelUsage` matters because a run
    that used subagents spends on more than one model — both measured runs
    carried two.

## Hooks: the guard and the authoritative tool boundary

`electron/run-hooks.mjs` installs the same five callbacks on both roles.
`parseClaudeStreamMessage` deliberately **stays** — hooks are an additional,
authoritative source, not a replacement, so `pushToolStart`/`pushToolEnd` keep
their signatures and the deck is untouched.

- **`PreToolUse` — the guard, and only the guard.** Two jobs, kept narrow so it
  stays reviewable: a one-shot warning when the run crosses a fraction of its
  spend ceiling (`IRIS_CLAUDE_BUDGET_WARN_FRACTION`, default 0.75), and a small
  explicit denylist for obviously destructive commands (`rm -rf` rooted outside
  the working directory, force-push, hard reset onto a remote). Relative deletes
  are deliberately allowed — a run cleaning up its own build output is ordinary
  work.
  - **This is a guardrail against accidents, not a sandbox, and Iris must not
    describe it as one anywhere.** `bypassPermissions` remains the intentional
    default because no interactive approval exists on the headless path; a
    determined or confused model can reach the same effect another way.
  - The in-flight spend figure comes from the SDK's
    `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` — the only
    live source there is, since everything else arrives once the run is over.
    Verified working, but experimental by declaration, so it degrades to
    **silence**: no figure means no warning, never an exception and never a
    number Iris made up.
- **`PostToolUse` / `PostToolUseFailure`** are the authoritative tool-end
  boundary and error flag. The old inference read `is_error` off a `tool_result`
  block, which cannot tell a tool that *failed* from one that completed and
  returned an error-shaped payload.
- **`PreCompact`** makes a compaction visible. It is otherwise a silent
  multi-second pause that reads as a stall, and a user who thinks a run has hung
  stops it.
- **`Notification`** surfaces runtime state that would otherwise never reach the
  user.

Also captured per run: the subprocess's **stderr**, buffered to the last 20 lines
and attached to a failed run's output. A transport failure used to reach the user
as one message with nothing behind it.

## Sessions, workstreams, and context ownership

- Context is **user-controlled**. Each "workstream" (session) has a project folder (`cwd`) and an active pipeline role. **DEV** tasks pass the stored session id as `resume`; **PO** tasks deliver into the resident SDK session, which itself was opened with `resume: <stored id>` if one existed. Either way follow-ups build on prior work. Tasks run **one at a time** (queued if Claude is busy) — see `runQueue` above.
- Sessions never reset on their own — only on explicit user action (New button, voice "new session", or picking a different project folder; Claude scopes conversations per directory). Persisted to `~/.iris/claude-sessions.json`. Each of these actions also closes any resident PO session bound to the workstream/cwd being left (`closePoSession`) so no subprocess is orphaned.
- Sessions are stored **per agent role**: PO and DEV each own their own continuous conversation within a workstream. The **only** context that crosses the PO → DEV gate is the **OpenSpec change** the PO writes to disk (`openspec/changes/<name>/`) — never a shared conversation.
- Default Claude working dir is `~/.iris/workspace` (override `IRIS_CLAUDE_CWD`).
- **A dead resume id is detected before the run, not after it fails.** `electron/run-sessions.mjs` asks `getSessionInfo()` up front; a session the runtime does not know about is dropped and the run starts fresh. This replaced a regex over the SDK's error string, which could only run *after* a run had already failed. It reports "dead" only on a positive answer — an inconclusive probe keeps the id, because discarding a live conversation is far worse than one failed run.
- **Both helpers pin `CLAUDE_CONFIG_DIR` for the call and restore it after.** This is not incidental: measured with the variable unset, `listSessions()` returned **32 of the user's own Claude Code sessions** out of `~/.claude` — the exact boundary Iris must never cross — and would have found none of Iris's own.
- Sessions are **named** after their workstream (`Label · DEV`), via `Options.title` for a new session and `renameSession()` for one that already exists. Every session Iris created used to carry an auto-generated title.
- The notes vault is **granted**, not described: plain-Claude runs get it through `additionalDirectories`. The prose directive that used to stand in for a grant, and the post-hoc `[vault-check: …]` caveat derived from diffing the vault afterwards, are both gone.
- **Cancellation is lifetime-agnostic.** Every run carries a `cancel`, so `runQueue.stop()` does not need to know whether it is stopping a one-shot DEV query (abort its controller) or a PO turn inside a resident session (`interrupt()` the turn, keep the session and its context window). An interrupt reports which queued work **survived** it, and Iris says so rather than claiming something was cancelled when it will still run.

## Skills, commands, and isolation from the user's Claude Code

- The skills the personas invoke (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`, the OpenSpec workflow skills, the LLM-Wiki skills) and the `/opsx` commands ship inside the app as a Claude Code **plugin** at `resources/iris-plugin/`, passed to every run through the SDK's `plugins` option (`{ type: "local", path, skipMcpDiscovery: true }`).
- Everything the plugin provides is **namespaced by the plugin name**: skills are `iris:grilling`, `iris:openspec-propose`, …; commands are `/iris:opsx:apply`, `/iris:opsx:archive`, …. The persona prompts reference those exact names.
- **A run sees only the skills its own work needs.** Both roles used to pass `skills: "all"`, so DEV could invoke `iris:grilling` and PO could reach the `wiki-*` suite. `electron/run-skills.mjs` now supplies an explicit list per role, each entry justified by a skill the persona or the plugin's own cross-references actually invokes. Measured, this is a real context filter, not a label: identical prompt, total input tokens — `"all"` (17 skills) 18 007, a two-skill list 16 056, `[]` 15 934. Plugin-qualified (`iris:grilling`) and bare (`grilling`) names behave identically; qualified is used so the list and the persona diff against each other by eye. Per the SDK's own wording this is **a context filter, not a sandbox**: unlisted skills are hidden from the model and rejected by the Skill tool, but their files stay readable via Read/Bash.
- `settingSources` is `["project"]`: the user's **`~/.claude` is never read**, so Iris neither depends on nor is perturbed by whatever they have installed in their own Claude Code. The working repository's `.claude/` is still loaded, which is what makes a project-local `.claude/agents/iris-<role>.md` override work.
- `skipMcpDiscovery` is set because Iris owns its own MCP wiring (the canvas server arrives via `mcpServers`); the plugin must not open connections of its own.
- **`settingSources` is not sufficient on its own**, and this is the part that is easy to get wrong. A few filesystem inputs are read and written *regardless* of it: the session transcript of every run, the always-read global `.claude.json`, and auto-memory. They all resolve under `CLAUDE_CONFIG_DIR`. So `computeClaudeWorkerEnv` (`electron/worker-env.mjs`) pins that variable to **`~/.iris/claude-home`** for both roles and sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Measured before this existed: one DEV run against `~/.iris/workspace` left a 57 KB transcript in the user's `~/.claude/projects/`. The directory has to be **stable** (not a temp dir) because a resumed session must find the transcript an earlier run wrote; the CLI creates it, and its own `.claude.json` inside it, on first use.
- Deliberately **not** overridable by an environment variable — the only interesting value to point it at is the user's `~/.claude`, which is what this prevents. Tests inject it through `computeClaudeWorkerEnv`'s second argument.
- **Consequence: the host Claude Code login is no longer reachable.** Before the pin, a run on a machine with an interactively logged-in Claude Code authenticated from that keychain entry *even with no credential in the environment* — so the app silently depended on the user's own install, and a developer machine could not reveal the failure a credential-less machine would hit. `PATH=/nonexistent` does not simulate this: it hides binaries, not the credential store. A credential must now come from the environment, which is exactly what the availability gate checks.
- Nothing is installed into `~/.claude`. Older Iris versions did copy skills, commands, and personas there — and, before the config-dir pin, wrote run transcripts into `~/.claude/projects/`. Settings offers a one-click removal of exactly those paths and nothing else. Transcript directories keyed by a **real project path** are deliberately excluded from that cleanup: Iris's runs and the user's own Claude Code sessions for the same project land in the same directory, so removing it would delete the user's history. Only the directory for Iris's own scratch workspace is safely attributable.

## The PO → DEV agent pipeline

- Role personas live in `resources/personas/iris-po.md` and `iris-dev.md`. They are parsed into the SDK's `AgentDefinition` (`electron/agent-definitions.mjs`) and passed to `query()` **by value** via `agents: { "iris-<role>": … }` + `agent: "iris-<role>"` — nothing is installed into `~/.claude/agents`. A project-local `.claude/agents/iris-<role>.md` still wins, since `settingSources` keeps the `project` scope. `AGENT_PREFIX = "iris-"`, `AGENT_LABELS = { po: "PO", dev: "DEV" }`.
- **The pipeline runs on OpenSpec — it is the single SDD surface (no `.scratch/` PRD).** Iris's PO is the **voice controller**: the Gemini voice layer sends the Claude-side PO short **control intents** (start-and-grill / propose / "are there tasks left?" / archive), never a hand-written PRD. **PO** grills the request first (the `grilling` skill; questions surface via `AskUserQuestion` voice relay), then runs the OpenSpec propose flow to create `openspec/changes/<name>/` with a `tasks.md`. **DEV** runs headless and implements the **remaining unchecked tasks of an open change** (`openspec-apply-change` + `tdd`, then verifies itself and uses `code-review`), then archives it to sync `openspec/specs/`. DEV never asks — it records "Decisions needed" that Iris reads aloud at run end. The skills both roles invoke come from the bundled plugin (above), enabled with `skills: 'all'`, so nothing has to be installed on the machine and both roles work on any `cwd`.
- **DEV is gated on the spec.** `startClaudeRun` refuses a DEV run when `openChangesWithTasks(cwd)` is empty (no open change with unchecked `- [ ]` tasks) — DEV never free-codes without a proposed change.
- The first role run in a fresh project makes it OpenSpec-ready via `ensureProjectScaffold` → `openspec init <cwd> --tools claude` (non-interactive; no-op if `openspec/` already exists). The `openspec` CLI ships with the app (`@fission-ai/openspec`): `openspecCommand()` returns a command spec that runs it through Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), since it is a JS entry point rather than a native executable. If editing the pipeline, keep the persona files and this scaffold/gate logic in sync.
- **No prerequisite installer.** `resources/iris-plugin/` vendors snapshots of the required third-party skills (mattpocock's `grilling`/`tdd`/`code-review`/`diagnosing-bugs`, plus the OpenSpec-generated skills + `/opsx` commands — see `resources/iris-plugin/ATTRIBUTION.md` for sources/versions/refresh steps) and ships them as a plugin, so there is nothing to install and no install step to skip. `checkSkillsStatus()` verifies the **bundle** is intact rather than checking the machine, and backs the SetupPanel's "Bundled / Damaged" row. What remains of the old installer is its inverse: `legacyClaudeArtifactsStatus()` / `removeLegacyClaudeArtifacts()` (IPC `pipeline:legacy-artifacts` / `pipeline:remove-legacy-artifacts`) report and, on an explicit click, remove what *older* Iris versions wrote into `~/.claude`.
- **Per-role model choice.** Each workstream stores an `agent_models: { po?, dev? }` map beside `agent_sessions`. Resolution order: workstream choice → `IRIS_PO_MODEL`/`IRIS_DEV_MODEL` env → hardcoded default (PO=`claude-opus-5`, DEV=`claude-sonnet-5`); plain Claude never gets a model choice. Model is resolved at **run start**, not submit time, so a change made while a task is queued still applies. DEV gets it via SDK `options.model` on its one-shot `query()`; PO gets it via SDK `options.model` at session creation and `query.setModel()` on an already-live session (context preserved, no resume/respawn). No automatic fallback — an unavailable model fails the run loudly like any other error. Set from the UI (chip's model segment, separate click zone from the role-select label) or by voice (`set_agent_model` tool) — both funnel through the same `setAgentModel()` in `electron/session-store.mjs`. See `openspec/changes/per-role-model-selection/`.

## PO subscription auth (stateful module only)

- Runs do **not** inherit the interactive `claude` `/login` session — and since the config-dir pin (above) that is now enforced rather than merely assumed. A role authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (generate once with `claude setup-token`, pointed at Iris's own bundled binary) so usage bills against the subscription, or via `ANTHROPIC_API_KEY` for metered billing.
- `computeClaudeWorkerEnv` (in `worker-env.mjs`) strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` whenever a subscription token is present — `ANTHROPIC_API_KEY` outranks the OAuth token in the SDK's own auth precedence, so a stray key left in `.env` would otherwise silently switch usage to per-token API billing. With no token it is left in place as the only credential an API-key-only user has. This is now a **single policy for both roles** (`computePoSessionEnv` is a thin alias of it), so DEV and PO cannot drift apart.
- `logPoBillingPathOnce()` logs which path is active at startup; `poBillingStatus()` gates `startPoRun` with an actionable error if no token is configured.
- The token is settable from the app: SetupPanel's Claude section (always shown — the binary ships with the app, so a missing credential is the only thing a user can actually lack) has a masked field plus Save/Remove, routed through `savePoToken()` in `electron/user-config.mjs` (IPC `config:save-po-token` / `config:remove-po-token`). It writes the same `.env` as every other setting, which is the only editable location in a packaged build (`~/.iris/.env`). Two rules make this safe: the value never reaches the renderer (`getFullConfig()` exposes only `poTokenSet`, and an empty token in an ordinary `config:save` is ignored via `KEEP_ON_EMPTY_CONFIG_KEYS` so the global Save can't blank it), and because `computePoSessionEnv` snapshots the environment at session creation, a token change calls `closeAllPoSessions()` — stored session ids are kept, so the next PO turn resumes the same conversation with the new credential. A change is refused while a PO turn is `RUNNING`. See `openspec/specs/setup-panel/` and `agent-subscription-auth/`.
