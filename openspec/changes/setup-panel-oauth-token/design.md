## Context

`writeUserConfig()` in `electron/main.mjs` already does everything a token editor needs: it merges keys line-wise into the effective `.env` (repo `.env` in dev, `~/.iris/.env` packaged), preserves comments and unrelated lines, applies the values to `process.env`, and never logs values. The only reason `CLAUDE_CODE_OAUTH_TOKEN` cannot be edited is that it is absent from the `ALLOWED_CONFIG_KEYS` whitelist and has no UI. So this change is mostly wiring, and the interesting decisions are about the two places where a token differs from the settings already exposed: it is a secret that must not round-trip to the renderer, and it is captured by the resident PO session at creation time rather than read per turn.

Two facts constrain the design. First, `computePoSessionEnv(process.env)` in `electron/po-session.mjs:19` is evaluated once when a PO session is created, so writing `process.env.CLAUDE_CODE_OAUTH_TOKEN` has no effect on a session that is already alive. Second, `runQueue` (`electron/run-queue.mjs`) keeps at most one run active system-wide, and each run carries `agent: "po" | "dev" | null`, so "is a PO turn in flight" is answerable from `runQueue.list()` without new bookkeeping.

## Goals / Non-Goals

**Goals:**

- A user of a packaged build can enable PO subscription billing entirely from the app.
- The token never leaves the main process, and no global Save can silently erase it.
- A token change takes effect on the next PO turn without restarting the app or losing PO conversation context.

**Non-Goals:**

- Automating `claude setup-token`. It opens a browser and expects a code pasted back into an interactive terminal; relaying that through the Electron UI is a separate, much larger change.
- Validating the token by calling Anthropic, or guessing its format.
- Encrypted credential storage (safeStorage/Keychain).
- Exposing any other `IRIS_*` variable through the UI.

## Decisions

**D1 — Reuse `writeUserConfig()` rather than a bespoke token writer.** Adding `CLAUDE_CODE_OAUTH_TOKEN` to `ALLOWED_CONFIG_KEYS` inherits the comment-preserving merge, the correct dev-vs-packaged path, and the no-logging discipline for free. The alternative — a dedicated token file or a separate writer — would duplicate that logic and create a second source of truth for where credentials live.

**D2 — Presence flag out, value never out.** `getFullConfig()` gains `poTokenSet: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim())` and nothing else. The renderer therefore cannot render, mask, or leak the value; the input is always empty on mount, with the placeholder carrying the state ("Token saved — paste a new one to replace" vs "Paste token from `claude setup-token`"). We considered echoing the value like `GEMINI_API_KEY` does today for consistency, and a masked `sk-…abc` form, but neither earns its keep: the user has the token in their clipboard or terminal, and the only question they need answered is set-or-not. The existing spec already says reads return secrets "reduced to presence/masked form", so presence-only is the stricter reading of a rule that is already on the books.

**D3 — Empty means keep; removal is explicit.** Since the input is always empty, an ordinary global Save would otherwise blank the stored token. `writeUserConfig()` skips the token key when the incoming value is empty or whitespace-only, and clearing goes through a distinct remove action. This rule is deliberately scoped to the token key — the other settings still treat empty as a real value, since blanking a name or a model override is a legitimate edit.

**D4 — Its own Save button, not the panel's.** `claudeSection` is rendered both in Settings and as the wizard's `claude` step, and the wizard step has no Save button at all — only Next. A local save also lets the panel re-run `checkClaude()` immediately so the billing line updates in place, which is the feedback that tells the user the paste worked. The cost is one more button in the section; the benefit is that the same control works in both hosts and cannot be defeated by the user pressing Cancel.

**D5 — Close every resident PO session on a token change; keep the session ids.** Because of the env-capture noted above, a token change must invalidate live sessions. `closeAllPoSessions()` is the right blunt instrument: any resident session, in any workstream, holds the old credential. The persisted `agent_sessions.po` ids in `~/.iris/claude-sessions.json` are untouched, so the next PO turn re-opens with `resume: <stored id>` and the conversation continues — the same mechanism already used when switching workstreams (`main.mjs:440`, `:459`, `:478`). Rejected alternative: leave sessions alone and tell the user to restart, which reproduces the "I saved it but it still says no token" confusion this change exists to remove.

**D6 — Refuse the change while a PO turn is running.** Tearing down a session mid-turn would abort work with a confusing error and could strand a pending `AskUserQuestion`. The guard is `runQueue.list().some(run => run.agent === "po" && run.status === RUN_STATUS.RUNNING)`; the save is rejected with a message naming the reason. A merely *queued* PO run does not block, because its session is only created inside `startPoRun`, which will read the new value. `list()` is documented as outside the queue's core interface but is already used for shutdown, so this is a second, similar read-only use rather than a new capability.

**D7 — Gate the control on `pipelinePrereqs.reachable`.** It lives in the same block as the openspec/skills/agents rows. Without a `claude` binary the token has nothing to authenticate, and the community release deliberately keeps chat-only mode free of pipeline surface area.

**D8 — Plaintext in `.env`.** The token has to reach the Claude subprocess environment in cleartext, so encryption at rest would protect it only from a casual reader of the file while adding a second storage path that diverges from `GEMINI_API_KEY`. If credential storage is ever hardened, it should be hardened for every secret at once, as its own change.

## Risks / Trade-offs

- **A user pastes something that is not a valid token and gets no feedback until the first PO turn.** → Accepted, per D2/the no-validation decision: the PO run already fails with an actionable auth error, and the panel's billing line only ever claimed presence, not validity. The placeholder text points at `claude setup-token` so the source of a correct value is unambiguous.
- **The token sits in plaintext in `~/.iris/.env`.** → Matches the existing `GEMINI_API_KEY` handling and the file is gitignored in the dev case; the value is still never logged and never sent to the renderer.
- **`closeAllPoSessions()` is broader than the workstream the user is looking at.** → Correct rather than excessive: every resident session captured the old environment. Context is preserved through the stored session ids, so the visible cost is one extra session start on the next turn.
- **Reading `runQueue.list()` from the config path couples settings to run state.** → Small and read-only; the alternative (exposing an `activePoRun()` accessor) can be added later if a third caller appears.

## Migration Plan

No data migration. An existing `~/.iris/.env` with a hand-written `CLAUDE_CODE_OAUTH_TOKEN` is picked up unchanged and shows as present. Rollback is removing the key from `ALLOWED_CONFIG_KEYS` and the UI block; nothing persisted changes shape.

## Open Questions

None outstanding — the scope questions (no `setup-token` automation, no other `IRIS_*` variables, plaintext storage, presence-only echo) were settled before this document.
