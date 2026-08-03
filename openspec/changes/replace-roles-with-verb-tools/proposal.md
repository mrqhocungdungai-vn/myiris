## Why

**PO and DEV are not roles the user should have to operate. They are tools Iris reaches for.**

Today they are modes with a persistent identity, and the user is required to run them. This is enforced in the prompt, by design:

- `gemini-prompts.mjs:59` — *"Only pass the 'agent' parameter when the user explicitly names a role; **never choose or advance a role yourself**."*
- `gemini-tools.mjs:56` — set `agent` *"ONLY when the user explicitly names a role (e.g. 'have the PO grill this…', 'cho dev làm…')"*.
- `run-dispatch.mjs:164` — with no named role, the run inherits `workstream.active_agent`, which is only ever set from a chip in the interface (`ipc.mjs:119`).
- `gemini-prompts.mjs:60` teaches the user a **"ROLE & MODE MODEL"** — Talk mode vs Build mode, three user-facing roles. The mental model is part of the product surface.

So the user must know PO and DEV exist, decide which applies, and either say its name or click. Iris — the one component actually listening — is forbidden from making the call. "Iris, build me X" does the wrong thing unless the chip already happens to be right.

Four consequences, all measured in the code:

1. **One tool is asked to be seven.** `submit_claude_task` is described as *"Hand actionable work to Claude. Invoke for deals, shopping, research, coding, file work, terminal tasks, summaries, automations, or anything requiring tools."* A tool with no boundary is not a tool. Its single `task` string must be shaped differently depending on the role — and the prompt spends **5,549 of 9,017 characters (62%)** of the pipeline block teaching Gemini how to shape it (`BRIEF WRITING`, `PRODUCT OWNER CONTROL`, `- PO control intent`, `- DEV brief`, `- Self-check before every submit_claude_task call`). Every one of those characters is *advice*. A parameter schema is a contract.

2. **The prompt contains an impossible instruction.** It tells Gemini the brief's required shape depends on the role, and in the same breath forbids Gemini from choosing the role.

3. **Capabilities have to write workarounds for the role model.** `capabilities/canvas.mjs:120` instructs Gemini to call `submit_claude_task` *"with no 'agent' parameter (**never DEV, which would be refused for lacking an open OpenSpec change**)"*. A drawing feature carries a workaround for a pipeline gate it has nothing to do with. Both `canvas.mjs:229` and `second-brain.mjs:270` declare `toolDeclarations: []` — **neither capability gives Gemini a single function.** They reach Claude only through the same undifferentiated `submit_claude_task` plus prose.

4. **Nothing is learned from what happens.** `grep` for vault/notes across `run-queue.mjs`, `run-stream.mjs`, `announcements.mjs` returns zero hits. Runs succeed and fail and nothing is recorded. The second brain, which exists and ships six `wiki-*` skills, never sees any of it.

The pipeline's substance is sound and stays: shaping requirements is different work from implementing them, and an implementation run should not free-code against no spec. What goes is the assumption that a **fixed role**, operated by the user, is how that distinction gets expressed. The real axis is not *who* the worker is — it is whether a task is **stateful** (a resident session that may pause and ask by voice) or **stateless** (a one-shot autonomous run that never asks). PO happens to be stateful and DEV happens to be stateless; naming them after personas was the mistake.

## What Changes

### The tool surface becomes seven verbs

`submit_claude_task` is replaced by seven functions, each with its own name, description, and **parameter schema**. Gemini routes by function-calling — the thing the model is actually trained on — instead of encoding the real choice in prose.

| verb | stateful | park | model | sessionKey |
| --- | --- | --- | --- | --- |
| `shape_requirements` | yes | on opening | strongest | `stateful` |
| `shape_on_canvas` | yes *(same session)* | on opening | *(follows the live session)* | `stateful` |
| `execute` | no | **every call** | fast | `execute` |
| `finish` | no | **every call** | fast | `finish` |
| `investigate` | no | no | fast | `investigate` |
| `review` | no | no | strongest | `review` |
| `capture_learning` | no | no | cheapest | `capture_learning` |

- **BREAKING:** `submit_claude_task` is removed, kept for one release as a deprecated alias mapping to `execute`.
- **BREAKING:** `workstream.active_agent`, the `agents:select` chip, and the role roster are removed. There is no current role; a verb is chosen per call.
- **`electron/verbs.mjs` is the single registry** — one record per verb, fields may be functions. `gemini-tools.mjs` reads function declarations from it, `run-dispatch.mjs` reads the park label, `run-exec.mjs` reads the `query()` options. One source of truth, because three hand-wired copies is the mechanism that produced F1.
- **`skills` is scoped per verb**, on the caller-supplied mechanism the conformance change builds. `execute` cannot invoke `grilling`; `capture_learning` cannot invoke `tdd`. Without this, seven verbs would be seven names for one agent — **the scoping is the substance, the verb table is the vehicle.**
- **Statefulness is fixed per verb and enforced, not promised.** The two stateful verbs share **one** resident session, so moving from talking to drawing continues the same conversation with the same context. The five stateless verbs carry `disallowedTools: ["AskUserQuestion"]`. They still resume their own prior conversation — **continuity and statefulness are different things**, and conflating them is what made "PO" mean two unrelated properties at once.

### Personas are renamed to what they are

`iris-po.md` → `stateful.md`, `iris-dev.md` → `stateless.md`, plus a short per-verb clause in the registry. Role vocabulary leaves the Claude-facing prompt; `iris-dev.md` currently opens *"You are the Developer (DEV) in the Iris delivery pipeline PO → DEV"*.

### `execute` forks on disk state instead of refusing

`run-exec.mjs:142` today fails a DEV run outright when no open change has unchecked tasks. Instead, `execute` reads the project: an open change with tasks means `/opsx:apply` and the full process; no change means ordinary work, the way a note gets written — no software-development ceremony. **This deliberately removes the gate that prevented implementation without a spec.** It is a decision, not an oversight: the remaining control is that `execute` is parked for review on every call.

### Second brain and canvas become verbs

Both already have everything they need — six `wiki-*` skills, an Excalidraw MCP server — and neither is reachable by voice. Wrapping each as a scoped `query()` makes it a tool Iris can call naturally, and deletes the `canvas.mjs:120` workaround.

Alongside `capture_learning`, **every run's outcome is appended to a vault inbox on finalize** — verb, task, result, cost, error, tools used. Plain file append: no tokens, no latency, and it does not take the single execution slot. Synthesis (`wiki-crystallize`, `wiki-integrate`) happens when `capture_learning` is called or when the inbox is worth processing. Raw capture is a log; synthesis is the learning — and spawning a second Claude run after every run would double cost and block the queue.

### The user's own words reach Claude

The conformance change makes the verbatim transcript retrievable. Here it is consumed: **every verb receives the recent fenced transcript as context**, alongside Gemini's parameters.

This changes what Gemini is for. The stateful verbs take a thin schema — the model on the other end is strong, holds the session context, and can pause to ask by voice, so a thin brief is a starting point rather than a loss. That is what statefulness is *for*. The stateless verbs keep concrete parameters as the **instruction**, with the transcript as background to check against, because a one-shot run that is forbidden to ask cannot recover from a vague brief.

Gemini's job shrinks to what it is good at: pick the verb, summarize in one line. It stops being the sole channel through which information reaches Claude.

### The review gate becomes verb-labeled and phase-scoped

The park label is a declared property of the verb, not a heuristic read off the brief's text. The two consequential stateless verbs (`execute`, `finish`) park on **every** call — each is a fresh autonomous run that writes to the repo. The stateful verbs park only on the call that **opens** the session: once the user has agreed to open a conversation, every steering turn into it dispatches directly. Parking each turn of a live grilling conversation is friction with no safety gained — the session is already alive and already spending.

## Impact

- **Affected specs**: `verb-tool-surface` (new), `role-capabilities` (role vocabulary becomes explanatory), `prompt-review-gate` (verb-labeled, phase-scoped), `per-role-model-selection` (model per verb), `personal-knowledge-notes` (capture verb + inbox), `canvas-claude-mcp` (canvas as a verb), `openspec-native-pipeline` (`execute` forks instead of refusing).
- **Affected code**: `electron/verbs.mjs` (new); `gemini-tools.mjs`, `gemini-prompts.mjs`, `run-dispatch.mjs`, `run-exec.mjs`, `run-queue.mjs`, `session-store.mjs`, `po-session.mjs`, `agent-definitions.mjs`, `ipc.mjs`, `preload.cjs`, `capabilities/{canvas,second-brain}.mjs`, `wiring*.mjs`; `resources/personas/*`; `src/App.tsx`, `src/components/{PipelineBar,SessionSwitcher}.tsx`.
- **Depends on** `agent-sdk-conformance`: the prompt policy, per-run budgets, caller-supplied `skills`, structural tool restriction, and the transcript ring.
- **User-visible**: the user no longer needs to know PO and DEV exist. "Build me X" starts the work. The role chip becomes a display of what ran, not a control. Trivial work stops being parked. Failures and successes accumulate in the second brain.
- **Migration**: existing `~/.iris/claude-sessions.json` stores are mapped forward — `po` → the stateful session, `dev` and `default` → `execute` with `last_agent_used` deciding which wins and the loser retained under an archive key. `agent_models.po` → the stateful verbs, `.dev` → the stateless ones. `active_agent` is dropped. **No conversation is discarded**, because `CLAUDE.md` promises context resets only when the user asks and an upgrade is not the user asking.
- **Risk — more ways to misroute.** Today Gemini can only get "is this Claude work" wrong. Now it can get "which of seven" wrong. Mitigated by parking the two expensive verbs, by the pure and exhaustively-tested registry, and by every routing decision being logged with its inputs. Not fully mitigated: a wrong `investigate` or `review` costs money quietly.
- **Known limit, not solved here**: the transcript improves what Claude receives but Gemini still chooses the verb and writes the summary line. This narrows the bottleneck; it does not remove it.
- **Not addressed**: concurrent runs (the single global execution slot stays); an on-device intent classifier; sandboxing `bypassPermissions`.
