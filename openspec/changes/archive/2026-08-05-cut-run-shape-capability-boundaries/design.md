## Context

`po-live-session` was written when PO and DEV were two roles, and it specified
everything about PO: how its session lived, how its turns queued, how its turns
finalized. `run-execution-queue` was written to own the single execution slot, and
grew the finalization and cancellation contract for every run. The two met in the
middle, and nobody removed the seam.

Renaming the capability to `stateful-verb-session` made the vocabulary honest
without moving the seam. This change moves it.

## Goals / Non-Goals

**Goals**

- Every rule about the two run shapes is stated in exactly one capability.
- A reader asking "who owns the resident session / the slot / the verb?" gets one
  answer per question.
- No rule is lost in the move.

**Non-Goals**

- Any behavior change. This is a re-partition of text over a code path that is
  already unified.
- Merging `stateful-verb-session` into `verb-tool-surface`. The session is a
  mechanism with its own lifecycle and failure modes; the verb surface is a
  registry. One capability for both would be the same over-collapse in the other
  direction.
- The skill-scoping overlap (see proposal's Impact). Deferred with a reason.
- Renaming `run-execution-queue` or `verb-tool-surface`.

## Decisions

### D1 — The queue owns cancellation, the session owns session-end

The duplicated rule is about what a *caller* gets when it stops a run: one path,
regardless of lifetime. That is the queue's contract — the queue holds the slot,
routes the stop, and finalizes. Placing it in `stateful-verb-session` also implies
the session is the authority on cancelling, which it is not: `run-queue.mjs`
delegates the actual kill to an injected hook precisely so it holds no
transport-specific knowledge.

What is genuinely session-specific survives in `stateful-verb-session`: **a turn
must not be left waiting when its session ends.** That failure has no analogue in a
one-shot run — it is the bug that bricked the app when a stream ended without
throwing — and it is a property of session lifetime, not of the slot.

### D2 — The shared-session rule moves to the session capability, not the reverse

Two candidate homes. `verb-tool-surface` could keep it on the grounds that "which
verbs share a session" is a registry fact — and indeed `verbs.mjs` declares the
session key. But the requirement's substance is what *happens* as a result:
context carries across a medium switch, and the model cannot differ while the
session is alive. Those are session mechanics.

`verb-tool-surface` keeps the declaration ("statefulness is fixed per verb"); the
session capability keeps the consequences. The registry declares; the mechanism
specifies.

### D3 — `verb-tool-surface`'s statefulness requirement is left alone

It contains one sentence reaching into queue territory: *"because a run that pauses
holds the single execution slot while it waits."* That is a justification, not a
requirement, and removing it would make the rule read as arbitrary. Cross-capability
*rationale* is healthy; cross-capability *SHALL* is the problem. Left as-is
deliberately, so the next reader does not "fix" it.

### D4 — Retitle rather than rewrite the queue's cancellation requirement

"Both roles cancel through one path" needs a new title because roles are gone, and
the body needs "a resident session and a one-shot run" to stay as the two shapes —
which it already says. So this is a retitle plus a noun, not a rewrite. Keeping the
body intact matters: it is the surviving copy of a rule that existed twice, and
rewording it during a de-duplication is how the surviving copy quietly changes
meaning.

### D5 — Verify the move by counting rules, not by reading for vibes

Before and after, enumerate every `SHALL` across the three capabilities. The set
must be identical; only its distribution changes. A de-duplication that also drops
a rule is indistinguishable from a successful one when reviewed by eye — this is
the same reason `sdk-options.test.mjs` asserts complete key sets rather than
spot-checking.

## Risks / Trade-offs

- **A rule could be lost in the move.** Mitigated by D5's before/after enumeration,
  which is a task, not an intention.
- **The surviving copy could drift from the deleted one during the move.** Mitigated by
  D4: the surviving text is moved verbatim, never reworded in the same step.
- **Readers with the old shape in memory will look in the wrong file.** Accepted and
  bounded: `openspec/changes/archive/` records where each rule used to live, and
  `docs/PIPELINE_INTERNALS.md` gets its cross-references updated.
- **Three capabilities change at once**, so the diff is wider than a one-file edit.
  Accepted: a boundary cut that touched one side would leave the other asserting the
  same rule, which is the current state.

## Migration Plan

None. No code, no stored state, no config, no persisted format. The living spec
after this change describes exactly the system it described before it.
