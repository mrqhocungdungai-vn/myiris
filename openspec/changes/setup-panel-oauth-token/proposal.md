## Why

In a packaged build the only place `CLAUDE_CODE_OAUTH_TOKEN` can live is `~/.iris/.env` — a hidden file the app writes but never lets the user edit, because `ALLOWED_CONFIG_KEYS` does not include that key and the SetupPanel's Claude section is read-only status. A user who installs the app, installs the Claude CLI, and runs `claude setup-token` then has nowhere to put the result, so PO turns keep failing with "no subscription token" and the only fix is hand-editing a dotfile.

## What Changes

- SetupPanel's "Claude pipeline (optional)" section gains a password-type token field with its own **Save token** button, plus a **Remove** button that appears only when a token is already stored. Both live inside the existing `pipelinePrereqs.reachable` block, so chat-only users (no Claude CLI) see nothing new. Because that section is shared, the field appears in both Settings and the onboarding wizard's `claude` step.
- `CLAUDE_CODE_OAUTH_TOKEN` joins `ALLOWED_CONFIG_KEYS` so the existing `writeUserConfig()` line-wise `.env` merge persists it (repo `.env` in dev, `~/.iris/.env` packaged) and applies it to `process.env` immediately.
- The token value is never sent to the renderer. `getFullConfig()` exposes only a `poTokenSet` boolean; the input renders empty with a placeholder stating whether a token is stored.
- Saving or removing a token closes any resident PO session so the next PO turn picks the new credential up, because `computePoSessionEnv` snapshots the environment at session creation. The stored session id is untouched, so the next turn resumes the same conversation. If a PO turn is currently running, the save is refused with an explanatory message rather than tearing down mid-turn.
- Verification stays cheap: after a successful save or remove the panel re-runs its existing `checkClaude()` so the billing line flips between "Subscription token found" and the actionable missing-token text. No trial API call and no format guessing — an invalid token surfaces on the first PO turn like any other auth error.
- Storage stays plaintext `.env`, matching `GEMINI_API_KEY`; the token must reach the Claude subprocess environment in cleartext anyway, so an encrypted second store would add a parallel path without removing the exposure.
- Out of scope: automating `claude setup-token` (it needs an interactive terminal and a browser round-trip), and exposing any other `IRIS_*` variable through the UI.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `setup-panel`: the Claude section's subscription-auth status stops being read-only — it gains token entry, save, and removal, and the config IPC contract gains a `poTokenSet` presence flag with an explicit "empty means keep existing" rule.
- `agent-subscription-auth`: the subscription token becomes user-configurable at runtime from the app, and a token change invalidates the resident PO session so the new credential takes effect without an app restart.

## Impact

- `electron/main.mjs` — `ALLOWED_CONFIG_KEYS`, `getFullConfig()` (add `poTokenSet`, never the value), a save/remove path that closes the resident PO session and refuses while a PO turn is in flight.
- `electron/preload.cjs` — expose whatever new IPC the token save/remove path needs.
- `src/components/SetupPanel.tsx` — token field and buttons inside `claudeSection`; `IrisConfig` type gains `poTokenSet`.
- `electron/po-session.mjs` — read-only dependency (`poBillingStatus`, `closePoSession`); no behavior change expected.
- Docs: `.env.example`, README/setup docs where `claude setup-token` is described today.
- No new dependencies. Verification is `npm run build` (tsc + vite) plus manual exercise of the panel; the repo has no test runner.
