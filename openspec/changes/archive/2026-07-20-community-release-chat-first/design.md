# Design: Community Release — Chat-First Iris

## Context

Iris today assumes the full stack is present: the Gemini system prompt describes three Claude roles, all Claude tools are always declared to the Live session, and the deck/HUD UI is built around the Work Stream. The STUDY role additionally depends on the `open-second-brain` plugin. For the community release, chat must work with nothing but `GEMINI_API_KEY`, the PO → DEV pipeline must reveal itself only when the `claude` binary is present, and STUDY is deleted outright (decisions locked in with the user through a grilling session; recovery path is git history plus `openspec/changes/archive/study-note-role/`).

Relevant existing mechanics this design builds on:

- `claudeBinary()` (`electron/main.mjs:669`) resolves the CLI via `IRIS_CLAUDE_BIN` + PATH probing; `check_claude_status` already shells `claude --version` (`electron/main.mjs:735`).
- Gemini session config declares `functionDeclarations` (`electron/main.mjs:1736`) and `systemInstruction` (`electron/main.mjs:1907`) at session creation — Gemini Live cannot change a session's tools mid-flight.
- `SetupPanel.tsx` already checks Claude CLI availability and PO token presence, and already owns the "can't hot-apply → offer reconnect" pattern (see `openspec/specs/setup-panel/spec.md`).
- `poBillingStatus()` already gates PO on `CLAUDE_CODE_OAUTH_TOKEN` with an actionable error; this stays the only token gate.

## Goals / Non-Goals

**Goals:**

- Zero-config chat: Gemini key alone yields a clean voice-companion experience with no dead pipeline surfaces.
- Pipeline availability is a single boolean derived from `claude` binary presence, computed in main and mirrored to the renderer; everything pipeline-shaped keys off it.
- Full STUDY removal (code, UI, prompts, personas, env, docs, living spec) with no data migration.
- SetupPanel is the one place that explains what's missing and how to enable more.

**Non-Goals:**

- No auto-installation of the Claude CLI, `openspec` CLI, or global skills into the user's machine or `~/.claude`.
- No packaged `.app`/`.exe` distribution this round (source + tag only).
- No feature flag to resurrect STUDY; no migration of existing `agent_sessions.study` data.
- No change to PO/DEV mechanics themselves (stateful SDK session vs one-shot spawn, queueing, OpenSpec gate all unchanged when the pipeline is on).

## Decisions

### 1. Availability is probed in main at startup and on demand; enabling requires a session reconnect

`pipelineAvailable` = `claude --version` succeeds for `claudeBinary()` (reusing the existing health-check code path, with its existing timeout). Probed once before the Gemini session is created, re-probed on SetupPanel "re-check" and on every Gemini session (re)connect. Because Live tool declarations are fixed per session, flipping availability mid-session cannot hot-apply: SetupPanel surfaces the existing reconnect prompt instead. Alternative considered — always declare tools and error at call time: rejected because Gemini would verbally offer delegation that then fails, the exact confusion this change exists to remove.

### 2. Chat-only Gemini surface = subtractive, not a second prompt fork

One system-prompt builder with the pipeline sections (delegation rules, PO control, roles, workspace) included only when `pipelineAvailable`. Tool list likewise: chat-only sessions declare only the non-Claude tools (UI control stays; it is interface-only). `check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model` are all omitted. Alternative — maintaining two prompt files: rejected as a drift hazard.

### 3. Renderer learns availability through the existing sidecar/boot payload

Main includes `pipeline_available` in the payload the renderer already receives at boot/session start (plus a sidecar event on re-check), exposed via `preload.cjs`. `App.tsx` holds it as state and gates Work Stream, `PipelineBar`, `SessionSwitcher` (workstream switcher), `TaskChooser`, HUD tasks column, and the PO question banner mount. No new IPC pair beyond what the payload extension needs.

### 4. STUDY removal is deletion, not deactivation

Delete `electron/study-session.mjs` and `resources/personas/iris-study.md`; shrink `AGENT_ROSTER` to `["po", "dev"]` and drop every `study` branch (dispatch in `startClaudeRun`, prompt blocks, tool descriptions, labels, model defaults/env). The voice-question relay drops its `role` parameter and reverts to PO-only semantics. `installIrisAgents` additionally deletes a stale `~/.claude/agents/iris-study.md` if one exists (we created it; cleaning it up is symmetric and keeps the user's agent list truthful).

### 5. Stale persisted state is sanitized on load, not migrated

`~/.iris/claude-sessions.json` may hold `agent_sessions.study`, `agent_models.study`, or an active agent of `study`. On load: an active agent of `study` falls back to the default role; `study` keys in the two maps are ignored (left in place, harmless). No migration/rewrite pass — the file format is otherwise unchanged and a git revert restores full compatibility.

### 6. SetupPanel prerequisite checks are read-only probes

Two new checks beside the existing Claude CLI/token rows: `openspec` CLI (via the existing `openspecBinary()` resolution, `--version` probe) and required global skills (directory-existence probe under `~/.claude/skills/` for the OpenSpec and mattpocock skill sets the personas invoke). Each row shows present/missing, a copyable install command, and shares the re-check action. Iris never writes into `~/.claude/skills`.

## Risks / Trade-offs

- [Gemini session created before user installs Claude mid-run keeps chat-only tools] → SetupPanel re-check detects the binary and offers the standard reconnect; after reconnect the pipeline is live. Documented in the panel copy.
- [Skills check is a heuristic (directory existence), not a semantic validation] → Acceptable: the real failure mode it prevents is "skill absent entirely"; PO/DEV error output still surfaces deeper problems. The check's copy says "detected", not "verified".
- [STUDY users on upgrade lose notes workflow with no warning at runtime] → BREAKING is called out in the release notes and README changelog; recovery documented as `git checkout <pre-release-tag>`/revert.
- [Hiding the workstream switcher in chat-only mode also hides multi-conversation management] → Intentional: workstreams exist to scope Claude sessions/cwd; pure chat has no per-project state worth switching. If chat-side history later needs it, that is a new capability.
- [Removing `get_workspace_info` from chat-only sessions removes folder-picker voice flow] → Correct behavior: the workspace concept only matters for Claude runs; the folder UI is hidden with the rest of the pipeline surface.

## Migration Plan

1. Land code + spec deltas in one change (this one); archive syncs living specs (six modified, `study-note-role` deleted).
2. README rewrite ships in the same change so the tag never points at docs describing STUDY.
3. Tag `v0.2.0` + GitHub Release notes (BREAKING: STUDY removed; NEW: chat-first onboarding). Tagging is a release step, not a task-gated code step.
4. Rollback: `git revert` of the change commit(s); no data migration in either direction (Decision 5).

## Open Questions

- None blocking. The exact skill-directory names probed by the SetupPanel check are pinned during implementation from what `resources/personas/iris-po.md`/`iris-dev.md` actually invoke (currently the OpenSpec skills and mattpocock's `grilling`/`tdd`/`verify`/`code-review` set).
