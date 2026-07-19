## Context

Today both pipeline roles are driven identically from `electron/main.mjs`: `startClaudeRun` spawns `claude -p "<task>" --output-format stream-json --verbose --permission-mode bypassPermissions --agent iris-<role> [--resume <sid>]`, parses the NDJSON stream line-by-line, and finalizes on process exit. Continuity is logical only — each turn is a fresh process that resumes the stored per-role session id and replays the transcript. Because a one-shot run cannot block for input, mid-run questions are impossible; the pipeline instead uses a "Decisions needed" batch that the PO writes at the end of a run, which Iris reads aloud, and which is answered by submitting a **new** run.

This shape fits DEV (one decided issue, run to completion) but fights the PO, whose work is a live conversation. Verified doc facts that constrain the design:

- The sanctioned way to get a persistent session with mid-turn approval/question callbacks is the **`@anthropic-ai/claude-agent-sdk`** (streaming input mode + `canUseTool`), not a raw CLI stdin protocol.
- The SDK does **not** inherit the interactive `/login` subscription. Subscription billing (no metered API) requires a `claude setup-token` OAuth token in `CLAUDE_CODE_OAUTH_TOKEN`.
- Auth precedence: `ANTHROPIC_API_KEY` outranks `CLAUDE_CODE_OAUTH_TOKEN`. A stray API key silently forces API billing.
- ToS: subscription-via-`setup-token` is blessed for the operator's **own** account/automation; offering claude.ai login to third-party end users is not.

## Goals / Non-Goals

**Goals:**
- Establish two separate modules by state model — **stateful** (PO) and **stateless** (DEV) — as an explicit architectural boundary meant to grow independently, not a shared code path with a role flag.
- PO runs as one persistent, resumable live conversation (single context window) the user steers by voice.
- PO can ask a yes/no (or optioned) question mid-turn; a voice answer resumes the *same* turn without respawn.
- PO usage stays on the subscription (no metered API), with a hard guard against accidental API billing.
- DEV's proven one-shot headless path — mechanism AND auth — is preserved untouched.

**Non-Goals:**
- Rewriting DEV to use the SDK, or making DEV interactive.
- A human attaching to a raw terminal/tmux to watch the PO (rejected — see Decisions).
- Multi-user token brokering or reselling subscription access.
- Changing the file-based PO → DEV handoff contract (`.scratch/<slug>/handoff`), which is unchanged.

## Decisions

### D1 — Two modules by state model: stateful PO on the SDK, stateless DEV on `claude -p`
This is the load-bearing decision. PO and DEV become **two separate modules** distinguished by their state model — the stateful PO is a resident `query()` session object in main; the stateless DEV keeps `startClaudeRun`'s subprocess path verbatim. `startClaudeRun` splits into `startDevRun` (existing spawn logic, the stateless module) and a new PO session route (the stateful module). The split is intentional headroom: each form is expected to accrue its own capabilities later (e.g. stateful: interruption, steering, memory; stateless: parallel fan-out, retries, sandboxing), so they must not be entangled behind one code path.
- **Alternative rejected — tmux send-keys + capture-pane:** gives a live REPL but requires scraping a human TUI (ANSI/prompt detection), and the doc the idea came from covers only terminal ergonomics, not programmatic control. Its only unique benefit (human `tmux attach`) is a non-goal.
- **Alternative rejected — keep `-p --resume` for PO:** cannot pause mid-turn; the "Decisions needed" batch is the symptom we are removing.

### D2 — Mid-turn Q&A via `canUseTool` + `AskUserQuestion`; PO stays `bypassPermissions`
The PO persona is instructed to call `AskUserQuestion` at real decision points. The SDK `canUseTool` callback (an `async` function in main) fires with `toolName === "AskUserQuestion"` and `input.questions`, pausing the turn. Main emits a new `SYSTEM_EVENT_PO_QUESTION` into the Gemini session; the existing Gemini tool surface gains a `answer_po_question` tool that resolves the pending callback with the user's selection.
- **Permission mode decided: keep `bypassPermissions`.** Only `AskUserQuestion` pauses; tool-use approvals are auto-allowed exactly as today. The relay stays scoped to real product decisions, and there is no second class of "approve this Bash command by voice" prompt to design.
- The `async` callback may await arbitrarily long — this *is* the "live session waiting for the user" behavior.
- **Batching preserved:** `AskUserQuestion` may carry multiple questions, so voice-friendly "read a short list, collect answers" still works when the PO groups decisions.

### D3 — Subscription auth is PO-scoped; DEV auth untouched
Only the PO (stateful) module authenticates via `CLAUDE_CODE_OAUTH_TOKEN`. Main computes the PO session env as `{ ...process.env }` with `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`) **deleted**, then injects the OAuth token. Missing-token yields an actionable error naming `claude setup-token`.
- **DEV keeps its current `/login`-based auth and env verbatim** (decided). Because DEV and PO are separate modules (D1), there is no benefit to entangling their auth; DEV already works on the subscription via `/login`, and this change deliberately does not touch it.
- **Trade-off accepted:** the app runs two auth paths (PO token, DEV `/login`). That is the cost of the module separation, and is preferred over reworking the proven DEV path.

### D4 — `runQueue` becomes role-aware
Reframe the single global `runQueue` so the PO session is a resident conversation with serialized turns, and DEV runs are discrete queued tasks sharing one execution slot. A PO turn and a DEV run never run simultaneously (one Claude at a time preserved), but the PO *session* persists between turns instead of being represented as a completed run.

### D5 — Session lifecycle keyed to the existing per-role store
The live PO session maps to the workstream's `agent_sessions.po` entry. Reset triggers (New, voice new-session, project-folder change) tear down the live session and clear/replace the stored id, matching today's user-controlled-context rule. On app quit, resident sessions are closed to avoid orphan processes.

## Verified against the installed SDK (v0.3.210)

Read directly from the shipped `sdk.d.ts`/`sdk-tools.d.ts` (not just doc pages), confirming the mechanism design D2 relies on:
- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options })` returns a `Query` with `streamInput(stream)` and `close()` — this is the live-session primitive for D1.
- `CanUseTool = (toolName, input, options) => Promise<PermissionResult | null>`; `PermissionResult` is `{behavior:'allow', updatedInput?}` or `{behavior:'deny', message}`.
- `AskUserQuestionInput.questions[]` (`question`, `header`, `options[]`) and `AskUserQuestionOutput` adds an `answers: {question -> answer string}` field — confirming the intended flow: `canUseTool` intercepts the `AskUserQuestion` tool call, and the answer is supplied back via `updatedInput` (merging an `answers` map into the input) rather than any separate dialog API.
- `permissionMode: 'bypassPermissions'` requires `allowDangerouslySkipPermissions: true` to be set alongside it, or the SDK rejects the option.
- **Resolved empirically (task 8.3, user-verified):** `canUseTool` DOES fire for `AskUserQuestion` under `permissionMode: 'bypassPermissions'` on the installed SDK version (`@anthropic-ai/claude-agent-sdk` 0.3.210) — a real PO turn paused, the question relayed to Gemini voice, a voice answer resolved it, and the turn resumed. This was flagged as unconfirmed by the docs (`agent-sdk/permissions.md` says user-interaction tools "always fall through to the callback, even when an allow rule matches," but never explicitly names `bypassPermissions`); it is now confirmed in practice for this app. The documented fallback below remains the escape hatch if a future SDK upgrade changes this: switch the PO session to `permissionMode: 'default'` with the same `canUseTool` (which already auto-allows everything except `AskUserQuestion`) — behaviorally equivalent for this app's purposes, since nothing else in the PO session was ever going to be denied.

## Risks / Trade-offs

- **Stray `ANTHROPIC_API_KEY` bills the API** → strip it from the agent env unconditionally (D3) and warn in `.env.example`/README; add a startup log line stating which billing path is active.
- **Long-lived process/memory leaks or wedged sessions** → explicit lifecycle (create/reset/quit) in D5; a pending-question timeout with safe default (voice-decision-relay spec) prevents indefinite hangs.
- **New dependency (`@anthropic-ai/claude-agent-sdk`) drift vs. the CLI** → the SDK still requires the `claude` binary; pin the SDK version and keep the existing binary-probe/`IRIS_CLAUDE_BIN` logic.
- **Two dispatch paths + two auth paths increase surface area** → this is the accepted cost of the stateful/stateless module split (D1/D3); keep the DEV path byte-for-byte unchanged and isolate all SDK logic behind a small stateful PO module so DEV is unaffected.
- **ToS if Iris is distributed** → document that each user must run their own `setup-token`; never ship a shared token.

## Migration Plan

1. Add the SDK dependency; build a PO-session module (no wiring yet).
2. Split `startClaudeRun` → `startDevRun` (unchanged) + PO route (behind a flag).
3. Implement PO-scoped auth env computation (D3); leave the DEV spawn env untouched.
4. Wire `canUseTool` → `SYSTEM_EVENT_PO_QUESTION` → `answer_po_question` relay end-to-end.
5. Rework `runQueue` (D4) and lifecycle (D5).
6. Flip PO to the SDK path; update personas + system prompt; update docs.
- **Rollback:** feature-flag the PO SDK path; disabling it reverts PO to the existing `-p --resume` behavior with no data migration (the per-role session store is compatible).

## Open Questions

- **Resolved — Permission mode:** the PO SDK session keeps `bypassPermissions`; only `AskUserQuestion` pauses for voice. (D2)
- **Resolved — DEV auth:** DEV stays on `/login`, unchanged. PO/DEV are separate modules and DEV is out of scope. (D1/D3)
- **Resolved — Pending-question timeout:** default **300000 ms (5 min)**, overridable via `IRIS_PO_QUESTION_TIMEOUT_MS`; on expiry the callback resolves with the PO's recommended option and records that the default was applied.

_All open questions resolved._
