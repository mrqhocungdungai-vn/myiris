## Why

Iris today has only two Claude worker roles — PO and DEV — both aimed at building software. But the everyday use the user actually wants is **learning**: open a source, read it, synthesize it aloud, and have the synthesis captured into their already-configured `open-second-brain` vault — and, on demand, fact-checked. Gemini voice can capture and orchestrate, but it has no worker whose job is to be the second-brain **librarian and fact-checker**. This adds that third role so a study sitting has a persistent, note-owning worker without bending the PO/DEV build pipeline to a purpose it was never designed for.

## What Changes

- Add a third pipeline role **`study`** (label "Study"), installed as `~/.claude/agents/iris-study.md`, selectable per workstream exactly like PO/DEV. Plain chat (`active_agent = null`) is unchanged.
- In Study mode the **division of labor** is explicit: Gemini stays the primary voice — it captures the user's spoken synthesis, acts as note-taking assistant, and dispatches tasks to Claude. The STUDY worker is the second-brain **librarian + fact-checker only** — it does not teach or answer study questions itself.
- STUDY runs as a **stateful Agent SDK session** in a **new, isolated module** `electron/study-session.mjs` (mirroring PO's mechanism but kept separate per the CLAUDE.md "keep them separate" mandate). Because two SDK roles can now hold a live session in one workstream, resident sessions are keyed by **workstream + role**.
- STUDY handles **two on-demand, separate task types**, distinguished purely by the dispatched task text (no new Gemini tools — `submit_claude_task` routes by the active role):
  - **Write note** (only when the user explicitly asks): synthesize the dictation into a note in `open-second-brain` following the plugin's own conventions (search first to avoid duplicates and to link; title + source citation + summary + links).
  - **Verify / fact-check**: check a note's claims against the original source (if a URL/text is provided) plus web search, and report uncertain or incorrect points.
- STUDY is **model-selectable** like PO/DEV, defaulting to `claude-sonnet-5` (`IRIS_STUDY_MODEL`, `agent_models.study`).
- STUDY may **pause mid-turn to ask by voice** (`AskUserQuestion`) like PO. The existing PO-only question relay is **generalized to be role-agnostic** so Iris knows whether PO or STUDY is asking.
- STUDY **authenticates via the subscription token** (`CLAUDE_CODE_OAUTH_TOKEN`) and scrubs `ANTHROPIC_API_KEY`, like PO.
- STUDY **skips OpenSpec entirely** — no `openspec init` scaffold and no change-gate. It uses the workstream `cwd` to read the material being studied, but notes always go to the second-brain vault (independent of `cwd`).
- Entering Study mode is **announced** to Gemini (like PO/DEV role selection), inviting the user to open a source, synthesize by voice, then ask to note or verify.

## Capabilities

### New Capabilities
- `study-note-role`: The Study worker role — a stateful, isolated Agent SDK session that acts as the second-brain librarian and fact-checker, its selectable-mode behavior, its write-note and verify task contracts, its OpenSpec exemption, and its session lifecycle.

### Modified Capabilities
- `global-agent-runtime`: the installed-agents roster and per-role session/model runtime now include a third role, `study`.
- `per-role-model-selection`: `study` becomes a third model-selectable role with its own default (`claude-sonnet-5`) and env override (`IRIS_STUDY_MODEL`).
- `voice-decision-relay`: the mid-turn `AskUserQuestion` relay generalizes from PO-only to any live SDK role (PO or STUDY), carrying which role is asking.
- `agent-subscription-auth`: the subscription-token auth and `ANTHROPIC_API_KEY` scrub now cover the STUDY SDK session as well as PO.
- `session-announcements`: the role-selection announcement covers the `study` role, with study-specific opening guidance.

## Impact

- **New file**: `electron/study-session.mjs` (isolated stateful module: session lifecycle, streaming channel, `canUseTool` relay, `computeStudySessionEnv`, `studyBillingStatus`).
- **`electron/main.mjs`**: `AGENT_ROSTER`/`AGENT_LABELS`, `MODEL_DEFAULTS`/`MODEL_ENV_VARS`, `startClaudeRun` (study branch: skip scaffold+gate, call `startStudyRun`), new `startStudyRun`, generalized question relay (`SYSTEM_EVENT_PO_QUESTION`/`answer_po_question`/`pendingPoQuestion` → role-agnostic), `announceAgentSelection` study branch, `closeStudySession`/`closeAllStudySessions` wired everywhere `closePoSession`/`closeAllPoSessions` are.
- **`resources/personas/iris-study.md`**: new persona (librarian + fact-checker; write-note and verify contracts; open-second-brain conventions; may ask via `AskUserQuestion`; never teaches, never free-codes).
- **Dependencies**: relies on the user-scope `open-second-brain` plugin (MCP + skills) and on `WebSearch`/`WebFetch` being available to the SDK session — both to be verified during implementation, wired explicitly if not automatic.
- **Docs**: `CLAUDE.md`, `README`, `.env.example` (`IRIS_STUDY_MODEL`, the new role and its stateful-SDK mechanism, the second-brain dependency).
- **Persisted state**: `~/.iris/claude-sessions.json` gains `agent_sessions.study` and `agent_models.study`; existing workstreams remain valid (additive).
