# Tasks

Each group leaves the app working and can ship on its own. Every group ends with
`npm run build && npm test && npm run lint`.

## 0. Spikes — settle what the docs do not (blocks group 1)

- [x] 0.1 **(D1, blocks 1.1–1.4)** Main-thread `AgentDefinition` prompt precedence: run a role `query()` with a definition prompt and a contradicting `systemPrompt.append`, both cheaply observable in the output. Record which one the model obeys in `design.md` under D1.
- [x] 0.2 Confirm F1 end to end against the live SDK: a `query()` with only a top-level `appendSystemPrompt` and no `systemPrompt` does **not** receive that text, and a `systemPrompt: { type: "preset", preset: "claude_code", append }` does. This is the regression test's ground truth.
- [x] 0.3 Characterize what reaches `canUseTool` when `AskUserQuestion` is called with **no** `canUseTool` set under `bypassPermissions` — denied, hung, or auto-answered. Determines whether 2.3's fallback is a safety net or the only thing standing between DEV and a hang.
- [x] 0.4 Measure `startup()`'s effect on first-query latency on this machine, with the bundled binary. Adopt in 3.6 only if the saving is real.
- [x] 0.5 Confirm `outputFormat` + `structured_output` round-trips through a *role* run (`agent` set, plugin loaded), not just a bare query — the personas produce long markdown and the interaction is unmeasured.
- [x] 0.6 **(D3)** Measure real turn counts and spend across a representative PO grilling session and a DEV implementation run, so 2.1's ceilings are set from data rather than guessed.

## 1. The system-prompt policy (F1, F2)

- [x] 1.1 Add `electron/role-prompt.mjs`: one policy returning the prompt configuration for `po` | `dev` | plain, shaped by 0.1's answer. Electron-free, no I/O.
- [x] 1.2 Delete `po-session.mjs:242`'s `appendSystemPrompt` and route PO through `role-prompt.mjs` — PO stops running on the SDK's minimal prompt.
- [x] 1.3 Route `run-exec.mjs`'s DEV and plain-Claude prompt construction through the same module; no prompt text is built at a call site.
- [x] 1.4 ~~If 0.1 says the definition wins: compose the runtime preamble into `AgentDefinition.prompt`…~~ **Declined on 0.1's evidence** — the definition replaces the *base* prompt but does not suppress `systemPrompt.append`, which is the mechanism the D2 policy already uses, so moving the preamble buys nothing. `initialPrompt` declined with it (auto-submitted as a *user* turn, and re-sent on every resume). Recorded in `design.md` under D1.
- [x] 1.5 Tests: PO and DEV prompts differ **only** in the documented role-specific clause; a passed-through `appendSystemPrompt` never appears in the options handed to `query()`; the plain-Claude notes-vault branch is unchanged.

## 2. Ceilings, cost, and tool restriction (F3, F4, F7)

- [x] 2.1 Add `electron/run-budget.mjs`: per-role `maxTurns` / `maxBudgetUsd` from 0.6's measurements, `IRIS_CLAUDE_MAX_TURNS` / `IRIS_CLAUDE_MAX_BUDGET_USD` overrides, documented in `.env.example`.
- [x] 2.2 Apply the budget to both roles; finalize `error_max_turns` and `error_max_budget_usd` with a dedicated status and a message naming the ceiling, its value, and how to raise it — never the generic `claude reported <subtype>` path.
- [x] 2.3 DEV: `disallowedTools: ["AskUserQuestion"]` (or `tools` on the definition, per 0.1), plus a `canUseTool` that fails the run loudly with a diagnostic if it is ever reached. Per 0.3, this is either belt-and-braces or the fix for a hang.
- [x] 2.4 Capture `total_cost_usd`, `usage`, `modelUsage`, `num_turns` off the result message onto the run; persist them; project them onto `claude_task_update`.
- [x] 2.5 Show cost and turns on the deck run card and in the step timeline; make them answerable by voice ("how much did that cost?").
- [x] 2.6 Add a `stderr` callback on both roles; buffer the last N lines and attach them to a failed run's output.
- [x] 2.7 Tests: each subtype's finalization message; budget resolution and env overrides; cost fields surviving the projection; a DEV `AskUserQuestion` attempt failing loudly rather than hanging; stderr appearing only on failure.

## 3. Skill scoping, hooks, sessions, and the remaining gaps (F5, F6, F8–F16)

- [x] 3.1 **(D7)** Grep both personas and the plugin's cross-references for every skill name they actually invoke, *before* fixing the lists — the lists must come from evidence, not intent.
- [x] 3.2 **(D7)** Replace `skills: "all"` in `run-exec.mjs:245` and `po-session.mjs:239` with a caller-supplied list; set the three conservative default lists. Record in the spec why each entry is present.
- [x] 3.3 **(D4)** `PreToolUse` hook on both roles: budget-threshold warning, and a small explicit destructive-command denylist under `bypassPermissions`. Two jobs only; the spec states this is a guardrail, not a sandbox.
- [x] 3.4 **(D5)** `PostToolUse` / `PostToolUseFailure` as the authoritative tool-end boundary and error flag, feeding the existing `pushToolEnd` signature. `parseClaudeStreamMessage` stays.
- [x] 3.5 `Notification` and `PreCompact` hooks → user-visible state (a compaction is currently invisible and looks like a stall).
- [x] 3.6 **(D6)** `outputFormat` schema with optional `decisions[]`; `run-stream.mjs` prefers `structured_output.decisions`, falls back to the prose `## Decisions needed` block. Handle `error_max_structured_output_retries` as its own outcome.
- [x] 3.7 Replace `run-exec.mjs:86`'s error-string regex with `getSessionInfo()`; set `title` from the workstream label; ~~adopt `startup()`~~ **declined** — 0.4 measured ~400 ms against a run whose own TTFT varies more than that, and `startup()` fixes the whole `Options` up front while `WarmQuery.query()` is single-use, so Iris would have to guess the next run's `cwd`/`agent`/`model`/`resume`. Recorded in `design.md` D1d.
- [x] 3.8 PO gets an `AbortController`; both roles cancel through one path; use `query.interrupt()` for the mid-turn case and record which queued messages survived.
- [x] 3.9 `additionalDirectories` carries the notes-vault root; retire the prose directive and the post-hoc `[vault-check: …]` heuristic in `run-exec.mjs`.
- [x] 3.10 **(F12)** Relay `header` and `multiSelect` end to end — voice reading, the UI answer path, and `defaultPoAnswers`' timeout default (which today cannot express a multi-select answer).
- [x] 3.11 **(D8, F15)** `renderer-bridge.mjs` retains a bounded, timestamped ring of recent user utterances past the display flush at line 56; expose a getter. Capped by count and age, never persisted. **No consumer in this change.**
- [x] 3.12 Evaluate `includePartialMessages` (voice latency), `enableFileCheckpointing` (undo for `bypassPermissions`), and `effort` (per-role). Adopt, or record the decline and its reason in `design.md` so the next audit does not re-litigate them.
- [x] 3.13 Tests: skill lists reaching `query()` verbatim and an unlisted skill being absent; each hook's contract; the structured/prose decision fork; dead-resume detection via `getSessionInfo`; multi-select relay including the timeout default; the transcript ring's count and age bounds.

## 4. Close the audit

- [x] 4.1 Add `electron/sdk-options.test.mjs`: assert the exact `Options` object each role hands to `query()`, field by field, so an option that is silently dropped (F1's failure mode) fails a test instead of a user's run.
- [x] 4.2 Record every deliberately-unused SDK option with its reason (`fallbackModel`, `taskBudget`, `sessionStore`, `sandbox`, `persistSession`, `forkSession`, `agentProgressSummaries`, `forwardSubagentText`, `toolConfig`, `strictMcpConfig`, …) in `docs/REFERENCE.md`, so the next audit starts from a decision rather than a blank.
- [x] 4.3 Update `docs/PIPELINE_INTERNALS.md` (prompt policy, budgets, hooks, skill scoping), `docs/TESTING.md` (the options test), `.env.example`, and `CLAUDE.md`'s router lines.
- [x] 4.4 Full gate: `npm run build && npm test && npm run lint && npm run scan:secrets` — all four green (615 tests). Plus an end-to-end smoke through the real `createRunExec` + live SDK: a DEV run completed in 138 s / 31 turns / $0.70, returned its **prose summary** (not the raw JSON `result.result`), recorded `usage`/`modelUsage`, emitted 56 tool boundaries from the `PostToolUse` hooks (2 flagged as failures), and left its session titled `Smoke · DEV`.
- [x] 4.5 `/opsx:archive` — synced into `openspec/specs/` and archived. The sync found three living-spec requirements this change falsified that the deltas did not cover (`One declared status vocabulary` — the new `limited` status; `Single task-update projection` — the new `usage` field; `PO session enables skills explicitly` — `skills: 'all'` and the `settingSources` claim, the latter already stale from `bundle-claude-via-agent-sdk`). Those were added to the delta specs as MODIFIED before merging, so the living spec is true after the change lands.
