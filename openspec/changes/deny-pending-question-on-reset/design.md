## Context

`PendingQuestion` (`main.mjs:129-176`) funnels every settlement path through one `settle(status, resolvedValue)` — the funnel the watchdog's `runQueue.resume()` also lives in. Today all three paths resolve with an **answers map**:

```js
answer(answers)          { this.settle("answered",  answers); }
expire()                 { ...; this.settle("timed_out", defaultPoAnswers(this.current.questions)); }
abandon(workstreamId)    { ...; this.settle("timed_out", defaultPoAnswers(this.current.questions)); }  // ← reset uses timeout's answer
```

`canUseTool` (`po-session.mjs:88-95`) turns whatever it receives into an allow:

```js
const answers = await onAskUserQuestion(state.workstreamId, questions);
return { behavior: "allow", updatedInput: { ...input, answers } };
```

So a session reset (`abandon`, called from the three teardown sites at `main.mjs:477`, `496`, `515`, each immediately before `closePoSession`) hands the SDK a fabricated "recommended option" and lets the turn continue. In the window before `closePoSession` runs, the SDK can act on it — writing files into the just-abandoned `cwd`.

The real timeout (`expire`, "unanswered beyond the configured wait") legitimately applies the default — that is what `voice-decision-relay`'s "Pending questions have a safe fallback" specifies. The defect is that reset borrows timeout's semantics when it should deny.

## Goals / Non-Goals

**Goals:**

- A deliberate reset denies the pending question — the SDK gets no usable answer and does not act on a fabricated one.
- The timeout path is byte-for-byte unchanged (default answer + log + recorded).
- The change stays inside the one `settle()` funnel; the watchdog's `resume()` is untouched.
- The deny-vs-allow decision stays in `main.mjs`; `po-session.mjs` remains a thin translator, preserving the module split.

**Non-Goals:**

- Deduplicating `voice-decision-relay/spec.md` (two copies of two requirements). Real and flagged, but a spec-hygiene task, not this bug.
- Changing when/how `closePoSession` tears down (BUG A landed that). This change only fixes what the *question* settles with; the turn's own settlement into `CANCELLED` is BUG A's, already in place.

## Decisions

### D1 — Settlement carries a result descriptor, not a bare answers map

**Chosen:** `settle` resolves with a descriptor the SDK boundary understands:

- `answer(answers)` → `{ behavior: "allow", answers }`
- `expire()` → `{ behavior: "allow", answers: defaultPoAnswers(...) }` (timeout default, unchanged in effect)
- `abandon(id)` → `{ behavior: "deny", message: "The session was reset; this question was abandoned." }`, with status `"abandoned"`

The descriptor is the minimal shape that lets one funnel express both outcomes. `answer` and `expire` keep producing an answer; only `abandon` produces a denial. The distinct `"abandoned"` status (vs today's `"timed_out"`) is also more truthful for the UI event.

*Adding a second settle method for deny considered and rejected:* it would fork the funnel the watchdog and the once-only invariant depend on. Keeping one `settle` with a richer value preserves "every path goes through one funnel."

### D2 — `canUseTool` translates the descriptor; the contract moves from "answers" to "descriptor"

**Chosen:** `po-session.mjs`:

```js
const result = await onAskUserQuestion(state.workstreamId, questions);
if (result?.behavior === "deny") {
  return { behavior: "deny", message: result.message ?? "Question abandoned." };
}
return { behavior: "allow", updatedInput: { ...input, answers: result.answers ?? {} } };
```

The `onAskUserQuestion` contract changes from *returns an answers map* to *returns a `{ behavior, answers?, message? }` descriptor*. This is the seam that keeps the reset-vs-timeout knowledge in `main.mjs` — `po-session.mjs` never learns what a "reset" is, only how to translate allow/deny to the SDK `PermissionResult`. A defensive `?? {}` / `?? "…"` guards a malformed descriptor.

*Relies on the same SDK behavior the allow path already relies on:* `canUseTool` is the effective gate for `AskUserQuestion` even under `bypassPermissions` (po-session.mjs:84-87 documents this). A `deny` return therefore denies that specific tool call. Verified manually rather than asserted, since `main.mjs`/SDK integration is out of automated scope.

### D3 — Only `abandon` changes; the three teardown sites are untouched

The call sites already do `PendingQuestion.abandon(id); closePoSession(id);` in the right order. `abandon` denying (instead of answering) is the whole fix; no call-site edit is needed. After deny, `closePoSession` closes the channel and BUG A's `finally` settles the turn as `CANCELLED` — the two fixes compose.

Microtask ordering is not load-bearing here: `abandon()`'s `resolve(...)` schedules the `canUseTool` continuation as a microtask, so `closePoSession()` (the synchronous next statement) runs first regardless. But the safety does not depend on that ordering — a denial carries no actionable answer either way, which is precisely why deny is more robust than trying to win a race with a fabricated answer.

## Risks / Trade-offs

**The UI/HUD banner keyed on a specific status string** → today `abandon` emits `"timed_out"`; this changes it to `"abandoned"`. The banner should dismiss on any non-`"pending"` status, but this must be confirmed (a task) so the banner still clears on reset in both deck and HUD mode (the HUD requirement lists "settlement on session reset" as expected).

**A malformed descriptor** → guarded by `?? {}` (answers) and `?? "…"` (message) in `canUseTool`, so a missing field degrades to an empty-answer allow or a generic deny rather than throwing into the SDK.

**Timeout regression** → `expire` still calls `defaultPoAnswers` and logs; only its wrapper shape changes (`{behavior:"allow", answers}`). A manual check that a genuine 5-minute timeout still applies the recommended option guards it.

**Coverage** → the settlement lives in `main.mjs` and the translation in `po-session.mjs`; both are integration points with the SDK, out of automated scope (Wave 0.0 D5). Covered by the manual reset ritual in tasks. (If a future refactor extracts the descriptor mapping as a pure function, it becomes unit-testable — noted, not required here.)
