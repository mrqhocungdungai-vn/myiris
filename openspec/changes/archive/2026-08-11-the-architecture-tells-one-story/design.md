## Context

Scoped on a machine that does not build the app; every claim below was verified
by executing the registry or reading the exact line. The implementing machine
should treat this file as the fact sheet and not re-derive it.

## The verified fact sheet

### The real chain (this is what ARCHITECTURE.md must draw)

1. `electron/verbs.mjs` — the registry. 7 verbs:
   `shape_requirements, shape_on_canvas, work_on_note, execute, finish,
   investigate, capture_learning` (`VERB_NAMES`, verified by execution).
2. `electron/gemini-tools.mjs:48-54` — `buildVerbDeclarations()` maps
   `resolveAllVerbs()` to `{name, description, parameters}`; built against the
   EMPTY project state on purpose (:46-47). `buildPipelineToolDeclarations()`
   adds the control tools; `buildAlwaysToolDeclarations()` adds
   `get_ui_context`, `control_ui`, `go_to_sleep`; capabilities contribute
   `toolDeclarations` (canvas contributes none — `capabilities/canvas.mjs`).
3. `electron/live-messages.mjs:213` — `message.toolCall` arrives;
   :226-233 transcripts are flushed BEFORE dispatch so the brief composes
   against current words; :237-238 listen-only refuses tool calls.
4. `electron/run-dispatch.mjs:527-533` — `executeClaudeTool`:
   `PIPELINE_ONLY_TOOLS` backstop (:512), then `submitVerb` (:310-322):
   `resolveVerb(verb, projectState)`, `missingRequired`, `composeBrief`.
5. `electron/run-dispatch.mjs:326-336` — the review gate: `shouldPark`
   (:292-300) reads `getPromptReviewMode()` and the verb's declared `park`;
   parked returns `parked_for_review`, zero Claude tokens.
6. `electron/run-dispatch.mjs:222-235` — lane selection: stateful verb with a
   live resident session → `runQueue.submitResident` (per-conversation lane,
   `run-queue.mjs:335-354`); otherwise the single global slot
   (`run-queue.mjs:142`).
7. `electron/run-exec.mjs:300` — `startClaudeRun`: verb re-resolved at run
   start, then `startStatefulRun` (resident `query()` via `po-session.mjs`) or
   `startStatelessRun` (one-shot `query()`), each with the verb's model,
   `skills`, `mcpServers`, budget, and prompt from one policy
   (`role-prompt.mjs`).
8. `electron/wiring.mjs:126-188` — finalize → `announceClaudeCompletion` /
   `announceVerbatimResult` (`spokenResult: "verbatim"` verbs get 8000 chars,
   others 2500) → `announcements.mjs` injects `SYSTEM_EVENT_CLAUDE_COMPLETE`
   into the Live conversation — in-band, not a callback.

### Every stale statement, by file and line

| Where | Says | Truth |
| --- | --- | --- |
| `docs/PIPELINE_INTERNALS.md:130` | "the eight verbs plus the control tools" | seven |
| `docs/PIPELINE_INTERNALS.md:135-136` | "Alongside the eight verbs" | seven |
| `docs/PIPELINE_INTERNALS.md:168` | "Offering eight verbs" | seven |
| `docs/PIPELINE_INTERNALS.md:650` | "eight verbs would be eight names" | seven |
| `docs/PIPELINE_INTERNALS.md:30-40` | verb table | missing `work_on_note` entirely |
| `docs/PIPELINE_INTERNALS.md:158-162` | "a stateful turn and a stateless run share the same execution slot and queue behind each other" | false since `submitResident` (`run-queue.mjs:335`); the same file's canvas section has it right |
| `docs/PIPELINE_INTERNALS.md:213` | "`investigate`, `review`, and `capture_learning` never park" | `review` is not a verb; it is `investigate` `depth: judge` |
| `docs/PIPELINE_INTERNALS.md:229` | "runQueue allows only one run system-wide" | resident lane exists |
| `docs/PIPELINE_INTERNALS.md:662` | "Stateless verbs never ask" | `execute`/no-change may ask (`effectiveDisallowedTools`, `run-exec.mjs:85-90`); :224 in the same doc says so |
| `docs/ARCHITECTURE.md:29,88` | delegation via `submit_claude_task` | deprecated, "do not call this" (`gemini-tools.mjs:70`); verbs are the path |
| `docs/ARCHITECTURE.md:179` | names `answer_po_question`, `set_agent_model` | do not exist; `answer_claude_question` (`gemini-tools.mjs:130`), `set_verb_model` (:172) |
| `docs/ARCHITECTURE.md:113-114` | "~40 single-responsibility modules" | 63 non-test `.mjs` under `electron/` at time of audit |
| `docs/ARCHITECTURE.md:119` | "`main.mjs` (~240 lines)" | 339 at time of audit — prefer dropping counts over re-pinning them |
| `docs/ARCHITECTURE.md` module list :133 | groups dispatch/stream/exec | `run-queue.mjs` absent |
| `README.md:9` | "seven named tools — shape, canvas, build, finish, look, review, notes … Two of them are stateful … the other five are stateless" | labels are Shape, Canvas, Note, Build, Finish, Look, Notes; `review` gone; **three** stateful (`STATEFUL_VERBS`, `verbs.mjs:507-512`), four stateless |
| `electron/gemini-tools.mjs:25,39` | "eight named verbs" / "The eight verbs" | seven |
| `electron/run-exec.mjs:320,498` | "eight verbs" | seven |
| `electron/verbs.test.mjs:300` | test *title* says eight (:30 says seven) | seven — title only, no assertion change |
| `electron/run-skills.mjs:16` | measurement "(17 skills) 18 007" tokens | 16 ship now (the canvas change made it 17 again — count at implementation time and date the figure instead of asserting a count) |
| `electron/run-skills.mjs:83` | "`review`: judge work that already exists" | the verb is dead; the list serves `investigate` `depth: judge` |

### Fields no doc names

`speakWhileWorking` (verbs.mjs:205, read at run-stream.mjs:277-280 — worker
prose spoken unthrottled, tool acts narrated on a 3s throttle), `spokenResult`
(verbs.mjs:200/:257 — verbatim read-out, 8000-char bound), `vault`
(additionalDirectories + notes clause), `structuredOutput`
(`DECISION_OUTPUT_FORMAT`, and the run-output-format.mjs:14-18 trap),
`guardOpenNoteWrites` (the Edit/Write confirm seam). ARCHITECTURE.md:132's
field list stops at "persona, clause".

## Decisions

### D1 — No delta specs, and why that is not a dodge

Every stale statement above lives in `docs/`, `README.md`, or a code comment.
The living spec was checked at each point and is correct (e.g.
`verb-tool-surface` requires the registry-derived declarations that exist;
`prompt-review-gate` describes the gate that exists). OpenSpec governs behavior
through specs; a change whose whole payload is prose-about-the-system carries
tasks but no deltas. The alternative — inventing a "documentation" capability
spec so this change has a delta to sync — would create a spec that describes
prose, which `spec:check` would then guard forever for no behavioral gain.

### D2 — One diagram, stations named after files

The repo has three mermaid diagrams and none shows this chain;
ARCHITECTURE.md's existing one routes through the deprecated tool. Replace it
(don't add a second — two diagrams of one flow is the duplication CLAUDE.md
warns about) with the eight-station sequence from the fact sheet. Each station
carries its file name so the diagram stays greppable against the code; line
numbers stay OUT of the diagram (they rot fastest) and live in the prose.

### D3 — Counts are stated once and dated, or not stated

"~40 modules", "~240 lines", "(17 skills)" all rotted because they assert a
current count with no mechanism keeping it true. Where a number is evidence
(the token measurement in run-skills.mjs), keep it but date it ("measured
2026-07-xx against a 17-skill bundle"). Where it is color ("~40 modules"),
drop the number.

### D4 — The Talk/Build paragraph states the decision chain

The framing sentence the docs never say, to appear in ARCHITECTURE.md's
overview and echoed once in PIPELINE_GUIDE.md: Gemini Live decides which verb
runs (nothing for the user to operate — `talk-and-build-modes` already requires
this); the review gate is where a human approves or cancels privileged work
before tokens are spent; each verb is a full Claude Code agent differing in
lifetime, model, skills, and tool bounds. Talk/Build stays as the *explanatory*
vocabulary Iris uses when asked what she can do. No spec delta —
`talk-and-build-modes` already says exactly this.

### D5 — The verbs.test.mjs edit is a title, and that is the whole edit

`verbs.test.mjs:300`'s `it()` title says "eight". Retitling a test is a code
change in a gate file, so it is named here explicitly: the change is the string
in the title, no assertion, no structure. If anything else in that test wants
changing, it does not belong to this change.

## Risks

- **Doc rot recurs.** This change fixes statements; it adds no guard, because
  the only honest guard (a doc-lint over counts and tool names) is a sixth gate
  this repo has explicitly decided not to add. Mitigation: D3 removes the
  fastest-rotting statement *form* (undated counts), which is cheaper than
  policing them.
- **The diagram drifts next time the chain changes.** Accepted: it is one
  diagram, file-named, and the PR that changes the chain now has one obvious
  place to update.
