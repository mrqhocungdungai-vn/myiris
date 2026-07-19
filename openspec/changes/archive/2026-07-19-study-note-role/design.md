## Context

Iris delegates "real work" from Gemini voice to Claude worker roles. Two roles exist: **PO** (stateful `@anthropic-ai/claude-agent-sdk` session, `electron/po-session.mjs`) and **DEV** (stateless `claude -p` subprocess). Roles are registered in `AGENT_ROSTER`/`AGENT_LABELS`, carry per-role stored Claude sessions (`agent_sessions`) and per-role model choices (`agent_models`), and their personas install to `~/.claude/agents/iris-<role>.md`. The user has `open-second-brain` enabled as a **user-scope Claude Code plugin** (`enabledPlugins` in `~/.claude/settings.json`), which exposes MCP tools (`brain_create_note`, `brain_search`, …) and skills.

The desired everyday workflow is **learning, not building**: the user opens a source, reads it, synthesizes it aloud; Gemini captures the synthesis and orchestrates; a Claude worker persists the note into the second brain and, separately, fact-checks it. Neither PO (product grilling → OpenSpec propose) nor DEV (implement an open change) fits this; forcing it through them would drag in the OpenSpec pipeline and a build-oriented persona. Hence a third role.

## Goals / Non-Goals

**Goals:**
- A third selectable role `study` that behaves consistently with PO/DEV where it should (roster, model selection, per-role session, install, announcement, subscription auth) while being purpose-built as a second-brain librarian + fact-checker.
- Reuse Gemini as the primary voice/orchestrator with **no new Gemini tool surface** — `submit_claude_task` already routes by active role.
- Keep the stateful-SDK mechanism isolated from PO's module, per the standing architectural mandate.

**Non-Goals:**
- STUDY does not teach, explain, or answer study questions — Gemini does that.
- No auto-note-on-every-turn; no bundled write+verify; no free-coding.
- STUDY does not participate in the PO → DEV spec pipeline and is exempt from OpenSpec scaffold/gating.
- No stateless rollback path for STUDY (it is new; there is no pre-SDK behavior to fall back to).

## Decisions

### D1 — STUDY is a third selectable role, not a repurposed default and not an ad-hoc worker
**Chosen:** register `study` in `AGENT_ROSTER`; the user switches `active_agent = "study"` to enter Study mode, exactly like PO/DEV. Plain chat (`null`) is untouched.
**Alternatives considered:** (a) repurpose the `null` default into a study assistant — rejected: it would change the meaning of ordinary voice chat and entangle the stateless null path with an SDK session; (b) on-demand only (invoked via `submit_claude_task`'s `agent` param without ever being the active role) — rejected by the user in favor of an explicit mode with its own session/model surface.

### D2 — Division of labor: Gemini teaches/orchestrates, STUDY is librarian + fact-checker
The user reads and synthesizes; Gemini captures the synthesis (voice input), acts as note-taking assistant, writes the prompt, and dispatches. The STUDY worker's whole job is second-brain operations. This keeps realtime conversation on the fast voice path and reserves the (slower, queued) Claude worker for the two concrete operations that need it.

### D3 — Separate module `electron/study-session.mjs`, not a generalization of `po-session.mjs`
STUDY is mechanically identical to PO (persistent `query()`, streaming user-message channel, `canUseTool`). Even so, per CLAUDE.md's "deliberately different, separately-evolving mechanisms … keep them separate," STUDY gets its own module rather than a shared `live-session.mjs` with a role flag. The two are expected to grow independent capabilities.
**Consequence:** `po-session.mjs` keys its resident-session `Map` by `workstream.id` alone — correct when PO was the only SDK role. With two SDK roles able to be resident in one workstream, each module keys by `workstream.id` within its own `Map`; the modules never share a map, so no cross-role key collision exists. (If a future refactor merges them, the key must become `workstream.id + role`.)

### D4 — Two on-demand task types distinguished by task text, no new Gemini tools
`submit_claude_task` already dispatches by active role, and the write-vs-verify distinction lives entirely in the task string Gemini composes ("Ghi note: …" vs "Xác minh note: …"). The STUDY persona interprets the intent. Adding dedicated `write_study_note`/`verify_study_note` Gemini tools was considered and rejected as unnecessary surface.
- **Write note** fires only on explicit user request. It follows `open-second-brain` conventions: search the vault first (dedupe + link), then create a structured note (title + source citation + summary + links to related notes) via the plugin's skill/tools. The plugin owns structure/MOC/schema.
- **Verify** checks the note's claims against the **original source when Gemini passes a URL/text**, plus `WebSearch`/`WebFetch`, and reports uncertain/incorrect points. No web sources found ≠ verified; the report says so.

### D5 — Model-selectable, default `claude-sonnet-5`
Add `study` to `MODEL_DEFAULTS` (`claude-sonnet-5`), `MODEL_ENV_VARS` (`IRIS_STUDY_MODEL`), and allow `agent_models.study` through the existing `setAgentModel` choke point (UI chip + `set_agent_model` voice tool). Resolution order is unchanged (workstream choice → env → default), resolved at run start.

### D6 — Reuse and generalize the single global question relay
STUDY may pause mid-turn via `AskUserQuestion` like PO. Because `runQueue` allows only one run globally at a time, at most one question is ever in flight, so the existing single global `pendingPoQuestion` + `answer_po_question` tool can be reused unchanged in mechanism. The PO-specific **naming** is generalized (the surfaced event and the answer path carry which role is asking) so Iris can attribute the question correctly. PO behavior is preserved.

### D7 — Subscription auth, PO-scoped scrub duplicated for STUDY
The SDK session must bill against the subscription, so STUDY needs `CLAUDE_CODE_OAUTH_TOKEN` and must strip `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from its environment. Per the separate-module decision, `study-session.mjs` gets its own `computeStudySessionEnv` and `studyBillingStatus`, and `startStudyRun` gates on the token exactly as `startPoRun` does. The scrub stays STUDY-scoped; DEV's `process.env` is untouched.

### D8 — STUDY skips OpenSpec; uses workstream `cwd`; writes to the vault
`startClaudeRun` currently runs `ensureProjectScaffold` for any role and gates DEV on open changes. A `study` branch skips both — STUDY is not a software-building role. It still runs in the workstream `cwd` so it can read the material being studied, but note writes target the second-brain vault, which the plugin resolves independently of `cwd`.

### D9 — Lifecycle mirrors PO
`agent_sessions.study` is stored and resumed. `closeStudySession`/`closeAllStudySessions` are added and invoked at every point `closePoSession`/`closeAllPoSessions` are today: workstream switch, select, `cwd` change, app quit, and session reset — so a Study session is never orphaned.

## Risks / Trade-offs

- **[SDK session may not inherit the plugin's MCP servers / web tools]** → Verify during implementation that `settingSources` default surfaces the `open-second-brain` MCP tools and that `WebSearch`/`WebFetch` are available. If not automatic, wire them explicitly via the SDK `mcpServers` option and allowed-tools. A failed inheritance would make note-write or verify silently tool-less.
- **[Code duplication between `po-session.mjs` and `study-session.mjs`]** → Accepted deliberately (D3). The isolation is the point; a future extraction remains possible if the two converge.
- **[Relay generalization could regress PO]** → Keep the mechanism identical (single global pending question); change only naming/attribution, and re-verify a PO question still surfaces and can be answered by voice.
- **[Missing subscription token]** → `startStudyRun` fails loudly with an actionable message (run `claude setup-token`, set `CLAUDE_CODE_OAUTH_TOKEN`), exactly like PO; DEV is unaffected.
- **[Verify with no source and thin web coverage]** → STUDY must report "unverified / insufficient sources" rather than asserting correctness, to avoid a false sense of fact-check.

## Migration Plan

Additive and backward-compatible. Existing workstreams gain `agent_sessions.study`/`agent_models.study` lazily on first use; those without the fields remain valid (mirrors the `per-role-model-selection` migration). No data migration. No rollback switch is provided because there is no prior STUDY behavior; disabling the role means simply not selecting it.

## Open Questions

- **Resolved (implementation):** the SDK loads MCP servers from **all sources including plugins** unless `strictMcpConfig` is set (the app never sets it), and `settingSources` default covers user scope (`~/.claude/settings.json`, where `enabledPlugins` lists `open-second-brain`). This is exactly how PO already inherits its user-scope skills. Therefore STUDY, mirroring PO (default `settingSources`, `skills: 'all'`, `strictMcpConfig` unset), inherits the `open-second-brain` plugin's MCP tools with **no explicit `mcpServers` wiring**. `WebSearch`/`WebFetch` are built-in default tools. Runtime confirmation is folded into the manual verify step (task 9.2).
