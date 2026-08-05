## Why

This repo has four quality gates and **all four check code**. Nothing checks
whether the living spec is still true. The consequence, measured on 2026-08-04:

| symptom | count |
| --- | --- |
| capability specs using `PO`/`DEV`, roles deleted that same day | 21 files, 210 occurrences |
| capabilities whose entire `Purpose` was `TBD` | 7 of 43 |
| capabilities whose `Purpose` read "Update Purpose after archive" — to nobody | 2 |
| requirements contradicting their own scenarios | 2 |
| requirements existing twice, verbatim, in two capabilities | 1 |
| requirements mandating a control that no longer exists | 4 |

Throughout all of it, `npm test` was green on 741 tests, `npm run build` passed,
and `openspec validate --specs --strict` reported **43 passed, 0 failed**. The
validator checks structure — headings, scenario shape — not truth. So the one tool
pointed at the spec tree confirmed it was well-formed while it described three
different versions of Iris at once.

That is not an argument the gates are bad. It is the observation that **the spec is
the only artifact in this repo with no automated check at all**, and it is the
artifact CLAUDE.md names as the source of truth. Drift there is worse than drift in
code, because the next change is authored *from* it.

One defect proves the cost was real rather than theoretical. `pipeline-availability`
required that a failing bundled-component row point at reinstalling "rather than
offering an install command that could not fix it" — while its own four scenarios
mandated a one-click install action and a copyable manual command. The renderer
implemented the scenarios: a **"Copy install command"** button that copied the
sentence *"missing from the app bundle: … — reinstall Iris"* to the clipboard. A
user who clicked it and pasted into Terminal got an error. That shipped, and it
shipped because the stale scenarios read as the contract.

There is also a narrower lesson about criteria. The vocabulary sweep's done-check
was `grep -E '\bPO\b|\bDEV\b'`, which passed at zero — while **72 occurrences of the
lowercase noun "role"/"persona" remained across 16 files**, including a requirement
still titled *"Both roles cancel through one path"*. A criterion that is
machine-checkable is not automatically a criterion that is right, and this gate is
where that gets fixed once instead of per-sweep.

## What Changes

**Phase 1 — make the tree clean.** The 72 remaining `role`/`persona` occurrences are
reconciled first, because a gate that fails on day one gets disabled on day one.
This phase proposes no behavior: it is an explicit vocabulary sync, the same
operation as commits `6d62949` and `12360d4`, and it carries no spec delta for that
reason. Where it uncovers a requirement asserting dead behavior — as the last sweep
did four times — that discovery is recorded and fixed in place.

**Phase 2 — add the fifth gate.** A `spec:check` gate over `openspec/specs/` that
fails on:

- **Retired vocabulary.** A configured list of terms that no longer name anything —
  seeded with the role era (`PO`, `DEV`, `role`, `persona`, `Hermes`) and extended
  whenever a concept is deleted. Deleting a concept becomes a two-part act: remove
  it, and add its name to the list.
- **Placeholder text.** `TBD`, `TODO`, `FIXME`, and "after archive" notes-to-self. A
  `Purpose` that says `TBD` is a source of truth admitting it is not one.
- **Self-contradiction between a requirement and its own scenarios**, in the narrow
  checkable form: a requirement whose text forbids something its scenarios then
  mandate. This is the check that would have caught the shipped defect.
- **A capability with no requirements**, or a requirement with no scenarios.

The gate is wired as the fifth member of the chain, fails closed like the others,
and is bound to editing events the same way.

## Capabilities

### Modified Capabilities

- **`workflow-quality-gates`** — the chain becomes five gates; one ADDED requirement
  specifying the spec check, its failure semantics, and the rule that retiring a
  concept means registering its name.

## Impact

- One new `scripts/` check plus an npm script; the chain grows from four to five.
- `openspec/specs/` — Phase 1 touches up to 16 files, prose only.
- `CLAUDE.md` and `docs/TESTING.md` — the "four gates" wording becomes five. Both
  state the count explicitly today.
- `.claude/settings.json` — the new gate joins the editing-event bindings.
- No app code, no behavior, no IPC, no UI.
