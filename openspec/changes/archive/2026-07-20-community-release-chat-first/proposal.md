# Community Release: Chat-First Iris

## Why

Iris is being published for the community, but today a first-time user must install the Claude CLI, generate a subscription OAuth token, enable the `open-second-brain` plugin, and read through a three-role architecture before they can even talk to the app. The STUDY role in particular drags in a personal-knowledge-base dependency most people don't have. For a community release, the out-of-the-box experience should be: paste a Gemini API key, talk. The PO → DEV build pipeline stays — but as a self-revealing opt-in for people who have Claude set up, not a prerequisite.

## What Changes

- **BREAKING: Remove the STUDY role entirely** — `electron/study-session.mjs`, the `iris-study` persona, the `study` roster entry, its Gemini system-prompt blocks and tool-description mentions, its UI presence, `IRIS_STUDY_MODEL`, and every `open-second-brain` reference in code and docs. History stays recoverable via `openspec/changes/archive/` and git.
- **Chat-first default**: with only `GEMINI_API_KEY` configured, Iris runs as a pure voice-chat companion. No Claude tools are declared to Gemini (so it never offers to delegate), the Gemini system prompt omits the pipeline, and all pipeline UI (Work Stream panel, PipelineBar, workstream switcher, HUD tasks column) is hidden.
- **Auto-detected pipeline opt-in**: presence of the `claude` binary (same resolution as today: PATH probe + `IRIS_CLAUDE_BIN`) is the master switch that enables the PO → DEV pipeline — tools declared, UI shown. `CLAUDE_CODE_OAUTH_TOKEN` continues to gate only PO (existing `poBillingStatus` behavior); DEV works with binary alone.
- **SetupPanel becomes the enablement surface**: alongside the existing Claude CLI and token checks it reports the `openspec` CLI and required global skills (OpenSpec + mattpocock) as present/missing with copyable install commands and a re-check action. Iris never installs into `~/.claude` on its own.
- **README rewritten quickstart-first**: chat-only setup (Gemini key → talk) up front; "Claude pipeline (PO → DEV)" as a separate advanced section with its enablement conditions. Fork credit (ASHR12/iris), MIT license, and the experimental-build disclaimer are kept.
- **Release as source + tag** (e.g. `v0.2.0`) with GitHub Release notes; no packaged binaries this round.

## Capabilities

### New Capabilities

- `pipeline-availability`: runtime detection of the Claude CLI as the pipeline master switch; chat-only mode (no Claude tools declared, chat-only Gemini prompt, pipeline UI hidden) when absent; full PO → DEV surface when present; SetupPanel prerequisite reporting (openspec CLI, global skills) with install guidance and re-check.

### Modified Capabilities

- `study-note-role`: **removed entirely** — the capability ceases to exist.
- `voice-decision-relay`: relay returns to PO-only; the `role` attribution (`po`/`study`) and STUDY scenarios are dropped.
- `agent-subscription-auth`: STUDY session env/billing requirements (`computeStudySessionEnv`, `studyBillingStatus`) removed; token requirement applies to PO only.
- `global-agent-runtime`: roster shrinks to PO/DEV; STUDY persona installation and study-session lifecycle requirements removed.
- `per-role-model-selection`: `study` model slot, default, and `IRIS_STUDY_MODEL` env removed.
- `session-announcements`: STUDY-mode announcement/greeting requirements removed.
- `setup-panel`: adds prerequisite checks (openspec CLI, global skills) with install guidance and re-check, and reflects pipeline availability state.

## Impact

- **Code**: `electron/main.mjs` (roster, dispatch, Gemini tool declarations and system prompt, detection gating), `electron/study-session.mjs` (deleted), `electron/preload.cjs` (pipeline-availability signal to renderer if needed), `src/App.tsx`, `src/components/PipelineBar.tsx`, `src/lib/agents.ts`, `src/vite-env.d.ts`, SetupPanel component, `resources/personas/iris-study.md` (deleted).
- **Docs/config**: `README.md` (restructured), `.env.example` (STUDY/second-brain sections removed), `CLAUDE.md` (architecture description updated to two roles + chat-first).
- **Specs**: `openspec/specs/study-note-role/` removed; six living specs updated per deltas above.
- **Users**: existing users of STUDY lose the feature on upgrade (**BREAKING**); recovery is a git revert. Everyone else sees a simpler app; pipeline users see no behavior change once the binary is detected.
