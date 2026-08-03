# Design

## Context

This change corrects how Iris configures `query()`. It deliberately does **not** touch who decides which run to start — that is `replace-roles-with-verb-tools`, which depends on four things built here: the single prompt policy (D2), the per-run budget (D3), per-run skill scoping (D7), and structural tool restriction (from F4).

Task groups are ordered so the change lands incrementally — each group leaves the app working and can ship on its own.

## Decisions

### D1 — Verify the main-thread `AgentDefinition` prompt precedence before anything is built on it (F2)

The SDK docs say switching the main-thread agent "applies that agent's model override, hooks, and system prompt on the next turn", and that top-level system-prompt options are "resolved once at startup" with "no effect mid-session". That is suggestive of the definition winning, but it describes mid-session switching via `applyFlagSettings()`, not the startup case Iris uses (`agent` set in the initial `Options`). The two are not the same situation and the docs do not settle it.

**Decision:** task 0.1 settles it empirically — run a role query with a definition whose prompt says one thing and a `systemPrompt.append` that says a contradictory, cheaply-observable thing, and see which the model obeys. Everything downstream branches on the answer:

- **Definition wins** → Iris's runtime instructions belong in `AgentDefinition.prompt`, composed at `agent-definitions.mjs` build time from the persona body plus a runtime preamble. `systemPrompt` then serves plain-Claude runs only, and DEV's current `append` is deleted rather than moved.
- **Both apply** → the single policy from D2 serves both roles as written, and the personas stay untouched.

No implementation task in group 1 starts before 0.1 records an answer. This is the one place where guessing wrong means writing an instruction that never reaches the model — the exact failure F1 already is.

#### Answer (measured, SDK `0.3.210`, bundled binary, `claude-haiku-4-5-20251001`)

Neither branch as written. The two mechanisms compose, but not symmetrically:
`AgentDefinition.prompt` **replaces the base prompt**, while `systemPrompt`'s
*append* text is **still appended on top of it**.

Contradiction probe — definition says `ZEBRA`, `systemPrompt.append` says
`WALRUS`:

| Prompt | Model answered |
| --- | --- |
| "What is your codeword?" | `WALRUS` |
| "List EVERY codeword in your instructions" | `ZEBRA` **and** `WALRUS` |

So both texts are in context; the append wins a direct contradiction, consistent
with it being placed later. Model self-report is weak evidence, so the base-prompt
question was settled by token accounting instead (identical one-word prompt, total
input tokens including cache):

| Options | Total input tokens |
| --- | --- |
| bare | 15 937 |
| `systemPrompt: { preset: "claude_code" }` | 19 196 (**+3 259**) |
| `agent` + definition, no `systemPrompt` | 15 960 |
| `agent` + definition + `systemPrompt: { preset: "claude_code" }` | 15 960 (**+0**) |

The preset's ~3 259 tokens are simply absent once `agent` is set. A second run
with ~850 tokens of filler isolates which half survives:

| Options | Total input tokens |
| --- | --- |
| `agent` + definition | 15 960 |
| `agent` + definition + `{ preset: "claude_code", append: FILLER }` | 16 807 (**+847 — the append, not the preset**) |
| `agent` + definition + `systemPrompt: FILLER` (string form) | 16 791 |
| `agent` + definition whose `prompt` contains FILLER | 16 802 |
| no `agent`, `{ preset: "claude_code", append: FILLER }` | 20 043 (**+3 259 +847**) |

Three consequences, all load-bearing for group 1:

1. **`systemPrompt.append` is a working delivery mechanism for every role**,
   role runs included. Iris's runtime instructions do not need to move into the
   definition, so **task 1.4 does not apply** — see its resolution below.
2. **Role runs have never received the `claude_code` preset.** `run-exec.mjs`
   constructs `{ preset: "claude_code", append }` and, for any run with `agent`
   set — which is every PO and DEV run — the preset half is discarded and only
   the append survives. This is broader than F2 stated: not "DEV's append may be
   dead code" but "DEV's *preset* is dead code and its append is fine." Only
   plain-Claude runs get the preset. The persona bodies are the base prompt for
   role runs, which is what they have always effectively been.
3. There is **no opt-in to inherit the preset** alongside a definition — the SDK
   exposes no such flag, and the preset text is not obtainable to paste into a
   persona. This is recorded rather than fixed; changing it means rewriting both
   personas against a prompt Iris cannot read, which is not this change's scope.

**Resolution of task 1.4:** declined on evidence, not skipped. Its precondition
("if 0.1 says the definition wins") is only half-met — the definition wins the
base prompt but does not suppress the append — and the append is the mechanism
D2's single policy already uses. Moving the runtime preamble into
`agent-definitions.mjs` would buy nothing and would couple prompt policy to
persona parsing. `initialPrompt` was evaluated with it and also declined: it is
auto-submitted as a *user* turn, so PO's live-session instruction would arrive as
something the user appeared to say, and it would be re-sent on every resumed
session.

### D1b — `appendSystemPrompt` at the top level, confirmed dead (F1, task 0.2)

Ground truth for the regression test, same harness:

| Options | "What is your codeword?" |
| --- | --- |
| `appendSystemPrompt: "…answer exactly: MANGO"`, no `systemPrompt` | *"I don't have a codeword to provide."* |
| `systemPrompt: { preset: "claude_code", append: "…answer exactly: MANGO" }` | `MANGO` |

F1 is confirmed against the running SDK, not just read off `sdk.mjs`. PO's
live-session instruction has never reached the model.

### D1c — `AskUserQuestion` exposure is gated on `canUseTool` (F4, task 0.3)

Measured with the same harness, `bypassPermissions`, a prompt that demands the
tool be called:

| Options | Outcome |
| --- | --- |
| no `canUseTool` | Tool **not offered at all** — model reports it is not in its tool list |
| `canUseTool` set | Tool offered, called, and the callback fires with the question payload |
| `canUseTool` + `disallowedTools: ["AskUserQuestion"]` | Tool **not offered** |
| `disallowedTools` only | Tool not offered |

Nothing hung in any configuration.

Two things follow. First, **DEV cannot hang on a question today**: it sets no
`canUseTool`, so the tool is never exposed. Task 2.3 is therefore belt-and-braces
— it makes an accident structural instead of incidental, which is what the spec
asks for, but it is not repairing a live hang. Second, `disallowedTools` is
confirmed as real enforcement: it removes the tool even when `canUseTool` would
otherwise expose it, so DEV stays safe if a future change adds a callback.

Also observed, and worth recording because it validates an existing comment in
`po-session.mjs`: the SDK emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning that
under `bypassPermissions` `canUseTool` is bypassed for ordinary tools — yet it
**is** invoked for `AskUserQuestion`. That is exactly the asymmetry PO depends
on, now measured rather than inferred from the docs.

### D2 — One prompt policy module, not two call sites

F1 exists because PO and DEV each build their base prompt inline, and nothing forced them to agree. Re-fixing them in place would leave the same shape.

**Decision:** `electron/role-prompt.mjs` exports one function returning the prompt configuration (and, per D1, possibly the definition preamble) for a given role. Both `run-exec.mjs` and `po-session.mjs` call it; neither constructs prompt text. This mirrors `worker-env.mjs`'s existing "one policy both roles route through, so the two can't drift" shape, which is the pattern that has held up.

A test asserts the two roles' prompts differ **only** in the documented role-specific clause. That is the regression guard F1 lacked.

### D1d — `startup()` measured and declined (F13, task 0.4)

First measured wrong — a fresh `query()` does not use the warm subprocess; it
must be driven through the returned handle's `warm.query()`. Corrected, three
rounds each, one-word prompt, bundled binary:

| | wall | ttft |
| --- | --- | --- |
| cold `query()` | 3041 / 5251 / 3146 ms | 1944 / 4075 / 2020 ms |
| `warm.query()` after `startup()` | 2341 / 2661 / 3156 ms | 1779 / 2067 / 2597 ms |
| `startup()` itself | 527–545 ms | — |
| pre-warmed 5 s ahead, then queried | 2774 ms | 1953 ms |

The saving is roughly **400 ms of subprocess spawn**, inside a run whose own
time-to-first-token varies by more than that between identical cold runs (1944 ms
vs 4075 ms). End to end (`startup()` + query) is no faster than going cold.

**Declined**, and the reason is structural rather than the margin: `startup()`
takes the full `Options` up front and `WarmQuery.query()` can be called **once**.
Iris cannot know a run's `cwd`, `agent`, `model`, `resume`, or `mcpServers` at the
moment the pipeline becomes available — those are resolved at run start, several
user actions later. A pre-warm would have to guess the next run's entire option
set and be discarded whenever it guessed wrong. Task 3.7 keeps its other two
parts and drops this one.

### D1e — `outputFormat` round-trips through a role run (F6, task 0.5)

Confirmed with the real DEV persona, the shipped plugin loaded, `agent` set, and
a `decisions[]` schema: `result.structured_output` came back as a parsed object
with `summary`, and a populated `decisions[]` carrying `question`,
`recommendation`, and `options[] { label, description }`. No retry, no
`error_max_structured_output_retries`.

One consequence D6 did not anticipate, and 3.6 must handle: **`result.result`
becomes the raw JSON string**, not prose. Today that field is what Iris finalizes
a run with and what the voice layer reads aloud. So adopting `outputFormat`
without changing the projection would have Gemini reading a JSON blob to the
user. `run-stream.mjs` must take the human-facing text from
`structured_output.summary` when structured output is present, and fall back to
`result.result` only when it is absent.

### D3 — Budgets are per-role, generous, and terminate loudly

**Measured (task 0.6).** A representative run of each role against a small real
project (a word-count CLI: `openspec init`, one full PO propose, then DEV
implementing every task in it), bundled binary, defaults otherwise:

| Role | Turns | Cost | Wall | Output tokens |
| --- | --- | --- | --- | --- |
| PO — one turn, grill → full 4-artifact proposal | **28** | **$0.966** | 211 s | 12 648 |
| DEV — implement the whole change, TDD, commit | **29** | **$0.779** | 164 s | 10 201 |

Two things this changes about D3 as written:

1. **PO is not the cheap role.** D3 assumed PO "should not run long tool loops"
   and would take a low ceiling. It took *more* turns and *more* money than DEV,
   because a propose turn writes four artifacts and validates them. Ceilings are
   therefore near-symmetric, PO slightly higher on spend.
2. This was a **toy project**. A real repository means more reading before the
   first edit, so these are a floor, not a typical case. Defaults are set at
   roughly 4–6× the measurement so the cap is a runaway guard and nothing else:

   | Role | `maxTurns` | `maxBudgetUsd` |
   | --- | --- | --- |
   | PO | 150 | 6.00 |
   | DEV | 150 | 5.00 |
   | plain Claude | 60 | 2.00 |

Also observed, and the reason the spec requires per-model accounting:
`modelUsage` carried **two** models on both runs — the selected `claude-sonnet-5`
plus a little `claude-haiku-4-5` the harness spends on its own. A single
top-level figure cannot attribute that.

`claude-fable-5` was PO's configured default in `session-store.mjs` when these
runs were measured, and it could not be measured at all: the account returned
*"Fable 5 requires usage credits."* Both runs above therefore used
`claude-sonnet-5`. On the strength of that, PO's default was changed to
`claude-opus-5` (and Fable 5 replaced by Opus 5 throughout the curated
`MODEL_CHOICES` list) — a separate, user-requested spec sync against
`per-role-model-selection`, not part of this change's deltas. PO's default is
still the pricier model of the two roles, which is a further argument for its
ceiling not being the lower one.



`maxTurns` and `maxBudgetUsd` produce distinct result subtypes (`error_max_turns`, `error_max_budget_usd`). Today any non-success subtype collapses into `claude reported <subtype>`, which would tell a user "the DEV failed" when it actually hit a ceiling — a materially different thing with a different fix.

**Decision:**
- Defaults per role, env-overridable. PO gets a low turn ceiling and a small budget (it grills and writes a proposal; it should not run long tool loops); DEV gets a high ceiling and a larger budget.
- Defaults are set high enough that no workflow observed today would hit them. **Values come from measurement in task 2.1, not from a guess.** A cap that fires in normal use will be switched off, which is worse than no cap.
- Both subtypes finalize with a dedicated status and a spoken message naming the ceiling, its value, and how to raise it — never the generic failure path.
- `taskBudget` (alpha, API-side pacing) is deliberately **not** adopted: it changes model behavior rather than adding a ceiling, and its interaction with the personas is unmeasured.

### D4 — The cost guard is a `PreToolUse` hook, not a poll

Reading `total_cost_usd` off the result message tells Iris what a run cost *after* it is over. `maxBudgetUsd` stops a run at the ceiling but says nothing on the way there.

**Decision:** a `PreToolUse` hook is the one place with both an in-flight view and the authority to return `permissionDecision: "deny"` with a message the model reads. It gets two jobs, and only two, so it stays reviewable:

1. **Budget warning** — signal when the run crosses a fraction of its budget, so a long run is visible before it terminates rather than after.
2. **Destructive-command interception** under `bypassPermissions` — a small, explicit denylist (`rm -rf` outside `cwd`, `git push --force`, writes outside `cwd` ∪ `additionalDirectories`). This is a guardrail, not a sandbox, and the spec says so: `bypassPermissions` remains the intentional default and this does not pretend to make it safe.

Step-timeline telemetry goes to `PostToolUse`/`PostToolUseFailure` (D5) precisely so this hook stays a guard and does not accumulate product logic.

### D5 — Keep `parseClaudeStreamMessage`, add hooks alongside it

Hooks give authoritative tool boundaries; the current parser derives them from assistant content blocks. Replacing the parser outright would rewrite a well-tested module and the whole `run-stream.mjs` projection at the same time as everything else here.

**Decision:** hooks become an *additional* source. `PostToolUse` / `PostToolUseFailure` supply the end boundary and the error flag (today `is_error` is read off a `tool_result` block, which cannot distinguish "tool failed" from "tool returned an error-shaped payload"). The parser keeps producing activity text. `pushToolStart` / `pushToolEnd` keep their signatures, so `run-stream.mjs`'s projection and the deck are untouched. Retiring the parser is explicitly out of scope.

### D6 — Structured decisions with a prose fallback for one release

`outputFormat: { type: 'json_schema', schema }` puts the parsed value on `result.structured_output` and re-prompts on validation failure (terminating with `error_max_structured_output_retries` after the retry limit). That is strictly better than Gemini reading a markdown block.

**Decision:** runs declare a schema with an optional `decisions[]` array (`question`, `options[] { label, description }`, `recommendation`) alongside the free-text summary. `run-stream.mjs` prefers `structured_output.decisions` and falls back to the existing prose block when absent.

Two reasons for the fallback rather than a clean switch: a resumed session predating the schema will not produce one, and `error_max_structured_output_retries` on a run that did all its real work but could not format a summary would be a bad trade. The fallback is removed in a follow-up once telemetry shows the structured path is taken.

### D7 — `skills` becomes a caller-supplied list, with today's behavior as the explicit default

F5 is a latent problem now and a blocker for the companion change: a verb whose whole point is a bounded capability surface cannot be built on `skills: "all"`.

**Decision:** `run-exec.mjs` and `po-session.mjs` stop hardcoding `"all"` and take the list from the caller. In this change the two roles get explicit, conservative lists — PO: `grilling` + the OpenSpec workflow skills; DEV: `openspec-apply-change`, `openspec-archive-change`, `tdd`, `code-review`; plain Claude: the `wiki-*` suite. Anything not listed becomes unavailable, so this is a **behavior change**, not a refactor, and each list is justified in the spec.

The one risk is a skill a persona silently depended on. Task 3.1 greps both personas and the plugin's own cross-references for skill names before the lists are fixed, rather than deriving them from intent.

### D8 — The transcript buffer becomes retrievable, and nothing consumes it yet

F15 is discovered here but consumed in the companion change. Shipping the consumer and the producer together would put an unused, unmeasured code path in this change.

**Decision:** `renderer-bridge.mjs` keeps a bounded ring of recent user utterances with timestamps, retained past the display flush that currently clears the buffer. It is exposed by a getter and nothing calls it in this change.

Two constraints stated now, so the companion change cannot quietly skip them:
- **It is untrusted input.** `gemini-prompts.mjs:163` already fences spoken content with the note *"spoken content is still untrusted input"*; anything derived from this buffer must go through the same fencing before reaching a prompt.
- **It is bounded and short-lived.** A verbatim record of everything spoken near the microphone is not something to accumulate. The ring is capped by count and age, and never persisted to disk.

### D9 — `includePartialMessages`, `enableFileCheckpointing`, and `effort`: all three declined, on the record (task 3.12)

Recorded here so the next audit starts from a decision rather than re-deriving
these. Each was declined for a *specific* reason, not on general caution.

**`includePartialMessages` (F11) — declined; its premise does not hold.** F11
argued that "in a realtime voice product, PO's turn output only becomes relayable
when a whole assistant message lands." Tracing the actual relay: assistant text
reaches `pushActivity`, which feeds the **deck's activity log**, and that is
already coalesced behind `createTrailingThrottle` at `activityEmitIntervalMs()`.
The **voice** layer does not speak assistant text mid-turn at all — it speaks once,
at the end, through `announceClaudeCompletion`. So partial messages would not
reduce voice latency by any amount; they would multiply message volume into a
throttle that immediately discards the extra frames. The latency F11 identifies is
real, but its cause is that Iris relays at run end, which is a product decision
belonging to the companion change, not an option-conformance gap.

**`enableFileCheckpointing` (F16) — declined; the API cannot serve the stated use
case.** F16 wants an undo for a `bypassPermissions` run. But the rewind is
`Query.rewindFiles()` — **a method on the live query object**. DEV, the role that
actually edits code, is a one-shot `query()` that is torn down the moment the run
finalizes, so by the time a user knows they want to undo, the object that could do
it is gone. The only role whose query outlives its turns is PO, which writes spec
artifacts rather than code. Enabling the flag would create file backups on every
run to serve a rewind that cannot be reached. A real undo needs a mechanism that
survives the run (a git checkpoint, or the SDK exposing rewind off a session id);
that is a feature, and it is not this change.

**`effort` — declined for now; it is a cost/quality change and this change sets
its numbers from measurement.** Every other knob here was measured before it was
set (D1, D3). `effort` moves both spend and answer quality, per role, and none of
that was measured — adopting it on intuition would be the exact thing D3 refuses.
It is also largely redundant with a control Iris already has: the per-role **model**
selector (`per-role-model-selection`) is how a user gives PO more capability today.
Revisit with a measurement, alongside the budget numbers it would move.

## Risks / Trade-offs

- **Budget caps could fire mid-workflow.** Mitigated by measuring defaults (D3), env overrides, an in-flight warning (D4), and a distinct spoken outcome. Accepted trade-off: an unbounded autonomous agent on the user's credential is the worse risk.
- **D7 removes capability.** A persona that quietly used an unlisted skill will start failing. Mitigated by the grep in 3.1 and by lists erring wide on the first pass.
- **D1's spike could invalidate group 1's shape.** That is why it runs first. If the definition wins, the work moves into `agent-definitions.mjs` — more churn on the personas, less on `run-exec.mjs`, same end state.
- **Structured outputs could cost a run** via `error_max_structured_output_retries` on a run that did its work. Mitigated by keeping the schema shallow with every field optional, and by the prose fallback (D6).
- **Hooks add a second execution path into the run.** Mitigated by keeping `PreToolUse` to two narrow jobs (D4) and leaving the message parser as the primary stream (D5).
- **D8 retains speech in memory.** Mitigated by the cap, the age bound, no disk persistence, and mandatory fencing. Stated in the spec so a later change cannot widen it silently.
