## 1. Verify environment facts (do first)

- [x] 1.1 Confirm a `@anthropic-ai/claude-agent-sdk` session started with default `settingSources` + `skills: 'all'` surfaces the user-scope `open-second-brain` plugin's MCP tools (`brain_create_note`, `brain_search`, …). If not automatic, plan to pass them via the SDK `mcpServers` option. — **Resolved:** the SDK loads MCP from all sources (incl. plugins) unless `strictMcpConfig` is set (never set); default `settingSources` covers user scope where `enabledPlugins` lists the plugin. Inherits automatically, mirroring PO's skills. No `mcpServers` wiring.
- [x] 1.2 Confirm `WebSearch`/`WebFetch` are available to the SDK session. — Built-in default tools; available under the session's default toolset.
- [x] 1.3 Record findings in `design.md` (Open Questions) so the implementation path is fixed before coding.

## 2. Roster, labels, and model config (`electron/main.mjs`)

- [x] 2.1 Add `"study"` to `AGENT_ROSTER` and `AGENT_LABELS` (`study: "Study"`).
- [x] 2.2 Add `MODEL_DEFAULTS.study = "claude-sonnet-5"` and `MODEL_ENV_VARS.study = "IRIS_STUDY_MODEL"`.
- [x] 2.3 Verify `resolveAgentModel`, `setAgentModel`, `normalizeWorkstream`, `agentsSnapshot`, and `agent_models` persistence all accept `study` (roster-driven — no change needed); generalized the one PO/DEV-worded error string in `setAgentModel`.
- [x] 2.4 Confirm a legacy workstream with no `agent_models`/`agent_sessions.study` still loads and resolves STUDY's model via env/default (additive; `normalizeWorkstream` already tolerant).

## 3. New isolated module `electron/study-session.mjs`

- [x] 3.1 Create the module mirroring `po-session.mjs`: channel, `pump`/`routeMessage`, `getOrCreateStudySession`, `deliverStudyTurn`, `getStudySessionState`, `setStudySessionModel`, `closeStudySession`, `closeAllStudySessions`, its own `Map`.
- [x] 3.2 Add `computeStudySessionEnv` (scrub `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`) and `studyBillingStatus` (require `CLAUDE_CODE_OAUTH_TOKEN`) — smoke-tested.
- [x] 3.3 Session options: `agent: "iris-study"`, `bypassPermissions`, `skills: "all"`, default `settingSources`, `strictMcpConfig` unset (so plugin MCP inherits), `model`, resume id.
- [x] 3.4 STUDY-specific `appendSystemPrompt` (librarian + fact-checker; may ask; never teaches; write vs verify by intent).
- [x] 3.5 `canUseTool` intercepts `AskUserQuestion` and relays via the `onAskUserQuestion` callback.

## 4. Run dispatch (`electron/main.mjs`)

- [x] 4.1 `startClaudeRun` routes `run.agent === "study"` to `startStudyRun` BEFORE `ensureProjectScaffold` and the DEV gate (skips both).
- [x] 4.2 `startStudyRun` mirrors `startPoRun`: `studyBillingStatus` gate, model resolved at run start, `getOrCreateStudySession`, `setStudySessionModel` on model drift, `deliverStudyTurn` wired to the run's activity/tool/session callbacks, finalize.
- [x] 4.3 Store/resume the Study session id under `agent_sessions.study` (via `resumeSessionId`/`rememberClaudeSessionId`).

## 5. Generalize the question relay (`electron/main.mjs` + `study-session.mjs`)

- [x] 5.1 `askUserQuestionViaVoice(workstreamId, questions, role)` carries the asking role; `PendingQuestion` stores it; the `po_question` event and the `SYSTEM_EVENT_PO_QUESTION` `asking_role:` line carry it. Single global pending question + first-answer-wins/timeout/reset preserved.
- [x] 5.2 Attribution added end-to-end (event `role` field + renderer label). **Deliberate deviation from the literal task:** the identifiers `po_question` / `answer_po_question` / `po:answer-question` were KEPT (not renamed) for renderer/preload/IPC back-compat — the spec contract requires attribution, not a rename, and renaming that surface adds regression risk for no behavioral gain. PO behavior unchanged.
- [ ] 5.3 Live-verify a PO question still surfaces/answers with no regression and a STUDY question surfaces attributed to STUDY. — **Pending manual run** (folded into 9.2); code path is shared and role-parameterized.

## 6. Announcements and lifecycle (`electron/main.mjs`)

- [x] 6.1 `announceAgentSelection` study branch: fresh session invites "open a source, synthesize by voice, then save or verify"; returning session gets a where-were-we.
- [x] 6.2 `closeStudySession` added at every `closePoSession` site (createWorkstream, selectWorkstream, setWorkstreamCwd) and `closeAllStudySessions` on quit.
- [x] 6.3 `PendingQuestion.abandon` already runs on those teardown paths and settles whatever role's question is pending (now role-aware).

## 7. Persona (`resources/personas/iris-study.md`)

- [x] 7.1 Persona authored: librarian + fact-checker; must not teach, must not write code.
- [x] 7.2 Write-note contract: explicit-request-only; search first; title + source + summary + links via open-second-brain conventions; concise confirmation.
- [x] 7.3 Verify contract: source (if given) + WebSearch/WebFetch; supported/uncertain/incorrect; "unverified" when evidence is thin.
- [x] 7.4 States it may pause via `AskUserQuestion`; `installIrisAgents` installs it (roster-driven) and `study` is not in `RETIRED_AGENTS`.

## 8. Docs

- [x] 8.1 `.env.example`: `IRIS_STUDY_MODEL` default + `open-second-brain` plugin + `CLAUDE_CODE_OAUTH_TOKEN` dependency for STUDY.
- [x] 8.2 `CLAUDE.md`: STUDY role section — selectable mode, isolated SDK module, division of labor, write/verify contracts, OpenSpec exemption, MCP inheritance, subscription auth, relay reuse.
- [x] 8.3 `README`: STUDY added to the roles/config surface.

## 9. Verify end-to-end

- [x] 9.1 `npm run build` (tsc --noEmit + vite) passes; `node --check` passes for `main.mjs` and `study-session.mjs`; study-session pure functions smoke-tested.
- [ ] 9.2 **Pending manual run** (requires the live voice app + a real source + the vault): select Study; dispatch a write-note task and confirm a linked note appears in the vault with source + summary; dispatch a verify task with a source URL and confirm a supported/uncertain/incorrect report; confirm a STUDY `AskUserQuestion` surfaces and is answerable by voice; confirm no `openspec init` ran in the `cwd`.
- [ ] 9.3 **Pending manual run:** confirm switching workstreams / resetting closes the Study session with no orphaned subprocess.
