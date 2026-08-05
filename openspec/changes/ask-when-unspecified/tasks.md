> Read design.md D3 before touching the expiry path — the divergence there is the
> point of the change, not an incidental detail. No open questions.
>
> Archive `open-note-session` before this one: both delta `stateful-verb-session`,
> on different requirements, and the second to archive must re-validate against the
> merged spec (proposal.md — Ordering).

## 1. The registry declares ask-ability (design D1)

- [ ] 1.1 Make `disallowedTools` a declared field on each verb record in `electron/verbs.mjs`, resolved through `resolveField` like `skills` and `clause` — a value where it is constant, a function of project state where it is not
- [ ] 1.2 Delete the hardcoded conditional in `resolveVerb` (`verbs.mjs:412`): `record.stateful ? [] : name === "investigate" ? [...] : ["AskUserQuestion"]`. A verb's capability bound belongs on the verb, not in the resolver
- [ ] 1.3 Declare `investigate`'s list on its own record — `["AskUserQuestion", "Write", "Edit", "NotebookEdit"]` — with the reasoning that is currently a comment in the resolver
- [ ] 1.4 Declare `execute`'s as a function of state: with an open change, withhold `AskUserQuestion`; with none, do not
- [ ] 1.5 Leave every other verb's resolved list byte-identical to today's, and assert that rather than assuming it

## 2. Permission needs a listener, not just unspecified work (design D2)

- [ ] 2.1 Establish how the run path learns whether the voice layer can currently relay a question. `getLiveStatus()` on the live session is the existing source of truth; inject it rather than reading Electron or a global from `run-exec.mjs`
- [ ] 2.2 At run start, resolve the effective `disallowedTools` from **both** conditions: the verb's state-resolved list, plus withholding `AskUserQuestion` whenever nothing can relay an answer. Never offer a tool whose use would abort the run
- [ ] 2.3 Keep the existing `canUseTool` abort-with-diagnostic path (`run-exec.mjs:405-409`) for the tool-granted-then-listener-left case. It stops being a backstop and becomes the only guard against a mid-run sleep parking the execution slot forever — say so where the code says the opposite today
- [ ] 2.4 Update that block's comment: "Nobody is listening on the headless path" is no longer unconditionally true, and the code now depends on the distinction

## 3. The permitted question reaches the user (spec: "A run with no specification asks and is answered")

- [ ] 3.1 Route the permitted branch of the stateless `canUseTool` into the existing `askUserQuestionViaVoice` — no second relay, no second pending-question object
- [ ] 3.2 Confirm `runQueue.suspend()`/`resume()` behave for a headless run exactly as for a resident turn, and that the idle watchdog does not terminate a run legitimately waiting. `run-execution-queue` already specifies this run-shape-agnostically, so this is a verification task, not an implementation one
- [ ] 3.3 Verify the answer resolves the paused `canUseTool` and the same run continues — it must not restart, and must not be finalized and re-dispatched

## 4. An unanswered question on a writing run writes nothing (spec: "An unanswered question on a run that writes"; design D3)

- [ ] 4.1 Give `PendingQuestion.raise` a caller-supplied expiry policy. Do not infer it inside `run-stream.mjs` from the verb or the run — the asking caller knows, and inference is how the two policies would drift
- [ ] 4.2 Keep `po-session.mjs`'s callers on today's behavior: `expire()` resolves the recommended option via `defaultPoAnswers`. The resident path is untouched
- [ ] 4.3 For a writing run, settle expiry as a **denial** rather than an answer, reusing the shape the session-reset path already uses (`{ behavior: "deny", message }`) — not a new settlement kind
- [ ] 4.4 Finalize such a run reporting the question it could not get answered, in the user's terms. Choose the terminal status deliberately: it did not fail and it was not cancelled by the user — check whether an existing status fits before adding one
- [ ] 4.5 Ensure nothing downstream describes the outcome as a decision: the structured result, `announceClaudeCompletion`'s spoken text, and the run record appended to `inbox/runs` must none of them read as though the user chose anything
- [ ] 4.6 Verify both expiry policies still funnel through the single `settle()` (`run-stream.mjs:64`), so no future settlement path can miss `runQueue.resume()`

## 5. Prompts state what the configuration cannot (design D5)

- [ ] 5.1 Extend `execute`'s clause for the no-open-change fork: ask only where a wrong assumption would have to be undone; otherwise apply a sensible default and record it. The clause is already a function of state, so this is an edit to the existing fork
- [ ] 5.2 Leave the with-open-change fork's clause telling it to work autonomously and not to ask — that fork genuinely cannot
- [ ] 5.3 Widen the live-question prose that frames these as shaping questions: `electron/gemini-prompts.mjs:68` ("when a shaping run reaches a real fork…") and `electron/gemini-tools.mjs:129` ("The live shaping session is paused…"). A build question must not be deferred as if a shaping session were waiting
- [ ] 5.4 Have the voice layer's instruction cover the expiry difference, so Iris does not tell the user a defaulted answer was applied when the run in fact stopped

## 6. Tests

- [ ] 6.1 `resolveVerb`: `execute` withholds `AskUserQuestion` with an open change and does not without one; `investigate` withholds its four either way; every other verb's list is unchanged from today
- [ ] 6.2 The resolver holds no verb-name conditional — assert against the resolved output for all verbs, so re-introducing one fails
- [ ] 6.3 Run configuration: with no listener, `AskUserQuestion` is withheld even where the work is unspecified
- [ ] 6.4 `electron/sdk-options.test.mjs`: both of `execute`'s configurations, with the complete options key set asserted for each per the repo convention
- [ ] 6.5 A permitted question raises through the existing relay, suspends the idle bound, and the answer continues the same run
- [ ] 6.6 A question with the tool granted but the listener gone aborts with the diagnostic and releases the slot
- [ ] 6.7 Expiry on a writing run settles as a denial, supplies no answer, and finalizes without a further write
- [ ] 6.8 Expiry on the resident path still applies the recommended option — the regression guard for D3's divergence
- [ ] 6.9 The unanswered outcome's result text, announcement, and inbox record contain no claim that the user chose anything

## 7. Gates

- [ ] 7.1 `npm run build`
- [ ] 7.2 `npm test`
- [ ] 7.3 `npm run lint`
- [ ] 7.4 `npm run scan:secrets`
- [ ] 7.5 `npm run spec:check`
- [ ] 7.6 Manual pass, review mode `never`, no open change: ask for something deliberately under-specified and confirm Iris asks by voice, that answering continues the same run, and that the work reflects the answer
- [ ] 7.7 Manual pass, same setup: ask, then do not answer. Confirm the run stops, nothing was written on a guess, and what Iris says names the question rather than claiming a choice was made
- [ ] 7.8 Manual pass, with an open change: confirm the build runs to completion without asking, exactly as before
