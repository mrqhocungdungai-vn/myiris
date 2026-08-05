## Why

`execute` cannot ask, and that is enforced rather than instructed: `AskUserQuestion` sits in its `disallowedTools`, and `run-exec.mjs:405` aborts the run outright if it tries. The living spec justifies this exactly — "the implementing verb is stateless because the task list it works from is already settled — the grilling that resolves ambiguity happens in the shaping verb, before a `tasks.md` exists" (`stateful-verb-session`).

That justification covers one of `execute`'s two paths. On the other it is simply false. With no open change, the registry resolves the verb to `ORDINARY_SKILLS` and to a clause that reads "There is no open change and none is wanted: do not propose one, do not create process artifacts, and do not ask for a specification first" — and it still cannot ask. So on that path the run is given no specification, told not to ask for one, forbidden to ask anything at all, and pointed at the repository with write access for one shot.

There is no upstream grilling on that path, because there is no upstream. Nothing resolves the ambiguity, so the run resolves it by guessing and then writes the guess. That is the shape of the complaint that work comes back wrong: not a model that could have done better, but a configuration in which asking is the one thing it is structurally prevented from doing.

The gap is narrow and it is the whole point. Where a settled task list exists, not asking is correct — the answers are already in the change. Where none exists, refusing to ask is refusing the only mechanism that could have got it right.

## What Changes

- **Whether the implementing verb may ask becomes a function of project state, not a constant.** With an open change it cannot ask, exactly as today. With none, it may. This mirrors how the registry already resolves that verb's `skills` and `clause` from the same state, so it introduces no new mechanism — the ask-ability simply stops being the one property of that verb that ignores the state everything else reads.
- **The voice layer still cannot choose it.** `verb-tool-surface` forbids statefulness being selectable per call, because a run that pauses holds the single execution slot. That stays true and stays enforced: the caller supplies no such parameter, and the value is derived in the main process from state the caller does not control.
- **The ask is granted only when the answer can actually be delivered.** The existing refusal is reasoned as "nobody is listening on the headless path". That is a statement about wiring, but it becomes literally true whenever Iris is asleep — so availability is computed at run start from both conditions, and the existing fail-loudly handler is kept as the runtime backstop for a voice layer that goes away mid-run. A run must never wait for an answer nobody will give.
- **An unanswered question ends the run without writing further, and reports what it needed to know.** It SHALL NOT fall back to the recommended option the way a resident session's question does. That fallback is right for shaping, whose output the user reads before anything happens; it is wrong for a run that writes to the repository, where proceeding on an unanswered question means acting on a guess *while appearing to have consulted the user* — worse than the honest guess this change exists to remove.
- **Scope is the implementing verb alone.** `investigate` and `review` cannot write and are better served by reporting both readings than by pausing. `finish` works from a settled input, the open change. `capture_learning` is deliberately left out, continuing the scope decision taken for `open-note-session`.
- **BREAKING (behavior, spec-level):** three requirements currently state without qualification that a stateless verb never asks and that the question tool is unavailable to it. That becomes conditional, and the condition is declared rather than inferred.

## Capabilities

### Modified Capabilities

- `verb-tool-surface`: "Statefulness is a fixed, enforced property of the verb" says a verb is declared stateless and that its runs "never pause and never ask", fixed per verb. It has to distinguish the two claims it currently merges: **not selectable by the caller** (which must survive untouched, and is the actual safety property) from **constant across project state** (which is what changes). Its "A stateless verb cannot ask" scenario becomes conditional.
- `voice-decision-relay`: "A stateful verb may ask; a stateless verb cannot" is the flat form of the same rule, plus the requirement that a headless run "can never reach a state where it waits for an answer nobody is listening for" — which this change must strengthen rather than weaken, since it is now the guarantee doing real work. Its unanswered-question fallback also needs the write-path distinction above; today the timeout fallback is described as uniformly applying the recommended default.
- `stateful-verb-session`: "A stateless verb remains a one-shot headless run" carries the sentence that motivates the whole restriction — "a stateless one as a single run that never asks" and the settled-task-list justification. The run shape does not change; what changes is that the justification is scoped to the path where it holds.

## Impact

**Code**

- `electron/verbs.mjs` — `execute`'s ask-ability resolved from project state, alongside the `skills` and `clause` forks already there. `resolveVerb`'s `disallowedTools` is currently computed by a hardcoded conditional on the verb name; that becomes a resolved field like the rest.
- `electron/run-exec.mjs` — the stateless path's `canUseTool` (lines ~385-410) currently denies-and-aborts on `AskUserQuestion` unconditionally. It gains the permitted branch, routed into the existing relay, and keeps the abort as the undeliverable-answer backstop.
- `electron/run-stream.mjs` — the unanswered outcome for a write-path question. `defaultPoAnswers` (line ~221) stays as it is for the resident session; this needs a settlement that supplies no answer and lets the run finalize with a diagnostic instead.
- `electron/gemini-prompts.mjs`, `electron/gemini-tools.mjs` — both describe `SYSTEM_EVENT_PO_QUESTION` as coming from a shaping run. A question from the implementing verb arrives on the same channel and must not be framed as, or deferred like, a shaping question.
- `electron/sdk-options.test.mjs` — asserts each run shape's complete options key set; `execute` resolving to two different tool configurations means both are asserted.

**Not affected**

`run-execution-queue` needs no delta. Its "A run blocked awaiting a human is not counted as idle" requirement is written about "the active run" without reference to run shape, so a headless run raising a question is already inside what it specifies, and `runQueue.suspend()`/`resume()` already funnel through `PendingQuestion`'s single settle path.

**Ordering**

`open-note-session` also holds a `stateful-verb-session` delta — on a different requirement ("The live session's lifecycle is user-controlled" vs "A stateless verb remains a one-shot headless run"), so the two can coexist. But whichever archives second merges into a spec the first has already changed, and must be re-validated against it rather than against today's file. Archive `open-note-session` first: its delta is the older decision and its change is further along.

**Risk**

An `execute` run that asks holds the single execution slot while it waits, for up to `IRIS_PO_QUESTION_TIMEOUT_MS`. This is accepted on the no-open-change path specifically because that path serves short ad-hoc requests the user just spoke — they are, in the overwhelming case, still present. The long unattended path, implementing a change's task list, is exactly where the ask stays unavailable, so the walk-away property that makes `execute` useful is preserved where it matters.

A verb that *can* ask may ask too readily, turning small requests into interrogations. The mitigation is the prompt, not the configuration: the model is told to ask only where a wrong assumption would have to be undone, and to apply and record a default otherwise. Stated plainly because it is the one part of this change that is a prompt-level guarantee — the configuration decides whether asking is *possible*, and nothing can make it decide whether asking is *warranted*.
