# Tasks: Community Release — Chat-First Iris

## 1. Remove the STUDY role (code)

- [x] 1.1 Delete `electron/study-session.mjs` and remove its imports/usages from `electron/main.mjs` (`studyBillingStatus`, `startStudyRun` routing, `closeStudySession`/`closeAllStudySessions` call sites)
- [x] 1.2 Shrink `AGENT_ROSTER` to `["po", "dev"]`; drop `study` from `AGENT_LABELS`, `MODEL_DEFAULTS`, `MODEL_ENV_VARS`; remove the `role === "study"` announcement block and every STUDY paragraph/mention in the Gemini system prompt and tool descriptions (`submit_claude_task`, `set_agent_model`)
- [x] 1.3 Revert the voice-question relay to PO-only: remove the `role` parameter from `askUserQuestionViaVoice` and the `asking_role`/role attribution in the `po_question` event and `SYSTEM_EVENT_PO_QUESTION`
- [x] 1.4 Delete `resources/personas/iris-study.md`; make `installIrisAgents` roster-driven off the new roster and delete a stale `~/.claude/agents/iris-study.md` if present
- [x] 1.5 Remove STUDY from the renderer: `src/lib/agents.ts`, `src/components/PipelineBar.tsx`, `src/App.tsx`, `src/vite-env.d.ts` (types), and any STUDY strings in UI copy
- [x] 1.6 Sanitize persisted state on load: active agent `study` falls back to the default role; `agent_sessions.study`/`agent_models.study` keys are ignored without error
- [x] 1.7 `npm run build` passes with no STUDY references left (`grep -ri study electron/ src/` returns only incidental non-role hits)

## 2. Pipeline availability detection (main process)

- [x] 2.1 Add a `probePipelineAvailability()` in `main.mjs` reusing the `claudeBinary()` + `--version` health-check path; run it before Gemini session creation and on every session (re)connect; cache the result as the single availability boolean
- [x] 2.2 Make the Gemini system-prompt builder conditional: pipeline sections (delegation rules, PO control, roles, workspace) included only when available; verify the chat-only prompt reads coherently on its own
- [x] 2.3 Declare Claude function declarations (`check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`, `set_agent_model`) only when available; keep UI-control and other non-Claude tools always declared
- [x] 2.4 Guard the tool-call dispatcher so a stray Claude tool call in chat-only mode returns a clean "pipeline not available" result instead of throwing
- [x] 2.5 Include `pipeline_available` in the boot/session payload the renderer receives and emit a sidecar event when a re-check changes it; expose via `electron/preload.cjs`

## 3. Chat-only UI (renderer)

- [x] 3.1 Hold `pipelineAvailable` state in `App.tsx` from the boot payload/sidecar event; when false, do not render Work Stream, `PipelineBar`, `SessionSwitcher`, `TaskChooser`, `PoQuestionBanner`, or the HUD tasks column
- [x] 3.2 Verify deck and HUD layouts render cleanly with the pipeline surfaces absent (no empty panels, no dead keyboard shortcuts or gesture targets pointing at hidden surfaces)
- [x] 3.3 Pipeline surfaces appear after an availability flip + session reconnect without an app restart

## 4. SetupPanel enablement surface

- [x] 4.1 Add read-only checks to `SetupPanel.tsx` beside the Claude CLI/token rows: `openspec` CLI (via `openspecBinary()` + `--version`) and global skills presence under `~/.claude/skills` (pin the exact directory names from what `iris-po.md`/`iris-dev.md` invoke), each with a copyable install command
- [x] 4.2 Wire the shared re-check action to re-probe binary/openspec/skills and surface the existing reconnect prompt when availability flips while a session is live
- [x] 4.3 Show the pipeline availability state (chat-only vs enabled) with the explanation and install pointer for the chat-only case

## 5. Config and docs

- [x] 5.1 `.env.example`: remove `IRIS_STUDY_MODEL`, the STUDY sections, and every `open-second-brain` mention; reword the token comment to PO-only
- [x] 5.2 Rewrite `README.md` quickstart-first: chat-only setup (Gemini key → talk) up front; "Claude pipeline (PO → DEV)" as an advanced section with enablement conditions and prerequisites; remove all STUDY/second-brain content; keep ASHR12/iris credit, MIT, and the experimental disclaimer; note the BREAKING STUDY removal and its git-revert recovery
- [x] 5.3 Update `CLAUDE.md` to describe the two-role, chat-first architecture (remove STUDY sections, add pipeline-availability mental model)

## 6. Verify and release prep

- [x] 6.1 `npm run build` clean; manual smoke: launch with Claude binary hidden from PATH → pure chat works, no pipeline UI, Gemini never offers delegation. Verified live: launched with `IRIS_CLAUDE_BIN=/nonexistent/claude`, screenshotted asleep and awake (Gemini connected, greeted, "Speaking...") — only Comms + Camera panels rendered, no Work Stream/PipelineBar/session-switcher.
- [x] 6.2 Manual smoke with Claude present: pipeline UI shows, SetupPanel checks report correctly. Verified live: relaunched with the real `claude` binary on PATH — Work Stream, PipelineBar (Iris/PO Fable 5/DEV Sonnet 5 chips), session switcher, and ProjectBar all appeared, matching design. DEV run and PO-without-token error path were not exercised live in this session (would dispatch real Claude work); those code paths are unchanged by this proposal aside from the availability gating already covered by 2.x/4.x.
- [x] 6.3 Draft GitHub Release notes for `v0.2.0` (NEW chat-first onboarding, BREAKING STUDY removal + recovery path); tagging happens at release time, after archive
