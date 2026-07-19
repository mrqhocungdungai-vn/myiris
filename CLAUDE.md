# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Iris is

A desktop voice companion (Electron + React + Vite + TypeScript). **Gemini Live** handles realtime voice conversation; when a request needs real work, Gemini delegates it to Claude as a background worker. The worker is one of three roles — the **PO → DEV** build pipeline plus a standalone **STUDY** learning role — installed as Claude Code agents, running on **deliberately different, separately-evolving mechanisms** by state model:

- **PO — stateful module.** A persistent `@anthropic-ai/claude-agent-sdk` session (`electron/po-session.mjs`) kept alive across turns: one continuous context window, no respawn/replay per turn. It can pause mid-turn via `AskUserQuestion` and get a voice answer back before continuing (see "Voice decision relay" below).
- **DEV — stateless module.** Unchanged one-shot `claude -p --resume` subprocess per issue, exactly as before this module split — fire-and-forget, never asks.
- **STUDY — stateful module.** A persistent Agent SDK session in its **own isolated module** (`electron/study-session.mjs`), mechanically like PO but kept separate. It is the second-brain **librarian + fact-checker** for a learning sitting: on explicit request it records the user's synthesized note into the enabled **`open-second-brain`** plugin's vault, or fact-checks a note's claims against the source + web. It may pause mid-turn via `AskUserQuestion` like PO. It is **not** part of the PO → DEV pipeline and skips OpenSpec entirely. See "The STUDY role" below and `openspec/changes/study-note-role/`.

This is an intentional architectural boundary (not a shared code path with a role flag): each module is expected to grow independent capabilities later, so keep them separate when extending any of them. PO and STUDY are both stateful SDK sessions but live in separate modules for exactly this reason.

## Commands

```bash
npm ci           # install deps
npm run dev            # Vite + Electron with hot reload (dev)
npm run build          # tsc --noEmit + vite build (typecheck + build to dist/)
npm start              # build then launch Electron from dist/ (production-like)
npm run start:prod     # launch prod build without rebuilding
npm run package:mac    # build + electron-builder --mac --dir (unpacked .app)
npm run dist:mac       # build + full macOS distributable
npm run package:win    # build + unpacked Windows dir
```

There is **no test runner and no linter** configured. `npm run build` (which runs `tsc --noEmit`) is the only automated check — run it to verify changes typecheck.

## Runtime prerequisites

- `GEMINI_API_KEY` in `.env` (copy from `.env.example`). Read from repo `.env` in dev, or `~/.iris/.env` (`%USERPROFILE%\.iris\.env` on Windows) for the packaged app.
- Claude Code CLI installed and authenticated (`claude --version` must work). A packaged GUI app may not inherit shell PATH — `main.mjs` probes `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, or set `IRIS_CLAUDE_BIN`.

## Architecture

Two-process Electron app. The Gemini↔Claude bridge is the heart of the system and lives almost entirely in `electron/main.mjs` (~1500 lines).

- **`electron/main.mjs`** — owns the Gemini Live session (`@google/genai`), declares Gemini's tools, spawns/streams headless Claude runs, manages sessions/roles, and does all audio IPC. The bulk of behavior is here. It also owns the Glass HUD window-shape morph (`enterHud`/`exitHud`/`toggleHud`, one `BrowserWindow` that swaps between a normal deck window and a transparent click-through fullscreen overlay), the Tray (`createTray`/`updateTrayMenu`), and the `IRIS_HUD_HOTKEY` global shortcut (`Alt+Space` default) — see "Glass HUD mode" below.
- **`electron/po-session.mjs`** — the stateful PO module: Agent SDK session lifecycle (create-on-first-turn, resume-on-follow-up, close-on-reset/quit), the streaming user-message channel, and the `canUseTool` callback that intercepts `AskUserQuestion`. Deliberately isolated so DEV's one-shot path in `main.mjs` never has to know it exists.
- **`electron/preload.cjs`** — the `window.iris` IPC bridge (audio chunks, sidecar events, session/agent controls, PO question answers, `hud:toggle`/`hud:interactive`/`hud:mode`/`iris:wake`/`win:control` for the Glass HUD). Any new renderer↔main channel must be exposed here.
- **`src/App.tsx`** (~1350 lines) — the renderer: mic capture (WebRTC AEC → 16 kHz PCM), Gemini audio playback (`AudioContext`, 24 kHz PCM), the "Orbital Deck" UI (Comms / Work Stream panels), keyboard shortcuts, gesture-driven interactions, and the `uiMode` (`deck` | `hud`) switch that renders `HudShell` in place of the deck.
- **`src/components/HudShell.tsx`** + **`src/styles/hud.css`** — the Glass HUD overlay: orb cluster, collapsible tasks column, comms, camera dock, and the PO question banner, all as pointer-transparent-except-`.hud-hit` islands (App.tsx reports pointer-over-island via `hud:interactive`; main toggles `setIgnoreMouseEvents` accordingly).
- **`src/useHandControl.ts`** — MediaPipe `GestureRecognizer` hook (on-device webcam gesture control, starts only after wake).
- **`src/ReactorCore.tsx`, `src/BootSequence.tsx`, `src/deck.css`, `src/App.css`** — UI/animation.
- **`scripts/run-electron.mjs`** — cross-platform launcher; clears `ELECTRON_RUN_AS_NODE`, supports `--prod`.

### The delegation model (key mental model)

1. Gemini decides routing: quick facts → built-in Google Search; real work → Claude tools. Gemini's tools: `check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`.
2. `submit_claude_task` dispatches by role. **DEV** (and plain Claude) spawn `claude -p "<task>" --output-format stream-json --verbose --permission-mode bypassPermissions --append-system-prompt "…"` and **return a `run_id` immediately** — Gemini 3.1 Live function calls are synchronous, so a tool call must never block on long work. **PO** delivers the task as a new turn into its resident Agent SDK session (`getOrCreatePoSession`/`deliverPoTurn` in `po-session.mjs`), created on the first PO turn in a workstream.
3. Both paths report progress through the same shape: DEV's NDJSON stream is parsed line-by-line; PO's SDK messages are routed the same way internally. Each tool call/note is pushed to the Work Stream panel in realtime. On completion (process exit for DEV, turn `result` message for PO) the final result is shown.
4. On completion, main injects `SYSTEM_EVENT_CLAUDE_COMPLETE` into the Gemini session so it proactively announces the result. Other internal events follow the same `SYSTEM_EVENT_*` convention (`SESSION_START`, `WORKSPACE_UPDATE`, `AGENT_SELECT`, `PO_QUESTION`).
5. `runQueue` still enforces "Claude does one thing at a time" globally — a PO turn and a DEV run share the same execution slot and queue behind each other exactly like two DEV runs would, via the same `finalizeRun`/`startNextInQueue`. The PO's resident session itself is a separate, independent piece of state (in `po-session.mjs`) that is never touched while a turn is merely queued — only `startPoRun` reads/delivers into it.

### Voice decision relay (PO only)

- PO may call `AskUserQuestion` mid-turn (its persona and `appendSystemPrompt` say so explicitly — the opposite of DEV's "never ask"). The SDK's `canUseTool` callback in `po-session.mjs` intercepts it and awaits an answer from `askUserQuestionViaVoice` in `main.mjs`.
- `askUserQuestionViaVoice` emits `SYSTEM_EVENT_PO_QUESTION` (and a `po_question` sidecar event for the UI) and registers a single global `pendingPoQuestion` — at most one can ever be in flight, since `runQueue` allows only one PO turn/DEV run system-wide at a time.
- Two paths can answer it: the Gemini tool `answer_po_question` (primary, voice) or `window.iris.answerPoQuestion` (secondary, UI click) via `ipcMain.handle("po:answer-question", ...)`. Whichever resolves first wins; `resolvePendingPoQuestion` is a no-op once already settled.
- Unanswered after `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000ms/5min): resolves with the first-listed ("recommended") option per question. Session reset (see below) settles any pending question the same way before tearing down.
- PO's tool-use permission mode stays `bypassPermissions` — only `AskUserQuestion` pauses; every other tool call auto-allows exactly as before. See design.md's "Verified against the installed SDK" note for the residual doc ambiguity this relies on.

### Sessions, workstreams, and context ownership

- Context is **user-controlled**. Each "workstream" (session) has a project folder (`cwd`) and an active pipeline role. **DEV** tasks **`--resume`** the stored Claude session for that role; **PO** tasks deliver into the resident SDK session, which itself was opened with `resume: <stored id>` if one existed. Either way follow-ups build on prior work. Tasks run **one at a time** (queued if Claude is busy) — see `runQueue` above.
- Sessions never reset on their own — only on explicit user action (New button, voice "new session", or picking a different project folder; Claude scopes conversations per directory). Persisted to `~/.iris/claude-sessions.json`. Each of these actions also closes any resident PO session bound to the workstream/cwd being left (`closePoSession`) so no subprocess is orphaned.
- Sessions are stored **per agent role**: PO and DEV each own their own continuous conversation within a workstream. The **only** context that crosses the PO → DEV gate is the **OpenSpec change** the PO writes to disk (`openspec/changes/<name>/`) — never a shared conversation.
- Default Claude working dir is `~/.iris/workspace` (override `IRIS_CLAUDE_CWD`).
- Rollback: `IRIS_PO_LIVE_SESSION=0` reverts PO to the pre-SDK one-shot behavior (identical to DEV's mechanism) with no data migration — both paths share the same `agent_sessions.po` id.

### The PO → DEV agent pipeline

- Role personas live in `resources/personas/iris-po.md` and `iris-dev.md`. On demand they are **installed to `~/.claude/agents/iris-<role>.md`** (`installIrisAgents`) and run via `claude --agent iris-<role>` (DEV, CLI flag) or `agent: "iris-po"` (PO, SDK option) — same underlying persona file either way. `AGENT_PREFIX = "iris-"`, `AGENT_LABELS = { po: "PO", dev: "DEV" }`.
- **The pipeline runs on OpenSpec — it is the single SDD surface (no `.scratch/` PRD).** Iris's PO is the **voice controller**: the Gemini voice layer sends the Claude-side PO short **control intents** (start-and-grill / propose / "are there tasks left?" / archive), never a hand-written PRD. **PO** grills the request first (the `grilling` skill; questions surface via `AskUserQuestion` voice relay), then runs the OpenSpec propose flow to create `openspec/changes/<name>/` with a `tasks.md`. **DEV** runs headless and implements the **remaining unchecked tasks of an open change** (`openspec-apply-change` + `tdd`/`verify`/`code-review`), then archives it to sync `openspec/specs/`. DEV never asks — it records "Decisions needed" that Iris reads aloud at run end. Global skills (OpenSpec + mattpocock) in `~/.claude/skills` are a **prerequisite**; the PO SDK session enables them with `skills: 'all'` (see `po-session.mjs`), so both roles work on any `cwd`.
- **DEV is gated on the spec.** `startClaudeRun` refuses a DEV run when `openChangesWithTasks(cwd)` is empty (no open change with unchecked `- [ ]` tasks) — DEV never free-codes without a proposed change.
- The first role run in a fresh project makes it OpenSpec-ready via `ensureProjectScaffold` → `openspec init <cwd> --tools claude` (non-interactive; no-op if `openspec/` already exists). The `openspec` CLI is resolved by `openspecBinary()` (probes `~/.local/bin` etc.; override `IRIS_OPENSPEC_BIN`). If editing the pipeline, keep the persona files and this scaffold/gate logic in sync.
- **Per-role model choice.** Each workstream stores an `agent_models: { po?, dev? }` map beside `agent_sessions`. Resolution order: workstream choice → `IRIS_PO_MODEL`/`IRIS_DEV_MODEL` env → hardcoded default (PO=`claude-fable-5`, DEV=`claude-sonnet-5`); plain Claude never gets a model choice. Model is resolved at **run start**, not submit time, so a change made while a task is queued still applies. DEV gets it via `--model` on the spawn; PO gets it via SDK `options.model` at session creation and `query.setModel()` on an already-live session (context preserved, no resume/respawn). No automatic fallback — an unavailable model fails the run loudly like any other error. Set from the UI (chip's model segment, separate click zone from the role-select label) or by voice (`set_agent_model` tool) — both funnel through the same `setAgentModel()` in `main.mjs`. See `openspec/changes/per-role-model-selection/`.

### PO subscription auth (stateful module only)

- The Agent SDK does **not** inherit the interactive `claude` `/login` session. The PO session authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (generate once with `claude setup-token`) so usage bills against the subscription, not the metered API.
- `computePoSessionEnv` (in `po-session.mjs`) strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the PO session's environment unconditionally — `ANTHROPIC_API_KEY` outranks the OAuth token in the SDK's own auth precedence, so a stray key left in `.env` would otherwise silently switch PO usage to per-token API billing. This scrubbing is **PO-scoped only**; DEV's subprocess env (`process.env`, unchanged) is never touched.
- `logPoBillingPathOnce()` logs which path is active at startup; `poBillingStatus()` gates `startPoRun` with an actionable error if no token is configured.
- **STUDY uses the same subscription-token path** via its own `computeStudySessionEnv`/`studyBillingStatus` in `study-session.mjs` (scoped identically, DEV untouched). `startStudyRun` gates on the token the same way. No `logStudyBillingPathOnce` is needed — the PO startup log already tells the user whether the token is present.

### The STUDY role (learning, not building)

- **A third selectable role**, parallel to PO/DEV in `AGENT_ROSTER`/`AGENT_LABELS` (`study` → "Study"), with its own per-role session (`agent_sessions.study`) and model (`agent_models.study`, default `claude-sonnet-5`, env `IRIS_STUDY_MODEL`). Persona: `resources/personas/iris-study.md`, installed to `~/.claude/agents/iris-study.md` by the roster-driven `installIrisAgents`.
- **Division of labor.** In Study mode the **Gemini voice** is the study assistant — it answers questions and captures the user's spoken synthesis. The **STUDY worker** is only the second-brain librarian + fact-checker; it never teaches and never writes code. Two on-demand task kinds, distinguished by the dispatched task text (no new Gemini tools — `submit_claude_task` routes by the active role): **write a note** (only on explicit user request; search the vault first, then create a linked, sourced note via `open-second-brain` conventions) and **verify** (check a note's claims against the provided source + `WebSearch`/`WebFetch`).
- **Mechanism.** Stateful Agent SDK session in the **isolated** `electron/study-session.mjs` (its own `sessions` Map, so a PO and a STUDY session can be resident in one workstream without colliding). `startClaudeRun` routes `run.agent === "study"` to `startStudyRun` **before** `ensureProjectScaffold`/the DEV gate, so STUDY never runs `openspec init` and is never gated on an open change. It runs in the workstream `cwd` (to read study material) but note writes target the `open-second-brain` vault, resolved by the plugin independent of `cwd`.
- **MCP inheritance.** The STUDY SDK session leaves `settingSources` at default and never sets `strictMcpConfig`, so it inherits the user-scope `open-second-brain` plugin's MCP tools (`brain_create_note`, `brain_search`, …) the same way PO inherits its skills; `WebSearch`/`WebFetch` are built-in. No explicit `mcpServers` wiring.
- **Asking mid-turn.** STUDY reuses the single global voice-question relay (`askUserQuestionViaVoice`, `PendingQuestion`, `answer_po_question`). The relay is role-agnostic: `askUserQuestionViaVoice(workstreamId, questions, role)` carries `role` (`po`/`study`) into the `po_question` event and the `SYSTEM_EVENT_PO_QUESTION` `asking_role:` line. Only one run executes globally at a time, so PO and STUDY questions can never be pending simultaneously. `closeStudySession`/`closeAllStudySessions` are called wherever `closePoSession`/`closeAllPoSessions` are (workstream switch/select, `cwd` change, quit).

## Pinned external identifiers — do not drift

These are load-bearing; a wrong value silently breaks voice or gestures (see README "Known footguns" for full rationale):

- Gemini Live model: **`models/gemini-3.1-flash-live-preview`** (Live models are a distinct family; keep the `models/` prefix). Voice: `Zephyr`. Both overridable via `GEMINI_LIVE_MODEL` / `GEMINI_LIVE_VOICE`.
- Audio is asymmetric: **send 16 kHz PCM, receive 24 kHz PCM**.
- Use `sendRealtimeInput` (not the deprecated `media_chunks` path).
- MediaPipe: `@mediapipe/tasks-vision` version and the `WASM_URL` version in `src/hooks/useHandControl.ts` must stay **equal** (both `0.10.35` today). WASM + model are fetched from CDN on first load (needs network on first run).

## Living spec (OpenSpec)

- **`openspec/specs/` is the living spec** — the source of truth for system behavior, one capability per folder (e.g. `voice-decision-relay`, `two-hand-gestures`, `per-role-model-selection`). Before changing behavior, read the relevant capability spec; after your change lands, the spec must still be true.
- Behavior changes flow through OpenSpec: propose under `openspec/changes/<name>/` (proposal / design / specs / tasks), implement (`/opsx:apply`), then archive — archiving syncs the change's delta specs into `openspec/specs/`. `openspec/changes/archive/` is history; the living spec is the merged truth.
- If code and a living spec disagree, reconcile through a change (or an explicit spec sync) — never silently edit either side.

## Conventions

- Config is env-driven with `IRIS_*` / `GEMINI_*` prefixes and sensible fallbacks; add new options the same way and document them in `.env.example`. PO-specific: `CLAUDE_CODE_OAUTH_TOKEN` (auth), `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000), `IRIS_PO_LIVE_SESSION` (rollback switch).
- `bypassPermissions` is the intentional default for the headless worker (no interactive approval exists in headless mode). `IRIS_CLAUDE_PERMISSION_MODE=acceptEdits|plan` restricts it. PO keeps `bypassPermissions` too (hardcoded in `po-session.mjs`, not `IRIS_CLAUDE_PERMISSION_MODE`-driven) — only `AskUserQuestion` pauses it.
- Never commit real keys; `.env` is gitignored. This now also covers `CLAUDE_CODE_OAUTH_TOKEN` — never set `ANTHROPIC_API_KEY` unless you intend PO to bill per-token (it would override the subscription token if it ever reached the PO session, though `computePoSessionEnv` strips it regardless).
- `@anthropic-ai/claude-agent-sdk` is a real npm dependency (drives the same `claude` binary DEV spawns directly) — keep its version pinned like the other exact-identifier dependencies in README's "Exact Google Models, SDKs & Assets" table equivalent for Claude-side pieces.
