## Context

See proposal.md — Why. The five items were found by reading spec-and-code pairs
after every automated check reported green, so the design question here is not
"what do we write" but "what do we write *instead of*", and what we deliberately
do not do about the class of miss that produced them.

Two facts shape every decision below:

- **The code is right in all five cases.** Each item is a spec sentence outranked
  by another spec (`pipeline-availability`, `deepspace-skin`, `two-hand-gestures`)
  or by nothing at all. So no requirement here decides new behavior, and any edit
  that reads as a behavior change is a mistake in this change.
- **The specs disagreed with each other, not just with the code.** `setup-panel`
  contradicted itself across two requirements and `pipeline-availability` across
  capabilities; `holo-deck-backdrop` asserted a property `deepspace-skin` had
  already retired. The repeated cause is a capability restating a rule another
  capability owns. That is the thing to remove, not just the false wording.

## Goals / Non-Goals

**Goals:**

- Make each of the five statements true of the current code.
- Where a false statement existed because one capability restated another's rule,
  replace the restatement with a reference, so the same sentence cannot go stale
  twice.
- Keep the change verifiable by the checks that already exist: `spec:check` and
  `openspec validate --specs --strict` before and after, plus the four code gates
  unchanged because no code moves.

**Non-Goals:**

- **No code, test, or script change.** Not even an obviously stale comment (see
  D5). A spec-only change whose diff touches `electron/` or `src/` cannot be
  reviewed as a spec-only change.
- **No sixth gate.** Naming the miss is not the same as automating it; see D4.
- **No re-cut capability boundaries.** `renderer-structure` remains a layout
  capability even though its subject is a completed refactor, and the overlap
  between `stateful-verb-session` and `verb-tool-surface` stays deferred, as it
  has been since the pile-2 sweep.

## Decisions

**D1 — `config-persistence` is REMOVED + ADDED, not MODIFIED.** The requirement's
name is part of what is false: "A config-sourced executable path" names a source
that no longer reaches this sink. A MODIFIED delta keeping that header would leave
the living spec with a title contradicting its own body, and OpenSpec matches
requirements by header text, so a later reader searching for the config-override
rule would still find it. Removing it records a **Reason** and a **Migration** in
the archive — which is the only place the deleted rule survives, and the thing a
future reader will want when they ask why Iris cannot be pointed at a host Claude.
The four other items are genuine MODIFIEDs: the requirement's subject still exists
and only its claims were wrong.

**D2 — Replace a restatement with a reference, rather than correcting it.**
`setup-panel` could have been fixed by editing "with copyable install commands" to
"reporting bundled or damaged". That would be true today and stale again the next
time `pipeline-availability` changes its row vocabulary, because the sentence would
still be a second declaration of it. So the requirement now defers: it says the
rows follow the vocabulary that capability owns, and states only what is
`setup-panel`'s own — that the panel shows the state, and that a flip while a Live
session is up surfaces the reconnect prompt. Same move in `holo-deck-backdrop`
(defers to `deepspace-skin` for what the adopted sheets are) and in
`workflow-quality-gates` (defers to `deepspace-skin` for the sweep's scoping
reason). The cost is that a reader needs two files to see the whole rule; the
alternative has been measured in this repo and it is a false requirement that
survives a migration.

**D3 — `setup-panel` keeps a chat-only scenario, restated on the real condition.**
Deleting the scenario was tempting — it was the false one — but "the panel explains
why the pipeline is off" is real, user-visible behavior that deserves a scenario.
The failure was that it named the wrong cause (a missing host binary) at a time
when the two possible causes are a missing credential and a damaged bundle. The
scenario now asks for exactly that distinction, which also keeps the panel honest
about the one row a user can act on.

**D4 — No new gate, and this is a decision rather than an omission.** Every item
here was invisible to `spec:check` by construction: a lexical scan cannot know that
`useHoldToScroll` does not exist, nor that two capabilities disagree. Two
automatable pieces do exist — a sweep asserting that every backticked
module/identifier in a spec resolves in the tree, and a cross-capability
contradiction check — and the first is what found item 3 during this audit. They
are a separate change: the drift gate's own history is that it was added *after*
the vocabulary sweep it would have caught, deliberately, so the sweep and the gate
could be reviewed apart. Folding a new gate in here would also break the "no code
change" property that makes this diff reviewable. Recorded so the next change has
somewhere to start, not deferred silently.

**D5 — Adjacent staleness in code comments is left alone, and named.**
`scripts/dead-claude-css.mjs`'s header still says the adopted sheets "must stay
byte-comparable to upstream so future ports diff cleanly" — the property
`deepspace-skin` retired. The sweep's *behavior* is correct and unchanged (it is
scoped to `claude.css`, which is still right for the reason that capability now
gives), so this is a comment whose rationale expired. It is left for whichever
change next edits that file, because touching it here would put a script in a
spec-only diff for a one-line rewording.

## Risks / Trade-offs

- **A spec-only change is invisible to the gates that could confirm it** → the
  verification is `spec:check` plus `openspec validate --specs --strict` (which
  both passed *before* this change too, so neither proves correctness), and a read
  of each modified requirement against the code path it describes. The tasks list
  the specific file and line for each, so the check is a re-read, not a re-audit.
- **MODIFIED deltas lose detail if pasted partially** → each of the four MODIFIED
  requirements carries its complete body and every one of its scenarios, including
  the ones this change does not touch. Archive overwrites the requirement wholesale;
  a scenario omitted from the delta is a scenario deleted from the living spec.
- **Deferring to another capability can hide a rule from a reader who lands on one
  file** → accepted, and mitigated by naming the owning capability inline in the
  sentence that defers, so the pointer is unmissable rather than implicit.
- **The audit that found these five was manual and is not repeatable on demand** →
  true, and the reason D4 records the two automatable pieces. Until then, the
  living spec's truth remains a thing a person checks, which is what this change
  is an instance of.

## Migration Plan

None. No user-visible behavior, no configuration, and no stored state changes
meaning. The change is complete when the five spec files say what the code does;
archiving syncs them into `openspec/specs/`.
