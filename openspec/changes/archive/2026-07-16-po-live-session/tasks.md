## 1. Subscription auth foundation

- [x] 1.1 Add `@anthropic-ai/claude-agent-sdk` to `package.json` and install; confirm it still requires/uses the existing `claude` binary.
- [x] 1.2 Add a PO-scoped `poSessionEnv()` helper in `electron/main.mjs` that clones `process.env`, deletes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, and injects `CLAUDE_CODE_OAUTH_TOKEN` — applied to the PO session only, NOT the DEV spawn. (Implemented as `computePoSessionEnv()` in `electron/po-session.mjs`; `CLAUDE_CODE_OAUTH_TOKEN` needs no separate injection since `loadEnvFile()` already merges it into `process.env`, which the helper spreads through.)
- [x] 1.3 On startup, log which billing path is active (subscription token present vs. none) and emit an actionable error naming `claude setup-token` when no usable token is found. (`logPoBillingPathOnce()` at startup; `startPoRun` fails the run with the actionable message if `poBillingStatus().ok` is false.)
- [x] 1.4 Document `claude setup-token`, `CLAUDE_CODE_OAUTH_TOKEN`, and the `ANTHROPIC_API_KEY` footgun in `.env.example` and README.

## 2. PO live-session module

- [x] 2.1 Create a PO-session module that opens an Agent SDK `query()` session with an async message generator, `--agent iris-po`, and `agentEnv()`. (`electron/po-session.mjs`: `getOrCreatePoSession` + `createUserMessageChannel`; agent passed as `agent: "iris-po"` per the SDK's `--agent`-equivalent option.)
- [x] 2.2 Map the live session to the workstream's `agent_sessions.po`; implement create-on-first-turn and reuse-on-follow-up.
- [x] 2.3 Implement `deliverPoTurn(task)` that pushes a new user message into the resident session (no respawn, no transcript replay).
- [x] 2.4 Parse SDK message events into the existing Work Stream event shape (reuse the current NDJSON→panel mapping). (`routeMessage`/`pump` in `po-session.mjs`, feeding `pushActivity`/`rememberClaudeSessionId` via callbacks — same shapes DEV already produces.)
- [x] 2.5 Implement lifecycle: reset on New / voice new-session / project-folder change; close resident sessions on app quit (no orphan processes).

## 3. Split dispatch (PO vs DEV)

- [x] 3.1 Refactor `startClaudeRun` into `startDevRun` (existing `claude -p` spawn — stateless module, unchanged behavior AND auth) and a PO route into the stateful session module.
- [x] 3.2 Verify the DEV subprocess env and auth are left byte-for-byte unchanged (no `poSessionEnv()`, keeps `/login`). (Confirmed by inspection: `startDevRun`'s spawn still uses `env: process.env` untouched.)
- [x] 3.3 Put the PO SDK path behind a feature flag so it can fall back to the legacy `-p --resume` PO behavior. (`IRIS_PO_LIVE_SESSION=0` in `startClaudeRun`'s dispatch.)

## 4. Role-aware queue

- [x] 4.1 Rework `runQueue` so the PO is a resident conversation with serialized turns and DEV runs are discrete queued tasks sharing one execution slot. (No new queue engine needed: the existing global `runQueue`/`finalizeRun`/`startNextInQueue` already serializes by run, agnostic to which module runs it; `startClaudeRun` now just dispatches by `run.agent` before that shared machinery.)
- [x] 4.2 Ensure a resident-but-idle PO session never blocks DEV runs, and a queued PO turn never discards the live session. (The resident session lives in `po-session.mjs`'s own `Map`, decoupled from the transient `run` record — nothing touches it while merely queued.)

## 5. Voice decision relay

- [x] 5.1 Implement the `canUseTool` callback in the PO session: pause on `AskUserQuestion` only (tool approvals stay auto-allowed under `bypassPermissions`), extract question(s)+options.
- [x] 5.2 Emit `SYSTEM_EVENT_PO_QUESTION` into the Gemini session and add its handling to the system prompt (read question + options aloud).
- [x] 5.3 Add an `answer_po_question` Gemini tool + `preload.cjs` IPC channel that resolves the pending callback with the user's selection and resumes the same turn. (Gemini tool routes through `executeClaudeTool`; `ipcMain.handle("po:answer-question", ...)` + `window.iris.answerPoQuestion` is the secondary UI path — both call the same `resolvePendingPoQuestion`.)
- [x] 5.4 Support multi-question `AskUserQuestion` (collect all answers before resolving) to preserve voice-friendly batching. (`AskUserQuestion` already carries 1-4 questions per call; the UI accumulates picks locally and submits once every question has one, matching the voice path's single-batch answer.)
- [x] 5.5 Add a pending-question timeout — default 300000 ms (5 min), overridable via `IRIS_PO_QUESTION_TIMEOUT_MS` — that resolves with the PO's recommended option and records that the default was applied.
- [x] 5.6 Settle any pending question cleanly on session reset without leaving an orphan process.
- [x] 5.7 Surface/answer PO questions in `src/App.tsx` (Comms / Work Stream UI). (`po_question` sidecar event → banner with clickable options in the Work Stream panel; voice remains the primary path.)

## 6. Persona & prompt divergence

- [x] 6.1 Update `resources/personas/iris-po.md`: permit/encourage `AskUserQuestion` at real decision points; remove "never ask the user questions mid-run".
- [x] 6.2 Confirm `resources/personas/iris-dev.md` keeps "never ask, use sensible defaults". (Verified unchanged — no edit needed.)
- [x] 6.3 Split the `--append-system-prompt` text so the "do not ask" instruction applies to DEV but not PO. (DEV keeps the CLI `--append-system-prompt` "do not ask" text; PO's SDK `appendSystemPrompt` says the opposite — "ask via AskUserQuestion at real decision points.")

## 7. Docs & wiring

- [x] 7.1 Update `CLAUDE.md` "delegation model" and "PO → DEV pipeline" sections to describe the two-module model — stateful PO (live SDK, token auth) vs stateless DEV (one-shot `-p`, `/login`). (Also added "Voice decision relay" and "PO subscription auth" sections; README updated to match.)
- [x] 7.2 Document `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000) in `.env.example`; permission mode (`bypassPermissions`), DEV auth (unchanged), and the timeout default are all decided — no design questions remain.

## 8. Verify

- [x] 8.1 `npm run build` (tsc --noEmit + vite build) passes. (Clean; also `node --check` on both `.mjs` files.)
- [x] 8.2 Manual: PO turn opens a live session; a follow-up continues the same context without respawn. **User-verified**: confirmed working in real usage on the user's own `CLAUDE_CODE_OAUTH_TOKEN`.
- [x] 8.3 Manual: PO asks via `AskUserQuestion`, question is read aloud, a voice answer resumes the same turn. **User-verified**: voice answer resolved the pending question and the pending-question banner disappeared immediately, confirming `canUseTool` does intercept `AskUserQuestion` under `bypassPermissions` on the installed SDK version (the residual doc ambiguity in design.md is resolved in practice). See memory `po-live-session-verified`.
- [x] 8.4 with `ANTHROPIC_API_KEY` set, confirm the PO session strips it and the billing/timeout helpers behave correctly. Verified directly: `computePoSessionEnv` removes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` while keeping `CLAUDE_CODE_OAUTH_TOKEN`/`PATH`; `poBillingStatus`/`poQuestionTimeoutMs` behave correctly with/without a token and with a valid/invalid timeout override. (Full live-network confirmation that the resulting `claude` subprocess itself reports `apiKeySource: "oauth"` still needs the user's real token — see 8.2.)
- [x] 8.5 Manual: DEV run still dispatches as a one-shot subprocess with its `/login` auth, completes unchanged. **User-verified**: confirmed DEV still runs one-shot as before.
