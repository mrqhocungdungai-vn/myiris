## Context

`workflow-quality-gates` establishes four gates — typecheck, tests, lint, secrets —
each independently runnable, each failing closed, each bound to editing events in
`.claude/settings.json`. The design principle already stated there is that a gate
which cannot run must fail rather than skip silently.

The spec tree has no gate. `openspec validate` exists and is structural: it confirms
a capability has a Purpose and that scenarios are shaped correctly. It reported
43/43 while the tree contained a requirement duplicated verbatim across two
capabilities, four requirements mandating deleted controls, and seven Purposes
reading `TBD`.

## Goals / Non-Goals

**Goals**

- Retired vocabulary cannot survive the change that retires it.
- A placeholder cannot sit in the source of truth indefinitely.
- The specific contradiction class that shipped a real defect is caught.
- The gate is cheap enough to run on every edit.

**Non-Goals**

- Judging whether a requirement is *true*. No checker can do that; a human reading
  the code is still the only mechanism, and this gate does not pretend otherwise.
- Natural-language understanding of requirements. Every check here is lexical and
  structural on purpose (D2).
- Checking `openspec/changes/` or `openspec/changes/archive/`. The archive is
  history and *must* keep its retired vocabulary — a gate that rewrote history
  would destroy the only record of where a rule used to live.
- Replacing `openspec validate`. This runs alongside it.

## Decisions

### D1 — Phase 1 lands before Phase 2, in that order, in one change

A gate that fails on the tree as it stands is a gate someone disables within a day.
So the 72 remaining `role`/`persona` occurrences are cleaned first.

They are one change rather than two because the ordering is the substance: separating
them creates a window where the cleanup is done and nothing prevents regression,
which is precisely the window that let the role era survive its own deletion.

Phase 1 carries **no spec delta** — it proposes no behavior, exactly like commits
`6d62949` and `12360d4`. Only Phase 2 has a delta, on `workflow-quality-gates`.

**This change applies last of the four**, and not merely by preference:

- `cut-run-shape-capability-boundaries` retitles `run-execution-queue`'s "Both roles
  cancel through one path" and relocates two requirements. Those are among the very
  occurrences Phase 1 would sweep, so running Phase 1 first means rewording text that
  is about to move, and hunting the same duplicate twice.
- `purge-role-vocabulary-from-prompts` and `remove-dead-role-era-styles` each ADD a
  requirement whose prose necessarily *names* a retired term — one to state the
  prohibition, one to explain why the check exists. Those requirements must be in the
  living spec before the gate is aimed at it, so their allowances land with the gate
  instead of being retrofitted after it starts failing.

A requirement forbidding a term has to be able to name it. That is not a loophole; a
gate that could not express it would fail its own installation.

### D2 — Every check is lexical or structural, never semantic

A checker that tried to decide whether a requirement matches the code would be
wrong often enough to be ignored. All four checks are mechanical:

- retired vocabulary → configured term list, word-boundary matched
- placeholders → fixed token list
- self-contradiction → a requirement whose body contains a prohibition (`SHALL NOT`,
  "rather than offering") on a phrase that one of its own scenarios then asserts
- emptiness → count of requirements per capability, scenarios per requirement

The contradiction check is the weakest and will not catch every case. It is included
because the *one* contradiction that shipped a defect was of exactly this shape —
a prohibition in the requirement, the prohibited thing mandated in the scenario — and
a check that catches that shape earns its place even if it misses subtler ones.

### D3 — Retired terms are registered, not inferred

The gate cannot know that `DEV` stopped meaning something. So the list is explicit,
and adding to it becomes part of retiring a concept: delete the thing, register its
name. That converts a discipline nobody remembers into a file diff a reviewer sees.

Seeded with `PO`, `DEV`, `role`, `Hermes` — the last one because `.hermes` CSS
survived two renames in plain sight, which is the same failure in the stylesheet.

**Correction, found during apply**: the original seed list also included `persona`.
It does not belong there. `persona` is live, load-bearing vocabulary —
`electron/agent-definitions.mjs`, `electron/pipeline-install.mjs`,
`electron/verbs.mjs`, and `resources/personas/{stateful,stateless}.md` all use it
deliberately to name *who the worker is*, a property the verb migration explicitly
kept distinct from the retired role concept (`PO`/`DEV` bundled "who" with "how the
run behaves"; the migration split them, keeping "persona" for the former and
introducing "stateful"/"stateless" for the latter). Registering it as retired would
fail the gate on `global-agent-runtime`'s ongoing, correct description of that same
concept. It is not in the seed list.

### D4 — Case sensitivity is per-term, because that is where the last criterion failed

`PO` must match case-sensitively with word boundaries: `IRIS_PO_QUESTION_TIMEOUT_MS`
and `SYSTEM_EVENT_PO_QUESTION` are **real identifiers the code reads**, and a spec
citing them is correct, not drifting. `role` must match case-insensitively, because
the last sweep's criterion was uppercase-only and 72 lowercase occurrences walked
straight through it.

So each registered term carries its own matching rule. A single global flag would
either re-miss the lowercase noun or start failing on legitimate identifiers.

### D5 — Allowances are explicit and must state a reason

Some occurrences are legitimate: a spec quoting an identifier, or the archive-facing
note in a de-duplicated requirement recording that a rule used to exist twice. The
gate supports a per-line allowance that requires a stated reason, so an exemption is
a decision in the diff rather than a silent regex tweak.

### D6 — Fails closed, and lives in the same chain

Consistent with the other four: exit non-zero, no warn-only mode, and bound to
editing events. A warning on a fault with no runtime symptom is a warning nobody
reads — `.hermes` and seven `TBD` Purposes are the evidence.

### D7 — The gate stays out of `npm run build`

`workflow-quality-gates` deliberately keeps `lint` and `scan:secrets` out of `build`
so a typecheck stays runnable alone. The spec check follows the same rule for the
same reason.

## Risks / Trade-offs

- **The contradiction check will produce false positives.** A requirement may
  legitimately forbid X and have a scenario mentioning X while asserting it is
  refused. Mitigated by D5's explicit allowances; accepted because the alternative
  is not catching the class at all.
- **The term list will go stale.** Nothing forces someone deleting a concept to
  register its name. Mitigated only by D3 making it visible in review — this is a
  real residual weakness and is recorded rather than papered over.
- **Phase 1 may uncover more dead behavior**, widening the change. The last sweep found
  four such requirements. Accepted: discovering them is the point, and each is
  recorded in the change rather than fixed silently.
- **Five gates is more friction per edit.** Accepted; the check is a lexical pass over
  43 markdown files.

## Migration Plan

None at runtime. Phase 1 is text; Phase 2 adds a script and an npm entry.
`CLAUDE.md` and `docs/TESTING.md` both state "four gates" explicitly and must be
updated in the same change, or they become the first thing the new gate's own
existence contradicts.
