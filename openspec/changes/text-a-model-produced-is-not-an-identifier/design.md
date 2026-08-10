## Context

See proposal.md — Why. The two code paths, as they stand:

- `run-stream.mjs`'s `askUserQuestionViaVoice` relays questions to Gemini as a numbered list (`${i + 1}.`), each with its `header` label, its options, and its multi-select flag. Two stable handles are already in that text.
- `answer_claude_question` (`gemini-tools.mjs`) asks for `question: "The exact question text, copied verbatim from the event."`
- `resolvePendingPoQuestion` (`run-stream.mjs:513`) builds `map[entry.question] = encodeAnswer(...)` and calls `PendingQuestion.answer(map)`, then returns `{ status: "ok" }` unconditionally.
- `po-session.mjs`'s `canUseTool` returns `{ behavior: "allow", updatedInput: { ...input, answers: result.answers ?? {} } }` — the map goes to the SDK as-is.

So a key the SDK does not recognise produces no error anywhere along that path. The tool receives a map missing that question, and the run continues.

The UI answer path does not have this problem; it answers from the rendered question objects it was given.

## Goals / Non-Goals

**Goals:**

- An answer reaches the question it was given for, without depending on a model retyping a sentence.
- A misfiled answer becomes visible instead of becoming a wrong story about the user's work.
- The ambient spool stops overstating its own reliability.

**Non-Goals:**

- Changing what the SDK receives. `po-session.mjs` still hands over an answers map keyed as the SDK expects; only how the app builds that map changes.
- Fuzzy or semantic matching of question text. The point is to stop matching on text, not to match on it more cleverly.
- Any change to expiry policy, timeout defaults, or the UI answer path.
- Changing what ambient capture retains or the consent that governs it.

## Decisions

### D1: The handle is the relayed ordinal

The relay already numbers the questions it reads out, so the voice layer has seen it, and it is short enough that a spoken interaction round-trips it without strain. `answer_claude_question` takes that number per entry.

Alternative considered: the question's `header`. Rejected — it is a topic label, not required to be unique within one relay, and two decisions about the same topic in one question set would collide.

Alternative considered: a generated id (uuid or hash). Rejected as needless: the handle only has to be unique within one pending relay, and there is at most one relay pending at a time because only one run executes globally. An opaque id would be harder for the model to carry and no more correct.

The verbatim `question` field stays in the schema as **optional corroboration**. It costs nothing, and when a mismatch is reported it is the difference between "an answer did not match" and knowing which question the voice layer thought it was answering.

### D2: The app maps handle → question text at the boundary, not the model

`resolvePendingQuestion` holds the pending questions already (`PendingQuestion.current.questions`). Given a handle it looks up that question and uses **the verb's own text** as the map key the SDK expects. The exact string the SDK asked with never leaves the main process and never has to survive a round trip through a speech model.

This is what makes the fix small: the SDK-facing contract is untouched, and the fragile hop is simply removed from the middle.

### D3: An unmatchable answer is an error the voice layer is told about

`resolvePendingPoQuestion` returns `{ status: "ok" }` no matter what it was given. It gains the ability to fail: an entry whose handle names no pending question means the relay did not land, and the right response is to say so and leave the question pending so it can be answered again.

Leaving it pending rather than settling is the load-bearing half. Settling on a partial map hands the SDK a question with no answer, and from there the verb's expiry policy either applies a default or stops the run — while the user has been told their answer was received. The `listen-window-is-bounded` family of changes has one recurring rule: never report an outcome that did not happen. This is that rule, at the answer relay.

### D4: The ambient spool's honesty is a header line, not a mechanism

`session-capture.mjs` already renders a self-describing header. It gains one clause stating the text is an automatic transcription that may be inaccurate.

Deliberately not more than that. There is no better source for continuous retention — the voice layer is not going to emit a tool call summarising every exchange, and asking it to would be the summarisation-drops-things problem all over again. The failure tolerance here is genuinely different from the one that killed meeting capture: a mishearing in a spool is caught during curation, where a mishearing read aloud to an audience is not. What was missing was not a better mechanism but an accurate label.

## Risks / Trade-offs

**The voice layer sends the old shape after the schema changes.** → The `question` field is retained and optional, so an entry carrying only text is still parseable — but it will not match, and by D3 it is reported rather than absorbed. That is the correct failure: loud, and recoverable by asking again.

**The ordinal is only meaningful within one relay.** → True, and sufficient: at most one question set is pending at a time because only one run executes globally, which the `voice-decision-relay` spec already states. If that ever stops being true, the handle has to become relay-scoped, and this decision is the place that says so.

**Making an unmatchable answer keep the question pending could hang a turn** if the voice layer repeatedly fails to match. → It cannot hang indefinitely: `PendingQuestion` already carries its own timeout and expiry policy, which this change does not touch. The worst case is that the existing fallback applies, which is what would have happened silently before — now with an error trail explaining why.

**Nothing here is testable end to end without the voice model.** → The matching, the mismatch error, and the pending-not-settled behaviour are all main-process logic over injected state, so all three are unit-testable. What cannot be tested locally is whether Gemini reliably sends the ordinal, and that is exactly why the mismatch path is loud.

## Migration Plan

No data or configuration migration. The tool schema changes shape, which takes effect on the next session's function declarations; no persisted state carries the old shape. Rollback is `git revert`.
