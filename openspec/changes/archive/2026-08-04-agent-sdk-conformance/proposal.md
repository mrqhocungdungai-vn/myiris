## Why

**Iris treats the Claude Agent SDK as a subprocess launcher it happens to drive, rather than as the agent runtime it is.**

Audited `electron/` line by line against the installed `@anthropic-ai/claude-agent-sdk@0.3.210` (`sdk.d.ts`, `sdk-tools.d.ts`, and the minified `sdk.mjs` where the declared types were not decisive), cross-checked against the `claude-agent-sdk` NotebookLM reference library. The previous change (`bundle-claude-via-agent-sdk`) got the *transport* right — both roles are on `query()`, personas travel by value, `~/.claude` is untouched. What it did not do is finish adopting the option surface. `Options` declares ~70 fields; Iris sets 14, and one of the 14 does not exist.

This change fixes the runtime configuration only. A companion change, `replace-roles-with-verb-tools`, replaces the fixed PO/DEV roles with a set of voice-callable verbs; it depends on the prompt policy, budget, skill-scoping, and tool-restriction machinery built here, and is sequenced after it so a live defect (F1) does not wait on a large refactor.

Verified findings, in severity order:

- **F1 — PO's system-prompt instruction is silently discarded, and PO runs with no base prompt.** `electron/po-session.mjs:242` passes a top-level `appendSystemPrompt`. That is not a field of the public `Options` type — it appears only on an internal init-config type (`sdk.d.ts:3341`). In `sdk.mjs` the normalizer reads **only** `options.systemPrompt`:

  ```js
  let {systemPrompt:i, settings:s, ..., ...d} = e ?? {}, p, f, m;
  if (i === void 0)               p = "";
  else if (typeof i === "string") p = i;
  else if (Array.isArray(i))      p = i;
  else if (i.type === "preset")   f = i.append, m = i.excludeDynamicSections;
  ```

  and then builds `{systemPrompt: p, appendSystemPrompt: f, …}`. A caller-supplied `appendSystemPrompt` is destructured into the rest object `d` and never read back. So PO never receives *"You are invoked from Iris voice as a LIVE, continuous session … Ask via AskUserQuestion at real decision points and wait for the answer"* — and because `systemPrompt` is unset, `p = ""`, i.e. the SDK's **minimal** prompt, not the `claude_code` preset DEV gets. PO still behaves roughly correctly only because `resources/personas/iris-po.md` happens to restate the same instructions. Two roles the code claims "differ in lifetime, not transport" are in fact running on materially different base prompts.

- **F2 — Iris's per-run instructions may be overridden on every role run.** With `agent` naming an `AgentDefinition` for the main thread, that definition's `prompt` applies to the session. If it replaces rather than augments the resolved system prompt, DEV's carefully-constructed `systemPrompt: { preset: "claude_code", append }` is dead code for role runs too, and the only reliable home for Iris-runtime instructions is the `AgentDefinition` itself (or its main-thread-only `initialPrompt` field). Documentation is suggestive but not conclusive; this needs a spike before anything is built on it.

- **F3 — no cost, token, or turn accounting anywhere, and no ceiling.** `total_cost_usd`, `usage`, `modelUsage`, `num_turns` arrive on every result message and are read in zero places outside tests. `maxTurns`, `maxBudgetUsd`, and `taskBudget` are all unset. A voice-dispatched DEV run executes under `bypassPermissions` with no turn limit and no spend limit, on a credential the user may be paying per token for. The SDK docs are explicit: *"Setting a budget is a good default for production agents."*

- **F4 — "DEV never asks" is a prompt promise with no enforcement and no handler.** DEV sets neither `canUseTool` nor `disallowedTools`, and its `AgentDefinition` sets no `tools`. Per the SDK docs, `AskUserQuestion` reaches `canUseTool` *"even if you've allowed them"* — so a DEV run that calls it hits an absent callback rather than a handled path, on the one code path where nobody is listening for a question. Structural enforcement (`disallowedTools`, or `tools` on the definition) exists and is unused.

- **F5 — every run sees every skill.** Both `run-exec.mjs:245` and `po-session.mjs:239` pass `skills: "all"`. The installed type is `string[] | 'all'`, so scoping is available and simply not used: today DEV can invoke `iris:grilling`, and PO can invoke `wiki-*` and `tdd`. A run's capability surface should be a property of what it was asked to do, not a constant.

- **F6 — the Decisions Relay round-trips through prose.** DEV writes a `## Decisions needed` markdown block, Gemini reads it aloud, the user picks, Gemini writes a follow-up brief. `outputFormat: { type: 'json_schema', schema }` with the parsed value on `result.structured_output` exists for exactly this, with SDK-side re-prompting on validation failure.

- **F7 — no `stderr` callback on either role.** Subprocess diagnostics are dropped; a transport failure reaches the user as `Failed to run claude: <message>` and nothing else.

- **F8 — no hooks, on either role.** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`, `PreCompact`, `Notification`, `SessionStart`/`SessionEnd` are all unused. The tool-step timeline is instead reconstructed by parsing assistant content blocks in `claude-stream.mjs` — a derived view where an authoritative in-band one is on offer, and where a `PreToolUse` hook is also the natural home for the cost guard (F3) and for interception of destructive commands under `bypassPermissions`.

- **F9 — cancellation is inconsistent between the two roles.** DEV aborts an `AbortController`; PO closes its message channel and calls `query.return()`. `query.interrupt()` — the SDK's own streaming-input interrupt, which reports which queued messages survived — is unused, and PO has no `abortController` at all.

- **F10 — session management is hand-rolled around `resume`.** `listSessions`, `getSessionInfo`, `getSessionMessages`, `forkSession`, `deleteSession`, `renameSession`, `tagSession` are unused. The dead-resume-id recovery in `run-exec.mjs:86` regex-matches error strings (`/no conversation|session.*not.*found|unknown session/i`) to guess at a condition `getSessionInfo()` answers directly. `title` is never set, so every session Iris creates carries an auto-generated title instead of the workstream label the user chose.

- **F11 — `includePartialMessages` unused.** In a realtime voice product, PO's turn output only becomes relayable when a whole assistant message lands.

- **F12 — AskUserQuestion is relayed lossily.** `run-stream.mjs` ignores `header` and `multiSelect`; `defaultPoAnswers` always produces one label per question, so a multi-select question can never be answered with more than one option, including on the timeout path. (Validated correct: the `answers` map keyed by question text exactly matches `AskUserQuestionInput.answers`.)

- **F13 — `startup()` unused.** The SDK offers CLI pre-warm to make the first query dramatically faster. Iris pays the cold-start on the first delegation of every session, inside a voice loop where latency *is* the product.

- **F14 — the notes-vault root is prose plus a heuristic.** `run-exec.mjs` appends a paragraph naming the vault path and then, after the fact, diffs the vault to decide whether to append a `[vault-check: …]` caveat. `additionalDirectories` is the structural mechanism for "this directory is also in scope."

- **F15 — the user's own words never reach Claude.** `live-config.mjs:35` enables `inputAudioTranscription` unconditionally; `live-messages.mjs:113` routes it to `appendUserTranscript`; `renderer-bridge.mjs:61` accumulates it — and `renderer-bridge.mjs:51,56` emits it to the deck for display and then clears the buffer. Iris holds a verbatim transcript of what the user said and uses it only to draw text on screen. Every piece of information that reaches Claude passes through Gemini's paraphrase. The companion change consumes this; making the buffer retrievable belongs here.

- **F16 — unused options with a concrete Iris use case:** `enableFileCheckpointing` (there is no undo for a `bypassPermissions` run), `effort`, `strictMcpConfig`, `persistSession`, `agentProgressSummaries`, `forwardSubagentText`, `toolConfig` (AskUserQuestion preview formatting), `sandbox`.

**Validated as correct, and deliberately not changed** — so this is a fair audit and not a rewrite for its own sake: DEV's `systemPrompt` preset form; the `bypassPermissions` + `allowDangerouslySkipPermissions` pairing; `env` fully replacing the subprocess environment and being computed by subtraction; `settingSources: ["project"]` + `plugins` + a pinned `CLAUDE_CONFIG_DIR` (and the reasoning that `settingSources` alone is genuinely not enough); personas by value with `agent` for the main thread; `canUseTool` intercepting only `AskUserQuestion` under `bypassPermissions` (docs confirm it reaches the callback even when allowed); the streaming-input channel keeping PO's context alive, with `setModel()`/`setMcpServers()` mid-session (both streaming-only APIs); `pathToClaudeCodeExecutable` pointing into `app.asar.unpacked`; and the deliberate absence of `fallbackModel`.

## What Changes

- **`systemPrompt` becomes the single, shared way both roles get their base prompt.** A new `electron/role-prompt.mjs` builds one prompt configuration from one policy, and the dropped `appendSystemPrompt` at `po-session.mjs:242` is deleted. Gated on a spike (F2) establishing where a main-thread `AgentDefinition` leaves the resolved system prompt; if the definition wins, Iris's runtime instructions move into the definition (or `initialPrompt`).
- **Every run gets a turn ceiling and a spend ceiling** (`maxTurns`, `maxBudgetUsd`), configurable per role and env-overridable, with `error_max_turns` / `error_max_budget_usd` surfaced as their own outcome rather than a generic failure, and a warning emitted while a run is still executing.
- **Cost and usage become first-class run data** — `total_cost_usd`, `usage`, `modelUsage`, `num_turns` captured, persisted, projected to the deck, and answerable by voice.
- **The skill surface becomes per-run instead of `"all"`.** `skills` is supplied by the caller as an explicit list. This is also the mechanism the companion change builds its verb table on.
- **"A role that must not ask cannot ask"** — enforced with `disallowedTools` / the definition's `tools`, plus a `canUseTool` fallback that fails the run loudly rather than hanging.
- **The Decisions Relay moves to `outputFormat` structured outputs**, with the prose block kept as a fallback for one release.
- **`stderr` is captured** on both roles and attached to failures.
- **Hooks are adopted where they replace guesswork**: `PreToolUse` for the cost/danger guard, `PostToolUse`/`PostToolUseFailure` for the step timeline, `PreCompact` and `Notification` for user-visible state.
- **PO gains an `AbortController` and uses `interrupt()`** so both roles cancel the same way.
- **Session bookkeeping moves onto the SDK helpers** — `getSessionInfo()` replaces the error-string regex, and `title` is set from the workstream label.
- **`additionalDirectories`** carries the notes-vault root; the prose directive and the post-hoc `[vault-check: …]` heuristic are retired.
- **The verbatim user transcript becomes retrievable** instead of display-only — a bounded, timestamped recent-utterance buffer the dispatcher can read. Nothing consumes it in this change.
- **`startup()`** pre-warms the CLI when the pipeline becomes available.
- **AskUserQuestion is relayed losslessly** — `header` spoken, `multiSelect` honored end to end (voice, UI, and the timeout default).
- `includePartialMessages`, `enableFileCheckpointing`, and `effort` are evaluated and adopted, or explicitly declined with a recorded reason.

## Impact

- **Affected specs**: `global-agent-runtime` (option conformance, prompt policy, budgets, skill scoping, tool restriction, hooks, stderr, granted directories, transcript retention), `po-live-session` (system prompt, cancellation/interrupt), `voice-decision-relay` (structured decisions, AskUserQuestion fidelity, enforced ask-asymmetry), `run-execution-queue` (cost/turn accounting, ceiling termination).
- **Affected code**: `electron/{role-prompt,run-budget}.mjs` (new); `po-session.mjs`, `run-exec.mjs`, `run-stream.mjs`, `run-queue.mjs`, `claude-stream.mjs`, `agent-definitions.mjs`, `renderer-bridge.mjs`, `user-config.mjs`, `wiring*.mjs`; the run-card components in `src/`.
- **User-visible**: run cards gain cost and turn counts; a run can terminate on a spend cap, reported as its own outcome. **No change to how work is requested** — that is the companion change.
- **Billing-visible**: defaults must be generous enough that no existing workflow starts failing. The cap is a runaway guard, not a quota.
- **Not addressed here** (belongs to `replace-roles-with-verb-tools`): the fixed PO/DEV role model, the voice tool surface, the review gate's granularity, the interface's role chip, and any consumer of the transcript buffer.
- **Not addressed at all**: multi-project / concurrent runs (the single global execution slot stays); `sessionStore` external persistence; sandboxing `bypassPermissions`; code signing.
