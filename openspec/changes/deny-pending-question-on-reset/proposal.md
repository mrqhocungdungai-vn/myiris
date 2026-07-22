## Why

When the user resets the session while the PO is paused on an `AskUserQuestion`, `PendingQuestion.abandon` (`electron/main.mjs:172-175`) settles the question with `"timed_out"` and **`defaultPoAnswers(...)`** — the same fabricated "recommended option" the real timeout path uses. That answer flows through `onAskUserQuestion` into `canUseTool` (`electron/po-session.mjs:93-94`), which returns `{ behavior: "allow", updatedInput: { ...input, answers } }`. So the SDK receives a made-up decision and **continues the turn**.

The teardown call sites make this dangerous:

```
PendingQuestion.abandon(id);   // SDK gets a fabricated answer → continues the turn
closePoSession(id);            // tears the session down (next statement)
workstream.cwd = newCwd;       // (setWorkstreamCwd) points at a different folder
```

Between the first line and the teardown, the SDK can act on that fabricated answer — including calling a file-writing tool — **into the very folder the user just left**. This is `docs/BUGFIX_PLAN.md` BUG J: the same category error as BUG A' (conflating a deliberate reset with a normal outcome), one layer down, but with a worse blast radius because it can write to disk.

A deliberate reset should **deny** the pending question, not answer it. Denying means the SDK gets no usable decision and does not proceed to act on one; the real 5-minute timeout keeps its default-answer behavior, which is what `voice-decision-relay` actually specifies for "unanswered beyond the configured wait."

## What Changes

One bug, **one commit**.

- Settlement carries a **result descriptor** instead of a bare answers map. `answer` and `expire` settle as `{ behavior: "allow", answers }` (voice/UI answer, and the timeout default — both unchanged in effect). `abandon` (session reset) settles as `{ behavior: "deny", message }` with a distinct `"abandoned"` status.
- `canUseTool` (`po-session.mjs:88-95`) maps the descriptor: a `deny` descriptor returns `{ behavior: "deny", message }` to the SDK; an `allow` descriptor returns `{ behavior: "allow", updatedInput: { ...input, answers } }` exactly as today. This keeps the deny-vs-allow decision in `main.mjs` (which owns `PendingQuestion` and knows reset from timeout) and leaves `po-session.mjs` a thin translator.
- The single `settle()` funnel and the `runQueue.resume()` inside it (from the watchdog work) are untouched — only what each path resolves *with* changes.

Not in scope:
- The pre-existing **duplication** in `voice-decision-relay/spec.md` (two copies of "Pending questions have a safe fallback" and "Voice answer resumes the same turn"). Real, flagged in the plan, but deduplicating a spec is a separate concern from this one-bug fix. This change adds a uniquely-named requirement so it does not have to touch the duplicated ones.
- The timeout path's default-answer behavior — correct and specified; unchanged.
- BUG A / A' (done) — this builds on the same category insight but is a distinct settlement path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-decision-relay`: adds a requirement that a session reset **denies** a pending question rather than answering it with a fabricated default, so the asking role does not continue and act on a made-up decision. The existing "Session reset with a question pending" scenario only requires the callback be "settled" and the turn "torn down" — silent on this distinction, which is the gap BUG J lives in. Added as a new requirement, leaving the (duplicated) existing ones untouched.

## Impact

- `electron/main.mjs` — `PendingQuestion.answer/expire/abandon` resolve with a descriptor; `abandon` uses `deny` + `"abandoned"` status.
- `electron/po-session.mjs` — `canUseTool` translates the descriptor to the SDK `PermissionResult` (allow-with-answers or deny-with-message). The `onAskUserQuestion` contract changes from "returns answers" to "returns a descriptor."
- `voice-decision-relay` living spec — one ADDED requirement.
- No new dependency, no data migration. Relies on the same SDK `canUseTool` behavior the existing allow-path relies on; the deny path is verified manually.
