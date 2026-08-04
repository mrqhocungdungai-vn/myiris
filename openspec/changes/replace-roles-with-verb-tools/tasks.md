# Tasks

Depends on `agent-sdk-conformance` (prompt policy, budgets, caller-supplied
`skills`, `disallowedTools`, transcript ring). Group 1 lands the registry before
anything reads from it; the interface changes last.

Every group ends with `npm run build && npm test && npm run lint`.

## 0. Spikes

- [ ] 0.1 Confirm Gemini Live routes correctly across seven declarations: script ~20 representative utterances (build a feature / fix this bug / what's left / review that / draw it out / save what we learned / archive it) and record which verb each selects. Establishes the misroute baseline the design accepts, before any of it ships. **Deferred by explicit decision** — it needs ~20 live Gemini Live sessions against the user's key. The design decisions it would have informed were already settled, so this is validation, not an input; run it against the shipped surface as 9.2.
- [x] 0.2 Verify a `query()` with an explicit `skills` list genuinely cannot invoke an unlisted plugin skill — that scoping restricts rather than merely deprioritizes. **If this fails, D2's whole premise fails**: seven verbs would be seven names for one agent. **Answered from evidence the conformance change already recorded** (`electron/run-skills.mjs` header): identical one-word prompt, total input tokens `"all"` (17 skills) 18 007 / two-skill list 16 056 / `[]` 15 934 — real scoping, ~120 tokens per skill listed. Per the SDK's own wording an unlisted skill is hidden from the listing *and rejected by the Skill tool*, so it restricts rather than deprioritizes. It is a context filter, not a sandbox: the files stay readable via Read/Bash.
- [ ] 0.3 Confirm the two stateful verbs can share one resident session across a media switch — open with `shape_requirements`, then `shape_on_canvas` into the same session, and check the canvas turn sees the earlier grilling context. **Deferred by explicit decision** (needs live Claude runs). Verified structurally instead: `po-session.mjs` keys its resident session by workstream, both verbs resolve to `sessionKey: "stateful"`, and a canvas turn wires the MCP into an already-open session via `setPoSessionMcpServers`. Tested in `run-exec.test.mjs` and `verbs.test.mjs`; **the end-to-end context check is still unverified.**
- [ ] 0.4 Measure the token cost of the recent-transcript block at a realistic conversation length, on the resumed-session path where it is added every turn. Sets the ring's age/count bounds from data. **Deferred by explicit decision** (needs live runs). Bounded from the conformance change's ring caps (40 utterances / 10 min) plus a tighter per-use cap in `run-context.mjs` — 12 utterances / 4 000 chars, dropping the oldest first — so the block cannot grow turn after turn. **The chosen numbers are reasoned, not measured.**

## 1. The verb registry

- [x] 1.1 Add `electron/verbs.mjs`: one record per verb — `stateful`, `park`, `sessionKey`, `model`, `skills`, `mcpServers`, `budget`, `params`, `basePersona`, `clause`. Fields may be functions of project state. Electron-free, no I/O.
- [x] 1.2 `resolveVerb(name, projectState)` → the full resolved configuration. Pure.
- [x] 1.3 Tests: every verb resolves; `execute` forks correctly on presence and absence of an open change with unchecked tasks; an unknown verb is rejected; the two stateful verbs resolve to the same `sessionKey`.
- [x] 1.4 Log every dispatch with its verb, resolved configuration, and the project state that produced it.

## 2. Personas

- [x] 2.1 `git mv` `iris-po.md` → `stateful.md`, `iris-dev.md` → `stateless.md`; strip PO/DEV/pipeline vocabulary from both bodies, keeping the behavioral substance (how to grill; how to implement test-first and verify).
- [x] 2.2 Compose `base + clause` through the conformance change's prompt policy — no prompt text assembled at a call site.
- [x] 2.3 Update `agent-definitions.mjs` and the project-local override path (`.claude/agents/iris-<base>.md`).
- [x] 2.4 Tests: composition per verb; the project-local override still wins; a missing base fails loudly.

## 3. The voice surface (BREAKING)

- [x] 3.1 `gemini-tools.mjs` derives its declarations from the registry; the eight pipeline declarations are replaced by seven verbs plus `set_verb_model` and `get_project_state`.
- [x] 3.2 Keep `submit_claude_task` as a deprecated alias mapping to `execute`, for one release.
- [x] 3.3 **(D7)** Thin schemas for the stateful verbs (`said` + one-line reading); concrete parameters for the stateless ones.
- [x] 3.4 `gemini-prompts.mjs`: delete the 5,549 characters of role-steering and brief-shaping prose (`BRIEF WRITING`, `PRODUCT OWNER CONTROL`, `BUILD-MODE STEERING`, `ROLE & MODE MODEL`, `- PO control intent`, `- DEV brief`, `- Self-check…`) now carried by the schemas. Replace with phase-based speech guidance (D9).
- [x] 3.5 Remove `"never choose or advance a role yourself"` and every instruction requiring the user to name a role.
- [x] 3.6 Tests: a declaration exists for each verb with its registry schema; the deprecated alias dispatches to `execute`; no declaration mentions PO or DEV.

## 4. Dispatch and execution

- [x] 4.1 `run-dispatch.mjs` takes a verb, not an agent; `buildRun` drops the `active_agent` fallback at line 164.
- [x] 4.2 `run-exec.mjs` builds `query()` options from the resolved verb — `skills`, `mcpServers`, `disallowedTools`, budget, model, `sessionKey` → `resume`.
- [x] 4.3 **(D4)** `execute` forks on project state; delete the hard refusal at `run-exec.mjs:142`. The removed gate is recorded in the spec as a decision.
- [x] 4.4 **(D3)** The resident session is keyed `stateful`, opened by whichever verb is called first, shared by both.
- [x] 4.5 Stateless verbs carry `disallowedTools: ["AskUserQuestion"]` from the registry; `investigate` additionally excludes `Write`/`Edit` — investigating does not modify.
- [x] 4.6 **(D7)** Attach the recent fenced transcript to every verb's query, bounded by 0.4's measurements.
- [x] 4.7 Tests: options per verb asserted field by field; the fork; `AskUserQuestion` absent for stateless verbs; `investigate` unable to write; the transcript fenced and bounded.

## 5. Second brain and canvas as verbs

- [x] 5.1 **(D5)** On `runQueue.finalize`, append verb/task/outcome/cost/error/tools to the dated vault inbox. Plain `fs` — no run, no tokens, no execution slot.
- [x] 5.2 `capture_learning` verb: reads the inbox, scoped to the `wiki-*` skills, runs crystallize/integrate.
- [x] 5.3 Iris suggests `capture_learning` when the inbox is worth processing; never runs it unprompted.
- [x] 5.4 `shape_on_canvas` verb: canvas MCP wired from the registry; **delete the `never DEV` workaround at `capabilities/canvas.mjs:120`.**
- [x] 5.5 Both capabilities stop declaring `toolDeclarations: []` and stop routing through `submit_claude_task` prose.
- [x] 5.6 Tests: inbox append on every terminal status including failure; append never blocks the queue; `capture_learning` reads the inbox; the canvas verb wires the MCP; neither capability's prose mentions a role.

## 6. Review gate

- [x] 6.1 **(D6)** The park decision reads the registry's label — never the brief's text.
- [x] 6.2 Phase scoping: stateful verbs park only on the call that opens the resident session; the session's approved state is what "already opened" means.
- [x] 6.3 `execute` and `finish` park on every call.
- [x] 6.4 Tests: each verb's park decision; a grilling follow-up not re-parking; a re-opened session parking again; `execute` parking on every call.

## 7. Session store and migration

- [x] 7.1 **(D8)** Migrate on load: `po` → `stateful`; `dev` + `default` → `execute` with `last_agent_used` deciding and the loser kept under an archive key; `agent_models` split across the two persona groups; `active_agent` dropped.
- [x] 7.2 `last_agent_used` → `last_verb_used`; remove `AGENT_ROSTER`.
- [x] 7.3 **(D3)** `set_verb_model(verb, model)` replaces `set_agent_model`; a model change on a live stateful session applies to both stateful verbs, and says so.
- [x] 7.4 Tests: migration from a real pre-change store; both collision directions; no conversation discarded; models landing on the right verbs.

## 8. Interface

- [x] 8.1 Remove the role chip and the `agents:select` IPC channel; the PipelineBar keeps the review-mode control and shows the last verb that ran with its reason.
- [x] 8.2 Run cards show the verb badge and its model.
- [x] 8.3 `SessionSwitcher` drops `active_agent`.
- [x] 8.4 Tests: no role selector rendered; verb and reason displayed; review control unchanged.

## 9. Close

- [x] 9.1 Update `docs/PIPELINE_INTERNALS.md`, `docs/PIPELINE_GUIDE.md` (the user no longer picks a role), `docs/ARCHITECTURE.md`, `docs/GESTURES.md` if the canvas entry path changed, `.env.example`, and `CLAUDE.md`.
- [ ] 9.2 Re-run 0.1's routing script against the shipped surface; record the misroute rate as the baseline a later change must beat.
- [x] 9.3 Full gate: `npm run build && npm test && npm run lint && npm run scan:secrets`.
- [ ] 9.4 `/opsx:archive` — sync the delta specs into `openspec/specs/`.
