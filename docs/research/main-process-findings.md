# Main-process improvement research — evidence-backed findings

Scope: `electron/` (main process) only. No code changed; no installs run.
Method: full read of the named modules, plus greps across `electron/**` and
`openspec/specs/**`. Every claim below cites `file:line`.

Line counts at time of writing (non-test, `wc -l`):

| module | lines | vs. 250–450 convention |
| --- | --- | --- |
| `capabilities/second-brain.mjs` | 1317 | **2.9×** ceiling |
| `canvas-mcp.mjs` | 804 | **1.8×** (spec records it as a 557-line exception) |
| `verbs.mjs` | 665 | 1.5× |
| `run-exec.mjs` | 638 | 1.4× |
| `run-dispatch.mjs` | 622 | 1.4× |
| `run-stream.mjs` | 583 | 1.3× |
| `wiring.mjs` | 539 | 1.2× |
| `run-queue.mjs` | 538 | 1.2× |
| `stateful-session.mjs` | 530 | 1.2× |
| `user-config.mjs` | 504 | 1.1× |
| `session-store.mjs` | 501 | 1.1× |
| `stateless-session.mjs` | 498 | over 450 |

Eleven of the twelve modules in scope are over the 450-line ceiling that
`openspec/specs/main-process-structure/spec.md` states as a *requirement* for
modules the reorganization created or rewrote. There is no guard script
(`CLAUDE.md`: "Convention-only by deliberate decision"), which is why the drift
is uniform rather than occasional.

---

## Ranked findings

Rank = impact ÷ risk-of-fixing. F1–F4 are worth doing; F5–F8 are cheap; F9–F12
are hygiene.

| # | Finding | Evidence | Impact | Risk | Seam proposed |
| --- | --- | --- | --- | --- | --- |
| **F1** | Concurrent `AskUserQuestion` is now reachable, but the relay still holds exactly one pending question and silently drops the first | `run-stream.mjs:84-91,104-117`; `run-queue.mjs:151-172,477-495`; `verbs.mjs:319` | **High** — a hung run + a false account of what was answered | Med | `createPendingQuestions()` keyed per run; refcounted `suspend`/`resume` |
| **F2** | `second-brain.mjs` is 1317 lines holding ≥6 responsibilities | `capabilities/second-brain.mjs:264-425, 427-520, 584-700, 703-780, 894-1032, 1034-1263` | **High** — the least navigable file in `electron/` | Low | 4 modules, split on existing internal boundaries |
| **F3** | Result→terminal-status interpretation is implemented twice, and `unanswered` exists on only one of the two paths | `run-exec.mjs:505-549` vs `stateless-session.mjs:456-494`, `:410-436` | **High** | Low | `finalizeRunResult()` in `run-outcome.mjs` |
| **F4** | `PIPELINE_ONLY_TOOLS` is a hand-maintained second copy of the pipeline tool list | `run-dispatch.mjs:512-524` vs `gemini-tools.mjs:56-199` | Med-High | **Very low** | export `PIPELINE_TOOL_NAMES` derived from the declarations |
| **F5** | `wiring.mjs` (the composition root's body) contains run-completion domain policy | `wiring.mjs:126-188` | Med | Low | `createRunCompletion({...}).onFinalized` |
| **F6** | The queue's two lanes are near-duplicate implementations of one algorithm | `run-queue.mjs:175-232, 268-354, 460-495` | Med | **Med-High** (concurrency) | `createLane()` used twice |
| **F7** | Spec records `canvas-mcp.mjs` as a 557-line exception; it is 804 and still growing | `main-process-structure/spec.md` §"single-responsibility modules"; `canvas-mcp.mjs` | Med | Low | split pure scene algebra out; re-state or retire the exception |
| **F8** | `run-dispatch.mjs` is three modules (review gate / dispatch / tool router) | `run-dispatch.mjs:89-172+278-300+355-415`, `174-276+310-353`, `477-600` | Med | Low | `run-review.mjs` + `claude-tool-router.mjs` |
| **F9** | State-dependent verb fields are read with **no** project state at 7 call sites | `run-dispatch.mjs:200,222,296`; `session-store.mjs:92,459-460`; `wiring.mjs:169`; `run-stream.mjs:298` | Med | Low | `resolveVerbStatic()` that throws on a function-valued field |
| **F10** | `verbs.mjs` mixes the verb *table* with the resolution *engine* (665 lines) | `verbs.mjs:164-511` vs `513-665` | Low-Med | **Very low** | `verb-table.mjs` (data) + `verbs.mjs` (resolution) |
| **F11** | `announceVerbatimResult` has no `unanswered` branch, unlike its sibling | `announcements.mjs:253-287` vs `:205-219` | Low (latent) | Very low | shared status-framing table |
| **F12** | Stale comments assert invariants the code has already broken | `run-stream.mjs:84-91`; `canvas-mcp.mjs:720-728`; `session-store.mjs:487-491`; `wiring.mjs:517` | Low | Very low | comment sweep alongside F1/F6 |

**Verified clean:** the Electron-free constraint. See "Constraint check" below.

---

## F1 — The one-question-at-a-time relay outlived the guarantee it rests on

`run-stream.mjs:84-91` states the invariant it is built on:

> "At most one run of either shape is ever mid-execution system-wide — Claude
> runs strictly one at a time (see runQueue) — so at most one AskUserQuestion
> can be pending across the whole app."

That is no longer true. `run-queue.mjs:151-172` introduced the resident lane
precisely so a conversation turn "does not contend for the single execution
slot", and `run-dispatch.mjs:222-235` routes stateful turns into it. So a
resident canvas/note turn runs **beside** a slot job. `run-stream.mjs:224-235`
already fixed the *same* stale assumption for activity throttles ("true when it
was written, and no longer true"), and the question relay was not revisited.

Two runs can both ask:

- a resident turn — `verbs.mjs:179,269` (`ASKS_FREELY`) — and
- an `execute` run holding the slot with no open change, which is now *granted*
  `AskUserQuestion` (`verbs.mjs:319`, `disallowedTools: (state) => state.hasOpenChange ? SETTLED_WORK_ASKS_NOTHING : []`).

`PendingQuestion.raise` (`run-stream.mjs:104-117`) does:

```js
return new Promise((resolve) => {
  const timer = setTimeout(() => this.expire(), timeoutMs);
  this.current = { workstreamId, questions, resolve, timer, onExpiry };
  ...
});
```

It **overwrites `this.current` without settling or clearing the previous one**.
Compare `PendingReview.raise` (`run-dispatch.mjs:92-98`) which calls
`this.clear()` first, deliberately. Consequences of a second `raise`:

1. The first run's `resolve` is dropped — its `canUseTool` promise never
   settles. The run hangs until the idle watchdog kills it as `error`
   (`run-queue.mjs:204-215` / `268-280`), reported as a fault when it was a
   dropped relay.
2. The first question's `setTimeout` is never cleared; when it fires,
   `expire()` reads `this.current` (`:146-148`) and settles the **second**
   question early, under the *first* caller's `onExpiry` policy. A `DENY`
   policy question can therefore be defaulted, or vice versa — which is exactly
   what `voice-decision-relay` forbids ("The unanswered outcome is never
   presented as a decision", quoted at `run-stream.mjs:119-126`).
3. `resolvePendingClaudeQuestion` (`run-stream.mjs:532-569`) matches answers by
   ordinal against `PendingQuestion.current.questions` — a voice answer to
   question 1 of run A is matched against run B's list. The ordinal was chosen
   as an identifier *because* text was unreliable (`:534-543`); with two
   pending questions the ordinal is unreliable too.
4. `runQueue.suspend()`/`resume()` (`run-queue.mjs:477-495`) are global
   booleans, not a refcount. The first settlement's `resume()` re-arms **both**
   lanes' watchdogs while the second run is still legitimately blocked on a
   human — the precise failure `suspend()` exists to prevent
   (`run-stream.mjs:105-111`).

### Spec disagreement (code vs. spec, and spec vs. spec)

`openspec/specs/voice-decision-relay/spec.md:20` still asserts:

> "Because only one run executes globally at a time, at most one such question
> is ever pending."

`openspec/specs/run-execution-queue/spec.md` (Requirement: Single execution
slot) says the opposite for resident turns, and adds "A resident turn SHALL
carry its own silence watchdog … A turn's own progress SHALL reset only its own
watchdog, and SHALL NOT keep an unrelated run alive." The relay's global
`suspend()` violates the second half of that sentence today.

Per `CLAUDE.md`, reconcile through a change — do not silently edit either side.

### Seam

Extract `electron/pending-questions.mjs`:

```js
export function createPendingQuestions({ emitQuestionEvent, onFirstRaise, onLastSettle }) {
  // Map<questionId, { runId, workstreamId, questions, resolve, timer, onExpiry }>
  return {
    raise(runId, workstreamId, questions, { timeoutMs, onExpiry }), // -> { questionId, promise }
    answer(questionId, answersByOrdinal),
    expire(questionId),
    abandon(workstreamId),   // settles every entry for that workstream
    list(),                  // for the relay's "which question is this" prompt
    pendingFor(runId),
  };
}
```

`onFirstRaise`/`onLastSettle` become `runQueue.suspend()`/`resume()`, making
the suspension refcounted by construction. The Gemini-facing tool must then
carry a question id (or the relay must refuse a second raise rather than
silently overwrite — the smaller, spec-preserving option, and worth proposing
as the interim).

### Test that pins it

`run-stream.test.mjs`:

- raise Q1 for run A (`onExpiry: DENY`), then Q2 for run B; assert **both**
  promises are still pending and two `claude_question` events were emitted;
- answer Q2; assert run B's promise resolves with `behavior: "allow"` and run
  A's is still pending;
- advance fake timers past Q1's timeout; assert Q1 settles `deny/unanswered`
  and Q2's already-resolved state is untouched;
- assert `runQueue.suspend` was called twice and `resume` fires only after the
  **second** settlement (refcount).

Plus a `run-queue.test.mjs` case: with a slot run and a resident turn both
suspended, resuming one must not re-arm the other's watchdog.

---

## F2 — `second-brain.mjs`: 1317 lines, six responsibilities

The seams are already visible as contiguous blocks:

| block | lines | responsibility |
| --- | --- | --- |
| vault readiness / scaffold / welcome note / skills probe | `264-425`, `521-541` | filesystem setup |
| voice announcements to Iris (`focusLine`, `openNoteLine`, `announceNoteOpened/Edited/FocusUpdate`) | `427-520` | notification prose |
| run-outcome capture + `captureNote` | `543-618` | inbox spooling |
| ambient session capture (timer, flush, preference, awake) | `619-700` | ambient-memory |
| prompt fragment | `703-780` | Gemini prose |
| focus / open-note state + path resolution + `mutateVaultNotes` / `findNoteByName` | `781-1032` | note identity + voice tools |
| IPC handler array (13 channels, incl. the read/write editor path) | `1034-1263` | renderer surface |

Proposed extraction, all Electron-free and already dependency-injected:

1. `capabilities/second-brain-vault.mjs` — `ensureNotesVaultReady`,
   `checkNotesSkillsStatus`, `renderNotesVaultConfig`, `seedWelcomeNote`,
   `probeSecondBrainAvailability`. Interface:
   `createVaultSetup({ irisPluginDir, userDisplayName, emitEvent }) -> { ensureReady, skillsStatus, probe }`.
2. `capabilities/second-brain-notes.mjs` — note identity and the three
   worker-free voice tools:
   `createNoteAccess({ getGraph, emitToRenderer, notifyIris }) -> { resolveVaultNotePath, findNotesByName, findNoteByName, mutateVaultNotes, readNote, writeNote }`.
   `resolveVaultNotePath` (`:813-835`) is the single security predicate for
   every note path — giving it its own module and test file is worth more than
   the line count saved.
3. `capabilities/second-brain-ambient.mjs` — `ambientCaptureLive`,
   `flushAmbientCapture`, the flush timer, `setAmbientCapturePreference`,
   `setAmbientCaptureAwake`, `syncAmbientCaptureState` (`:619-700`).
4. The remaining `second-brain.mjs` keeps focus/open-note state, the prompt
   fragment, the IPC array and `teardown` — the capability-contract surface
   described at `gemini-tools.mjs:7-22`.

**Test that pins it:** `second-brain-notes.test.mjs` asserting
`resolveVaultNotePath` refuses a ghost node, an unknown id, a since-deleted
file and a symlink escaping the vault — behavior asserted only indirectly today
through the IPC handlers (`:1117-1130`, `:1139-1166`).

---

## F3 — Two implementations of "what did this run's result mean"

`run-exec.mjs:505-521` (stateful) and `stateless-session.mjs:456-494`
(stateless) each independently:

- capture `result.usage` / `result.decisions` onto the run,
- map `isCeilingSubtype(subtype)` → `RUN_STATUS.LIMITED` with `describeCeiling`,
- map `error_max_structured_output_retries` → `RUN_STATUS.FAILED` with
  `STRUCTURED_OUTPUT_FAILURE`,
- append `withStderr(...)` on failure.

The comment at `run-exec.mjs:506-507` states the intent — "the budget policy
lives here, once, for both shapes" — but it lives *twice*, once per shape. Both
import the same helpers from `run-budget.mjs` / `run-output-format.mjs`
(`run-exec.mjs:31,33-38`; `stateless-session.mjs:17,21-24`), which is the tell:
the helpers were shared, the *policy that composes them* was not.

The divergence this has already produced: **`RUN_STATUS.UNANSWERED` is only
ever reached from the stateless path.** Grep across `electron/**` non-test:

```
stateless-session.mjs:420   runQueue.finalize(run.run_id, RUN_STATUS.UNANSWERED, run.unansweredQuestion);
```

is the only writer. The stateful catch (`run-exec.mjs:522-549`) knows
`teardown` and `cancelled` and otherwise finalizes `ERROR`. A resident turn
whose write-guard confirmation (`run-exec.mjs:56-106`) or own `AskUserQuestion`
goes unanswered therefore reports as `error` — the exact misreport
`run-queue.mjs:49-57` documents `UNANSWERED` as existing to prevent, and which
`run-execution-queue`'s terminal-status requirements forbid downstream.

### Seam

`electron/run-outcome.mjs`, pure:

```js
/** @returns {{ status: string, output: string, usage?, decisions? }} */
export function interpretRunResult(result, { budget, stderrTail, cancelledMarkers });
```

Both shapes then do `runQueue.finalize(run.run_id, ...interpretRunResult(...))`,
and the unanswered/abandoned/violation branches (`stateless-session.mjs:410-436`)
move into it as declared markers read off the run.

**Test:** `run-outcome.test.mjs` — a table-driven case per `(subtype, markers)`
pair asserting the terminal status and message, then one assertion in each of
`run-exec.test.mjs` and `stateless-session.test.mjs` that the shape delegates
rather than deciding. That table is the thing that would have caught the
missing stateful `unanswered`.

---

## F4 — The registry rule stops one tool short

`CLAUDE.md`: "A verb is defined in exactly one place." `gemini-tools.mjs:38-54`
honours it for verbs. But the **non-verb pipeline tools** are declared in
`gemini-tools.mjs:56-199` and then re-enumerated by hand in
`run-dispatch.mjs:512-524`:

```js
const PIPELINE_ONLY_TOOLS = new Set([
  ...VERB_NAMES, DEPRECATED_TASK_TOOL, "check_claude_status", "get_claude_task_status",
  "stop_claude_task", "start_new_claude_session", "get_workspace_info",
  "get_project_state", "answer_claude_question", "set_verb_model", "respond_to_task_review",
]);
```

The two sets agree today (I diffed them; they match exactly). Nothing forces
that. This is the shape `verbs.mjs:13-19` names as the mechanism that produced
the silently-dropped `appendSystemPrompt`: two call sites building the same
list with nothing making them agree. The failure mode is quiet in both
directions — a tool declared but absent from the set is callable in chat-only
mode; a tool in the set but never declared is dead weight nobody notices.

The archived change `2026-07-27-harden-security-boundaries/tasks.md:11` had to
remember to edit *both* places for one tool removal, which is the maintenance
cost made concrete.

### Seam

In `gemini-tools.mjs`, add:

```js
export const pipelineToolNames = (tools) => new Set(tools.buildPipelineToolDeclarations().map((d) => d.name));
```

and inject it into `createRunDispatch` as `isPipelineOnlyTool`. **Test**
(`gemini-tools.test.mjs`, one assertion): the declared pipeline names and the
dispatch guard's set are equal — a set-equality assertion that fails the moment
either side moves. Cheapest high-value fix in this report.

---

## F5 — Run-completion policy lives in the wiring module

`main-process-structure` requires `main.mjs` to "act solely as a composition
root … and SHALL NOT contain domain logic". `wiring.mjs` is main.mjs's
extracted body (`wiring.mjs:1-11`), and its `onFinalized` callback
(`wiring.mjs:126-188`) is 60 lines of *policy*, not wiring:

- ordering rule: token accounting must run **above** the `started_at` gate
  (`:144-150`),
- the `started_at` gate itself (`:151-155`),
- "record in the second brain before anything is announced" (`:156-163`),
- announcement routing derived from the verb registry (`:164-187`).

The comment at `:159-162` — "Deliberately NOT gated on started_at's sibling
checks below — wait, it is" — is an author arguing with themselves inside a
dependency-injection block, which is the readable symptom.

**Seam:** `electron/run-completion.mjs`:

```js
export function createRunCompletion({ cancelActivityThrottle, recordUsage, captureRunOutcome,
                                      announceClaudeCompletion, announceVerbatimResult, resolveVerb, isVerb }) {
  return { onRunFinalized(run) { ... } };
}
```

`wiring.mjs` then passes `onFinalized: runCompletion.onRunFinalized`.

**Test:** `run-completion.test.mjs` — a run with no `started_at` records usage
but is never announced nor captured; a `spokenResult: "verbatim"` verb takes
the verbatim path exactly once and the summary path zero times; ordering is
asserted by a call-log array.

---

## F6 — One queue algorithm, written twice

| slot lane | resident lane |
| --- | --- |
| `armIdleTimer` `:175-183` | `armResidentTimer` `:190-196` |
| `clearIdleTimer` `:185-188` | `clearResidentTimer` `:198-202` |
| `onIdleExpiry` `:268-280` | `onResidentExpiry` `:204-215` |
| `beginRun` `:282-291` | `beginResident` `:234-238` |
| `dequeueNext` `:293-303` | `releaseResident` `:219-232` |
| `submit` `:305-323` | `submitResident` `:335-354` |

`submit` and `submitResident` are line-for-line parallel down to the identical
"read the status back because startRun is synchronous" comment
(`:313-321` / `:347-352`). `finalize` then has to remember to call both release
paths (`:377-385`), and `stop` has to reason about both queues at once
(`:398-407`) — the `holdsSomething` predicate at `:398` exists purely because
the two lanes are separate variables rather than one abstraction.

**Seam:** `createLane({ capacity, idleTimeoutMs, startRun, onExpire })` returning
`{ submit, release, stop, suspend, resume, activeIds }`; the slot lane is one
instance with a single global key, the resident lane is one instance keyed by
`workstream_id`. `finalize` calls `lane.release(run)` on the lane that owns the
run.

**Risk is the highest in this report** — this is the concurrency core, and the
existing 841-line `run-queue.test.mjs` is the safety net. Do it only *after*
F1, since F1 changes `suspend`/`resume` semantics anyway.

**Test:** the existing suite must pass unchanged (that is the point), plus a new
parametrised block running the same lifecycle assertions against both lane
instances, so a rule added to one lane cannot be forgotten in the other.

---

## F7 — A recorded exception that grew 44%

`openspec/specs/main-process-structure/spec.md`, Requirement "The main process
is a set of single-responsibility modules":

> "`electron/canvas-mcp.mjs` (557 lines) is a recorded pre-existing exception:
> it is untouched by this change and its split is an explicit non-goal, tracked
> as a follow-up."

The file is **804 lines**. The spec's parenthetical is factually false, and the
"untouched" premise no longer holds. This is a code/spec disagreement of the
kind `CLAUDE.md` says must be reconciled through a change.

The split is also obvious — the file already labels it at `:28`
("`===== Pure scene / element helpers (no Electron, no MCP) =====`"):

- `canvas-scene.mjs` — `:23-556` (element builders, geometry, apply/update/delete,
  result annotation). Pure, no MCP, no http; already exported individually and
  already covered by `canvas-mcp.golden.test.mjs`.
- `canvas-mcp.mjs` keeps `registerTools` (`:573-698`) and the listener/lifecycle
  (`:703-804`).

Two secondary observations in the same file:

- `:720-728` justifies per-request server construction with "runQueue's
  one-Claude-at-a-time guarantee makes this cheap, not a concurrency
  requirement" — the same stale invariant as F1. The *code* is safe (a fresh
  `McpServer` + transport per request), only the reasoning is stale.
- `commitWrite` (`:579-598`) is a read-modify-write over the injected scene
  (`sceneOrEmpty(getScene())` … `setScene(scene, …)`) with no serialization.
  Under the old global slot two canvas tool calls could not interleave; with the
  resident lane keyed per workstream (`run-queue.mjs:171`) two canvas
  conversations in two workstreams can, and the loser's elements are silently
  dropped. Low likelihood, easy guard: compare the revision `setScene` returns
  against the one read, or serialize `commitWrite` behind a promise chain.

---

## F8 — `run-dispatch.mjs` is three modules

Three unrelated responsibilities, each self-contained:

1. **Review gate** — `PendingReview` (`:89-127`), its events/narration
   (`:129-172`), `shouldPark` (`:278-300`), and the four resolution entry points
   (`:355-415`). ~150 lines, and it is the module the `prompt-review-gate` spec
   is about.
2. **Dispatch** — `buildRun` (`:180-197`), `dispatch` (`:199-276`) including the
   resident-vs-slot lane decision and its three result messages, `submitVerb`
   (`:310-339`). ~130 lines.
3. **Tool router** — `UI_ACTIONS` (`:480-504`), `PIPELINE_ONLY_TOOLS` (`:512-524`)
   and the 18-case `executeClaudeTool` switch (`:527-600`), which also owns
   `go_to_sleep`'s timing (`:589-596`) and the four worker-free note/answer
   tools. ~120 lines.

The router is the natural first extraction: it has one input (`name`, `args`),
no state, and it is where F4's duplication lives.

**Seam:** `createToolRouter({ isPipelineOnlyTool, getPipelineAvailable, handlers })`
where `handlers` is a plain name→function record built in wiring, so adding a
worker-free tool is a record entry rather than a switch case.

**Test:** every declared tool name (from `gemini-tools`) resolves to a handler,
and every handler name is declared — the bidirectional check the current switch
plus hand-written set cannot express.

---

## F9 — Verb fields resolved without the state they depend on

`resolveVerb(name)` defaults to `NO_PROJECT_STATE` (`verbs.mjs:537,586`), so a
function-valued field silently resolves against an empty project. Seven call
sites do this:

| site | field read | safe today because |
| --- | --- | --- |
| `run-dispatch.mjs:200` | `.label` | static |
| `run-dispatch.mjs:222` | `.stateful` | static |
| `run-dispatch.mjs:296` | `.park` | static |
| `run-stream.mjs:298` | `.speakWhileWorking` | static |
| `wiring.mjs:169` | `.spokenResult` | static |
| `session-store.mjs:92` | `.stateful` | static |
| `session-store.mjs:459-460` | **`.sessionKey`** | **not static** — `work_on_note`'s is `noteSessionKey(state)` (`verbs.mjs:122-124`) |

The last one already reads a state-dependent field with no state. It happens to
be correct only because `noteSessionKey` falls back to the bare
`"work_on_note"` string (`verbs.mjs:121`) and no other stateful verb collides
with it — an accident, not a guarantee. `verbs.mjs:608-611` explicitly warns
that `sessionKey` "is dynamic for exactly one verb today", which is the
condition that makes this a live hazard rather than a hypothetical.

**Seam:** add to `verbs.mjs`:

```js
/** Resolve only the fields that are declared state-independent; throws otherwise. */
export function resolveVerbStatic(name) { /* throws if any read field is a function */ }
```

and switch the six genuinely-static call sites to it, leaving
`session-store.mjs:459` obliged to pass state.

**Test** (`verbs.test.mjs`): for every verb, assert that each field the static
resolver serves is a non-function in the raw record — so making
`park`/`label`/`spokenResult` state-dependent in future fails the test rather
than silently defaulting at six call sites.

---

## F10 — `verbs.mjs`: table and engine in one file

`verbs.mjs:164-511` is the `VERBS` data table (348 lines, mostly prose:
descriptions, parameter schemas, persona clauses). `verbs.mjs:513-665` is the
resolution engine (`projectState`, `resolveField`, `resolveVerb`,
`resolveAllVerbs`, `defaultModelFor`) — 150 lines of pure logic.

They change for different reasons: the table changes when a verb's wording or
schema changes (frequently, and reviewed for *prose*); the engine changes when
resolution semantics change (rarely, and reviewed for *correctness*). Splitting
`verb-table.mjs` (data + the `PARK`/`MODEL_CHOICES`/skill constants) from
`verbs.mjs` (engine, re-exporting the table's public names) leaves both under
450 with a zero-behavior-change move, and makes the engine's test file
(`verbs.test.mjs`, 377 lines) legible as a test of resolution rather than of
copy.

This does **not** violate "a verb is defined in exactly one place" — the table
stays one table; only the code that reads it moves out.

---

## F11 — The verbatim announcement path is missing a status branch

`announceClaudeCompletion` frames both non-failure terminal statuses:
`LIMITED` at `announcements.mjs:205-209`, `UNANSWERED` at `:215-219` (whose
instruction is quoted almost verbatim from the spec: "nothing was chosen for
him and no default was applied").

`announceVerbatimResult` (`:253-287`) — the path taken by
`shape_on_canvas` and `work_on_note` (`verbs.mjs:209,268`; routed at
`wiring.mjs:169-177`) — frames `LIMITED` (`:278-282`) but **not** `UNANSWERED`.
A verbatim verb that finalized `unanswered` would have its raw output read
aloud with no framing at all.

Unreachable today only because of F3 (no stateful path produces `UNANSWERED`).
Fix them together, or the fix to F3 turns this latent gap into a live one.

**Seam:** one exported `statusFraming(status, runStatus)` returning the
instruction lines, consumed by both announcers. **Test:** for every member of
`TERMINAL_STATUSES`, both announcers produce framing or deliberately produce
none, asserted as a table — so a new terminal status cannot be added to
`run-queue.mjs:68-75` without both paths being considered.

---

## F12 — Comments asserting invariants the code has already broken

- `run-stream.mjs:84-91` — "at most one run … is ever mid-execution
  system-wide". False since the resident lane (F1).
- `canvas-mcp.mjs:720-728` — "runQueue's one-Claude-at-a-time guarantee makes
  this cheap". Same stale premise (F7).
- `session-store.mjs:487-491` — "a run-lifecycle call site (still in main.mjs,
  moving to run-exec.mjs in a later commit)". That move has landed;
  `persistSessionStore` is now injected into `run-exec.mjs:114,151` and
  `stateless-session.mjs:81,110`.
- `wiring.mjs:517` — stray indentation on `legacyClaudeArtifactsStatus,`
  inside the return object (cosmetic; oxlint does not flag it).

These matter more than usual in this repo, because the comments *are* the
design record — several are the only place a decision is written down.

---

## Constraint check: Electron-free modules — **PASS**

`grep -rn "from ['\"]electron['\"]\|require(['\"]electron['\"])" electron/`:

```
electron/window.mjs:6            import electron from "electron";
electron/ipc.mjs:17              import electron from "electron";
electron/renderer-security.mjs:7 import electron from "electron";
electron/main.mjs:5              import electron from "electron";
electron/preload.cjs:1           const { contextBridge, ipcRenderer } = require("electron");
electron/ipc.test.mjs:23         (test)
electron/renderer-security.test.mjs:39 (test)
```

Exactly the four permitted modules, plus the explicitly out-of-scope
`preload.cjs`. A second grep for Electron *API* names
(`ipcMain|BrowserWindow|globalShortcut|nativeImage|systemPreferences|app.isPackaged|app.getPath`)
in non-permitted modules returns three files — `canvas-mcp.mjs:7`,
`os-permissions.mjs:1-140`, `user-config.mjs:4` — and **every match is inside a
comment** explaining why the module does *not* use the API. No violation.

The constraint is also machine-enforced: `electron-graph.supply.test.mjs:29`
pins `EXPECTED_ELECTRON_DEPENDENT` to exactly those four names and asserts the
candidate count, so a new Electron import fails the suite. This is the one part
of `main-process-structure` with a real guard behind it — and, notably, the one
part that has not drifted. The line-count requirement, which has no guard, has
drifted on 11 of 12 modules in scope.

**Suggested cheapest structural win of all:** a `scripts/check-module-size.mjs`
in the same shape as `scripts/check-types-node.mjs`, listing today's oversized
modules as a explicit, shrinking allowlist. It does not fix any file, but it
converts "convention nobody checks" into "a list that can only get shorter" —
which is what made the Electron rule stick.

---

## Suggested order of work

1. **F4** (set-equality test + derived list) — one afternoon, near-zero risk.
2. **F3** (`run-outcome.mjs`) — unblocks F11 and closes the stateful
   `unanswered` gap.
3. **F1** via an OpenSpec change — it needs a spec reconciliation
   (`voice-decision-relay:20`) before code, per `CLAUDE.md`.
4. **F2**, **F8**, **F10**, **F5** — behavior-preserving moves, each landing
   with its own test file per `main-process-structure`'s "Every extracted module
   is covered by tests".
5. **F7** spec reconciliation, then the `canvas-scene.mjs` split.
6. **F6** last, on top of F1's suspend/resume rework.


---

## Parent verification (independent re-check)

I re-read the cited source for the load-bearing findings rather than accepting
them. **F1 and F3 confirmed as stated. F4 needs one correction.**

### F1 — confirmed, including the premise

The report's strength is that it checks the *premise* as well as the defect.
Both halves hold:

**The invariant is stated and is dead.** `run-stream.mjs:84-91` asserts "at most
one AskUserQuestion can be pending across the whole app." But
`run-queue.mjs:151-172` documents the resident lane existing so a turn "cannot
begin a second worker" and does not wait behind a slot job, and `verbs.mjs:319`
grants `execute` the ask tool whenever there is no open change:

```js
disallowedTools: (state) => (state.hasOpenChange ? SETTLED_WORK_ASKS_NOTHING : []),
```

So a resident turn and a slot-holding `execute` can both be asking.

**The defect is real.** `run-stream.mjs:112-114`:

```js
const timer = setTimeout(() => this.expire(), timeoutMs);
this.current = { workstreamId, questions, resolve, timer, onExpiry };
```

No `clear()`, no `settle()` of the incumbent. The contrast the report draws is
exact — `PendingReview.raise` (`run-dispatch.mjs:92-93`) does:

```js
this.clear(); // at most one pending review — a new submit supersedes silently
```

Two sibling objects, one deliberate about supersession and one not.

**One thing the report under-states.** I checked `suspend`/`resume`
(`run-queue.mjs:477-495`) and they are plain booleans:

```js
function suspend() { idleSuspended = true; ...; residentSuspended = true; ... }
function resume()  { idleSuspended = false; if (active) armIdleTimer(); ... }
```

`raise()` calls `suspend()` per question but `settle()` calls `resume()` once.
Two raises then one settle **re-arms every watchdog while a question is still
pending** — so the surviving run is now exposed to the idle watchdog it was
explicitly meant to be protected from. That is a third failure mode on top of
the two the report lists, and it is the one that turns a dropped question into a
killed run. Note `run-queue.mjs:481-483` even restates the dead invariant
("There is one pending question in the app at a time") as the *justification*
for the shared flag — the stale assumption has propagated into a second module.

### F3 — confirmed as a real behavioral asymmetry

Two independent result→status interpretations, and `unanswered` reachable on
only one, means a stateful turn whose question went unanswered is reported as
`error`. CLAUDE.md is explicit that this is forbidden: a run whose question went
unanswered is "`unanswered`, and nothing downstream may report it as a
decision." This is a code-vs-documented-invariant conflict, not a style issue.

### F4 — correction: no live drift, the finding is preventive

The report implies `PIPELINE_ONLY_TOOLS` may already disagree with the
declarations. **I diffed the two sets and they agree today.** Extracting every
`name: "…"` from `gemini-tools.mjs` and the `Set` literal from
`run-dispatch.mjs:512-524` plus `VERB_NAMES`:

- Declared but not guarded: `get_ui_context`, `control_ui`, `go_to_sleep`.
- These are **correctly** unguarded — they are voice/UI tools that must keep
  working in chat-only mode, exactly as `prepared-answers` describes
  `find_prepared_answer` as deliberately outside `PIPELINE_ONLY_TOOLS`.

So the two lists are consistent, and the omissions are intentional. F4 is
therefore a **guard against future drift**, not a bug fix — which if anything
*raises* its appeal: it is a ~10-line set-equality test with no behavior change
and no migration. But it should not be sold as fixing something broken, and the
test must encode the three deliberate exclusions as named exceptions rather than
asserting bare equality, or it will fail the moment it is written.

### Constraint check — independently agreed

The report verifies the Electron-free rule passes and observes the sharpest
structural point in this whole research: **the one rule with an automated guard
(`electron-graph.supply.test.mjs`) has not drifted, while the unguarded 450-line
ceiling has drifted on 11 of 12 modules.** That is the same conclusion the
harness report reached from the opposite direction (prose-only enforcement in
`docs/TESTING.md` rotted in both directions), and it is the strongest available
argument for the proposed size ratchet.
