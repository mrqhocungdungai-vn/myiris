## Context

See proposal.md — Why. What matters for the approach:

- `resolveVerb` (`electron/verbs.mjs:412`) computes `disallowedTools` from a **hardcoded conditional on the verb's name**, not from a declared field: `record.stateful ? [] : name === "investigate" ? [...] : ["AskUserQuestion"]`. It is the one part of a verb's configuration that is not read off the record and not resolvable against project state, while `skills` and `clause` on that same verb already are (`resolveField`).
- The stateless path's `canUseTool` (`run-exec.mjs:394-410`) is already the enforcement point, and it already does two different things: a withheld edit tool is denied without ending the run, while `AskUserQuestion` records `run.askViolation` and calls `abortController.abort()`. Its comment states the reason — "Nobody is listening on the headless path, so waiting here would hang the run and the single execution slot with it."
- The relay that would carry the question exists and is verb-agnostic: `askUserQuestionViaVoice` (`run-stream.mjs:241`) raises `PendingQuestion`, calls `runQueue.suspend()`, emits `SYSTEM_EVENT_PO_QUESTION` through `notifyIris`, and resolves on the voice tool, the UI channel, or its own timeout. It is currently reachable only from `po-session.mjs`'s `canUseTool`, which is a wiring fact, not a capability one.
- `PendingQuestion.settle` (`run-stream.mjs:64`) funnels every settlement path through one function and already distinguishes an answer from a denial: `answer()` resolves `{ behavior: "allow", answers }`, and the session-reset path resolves a denial precisely so a torn-down turn cannot act on a decision the user never made. The timeout path (`expire`) resolves an *answer* built from `defaultPoAnswers` — `q.options?.[0]?.label`.
- `run-execution-queue`'s "A run blocked awaiting a human is not counted as idle" is written about "the active run" with no reference to run shape, so a headless run raising a question is already inside what it specifies. No delta there.
- `execute` is `PARK.ALWAYS`, but `shouldPark` returns `false` outright when review mode is `never` (`run-dispatch.mjs:239`), so the pre-dispatch review cannot be what catches an under-specified request.

## Goals / Non-Goals

**Goals:**

- Make ask-ability a resolved property of the verb, so the registry stays the single place a verb is defined.
- Preserve, exactly, the property that actually protects the execution slot: the caller cannot choose it.
- Never let a run wait for an answer that cannot arrive — before it starts, and while it is running.
- Make the unanswered outcome on a writing run one that writes nothing and claims nothing.

**Non-Goals:**

- Making `execute` stateful, or resident. It stays one-shot; pausing is not residency.
- Widening this to `investigate`, `review`, or `finish`. See D4.
- Touching `capture_learning`. Deferred again, deliberately.
- A second question channel, a second pending-question object, or a second relay. There is one, and it is enough.
- Any change to how a *stateful* verb's questions behave. The resident path is untouched.

## Decisions

### D1. `disallowedTools` becomes a resolved field, not a name check

The mechanism this change needs already exists and is being bypassed for this one field. `resolveVerb` resolves `model`, `skills`, `mcpServers`, `structuredOutput` and `clause` through `resolveField`, which accepts a value or a function of project state — and then computes `disallowedTools` with a conditional on the verb's name.

So `execute` declares it as a function of state, `investigate` declares its list as a value, and `resolveVerb` resolves it like everything else. The name check disappears rather than gaining a third branch.

This is the point of the registry, stated in CLAUDE.md: a verb is defined in exactly one place, because three hand-wired copies is the mechanism that produced the silently-dropped `appendSystemPrompt`. A hardcoded `name === "investigate"` inside the resolver is a fourth copy in miniature — the verb's capability bound living somewhere other than the verb.

*Alternative considered:* add a separate `mayAsk` field and keep `disallowedTools` derived from it. Rejected — two fields for one fact, and the derivation would still be a conditional in the resolver. `disallowedTools` is already the enforced thing; make *it* the declared thing.

### D2. Permission is computed at run start from two conditions, and re-checked at the question

Two independent things must hold for a question to be answerable: the work must be unspecified (so asking is warranted), and a voice layer must be connected (so the answer can arrive).

The first is project state, known when the run is configured. The second is known then too — but can stop being true afterwards, because Iris can be put to sleep while a run continues. So:

- **At run start:** both conditions decide whether `AskUserQuestion` is in `disallowedTools`. If either fails, the tool is absent — the guarantee is structural, and the model is not offered something it will be punished for using.
- **At the question:** the existing `canUseTool` handler stays, and keeps its abort-with-diagnostic behavior for the case where the tool was granted and the listener has since gone. This is not belt-and-braces; it is the only thing standing between a mid-run sleep and a run waiting forever on the single execution slot.

The second condition is the more important half of this decision, because it is what makes the original code comment true rather than merely cautious. "Nobody is listening on the headless path" was a description of the wiring. Once the wiring exists, it has to become a description of reality, checked.

*Alternative considered:* grant the tool whenever the work is unspecified and rely on the runtime handler alone. Rejected — it offers the model a tool that will abort its run, and a model that tries once has already lost the run.

### D3. An unanswered question on a writing run supplies no answer

This is the decision with teeth, and it is a divergence from the resident path rather than a reuse of it.

`PendingQuestion.expire()` resolves an *answer* — the first-listed option, by the convention that the first option is the recommendation. For shaping that is defensible: the run produces a proposal the user reads before anything is acted on, so a defaulted decision is visible and reversible at no cost.

For a run that writes to the repository it is the worst available outcome. The run proceeds on a decision the user never made, and then every account of it — the structured result, the spoken announcement, the record appended to the notes inbox — is shaped as though a question had been asked and answered. The user is not merely given wrong work; they are given wrong work that reports having been confirmed.

So a writing run's expiry settles as a **denial**, not an answer, and the run finalizes reporting the question it could not get answered. The precedent is already in the codebase and already reasoned in the spec: the session-reset path settles a denial for exactly this reason — "it lets it continue the torn-down turn and act on a decision the user never made — including writing files into the project folder the user just left". This change applies that same reasoning to the same risk arriving by a different route.

Which behavior applies is a property of the asking run, so `PendingQuestion.raise` takes it from the caller rather than inferring it. `po-session.mjs`'s callers keep today's behavior with nothing to change.

*Alternative considered:* let the writing run default like shaping does, and mark the result. Rejected — a marker on a result the user may never read is not consent, and the work is already on disk by then.

*Alternative considered:* forbid the question if the user might not answer. Rejected — that is the current behavior, and it is what this change exists to fix.

**Note the symmetry with `open-note-session` D6**, which resolves the same problem for note edits by ordering the options so the first one is the no-op. Both follow one rule: *the unanswered outcome must be the one that writes nothing.* Where the question has a safe option, order it first; where it is open-ended, there is no safe option to pick, so the safe outcome is to stop.

### D4. Only the implementing verb, and only where nothing upstream settled the work

- **`execute` with an open change** — unchanged. The task list is settled, the grilling happened in shaping, and this is the long unattended path whose whole value is that the user can walk away. Granting the ask here would let a build stop for five minutes at a time waiting for someone who left.
- **`execute` with no open change** — the change. Short, ad-hoc, spoken moments ago, so the user is almost certainly still there; and nothing upstream resolved anything.
- **`investigate` and `review`** — no. Neither can write (`investigate` withholds `Write`/`Edit`/`NotebookEdit` structurally), so a wrong assumption costs a re-ask rather than a file. An ambiguous question is better answered by reporting both readings than by pausing to pick one.
- **`finish`** — no. Its input is the open change, which is settled by definition; if it is not, that is what `investigate` is for.
- **`capture_learning`** — deferred, and worth naming why rather than leaving it looking like an oversight. It has the same structural shape as the case being fixed (writes, one shot, no settled input, cannot ask) and it is the verb the user has complained about most. But it is declared `CHEAPEST` model and `light` budget precisely because it is meant to be cheap bookkeeping over text that already exists, and making it interactive changes what it is. That is its own decision with its own trade-offs, taken separately.

### D5. The prompt carries what the configuration cannot

Granting the tool decides that asking is *possible*. Nothing in a configuration can decide whether a given ambiguity is *worth* asking about — that is a judgement, and it lives in the prompt.

This is stated as a decision rather than left implicit because this repo is deliberately sceptical of prompt-level guarantees, and the distinction matters: the configuration is the guarantee that a run cannot ask when nobody can answer, and the prompt is the explanation of when asking is warranted. Conflating them in either direction is the error. The verb's clause tells it to ask only where a wrong assumption would have to be undone, and to apply and record a default otherwise — the behavior `voice-decision-relay` already requires of a run that cannot ask, now the fallback for a run that can but shouldn't.

## Risks / Trade-offs

- **A permitted run holds the execution slot while it waits** (up to `IRIS_PO_QUESTION_TIMEOUT_MS`) → Accepted on this path only, because it serves requests the user just spoke. The unattended path keeps the ask unavailable, so the walk-away property survives where it is load-bearing.
- **The model may ask too readily, turning a small request into an interrogation** → Mitigated by the clause (D5), and only by the clause. Named as a prompt-level guarantee rather than dressed up as an enforced one.
- **`disallowedTools` becoming state-dependent means `execute` has two run configurations** → `sdk-options.test.mjs` asserts each run shape's complete options key set, so both are asserted there. The key set is identical either way; only the list's contents differ, which is what the test should be checking.
- **A divergent expiry behavior is a second policy where there was one** → It is one policy with a declared parameter, resolved from the asking run rather than inferred, and both branches funnel through the existing single `settle()`. The alternative — one behavior for two risk profiles — is what the divergence exists to avoid.
- **The two changes in flight both delta `stateful-verb-session`** → Different requirements, so they coexist; but the second to archive must re-validate against the merged spec rather than today's file. Recorded in proposal.md — Ordering.
