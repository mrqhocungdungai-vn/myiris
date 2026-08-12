## Context

See proposal.md — Why. What shapes the approach is that this is the one change in the arc where a mistake alters what the system is *required* to do. The other two are verified by a compiler and a test count; this one is verified by reading.

Two constraints frame it. `scripts/check-spec-drift.mjs` walks `openspec/specs/` and never `openspec/changes/archive/` — so the archive keeps its historical vocabulary by design and must not be rewritten, and an emptied capability is a gate failure rather than a matter of care. And OpenSpec's delta vocabulary has `RENAMED Requirements` but **no rename operation for a capability**, so the split has to be expressed as a removal plus two additions.

## Goals / Non-Goals

**Goals**

- The folder boundary sits where the concept boundary is, so the rendering half can be cited by a future second consumer without dragging note semantics with it.
- Every carried-over requirement means exactly what it meant, and that is checkable by counting rather than by assertion.
- No citation anywhere names a capability that no longer exists.

**Non-Goals**

- No code behavior changes. The only source edits are comment repoints; a diff hunk touching an identifier belongs to the previous change, not this one.
- The two new capabilities are **not** made symmetrical for its own sake. `galaxy-view` has six requirements and `second-brain-layer` five because that is where the question fell, not because a split should balance.
- `galaxy-view` is not generalised beyond what is true. It has exactly one data source today, and where a rule depends on a property only that source supplies, it names the property rather than pretending the rule is source-agnostic.

## Decisions

### D1 — The split line is one question, asked of the requirement rather than of its wording

> *If the galaxy were handed a folder tree tomorrow instead of vault notes, would this requirement still be true?*

Asked of the **requirement**, not its current phrasing — otherwise "Note titles are always drawn in the galaxy" would sort as feature simply because someone wrote "note". Strip the subject noun and it is a rule about sprite pools, perspective scaling and an off-axis eligibility tie-break: rendering.

**Alternative rejected — leave one capability and sweep only its prose.** Cheaper, and it fails the actual test. `two-hand-gestures` and `second-brain-gesture-nav` already cite *rendering* requirements by capability name; a future folder-galaxy would cite them too, from a capability whose name asserts the notes vault. The folder boundary is what is wrong, so the folder boundary is what changes.

### D2 — `galaxy-view` speaks in nodes, and where a rule needs a source property it says so

Rendering requirements are re-worded out of note-language and **only** out of note-language: "note-node" → "node", "note title" → "node label", "the vault's note count" → "the graph's node count".

Where a rule genuinely depends on something only the source supplies, it names the property and cites where it comes from rather than laundering it into a false generality. The ghost exclusion is the case that matters: `galaxy-view` says a ghost is a node the source marks as named-but-not-openable and cites `second-brain-layer` for what makes one, instead of either keeping `[[wikilink]]` in a rendering spec or silently broadening the rule to any node any source might mark. **Broadening would have been a meaning change disguised as a rename**, which is precisely what this change must not do.

### D3 — One clause is stated on both sides, deliberately

The old spec's containment requirement says an in-scene title must reach the view as drawn text rather than through a surface that interprets markup. After the split, the *obligation* (note content is untrusted) belongs to `second-brain-layer` and the *mechanism* (labels are drawn, never parsed) belongs to `galaxy-view`, and neither file alone would say both.

So it appears in both, and the accounting says so: +1 `SHALL`, +1 scenario, named in the proposal and reconciled in the tasks. The alternative — leaving it only in `second-brain-layer` — would make `galaxy-view` silent on a property it is the sole implementer of, so a second data source would inherit a renderer with no stated guarantee about what it draws.

### D4 — `second-brain-layer`, not a bare `second-brain`

The feature is already partitioned across `personal-knowledge-notes` (the vault and its write path), `second-brain-focus` (the shared selection), `second-brain-gesture-nav` (the hands) and `open-note-session` (the reader's session). A capability named `second-brain` would read as the parent of all four and would attract requirements belonging in one of them.

What is left after `galaxy-view` is taken out is precisely *the layer that shows the vault, and what it takes to put one up*. `second-brain-layer` names that and claims nothing else.

### D5 — Citation repoints are a sync, not four `MODIFIED` blocks

Five citations name requirements across the capability boundary. **No normative clause changes** — only the name of the document a parenthetical points at.

Writing four full `MODIFIED` requirement blocks to record a capability name would mean copying four large blocks by hand, whose documented failure mode is losing detail in the copy. The cost is real and the record is nil. They are repointed in the same commit as the split, and the acceptance check is mechanical: `git grep second-brain-galaxy-view -- openspec/specs` returns nothing.

### D6 — 36 sentences are left alone, with the count written down

`second-brain-gesture-nav` says "the galaxy is active" 36 times, meaning the second-brain layer is up. By this change's own test that phrasing is questionable, and so is the folder's name.

They stay, for a reason that is not budget. **The sentences are not false.** With one galaxy they describe a real observable state; they become ambiguous only when a second exists — which is also the moment it becomes clear what needs distinguishing, and therefore the right moment to choose new wording. Sweeping 36 normative sentences now, in a 1000-line spec, spends the risk of altering a `SHALL` to buy prose consistency that no reader currently lacks.

This is also why the naming rule the previous change adds to `renderer-structure` is **scoped to code identifiers**: written wider it would be violated here on the day it landed, and a rule the tree does not satisfy stops being read.

### D7 — Comment repoints require reading the cited rule

~25 comments cite `second-brain-galaxy-view` by name. A citation to a capability that no longer exists is worse than none — it reads as authoritative and resolves to nothing — so each is repointed to whichever half holds the rule it cites, which means reading that rule.

Two need judgement rather than lookup. `electron/vault-graph-parse.test.mjs:2` cites a *change* path (`openspec/changes/second-brain-galaxy-view/…`) rather than a spec path and is already stale. `docs/PROPOSAL_SECOND_BRAIN_WORKSPACE.md` is a design document about future work whose citations describe the spec as it stood; its citations update, its argument does not.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| The split loses a requirement, or quietly changes one | The `REMOVED` delta lists all twelve with destinations, so the mapping is reviewable rather than inferred. Acceptance is a clause count with a stated expected total (152/98/12) and a named `+1`, so an unexplained drift is visible as arithmetic. |
| A subject-noun rewrite becomes a predicate rewrite | Task-level rule: a `SHALL` may change what it is about, never what it requires. Checked clause by clause against the pre-split file, which stays in git history. |
| `galaxy-view` is over-generalised into claiming source-independence it does not have | D2. Where a rule needs a source property it names it and cites `second-brain-layer`. |
| A citation somewhere still names the deleted capability | `git grep second-brain-galaxy-view -- openspec/specs` must return nothing; the ~25 code and doc citations are enumerated in the tasks rather than swept. |
| The old folder is left empty rather than deleted | `check-spec-drift.mjs` fails an empty capability, so `spec:check` catches it. |
| The archive is rewritten for consistency | Explicitly forbidden, and verified by `git diff --stat` over `openspec/changes/archive` returning nothing. It is the only record of where these rules used to live. |
| Two capabilities where one existed makes a rule harder to find | Each Purpose states what it holds **and** what its sibling holds, so either entry point resolves in one hop. |

## Migration Plan

None — no code behavior, no persisted state, no contract. Rollback is a `git revert` of one commit; the deleted spec file returns with it.

## Open Questions

None that would change the specs, the approach or the task breakdown. `second-brain-gesture-nav`'s name and its 36 sentences are settled as *declined with a stated trigger* (D6), not left hanging.
