## Why

The PO role is fundamentally a **conversation** — analysis, scope negotiation, clarifying decisions — but today it is driven the same way as DEV: a one-shot `claude -p ... --resume` process that is spawned fresh per turn, replays the transcript, runs to completion, and exits. That shape cannot let the PO pause mid-thought to ask a question; the codebase works around it with the "Decisions needed" batch that is dumped at the end of a run and answered by respawning. The result is a cold, high-latency loop for a role whose essence is live back-and-forth. DEV, by contrast, executes one already-decided issue and fits the one-shot model perfectly.

We want the PO to live as a single continuous conversation the user can steer by voice in real time — including answering the PO's yes/no questions **mid-turn** — while keeping everything on the Claude subscription (no per-token API billing) and leaving DEV's proven headless path untouched.

## What Changes

- **The pipeline splits into two distinct modules by state model.** PO becomes the **stateful** module (a resident live conversation) and DEV stays the **stateless** module (fire-and-forget per issue). This is a deliberate architectural boundary: the two forms are expected to grow independently, so they get separate dispatch paths, separate auth handling, and separate personas rather than a shared code path.
- **PO becomes a persistent Agent SDK session.** The PO runs via `@anthropic-ai/claude-agent-sdk` as one long-lived session object in the Electron main process (a single continuous context window), instead of a per-turn `claude -p --resume` spawn. Follow-up turns are pushed into the live session, not a new process.
- **Mid-turn voice decisions.** When the PO calls `AskUserQuestion` (or a tool needs approval), the SDK `canUseTool` callback fires and **pauses the turn**. Iris relays the question to Gemini voice, the user answers yes/no by voice, and the answer resolves the callback so the PO **continues the same turn** — replacing the end-of-run "Decisions needed" batch relay.
- **PO is now allowed (and expected) to ask.** The `--append-system-prompt` "never ask" instruction and the PO persona's "never ask the user questions mid-run" rule are inverted for the PO: it asks via `AskUserQuestion` at real decision points. DEV keeps the "never ask, use defaults" rule.
- **Subscription auth for the PO SDK session via `CLAUDE_CODE_OAUTH_TOKEN`.** The SDK does not inherit the interactive `/login`, so the PO session authenticates with a `claude setup-token`–generated OAuth token; usage bills against the subscription, not the API. `ANTHROPIC_API_KEY` is **stripped** from the PO session env so it cannot silently override the token onto API billing. This env handling is scoped to the PO module only.
- **DEV is unchanged — mechanism and auth.** DEV keeps running as a one-shot `claude -p` subprocess with its current `/login`-based subscription auth. Nothing in this change touches the DEV path; it is walled off as the stateless module.
- **PO tool approvals stay on `bypassPermissions`.** Only `AskUserQuestion` pauses the PO turn for a voice answer; tool-use approvals are auto-allowed as they are today, so the relay stays focused on genuine product decisions.
- **`runQueue` coexists with a resident PO session.** The "one task at a time" queue is reworked so a long-lived PO session is a resident conversation (turns serialized within it) while DEV runs remain queued discrete tasks.
- **BREAKING (operational, not code API):** running the PO now requires a one-time `claude setup-token` and a `CLAUDE_CODE_OAUTH_TOKEN` in the app environment; interactive `/login` alone no longer suffices for the PO path.

## Capabilities

### New Capabilities
- `po-live-session`: The PO runs as a single persistent Agent SDK conversation (one continuous context window) with an explicit lifecycle — created on first PO turn, kept alive across follow-ups, reset only on the existing user-controlled triggers (New session, voice new-session, project-folder change) — while DEV remains a one-shot headless subprocess.
- `voice-decision-relay`: A mid-turn question/answer loop in which the PO's `AskUserQuestion` / tool-approval requests pause the session, surface to Gemini voice as a structured event, and are answered by voice to resume the same turn.
- `agent-subscription-auth`: Subscription-based authentication for the PO SDK session via `CLAUDE_CODE_OAUTH_TOKEN`, with `ANTHROPIC_API_KEY` deliberately excluded from the PO session environment to guarantee subscription (not API) billing. DEV's existing `/login` auth is out of scope.

### Modified Capabilities
<!-- None: no existing specs in openspec/specs/. -->

## Impact

- **Code:** `electron/main.mjs` (PO run path splits into its own stateful module — SDK session lifecycle, `canUseTool` callback, `runQueue` rework, PO-scoped auth env handling — while the DEV subprocess path is left untouched as the stateless module); `electron/preload.cjs` (new IPC channel for the question relay and voice answer); `src/App.tsx` (surface/answer PO questions in the Comms/Work Stream UI); Gemini tool + system-prompt wiring in `main.mjs` (relay `SYSTEM_EVENT_*` for PO questions, a tool for the voice answer).
- **Personas:** `resources/personas/iris-po.md` (allow/encourage `AskUserQuestion`, drop "never ask mid-run"); `resources/personas/iris-dev.md` (unchanged behavior, confirm "never ask").
- **Dependencies:** new `@anthropic-ai/claude-agent-sdk` (drives the existing `claude` binary; still requires it installed + authenticated).
- **Config / docs:** `.env.example` and README gain `CLAUDE_CODE_OAUTH_TOKEN` and the `claude setup-token` step, plus the `ANTHROPIC_API_KEY` footgun warning; `CLAUDE.md` "delegation model" and "PO → DEV pipeline" sections updated to describe the asymmetric PO(live)/DEV(one-shot) model.
- **ToS:** the subscription token path is the doc-sanctioned automation route for the user's own account; if Iris is distributed, each user must run their own `setup-token` (no shared/central token).
