# Pipeline Internals

[← Back to README](../README.md) · [Architecture](ARCHITECTURE.md) · [User-facing pipeline guide](PIPELINE_GUIDE.md)

Implementation-level reference for the Gemini↔Claude bridge: how the pipeline is
detected and gated, how the verb registry defines every kind of work, how a
request is dispatched and streamed, how the voice question relay works, how
sessions and context ownership are scoped, and how billing/auth is kept on the
subscription path.

Read this before changing anything in the pipeline modules under `electron/`
(`verbs.mjs`, `pipeline-probes.mjs`, `pipeline-install.mjs`, `run-dispatch.mjs`,
`run-stream.mjs`, `run-exec.mjs`, `run-context.mjs`, `run-inbox.mjs`,
`vault-write.mjs`, `session-store.mjs`, `user-config.mjs`) or
`electron/po-session.mjs`. The
corresponding living specs are in `openspec/specs/` (`verb-tool-surface`,
`pipeline-availability`, `voice-decision-relay`, `per-verb-model-selection`,
`agent-subscription-auth`, `openspec-native-pipeline`, `run-execution-queue`,
`prompt-review-gate`, `setup-panel`) — if this doc and a spec disagree, the spec
wins and this doc needs fixing.

## The verb registry

`electron/verbs.mjs` holds **one record per verb**, and everything else derives
from it: `gemini-tools.mjs` builds the function declarations, `run-dispatch.mjs`
reads the park label, `run-exec.mjs` builds the `query()` options. A verb is
defined in one place, because three hand-wired copies of a definition is exactly
the mechanism that let `appendSystemPrompt` sit unread for months.

| verb | stateful | park | model | session |
| --- | --- | --- | --- | --- |
| `shape_requirements` | yes | on opening | Opus 5 | `stateful` |
| `shape_on_canvas` | yes *(same session)* | on opening | *(follows the live session)* | `stateful` |
| `execute` | no | **every call** | Sonnet 5 | `execute` |
| `finish` | no | **every call** | Sonnet 5 | `finish` |
| `investigate` | no | no | Sonnet 5 | `investigate` |
| `review` | no | no | Opus 5 | `review` |
| `capture_learning` | no | no | Haiku 4.5 | `capture_learning` |

Resolution is a **pure function of `(verb, project state)`** — `resolveVerb()`
takes the array `openChangesWithTasks(cwd)` returns and hands back the complete
configuration, so the whole table is assertable without booting anything. A field
may be a function where the value genuinely depends on state; `execute` is the
reason that exists (see "the fork" below).

**Iris picks the verb, per request.** There is no current role to inherit, no
chip to set, and no requirement that the user knows verbs exist. That was the
point: the previous surface forbade Gemini from choosing a role *and* told it the
brief's required shape depended on the role it could not choose.

## Two run shapes, two deliberately different mechanisms

The runtime axis is **stateful vs stateless**, and `stateful` means one thing
only: this verb's runs may pause mid-turn and ask by voice.

- **Stateful — a resident session.** A persistent
  `@anthropic-ai/claude-agent-sdk` session (`electron/po-session.mjs`) kept alive
  across turns: one continuous context window, no respawn/replay per turn. It can
  pause mid-turn via `AskUserQuestion` and get a voice answer back before
  continuing (see "Voice decision relay" below).
- **Stateless — one-shot `query()` per run**, resuming the stored session id —
  fire-and-forget, never asks.

**Statefulness is not continuity.** Every verb, stateless included, resumes its
own prior conversation via `resume`; that is what makes a follow-up request
intelligible. Conflating the two is what made "PO" and "DEV" each mean two
unrelated things at once — *who the worker is* and *how the run behaves* — when
only the second matters to the runtime.

Both stateful verbs share **one** resident session, keyed `stateful`: shaping by
voice and shaping on the canvas are the same conversation in two media, and
switching to the canvas happens precisely when talking has stopped working, which
is when the accumulated context matters most. Two consequences are declared
rather than hidden: they cannot run on different models while the session is
alive, and whichever is called first is what opens it.

## Every obligation slot settles exactly once, and within a bound

A cross-cutting invariant, identified in the 2026-07-21 architecture review after
two separate app-bricking bugs turned out to be one defect wearing two masks:

> **Any slot holding an outstanding obligation must have exactly one settle path,
> and that path must be reachable from a bounded timer.**

It has two halves, and the second is where the bugs lived. *At most once* — a
single funnel, so nothing resolves twice — is the easy half. *At least once,
within a bound* — something fires even if the party that owes the answer never
speaks again — is the half that gets forgotten, because a slot that merely leaks
looks correct in every test that exercises the happy path.

The system holds four such slots, each in its own module:

| Slot | Owner | Funnel |
| --- | --- | --- |
| A pending voice question | `PendingQuestion` (`electron/run-stream.mjs`) | `settle()` + its own timeout |
| A stateful verb's in-flight turn | `state.currentTurn` (`electron/po-session.mjs`) | settles on turn end, session end, or cancel |
| The single execution slot | `active` (`electron/run-queue.mjs`) | `finalize()`, backed by the idle watchdog |
| A parked prompt review | `electron/run-dispatch.mjs` | settle-once relay, deliberately mirroring `PendingQuestion` |

`PendingQuestion` was the first of the four to be built, and it is the reference
implementation: every settlement path (answer, expire, abandon) funnels through
one `settle()`, with a `setTimeout` as the backstop. The other three were brought
to that shape afterwards, one bug at a time.

**The invariant lives at each slot, never in a central lifecycle manager.** A
manager would have to couple `run-queue.mjs` to `po-session.mjs`, collapsing
exactly the module boundary the main-process split exists to maintain. The
authoritative per-slot requirements are in `openspec/specs/run-execution-queue/`
and `openspec/specs/prompt-review-gate/`.

Two more invariants came out of the same review. Neither is slot-shaped, and both
produced bugs that typechecked perfectly:

- **Readiness is an explicit state, never "the handle is non-null."** A field that
  is *both* the handle you send through *and* the predicate for whether sending is
  possible cannot be assigned atomically with readiness, so a buffer keyed on it
  drains at the wrong moment or never.
- **A function that invokes an injected callback must re-read state before
  reporting on it.** A synchronously-invoked callback can change the very state
  the caller is about to describe; a value computed before the call is stale by
  the time it is returned. Once-guards do not help here — the bug is in the
  return value, not in double execution.

## Pipeline availability (chat-only mode)

- `pipelineAvailable` (owned by `electron/pipeline-probes.mjs`) is the single source of truth for whether the Claude pipeline is on. Set by `probePipelineAvailability()`, and it takes **two** inputs together (`pipeline-probes.mjs`): the bundled binary answers a `--version` probe (`checkClaudeStatus().reachable`) **and** at least one credential is configured (`claudeCredentialStatus()` — `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`). The two stay deliberately distinct in what `checkClaudeHealth()` reports: `reachable` is strictly "the bundled binary launched", so the SetupPanel can tell a packaging failure apart from a user who simply has not logged in yet. `poBillingStatus()` answers a third question again — *which* credential pays for the stateful verbs; see "Subscription auth" below.
- Probed at app boot (fire-and-forget) and at the top of every `connectLive()` call (fresh connect or Live's periodic reconnect) — Live tool declarations are fixed per session, so availability flipping mid-session only changes the declared tool surface on the next (re)connect. Also re-probed by `checkClaudeHealth()`, the SetupPanel's "Check Claude" / re-check path.
- Gates three things from one flag, no separate toggles: `buildClaudeTools()` only spreads in `buildPipelineToolDeclarations()` — the eight verbs plus the control tools — when true (interface-control tools from `buildAlwaysToolDeclarations()` are always declared); `buildSystemInstructionText()` includes the pipeline paragraphs only when true, with a short chat-only alternative otherwise — one builder, not two maintained prompts; `executeClaudeTool` additionally guards `PIPELINE_ONLY_TOOLS` at call time as a defensive backstop.
- The renderer learns the value via `window.iris.getPipelineStatus()` (IPC `pipeline:status`, read at mount) and the `pipeline_availability` sidecar event (emitted only when the value changes). `App.tsx` holds it as `pipelineAvailable` state and conditionally renders Work Stream, PipelineBar, the workstream switcher (nested inside WorkStream), TaskChooser, and — inside `HudShell` via a passed-down prop — the HUD tasks column and the live-question banner.
- See `openspec/specs/pipeline-availability/spec.md` for the full requirement set.

## The delegation model (key mental model)

1. Gemini decides routing: quick facts → built-in Google Search; real work → **a
   verb** (only declared when `pipelineAvailable`, see above). Alongside the eight
   verbs it has `check_claude_status`, `get_claude_task_status`,
   `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`,
   `get_project_state`, `answer_claude_question`, `set_verb_model`, and
   `respond_to_task_review`. `submit_claude_task` survives for one release as a
   deprecated alias onto `execute`, so a Gemini session resumed mid-conversation
   does not call a tool that no longer exists.
2. Every verb dispatches through one path, `submitVerb` in `run-dispatch.mjs`:
   the brief is composed from the verb's **own parameter schema** by
   `run-context.mjs` (in declaration order, no per-verb formatting code), the
   review gate decides whether to park it, and the run is submitted. A stateless
   verb spawns a one-shot `query()` and **returns a `run_id` immediately** —
   Gemini Live function calls are synchronous, so a tool call must never block on
   long work. A stateful verb delivers the request as a new turn into the
   resident session (`getOrCreatePoSession`/`deliverPoTurn` in `po-session.mjs`),
   created on the first stateful turn in a workstream.
3. Both shapes report progress through the same projection: SDK messages are
   routed through `handleClaudeStreamMessage`, each tool call/note pushed to the
   Work Stream panel in realtime. On the terminal `result` message the final
   result is shown.
4. On completion, main injects `SYSTEM_EVENT_CLAUDE_COMPLETE` into the Gemini
   session so it proactively announces the result. Other internal events follow
   the same `SYSTEM_EVENT_*` convention (`SESSION_START`, `WORKSPACE_UPDATE`,
   `PO_QUESTION`, `TASK_REVIEW_PARKED`, `TASK_REVIEW_RESOLVED`).
5. `runQueue` still enforces "Claude does one thing at a time" globally — a
   stateful turn and a stateless run share the same execution slot and queue
   behind each other. The resident session itself is separate, independent state
   that is never touched while a turn is merely queued.

### Every dispatch records why it happened

Offering eight verbs creates more ways to select wrongly than one general tool
did. That trade is accepted deliberately, and it is only acceptable while every
selection is inspectable afterwards — so `startClaudeRun` logs the verb, its
fully resolved configuration (model, statefulness, session key, park label, skill
list), and the project state that produced it. The brief itself is deliberately
absent: it is the user's content, not diagnostics.

### `execute` forks on the project instead of refusing

`startClaudeRun` used to fail a DEV run outright when no open change had
unchecked tasks. `execute` now reads the project **at run start** (not submit
time, so a change proposed while the run sat queued is seen) and behaves
accordingly:

- an open change with unchecked tasks → the OpenSpec apply workflow, with the
  workflow skills loaded;
- no open change → ordinary work, **no** process skills, and no scaffolding —
  `ensureProjectScaffold` runs only for the stateful verbs, because a project the
  user only asked a small favour of must not acquire an `openspec/` directory.

**This removed the gate that prevented implementation without a spec.** It is a
decision, recorded in `openspec/specs/openspec-native-pipeline/spec.md`, not an
oversight: the gate's real protection was against an *unattended* run free-coding,
and that now comes from `execute` being parked for review on every dispatch. **If
the park is ever weakened, this decision must be revisited with it.**

## The review gate

`electron/user-config.mjs` owns a three-valued flag, `IRIS_PROMPT_REVIEW`:
`never` (dispatch immediately), `always` (park everything), and `verb` (the
default). The previous boolean values are still accepted and map to `always` /
`never`, so an existing configuration is not silently reinterpreted.

On `verb`, whether a request parks is a **declared property of the verb**, read
from the registry by `shouldPark()` in `run-dispatch.mjs` — never derived from the
brief's wording, which fails silently in both directions.

- `execute` and `finish` park on **every** call. Each is a fresh one-shot run that
  writes to the repository, so each call is a new risk.
- The stateful verbs park only on the call that **opens** the resident session
  (`hasLiveStatefulSession(workstreamId)` is the test). Once the user has agreed
  to a conversation, every steering turn into it dispatches directly; parking each
  turn of a live grilling conversation is friction with no safety gained, since
  the session is already alive and already spending. Once the conversation ends,
  opening a new one is reviewed again.
- `investigate`, `review`, and `capture_learning` never park.

The consent unit is therefore the **conversation** for one kind of verb and the
**run** for the other — which is exactly the difference between them. The decision
is made in the main process at dispatch and does not depend on the voice layer
honouring an instruction; the flag is not writable by voice, and a forged call
naming a review-mode mutation tool is refused.

## Voice decision relay

- A stateful run may call `AskUserQuestion` mid-turn (its persona and its system prompt say so explicitly). The SDK's `canUseTool` callback in `po-session.mjs` intercepts it and awaits an answer from `askUserQuestionViaVoice` in `run-stream.mjs`.
- **A stateless run may too, but only where nothing upstream settled the work.** `execute` with an open change cannot ask — the task list is settled, the grilling happened in shaping, and that is the long unattended path whose value is that the user can walk away. `execute` with *no* open change can: there is no upstream to have resolved anything, so withholding the question tool does not stop the run needing the answer, it makes it invent one and write the result. The permission is a resolved field of the verb (see below), never a parameter the voice layer supplies.
- **The rule is enforced, not just stated, and in both directions.** Measured: `AskUserQuestion` is only offered to the model when a `canUseTool` callback is present, and `disallowedTools` removes it even then. So `disallowedTools` *is* the guarantee — and it is declared per verb in `verbs.mjs`, resolved against project state like `skills` and `clause` (there is no verb-name conditional in `resolveVerb`). `run-exec.mjs` then narrows the resolved list by a **second, independent** condition: the injected `canRelayQuestion()` predicate (the live session's own status), so a run is never offered a tool whose answer nothing could deliver. `role-prompt.mjs` picks the run's base clause from that same effective list, so the prose can neither promise a tool the run was not given nor withhold one it was.
- The `canUseTool` handler stays in place for a run that *is* permitted to ask, because permission is granted at run start and the listener can go away while the run continues. Reaching it with no listener aborts with a diagnostic rather than waiting — that abort is the only thing between a mid-run sleep and a run parking the single execution slot forever.
- `investigate` additionally carries `Write`/`Edit`/`NotebookEdit` in that list — investigating does not modify, and that has to be structural too; a withheld edit tool is denied *without* ending the run, since the model can still answer. The prompt is the explanation of when asking is *warranted*; the configuration is the guarantee of whether it is *possible*.
- A question is relayed **without losing its shape**: its `header` (short topic label) and `multiSelect` flag both reach the voice layer and the UI. `AskUserQuestion`'s `answers` map takes one string per question with multi-select answers **comma-separated**, and every answer path — voice, click, and the timeout default — encodes through the one `encodeAnswer` in `run-stream.mjs`, so none of them can silently reduce a multi-select question to a single choice.
- `askUserQuestionViaVoice` emits `SYSTEM_EVENT_PO_QUESTION` (and a `po_question` sidecar event for the UI) and registers a single global `pendingPoQuestion` — at most one can ever be in flight, since `runQueue` allows only one run system-wide at a time.
- Two paths can answer it: the Gemini tool `answer_claude_question` (primary, voice) or `window.iris.answerPoQuestion` (secondary, UI click) via `ipcMain.handle("po:answer-question", ...)`. Whichever resolves first wins; `resolvePendingPoQuestion` is a no-op once already settled.
- **An answer names its question by NUMBER, and the app owns the mapping back to text.** The relay lists the questions numbered; `answer_claude_question` requires that number, and `resolvePendingPoQuestion` looks the question up in `PendingQuestion.current.questions` and builds the SDK's answers map from *the verb's own question text*. That string never round-trips through the voice layer. It used to: the map was keyed on the question sentence retyped by a speech model that had just read it aloud in translation, and one character off matched nothing — no error, no warning, the run proceeded as though nobody had answered. An answer whose number matches no pending question is now a reported **error**, and the question is left pending: being answered and misfiled is not the same as going unanswered.
- Unanswered after `IRIS_PO_QUESTION_TIMEOUT_MS` (default 300000ms/5min): **what that settles as is the asking caller's declared policy**, passed as `onExpiry` (`QUESTION_EXPIRY` in `run-stream.mjs`) rather than inferred from the verb or the run.
  - `RECOMMENDED_OPTION` (the default, and what every resident-session caller uses): resolves with the first-listed ("recommended") option per question, encoded in the shape the question asked for. Right where the run's output is something the user reads *before* anything happens to their files.
  - `DENY` (what a one-shot `execute` question uses): supplies **no answer at all**. The run is aborted and finalizes as `unanswered` — its own terminal status, because it did not fail and the user did not cancel it. Applying a default on a run that writes is the one outcome worse than an honest guess: the work lands on disk *and* every account of it reads as though the user had been consulted. The result text, `announceClaudeCompletion`'s spoken instruction, and the `inbox/runs` record are each asserted to claim no choice was made.
  - Both branches funnel through `PendingQuestion.settle()`, so neither can miss `runQueue.resume()`. Session reset settles a pending question as a denial too, tagged `reason: "abandoned"` so the asking run reports a cancellation rather than an absent answer.
- Tool-use permission mode stays `bypassPermissions` — only `AskUserQuestion` pauses; every other tool call auto-allows. The SDK warns that `bypassPermissions` shadows `canUseTool`; measured, it fires for `AskUserQuestion` anyway, which is what both the resident path and a permitted one-shot question depend on.
- **End-of-run decisions travel as data, not prose.** Verbs that declare `structuredOutput` use an `outputFormat` schema (`electron/run-output-format.mjs`) with a `summary` and an optional `decisions[]`. Note the trap this creates and `readRunOutput` defuses: once `outputFormat` is set, `result.result` becomes the raw **JSON string**, and that field is what finalizes a run and gets read aloud — so the speakable text must come from `structured_output.summary`. The prose `## Decisions needed` block stays as the fallback for one release. `investigate` and `capture_learning` deliberately declare **no** schema: they answer a question rather than reporting on work, and forcing a summary/decisions shape on that would reshape the answer.

## The user's own words reach the run

Gemini used to be the **only** channel through which information about a request
reached Claude: one `task` string, written by a model that had just heard the user
and was asked to summarize them. A detail dropped in that summary was gone.

`electron/run-context.mjs` attaches the recent verbatim transcript (from
`renderer-bridge.mjs`'s bounded utterance ring) to **every** verb's query, fenced
through `electron/untrusted-text.mjs`. Fencing is mandatory on both paths: the
microphone does not distinguish who is speaking near it, and being the user's own
speech is not an exemption.

What the parameters are *for* differs by statefulness, and the difference follows
from what each kind of run can do about a thin brief:

- **Stateful verbs take a thin schema** — `said` (as close to verbatim as Gemini
  can manage) plus a one-line `reading`. The model is the strongest available,
  holds the session context, and can pause to ask, so a thin brief is a starting
  point it repairs. Forcing Gemini to enumerate details here would be *worse*:
  enumeration is summarization, and summarization drops things.
- **Stateless verbs keep concrete parameters as the instruction**, with the
  transcript as background to check against. A run forbidden to ask cannot recover
  from a vague brief.

A third case used to sit above both, and it was wrong. Two verbs
(`shape_on_canvas` and `work_on_note`) could declare that the user's words
**led** the prompt: the transcript came *first* and the brief *after it*, under
"prefer it over the reading below wherever the two differ". The registry field
that declared it is gone. That inverted the two channels. Gemini Live is a
**voice-to-voice model with tool use**: it takes the audio in, reasons over it,
and emits the function call. `inputAudioTranscription` is not how it understood
anything — it is an optional side channel, opted into by one line in
`live-config.mjs`, running a separate recognizer over the same audio. Turn it
off and the model works exactly as before.

So the leading path demoted the component that actually heard the user to "the
reading", and promoted an ASR pass whose errors are **silent** over a model
whose errors are not. The call's parameters are the instruction now, for every
verb, and the transcript follows as corroboration under a label that says what
it is. Where a brief was too thin, the fix belongs in the **tool schema** — the
channel the model speaks through — which is why `said` was widened and
`spoken_by` added, rather than a second channel being told to outrank the first.

The attachment is bounded twice: the ring itself is capped by count and age, and
`boundTranscript` applies a tighter per-use cap (12 utterances / 4 000 chars,
dropping the *oldest* first). On a resumed session this block is added every turn,
so an unbounded one would grow the cost of a long conversation turn after turn.

**This narrows the bottleneck; it does not remove it.** Gemini still picks the
verb and writes the summary line.

## The canvas is a conversation, not an errand

Drawing with Iris is the one place the pipeline runs as a *dialogue* rather than
as a request and a wait, and almost everything that makes that work is policy
rather than transport. The transport was already right: `po-session.mjs` keeps a
`query()` alive across turns through a pull-based channel, residency has no idle
teardown, and the canvas MCP server survives runs. What was wrong was when a
session existed, when a turn could run, and what the user heard meanwhile.

**Opening the board opens the conversation.** Once the canvas is engaged *and*
Claude is reachable, the shaping session is warmed — scaffold, session, canvas
tools — so the first sentence is answered by an existing conversation instead of
paying to create one. Iris says the mode is open when it happens, which is what
makes warming honest rather than a hidden cost: an announced state is one the
user can hear and can close.

Both gates are re-checked, and the order they flip in is not fixed. Opening the
board while the Claude probe is still running is the ordinary case at startup,
and warming only on `canvas:activate` meant the probe finishing moments later
brought the tools up and left the conversation cold. One function
(`onCanvasBecameUsable`) does what "the canvas became usable" means — tools and
conversation — from whichever signal arrives last, and stays idempotent so a
later probe tick cannot open a second one.

**A warmed session is not a conversation that has happened**, and the difference
is load-bearing. The review gate parks on the call that *opens* a conversation
and decides that by asking whether a live session exists — so a warmed transport
answering "yes" would send the user's first sentence through unreviewed, into a
conversation they were never asked about. `po-session` carries a `warm` flag,
cleared by the first delivered turn, and two predicates read it:

| Question | Predicate | Used by |
| --- | --- | --- |
| Has the user taken part in this conversation? (consent) | `hasUsedPoSession` | the review gate |
| Is there a live session to deliver into? (mechanics) | `getPoSessionState` | the lane |

Conflating them is not academic: it left the first sentence after opening the
canvas queueing behind unrelated work, which is the half of the cost warming does
not remove.

**A turn into an open conversation is not a job.** The execution slot exists to
stop two *jobs* running at once, because two workers writing a repository is the
hazard. The next turn of an open conversation shares a context window and cannot
begin a second worker, so it takes its own lane (`runQueue.submitResident`) and
waits only for the previous turn *of its own conversation* — `deliverPoTurn`
overwrites the in-flight turn's handle, so two turns of one conversation genuinely
must not overlap. This is safe against the slot by construction: `finalize`
already guards every slot side-effect behind `active === runId`.

Two things follow that are easy to miss. The slot's idle watchdog is keyed to the
active run, so a resident turn carries **its own**, or the lane would trade
"waits too long" for "wedges unnoticed". And the canvas verb, which withheld no
tools at all while one slot made overlap impossible, now **withholds Write, Edit,
NotebookEdit and Bash** — a conversation about a whiteboard has no business
editing files beside an unrelated build. It still asks freely.

**The user hears the work, not just the result.** The worker's own prose is
spoken per block as it lands, and acts fill the gaps between. Three rules shape
the acts, each of them a correction of the obvious implementation:

- The **first** act of a turn is spoken at once; only the ones after it are
  paced at 3 s. A purely trailing throttle held the opening act — the one that
  says she has started — for the full interval, and a turn shorter than the
  interval narrated *nothing*, because finalize cancels what is still pending.
  Short turns are most of a brainstorm.
- A burst still reports its **most recent** act rather than its stalest, which
  is what the trailing edge is for. The deck is glanced at; speech is listened
  to, and a voice reporting every tool call talks over the work it narrates.
- An act is **dropped when the worker's prose just covered the same moment**. An
  assistant message carries prose and a tool call together, so "let me add three
  boxes" arrives with `add_elements`; narrating both means hearing one thing
  twice, the second time in worse words. Acts cover silence, and prose means
  there is none. Scoped per run — two conversations can be live at once, and one
  talking must not silence the other. Neither is buffered when the voice is
offline: every other `SYSTEM_EVENT_*` is a state change worth delivering late,
while running commentary replayed on reconnect becomes remarks about work that
finished minutes ago. `includePartialMessages` stays declined — an `assistant`
message already arrives complete several times per turn, which is the same
property at the granularity of a thought rather than a token.

**The result is read out whole**, not summarized, for verbs declaring
`spokenResult: "verbatim"`. That began as `work_on_note`'s private path and is a
registry field now, because the announcement layer had become a second place a
verb was defined. Two verbs, two reasons: a note in précis is not the note, and a
summary of an answer in a brainstorm the user watched happen is a worse answer —
and what Iris speaks is also what she reasons from next turn, so summarizing
compounds.

**Iris's own job changes while the canvas is open.** Everywhere else she *routes*
— picks a verb, writes a brief, with editorial licence over what was said. Here
she *carries*: the words through unchanged and promptly, the answer back in full.
That is a voice instruction (the canvas capability's `promptFragment`, present
only while the canvas is engaged), not a Claude skill — describing one agent's job
in another agent's briefing is the mistake it avoids.

**Speaking over Iris ends the turn, not the conversation** — `interrupt()`, never
`abort`, so the context window and everything already drawn survive.

Two decisions are on the diagnostic log, because neither is visible from outside
the process and both decide how the feature feels: whether a conversation was
warmed before the first turn, and which lane a stateful turn took.

## The shared focus reaches the run beside the transcript

The second-brain galaxy is the one surface where the voice is blind: it has no
idea which note the user is pointing at. `second-brain-focus` fixes this with
one main-owned focus — the set of vault notes currently selected in the
galaxy (by a pinch-tap or a modifier-click), produced by the renderer and read
by both the voice layer and a run.

`electron/focus.mjs` holds the pure state (`{ ids, at }`, bounded, with
`toggle`/`set`/`clear` and `resolve(focus, graph)`); the one instance lives in
`electron/capabilities/second-brain.mjs`, resolved against whatever graph the
galaxy watcher last saw. `electron/run-context.mjs`'s `buildRunPrompt` composes
one more fenced block beside the transcript — ids, titles, and tags only,
never a note's body — using the exact same `untrusted-text.mjs` mechanism,
because a note's title can originate from the web (`wiki-ingest`) just as
readily as the transcript can carry a second voice in the room. No verb
declares a parameter for it: it arrives purely by composition, so a future
verb cannot start re-declaring it (the one grandfathered exception is
`capture_learning`'s own pre-existing `focus` string, which predates this
mechanism and means something broader — "what to concentrate on").

The voice layer's own system instruction is built once per Live connect, not
per turn, so a fact that changes as often as a gesture selection needs a
second delivery path: `announceFocusUpdate()` pushes a `SYSTEM_EVENT_FOCUS_UPDATE`
(mirroring `announceWorkspaceUpdate()`'s identical staleness fix for workspace
state) on every toggle/clear, including "nothing is focused now" so a stale
referent is never left standing after the selection changes or the galaxy
closes.

## One system-prompt policy, one budget policy

Both run shapes route through the same two modules, for the same reason
`worker-env.mjs` exists: a policy each implements at its own call site is a policy
that will drift.

- **`electron/role-prompt.mjs`** composes `base + clause`. The base is the one
  documented statefulness clause (may pause and ask / cannot); the clause is the
  verb's own one-line job, declared in the registry. **No call site builds prompt
  text**, and a test asserts that stripping the clauses leaves two identical
  strings.
  - It emits `systemPrompt: { type: "preset", preset: "claude_code", append }` —
    **the only delivery mechanism the SDK reads.** The resident session previously
    carried its live-session instruction on a top-level `appendSystemPrompt`,
    which is not a declared field and was silently discarded, so it ran with no
    base prompt at all while the one-shot path got a full one. See
    `docs/REFERENCE.md` for the measurement.
  - Caveat that is invisible at the call site: on a run with `agent` set — every
    verb run — the definition's prompt replaces the base, so the `claude_code`
    preset half is dropped and only `append` survives. The persona body *is* the
    base prompt.
  - The shared stateful session sets its system prompt **once, when it opens**, so
    the clause baked in is whichever verb opened it. Each turn therefore also
    carries its own verb's clause in the turn prompt — a session opened by voice
    must still be told, on the turn that moves to the canvas, that this turn is
    canvas work.
- **`electron/run-budget.mjs`** gives every run a turn ceiling and a spend
  ceiling (`maxTurns`, `maxBudgetUsd`), overridable by `IRIS_CLAUDE_MAX_TURNS` /
  `IRIS_CLAUDE_MAX_BUDGET_USD`. The profile is a declared property of the verb:
  `stateful` (150 / $6), `worker` (150 / $5, for `execute` and `finish`), `light`
  (60 / $2, for the three that read rather than build). Defaults come from
  measurement, not intuition: a representative propose turn took **28 turns /
  $0.97**, an implementation run **29 turns / $0.78**, both on a small real
  project. Ceilings sit at ~4–6× that, because **a cap that fires during ordinary
  work gets switched off**, which is worse than no cap. Note what the measurement
  overturned: shaping is *not* the cheaper work.
  - A run that hits a ceiling finalizes as its own terminal status, `limited` —
    **not** `failed` — with a message naming which ceiling, its value, and the
    env var that raises it. A run that hit a limit and a run that broke need
    different responses from the user.
  - Cost is **recorded, never estimated**: `total_cost_usd`, `usage`,
    `modelUsage`, and `num_turns` are captured off the result message onto the
    run, projected on `claude_task_update`, shown on the run card, and answerable
    by voice through `get_claude_task_status`. `modelUsage` matters because a run
    that used subagents spends on more than one model — both measured runs
    carried two.

## Hooks: the guard and the authoritative tool boundary

`electron/run-hooks.mjs` installs the same five callbacks on both roles.
`parseClaudeStreamMessage` deliberately **stays** — hooks are an additional,
authoritative source, not a replacement, so `pushToolStart`/`pushToolEnd` keep
their signatures and the deck is untouched.

- **`PreToolUse` — the guard, and only the guard.** Two jobs, kept narrow so it
  stays reviewable: a one-shot warning when the run crosses a fraction of its
  spend ceiling (`IRIS_CLAUDE_BUDGET_WARN_FRACTION`, default 0.75), and a small
  explicit denylist for obviously destructive commands (`rm -rf` rooted outside
  the working directory, force-push, hard reset onto a remote). Relative deletes
  are deliberately allowed — a run cleaning up its own build output is ordinary
  work.
  - **This is a guardrail against accidents, not a sandbox, and Iris must not
    describe it as one anywhere.** `bypassPermissions` remains the intentional
    default because no interactive approval exists on the headless path; a
    determined or confused model can reach the same effect another way.
  - The in-flight spend figure comes from the SDK's
    `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` — the only
    live source there is, since everything else arrives once the run is over.
    Verified working, but experimental by declaration, so it degrades to
    **silence**: no figure means no warning, never an exception and never a
    number Iris made up.
- **`PostToolUse` / `PostToolUseFailure`** are the authoritative tool-end
  boundary and error flag. The old inference read `is_error` off a `tool_result`
  block, which cannot tell a tool that *failed* from one that completed and
  returned an error-shaped payload.
- **`PreCompact`** makes a compaction visible. It is otherwise a silent
  multi-second pause that reads as a stall, and a user who thinks a run has hung
  stops it.
- **`Notification`** surfaces runtime state that would otherwise never reach the
  user.

Also captured per run: the subprocess's **stderr**, buffered to the last 20 lines
and attached to a failed run's output. A transport failure used to reach the user
as one message with nothing behind it.

## Sessions, workstreams, and context ownership

- Context is **user-controlled**. Each "workstream" (session) has a project folder (`cwd`). Every verb keeps its **own** continuous conversation within a workstream, resumed on each run — except the two shaping verbs, which deliberately share one. Tasks run **one at a time** (queued if Claude is busy) — see `runQueue` above.
- Sessions never reset on their own — only on explicit user action (New button, voice "new session", or picking a different project folder; Claude scopes conversations per directory). Persisted to `~/.myiris/claude-sessions.json`. Each of these actions also closes any resident session bound to the workstream/cwd being left (`closePoSession`) so no subprocess is orphaned.
- **Migrating a pre-verb store discards nothing.** On load, `agent_sessions.po` → `stateful`; `dev` and `default` both map to `execute`, with the old `last_agent_used` deciding which wins and the loser retained under `execute__superseded` rather than deleted. `agent_models.po` carries onto the shaping verbs and `.dev` onto the rest, because a stored model choice is about the *kind* of work. `active_agent` is dropped — a workstream no longer has a current role. The migration is idempotent, and `CLAUDE.md` promises a context reset only when the user asks: an app upgrade is not the user asking.
- Default Claude working dir is `~/.myiris/workspace` (override `IRIS_CLAUDE_CWD`).
- **A dead resume id is detected before the run, not after it fails.** `electron/run-sessions.mjs` asks `getSessionInfo()` up front; a session the runtime does not know about is dropped and the run starts fresh. This replaced a regex over the SDK's error string, which could only run *after* a run had already failed. It reports "dead" only on a positive answer — an inconclusive probe keeps the id, because discarding a live conversation is far worse than one failed run.
- **Both helpers pin `CLAUDE_CONFIG_DIR` for the call and restore it after.** This is not incidental: measured with the variable unset, `listSessions()` returned **32 of the user's own Claude Code sessions** out of `~/.claude` — the exact boundary Iris must never cross — and would have found none of Iris's own.
- Sessions are **named** after their workstream (`Label · Build`), via `Options.title` for a new session and `renameSession()` for one that already exists. Every session Iris created used to carry an auto-generated title.
- The notes vault is **granted**, not described: `capture_learning` gets it through `additionalDirectories`, and it is the only verb that does. The prose directive that used to stand in for a grant, and the post-hoc `[vault-check: …]` caveat derived from diffing the vault afterwards, are both gone.
- **Cancellation is lifetime-agnostic.** Every run carries a `cancel`, so `runQueue.stop()` does not need to know whether it is stopping a one-shot query (abort its controller) or a turn inside a resident session (`interrupt()` the turn, keep the session and its context window). An interrupt reports which queued work **survived** it, and Iris says so rather than claiming something was cancelled when it will still run.

## The vault write path, the run inbox, and the second brain

Nothing used to be learned from what happened: runs succeeded and failed, and the
second brain — which ships six `wiki-*` skills and exists precisely to accumulate
knowledge — never saw any of it. And capturing the user's own thoughts used to be
modelled as a Claude run (`capture_learning`), so it cost seconds of latency and
tokens, and was **unavailable without a Claude credential**.

- **One module owns writing to the vault: `electron/vault-write.mjs`.**
  Electron-free, injected `fs`, never throws. It exposes a synchronous spool
  append (`appendSpoolRecordSync`, for the run-finalize path, which cannot
  await anything), an async spool append (`appendSpoolRecord`, for the capture
  tool, whose reply to Gemini must reflect what the filesystem actually did),
  and an atomic, title-sanitized note-page writer (`createNotePage`) for
  curated pages. `electron/run-inbox.mjs` no longer writes on its own; it owns
  only the run record's *shape* (`renderInboxRecord`) and calls into
  `vault-write.mjs` for the write — two independent writers into the same
  directory is how a folder ended up missing from the galaxy's user-note
  exclusion in the first place.
- **Three spools, one write path.** `~/iris-second-brain/inbox/runs/` gets one
  dated-file record per finished run (verb, request, result, cost, error, the
  tools it used); `~/iris-second-brain/inbox/captures/` gets one dated-file
  record per voice capture; `~/iris-second-brain/inbox/sessions/` gets the
  opt-in ambient session capture's flushed conversation text (see below). All
  three are plain markdown, all three are excluded from the vault graph as
  machine-written plumbing (`NOTES_PLUMBING_FOLDERS` in
  `electron/vault-graph-parse.mjs` includes `inbox`), and all three are read by
  `capture_learning`'s clause, which names all three directories explicitly —
  a fresh capture (or a recent conversation) must be findable in the same turn
  a curator run reads the vault, and that only holds if the run is actually
  told to look there.
- **Capture is a direct write, not a run, and it is not gated on the
  pipeline.** The second-brain capability declares a `capture_note` tool
  (params: `text` required, `title`/`tags` optional) whose handler calls
  `ensureNotesVaultReady()` then `appendSpoolRecord()` and returns the real
  filesystem outcome — no run is started, no tokens are spent, and the single
  execution slot is never held. `gemini-tools.mjs` concatenates every
  capability's `toolDeclarations` **outside** the `pipelineAvailable` gate, so
  `capture_note` is declared even in chat-only mode; `run-dispatch.mjs`
  dispatches it outside `PIPELINE_ONLY_TOOLS` for the same reason. Both
  **failures are recorded/reported on the same terms as successes** — a failed
  attempt (or a failed capture) is at least as worth keeping/reporting as a
  successful one, and a capture whose write fails is reported as failed, never
  as saved.
- **Finding a note by name is a direct read, on exactly those terms.** The same
  capability declares `find_note_by_name` (params: `name` required, `open`
  optional), dispatched outside `PIPELINE_ONLY_TOOLS` beside `capture_note` for
  the identical reason read the other way round: comparing what the user said
  against a list of titles needs no model, so routing it through a worker would
  make the cheapest question the second brain can answer the slowest, the only
  one that could fail for reasons unrelated to the vault, and the only one a
  user without a Claude credential could not ask.
  - **The matcher is `electron/note-name-match.mjs`** — pure, Electron-free, and
    the *only* implementation. The galaxy's typed find field reads it over
    `secondbrain:find-notes`; the spoken lookup calls it through the dispatch.
    One matcher is what makes "spoken and typed searches agree" structural
    rather than aspirational, and it has to live in main regardless because the
    lookup answers with the galaxy closed, where there is no renderer state.
  - **Always a fresh `getGraph()`, never the cached copy.** The vault watcher is
    scoped to galaxy-active, so with the galaxy shut nothing keeps a copy
    current — and on a cold session that copy is the empty initial graph, so a
    cached read would answer "no matches" for an entire vault. The scan also
    primes `vault-graph`'s cache, which is what lets a note found this way then
    be *opened* (`resolveNotePath` reads that cache).
  - **The boundary against `capture_learning` is declared, not just described.**
    The parameter is `name` (not `query`/`subject`), the declaration states the
    negative case and names the verb as the alternative, and the prompt fragment
    says when to use which — in that order of strength. "Find my note about X"
    and "what do my notes say about X" are one word apart and route to
    completely different machinery, and the mistake is not symmetrical.
  - Matches reach the rail on the capability's **own** channel
    (`secondbrain:name-matches`), never `iris:ui-action` — `voice-ui-control`
    enumerates a fixed vocabulary that is not about the second brain. Same for
    `secondbrain:open-note`, which activates the galaxy as part of opening a
    named note (the reader does not exist outside that layer) and is
    deliberately not a spoken galaxy toggle.
- Recording a run outcome is **not conditional on the voice layer** choosing to
  record something. Accumulated knowledge that requires a model to remember to
  save it is knowledge that will be lost.
- **Curation is the deliberate step, and it is what `capture_learning` is now
  for.** It reads both spools and runs the crystallize/integrate skills when
  called — weaving accumulated captures and run records into linked wiki pages,
  or writing something up as a page on explicit request (the `save` parameter).
  It still requires the Claude pipeline, since curation and retrieval are real
  judgement, not a filesystem append. Iris may *offer* it once the backlog is
  worth processing (the second-brain capability's prompt fragment counts
  records across all three spools), and never starts it unprompted.

## What Iris retains, and ambient session capture

Beyond the run/capture spools above, Iris can retain a **text** transcript of
ordinary conversation — never audio — so the second brain accumulates from what
the user already talks about, not only from deliberate captures. This is the
only mechanism in Iris that writes what was said near the microphone to disk,
so it is **opt-in, default off, and reviewed as its own thing**
(`ambient-session-capture` capability spec has the authoritative behavior;
this is the mechanism behind it).

- **`electron/session-capture.mjs`** owns the policy: the enabled flag, a
  per-session watermark, and the room-transcript rendering. Electron-free,
  injected `fs`/clock, never throws. It knows nothing about *why* it is
  enabled — the fail-closed gate lives entirely in its callers.
- **The gate fails closed by construction.** `electron/capabilities/
  second-brain.mjs` holds the actual enabled flag, defaulted to **off on every
  launch**, and it only ever goes live when BOTH the renderer's persisted
  preference (`ambient-capture:set-enabled`, mirrored from `localStorage` like
  every sibling device preference) AND Iris being awake (main's own
  `setAmbientCaptureAwake`, driven by the Live session's `onopen`/explicit-stop/
  reconnect-exhausted hooks — never a renderer signal) are both true.
  `IRIS_AMBIENT_CAPTURE=off` can additionally force it off and hide the
  toggle; there is deliberately no variable that force-*enables* it.
- **What is captured is exactly what the utterance ring already holds** — the
  same `recentUtterances()` every run's prompt already reads (see "The user's
  own words reach the run" above) — spooled progressively on a timer, on sleep,
  and on quit, watermarked so a flush never duplicates and a crash loses only
  what happened since the last flush. Enabling mid-conversation does NOT sweep
  up what the ring already held — the watermark starts at the enable moment.
- **The spool is self-describing.** Each flushed block is headed as a verbatim
  microphone record with its time span, entries as quoted lines — a reader (and
  a curator run) can tell it apart from an authored note at a glance.
  `capture_learning`'s clause now names `inbox/sessions` alongside the other
  two spools, and explicitly weighs it as untrusted recollection rather than
  the user's own assertion, since the microphone does not distinguish who was
  speaking.
- **The interface indicates it whenever it is actually live**, with a stop
  affordance right there — a preference agreed to once is not standing
  consent for an indefinite, unindicated microphone log.

## Skills, commands, and isolation from the user's Claude Code

- The skills the personas invoke (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`, the OpenSpec workflow skills, the LLM-Wiki skills) and the `/opsx` commands ship inside the app as a Claude Code **plugin** at `resources/iris-plugin/`, passed to every run through the SDK's `plugins` option (`{ type: "local", path, skipMcpDiscovery: true }`).
- Everything the plugin provides is **namespaced by the plugin name**: skills are `iris:grilling`, `iris:openspec-propose`, …; commands are `/iris:opsx:apply`, `/iris:opsx:archive`, …. The persona prompts reference those exact names.
- **A run sees only the skills its own work needs, declared by its verb.** Both roles used to pass `skills: "all"`, so the implementation path could invoke `iris:grilling` and the shaping path could reach the `wiki-*` suite. `electron/run-skills.mjs` holds the lists — named for the *work*, with each entry justified by a skill the persona or the plugin's own cross-references actually invokes — and the registry binds one to each verb. **This scoping is the substance of the verb surface**: without bounded capability surfaces, eight verbs would be eight names for one agent. Measured, this is a real context filter, not a label: identical prompt, total input tokens — `"all"` (17 skills) 18 007, a two-skill list 16 056, `[]` 15 934. Plugin-qualified (`iris:grilling`) and bare (`grilling`) names behave identically; qualified is used so the list and the persona diff against each other by eye. Per the SDK's own wording this is **a context filter, not a sandbox**: unlisted skills are hidden from the model and rejected by the Skill tool, but their files stay readable via Read/Bash.
- `settingSources` is `["project"]`: the user's **`~/.claude` is never read**, so Iris neither depends on nor is perturbed by whatever they have installed in their own Claude Code. The working repository's `.claude/` is still loaded, which is what makes a project-local `.claude/agents/iris-<base>.md` override work.
- `skipMcpDiscovery` is set because Iris owns its own MCP wiring (the canvas server arrives via `mcpServers`); the plugin must not open connections of its own.
- **`settingSources` is not sufficient on its own**, and this is the part that is easy to get wrong. A few filesystem inputs are read and written *regardless* of it: the session transcript of every run, the always-read global `.claude.json`, and auto-memory. They all resolve under `CLAUDE_CONFIG_DIR`. So `computeClaudeWorkerEnv` (`electron/worker-env.mjs`) pins that variable to **`~/.myiris/claude-home`** for every run and sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Measured before this existed: one run against the default workspace left a 57 KB transcript in the user's `~/.claude/projects/`. The directory has to be **stable** (not a temp dir) because a resumed session must find the transcript an earlier run wrote; the CLI creates it, and its own `.claude.json` inside it, on first use.
- Deliberately **not** overridable by an environment variable — the only interesting value to point it at is the user's `~/.claude`, which is what this prevents. Tests inject it through `computeClaudeWorkerEnv`'s second argument.
- **Consequence: the host Claude Code login is no longer reachable.** Before the pin, a run on a machine with an interactively logged-in Claude Code authenticated from that keychain entry *even with no credential in the environment* — so the app silently depended on the user's own install, and a developer machine could not reveal the failure a credential-less machine would hit. `PATH=/nonexistent` does not simulate this: it hides binaries, not the credential store. A credential must now come from the environment, which is exactly what the availability gate checks.
- Nothing is installed into `~/.claude`. Older Iris versions did copy skills, commands, and personas there — and, before the config-dir pin, wrote run transcripts into `~/.claude/projects/`. Settings offers a one-click removal of exactly those paths and nothing else. Transcript directories keyed by a **real project path** are deliberately excluded from that cleanup: Iris's runs and the user's own Claude Code sessions for the same project land in the same directory, so removing it would delete the user's history. Only the directory for Iris's own scratch workspace is safely attributable.

## Personas, OpenSpec, and the bundled prerequisites

- There are **two** personas, named for the property that actually differs at runtime: `resources/personas/stateful.md` and `stateless.md`. They were `iris-po.md` and `iris-dev.md`; naming them after job titles bundled *who the worker is* with *how the run behaves*, and only the second is real. They are parsed into the SDK's `AgentDefinition` (`electron/agent-definitions.mjs`) and passed to `query()` **by value** via `agents: { "iris-<base>": … }` + `agent: "iris-<base>"` — nothing is installed into `~/.claude/agents`. A project-local `.claude/agents/iris-<base>.md` still wins, since `settingSources` keeps the `project` scope; the override keeps the `iris-` prefix because it sits in a directory shared with the user's own agents, while the bundled file does not need one.
- The personas describe **behaviour, not skill names**, because one persona serves several verbs with different skill lists — naming `iris:tdd` in the stateless body would tell `investigate` to invoke a skill it cannot see. What each verb is *for* comes from its registry clause; what it may *reach* comes from its skill list. A test asserts that any `iris:*` name appearing in a persona is available to every verb using it.
- **The pipeline runs on OpenSpec — it is the single SDD surface (no `.scratch/` PRD).** `shape_requirements` grills the request (the `grilling` skill; questions surface via the `AskUserQuestion` voice relay), then runs the OpenSpec propose flow to create `openspec/changes/<name>/` with a `tasks.md`. `execute` implements the remaining unchecked tasks of an open change (`openspec-apply-change` + `tdd`, verifying itself with `code-review`); `finish` closes the change out and archives it to sync `openspec/specs/`. Stateless verbs never ask — they record "Decisions needed" that Iris reads aloud at run end.
- **The ordering survives; the requirement that the *user* enforce it does not.** Work that goes through the process is still specified before it is implemented, but that follows from the project's own state, which `execute` reads at dispatch — not from a user naming a worker or operating a control.
- The first shaping run in a fresh project makes it OpenSpec-ready via `ensureProjectScaffold` → `openspec init <cwd> --tools claude` (non-interactive; no-op if `openspec/` already exists). The `openspec` CLI ships with the app (`@fission-ai/openspec`): `openspecCommand()` returns a command spec that runs it through Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), since it is a JS entry point rather than a native executable.
- **No prerequisite installer.** `resources/iris-plugin/` vendors snapshots of the required third-party skills (mattpocock's `grilling`/`tdd`/`code-review`/`diagnosing-bugs`, plus the OpenSpec-generated skills + `/opsx` commands — see `resources/iris-plugin/ATTRIBUTION.md` for sources/versions/refresh steps) and ships them as a plugin, so there is nothing to install and no install step to skip. `checkSkillsStatus()` verifies the **bundle** is intact rather than checking the machine, and backs the SetupPanel's "Bundled / Damaged" row. What remains of the old installer is its inverse: `legacyClaudeArtifactsStatus()` / `removeLegacyClaudeArtifacts()` (IPC `pipeline:legacy-artifacts` / `pipeline:remove-legacy-artifacts`) report and, on an explicit click, remove what *older* Iris versions wrote into `~/.claude` — including the retired `iris-po.md` / `iris-dev.md` personas.
- **Per-verb model choice.** Each workstream stores an `agent_models` map keyed by verb, beside `agent_sessions`. Resolution order: workstream choice → the persona group's env default (`IRIS_STATEFUL_MODEL` / `IRIS_STATELESS_MODEL`, with `IRIS_PO_MODEL` / `IRIS_DEV_MODEL` still accepted as aliases) → the verb's own registry default. Model is resolved at **run start**, not submit time, so a change made while a task is queued still applies. A stateless run gets it via SDK `options.model`; the resident session gets it at creation and via `query.setModel()` on an already-live session (context preserved, no resume/respawn). No automatic fallback — an unavailable model fails the run loudly. Set from the UI or by voice (`set_verb_model`) — both funnel through the same `setVerbModel()` in `electron/session-store.mjs`. **Because the two shaping verbs share a live session they cannot run on different models while it is alive**, so a change to either is written to both and the reply says so, rather than appearing to change one and silently changing the other.

## Subscription auth (stateful verbs only)

- Runs do **not** inherit the interactive `claude` `/login` session — and since the config-dir pin (above) that is now enforced rather than merely assumed. A run authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (generate once with `claude setup-token`, pointed at Iris's own bundled binary) so usage bills against the subscription, or via `ANTHROPIC_API_KEY` for metered billing.
- `computeClaudeWorkerEnv` (in `worker-env.mjs`) strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` whenever a subscription token is present — `ANTHROPIC_API_KEY` outranks the OAuth token in the SDK's own auth precedence, so a stray key left in `.env` would otherwise silently switch usage to per-token API billing. With no token it is left in place as the only credential an API-key-only user has. This is a **single policy for both run shapes** (`computePoSessionEnv` is a thin alias of it), so they cannot drift apart.
- `logPoBillingPathOnce()` logs which path is active at startup; `poBillingStatus()` gates `startStatefulRun` with an actionable error if no token is configured. The stateless verbs are unaffected.
- The token is settable from the app: SetupPanel's Claude section (always shown — the binary ships with the app, so a missing credential is the only thing a user can actually lack) has a masked field plus Save/Remove, routed through `savePoToken()` in `electron/user-config.mjs` (IPC `config:save-po-token` / `config:remove-po-token`). It writes the same `.env` as every other setting, which is the only editable location in a packaged build (`~/.myiris/.env`). Two rules make this safe: the value never reaches the renderer (`getFullConfig()` exposes only `poTokenSet`, and an empty token in an ordinary `config:save` is ignored via `KEEP_ON_EMPTY_CONFIG_KEYS` so the global Save can't blank it), and because `computePoSessionEnv` snapshots the environment at session creation, a token change calls `closeAllPoSessions()` — stored session ids are kept, so the next stateful turn resumes the same conversation with the new credential. A change is refused while a turn is `RUNNING`. See `openspec/specs/setup-panel/` and `agent-subscription-auth/`.
