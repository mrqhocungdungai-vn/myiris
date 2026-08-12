## Why

`openspec/specs/second-brain-galaxy-view/spec.md` joins two concepts with a hyphen, and its 672 lines confirm the name is honest about what happened. Applying one question to each of its requirements —

> *If the galaxy were handed a folder tree tomorrow instead of vault notes, would this requirement still be true?*

— partitions them cleanly, with no requirement landing in both:

| Belongs to the **feature** (5) | Belongs to the **rendering** (6) |
| --- | --- |
| The vault is shown as a toggleable HUD layer, exclusive with drawing, HUD-only | The layer renders over an immersive opaque deep-space backdrop |
| The vault graph is owned and kept fresh by the main process | The node being pointed at reveals its link cluster |
| Opening a node shows the note's content | Labels are always drawn, legible by camera proximity |
| Untrusted note content is contained | The camera turns and dollies around a movable anchor |
| The layer is gated on the vault existing, independent of the Claude pipeline | The camera is aimed by a sight that follows the hands |
| | What a grab will take hold of is visible before the grab |

`CLAUDE.md` says one capability per folder. This is two.

That is not only untidy — it is already producing a specific defect in the citations. `two-hand-gestures` and `second-brain-gesture-nav` both cite **rendering** requirements ("The camera turns and dollies around a movable anchor", "The camera is aimed by a sight that follows the hands", "The node being pointed at reveals its link cluster") by capability name. They are citing camera behavior from a capability whose name asserts the notes vault. A second consumer of the same rendering would have to cite it the same way, or copy it.

Why now: the code this spec describes has just been brought into line with the same distinction (`the-brain-is-the-feature-the-galaxy-is-the-view`), and the drawing modules were already generic before that — `src/lib/galaxy-nav.ts` exports 30 pure functions, none of which knows what a note is. The spec is now the only place the two concepts are still fused.

## What Changes

- **`second-brain-galaxy-view` becomes two capabilities.** `second-brain-layer` takes the toggle, the exclusivity rule, the HUD-only lifetime, main's ownership of the vault graph, the note reader, containment of untrusted note content, and availability gating. `galaxy-view` takes the backdrop and its quality path, the pointed-at highlight, node labels, the movable anchor, the hand-driven sight, and the grab affordance.
- **Vocabulary is corrected only where a rendering rule was written in note-language.** "Note titles are always drawn in the galaxy" becomes a statement about node labels; the pool ceiling, the proximity rule, the off-axis eligibility rule and the `Infinity` distance cutoff are unchanged, including their stated reasons. **A `SHALL` may change its subject noun; it may not change what it requires.**
- **`second-brain-layer`'s requirements keep saying "galaxy" where they mean the current rendering**, because they do mean it — the layer *is* drawn as a galaxy today, and a requirement that pretended otherwise would describe a system that does not exist.
- **Five sibling citations are repointed** — 4 in `second-brain-gesture-nav`, 1 in `two-hand-gestures` — because after this change they would name a capability that does not exist.
- **~25 code and doc comments** citing `second-brain-galaxy-view` are repointed to whichever half now holds the rule each one cites. This requires reading the cited rule; it is not find-and-replace.
- **The old capability folder is deleted**, not left empty. `scripts/check-spec-drift.mjs` fails an empty capability, so `spec:check` enforces it rather than trusting it.

**No code behavior changes.** The only source edits are comment repoints. No IPC channel, no identifier, no test.

### The clause arithmetic, stated so it is reconcilable

`second-brain-galaxy-view` today holds **149 `SHALL` clauses / 95 scenarios / 11 requirements**, plus the one requirement `the-icon-names-what-it-opens` adds ahead of this change (**+4 `SHALL` / +2 scenarios / +1 requirement**), for **153 / 97 / 12** going in.

Coming out: **154 / 98 / 12** — `second-brain-layer` at 69/40/6 and `galaxy-view` at 85/58/6. The single addition is `galaxy-view`'s label requirement restating that a label reaches the view as **drawn text** rather than through a surface that interprets markup, with one scenario. It is not new behavior — "Untrusted note content is contained" already requires it. It is stated on both sides because the containment *obligation* belongs to the note source while the *mechanism* belongs to the renderer, and after the split neither file alone would say both.

### Deliberately not here

- **`second-brain-gesture-nav` is not renamed, and its prose is not swept.** It holds **137** occurrences of "galaxy", **36** of them the phrase "the galaxy is active" meaning the second-brain layer is up — and by this change's own test its folder name is questionable too, since most of its content is camera navigation that would survive a change of data source. Two reasons it waits. Those 36 sentences are **not false**: with one galaxy they describe a real observable state, and they become ambiguous only when a second one exists — which is also when it will be clear what needs distinguishing. And renaming a second capability inside this change would double its blast radius while it is already the riskiest of the three. Recorded here so a later reader knows it was measured, not missed.
- **`openspec/changes/archive/` is untouched.** It keeps `second-brain-galaxy-view` and the old vocabulary. It is the only record of where these rules used to live, and `check-spec-drift.mjs` never walks it — so a sweep there would be undetectable and would destroy history.

## Capabilities

### New Capabilities

- `second-brain-layer`: the HUD layer that shows the vault and what it takes to put one up — the "show second brain" toggle and its exclusivity with the drawing canvas, HUD-only lifetime, the main-process graph owner (scan/parse/cache/watch), the note reader opened from a node, containment of untrusted note content, and gating on the vault existing rather than on the Claude pipeline. Named `-layer` rather than a bare `second-brain` because the feature is already partitioned across `personal-knowledge-notes` (the vault and its write path), `second-brain-focus` (the shared selection), `second-brain-gesture-nav` (the hands) and `open-note-session` (the reader's session); a bare name would read as their parent and would invite requirements that belong in one of them.
- `galaxy-view`: how a link-graph is drawn and flown, in terms that name no note — the opaque deep-space backdrop and its quality path, the pointed-at node's link cluster, node labels made legible by camera proximity, the movable camera anchor, the sight that follows the hands, and the pre-grab affordance.

### Modified Capabilities

- `second-brain-galaxy-view`: removed. Every requirement moves to one of the two above; the folder is deleted.

**Not listed as modified, deliberately.** `second-brain-gesture-nav` (4 citations) and `two-hand-gestures` (1) must repoint, but **no normative clause in either changes** — only the name of the document a parenthetical points at. Writing four full `MODIFIED` blocks whose sole diff is a capability name risks losing detail in the copy, which is the documented failure mode of a partial `MODIFIED`, to record nothing. They are repointed as part of this change's spec sync and verified by an explicit check: no file under `openspec/specs/` may contain the string `second-brain-galaxy-view` when this lands.

## Impact

- **New**: `openspec/specs/second-brain-layer/spec.md`, `openspec/specs/galaxy-view/spec.md`.
- **Deleted**: `openspec/specs/second-brain-galaxy-view/`.
- **Edited prose, no clause changes**: `openspec/specs/second-brain-gesture-nav/spec.md`, `openspec/specs/two-hand-gestures/spec.md`.
- **Comment repoints only**: `electron/capabilities/second-brain.mjs`, `electron/window.mjs`, `electron/renderer-security.mjs`, `electron/wiring-capabilities.mjs`, `electron/vault-graph-parse.test.mjs`, `src/components/VaultGalaxy.tsx`, `GalaxyErrorBoundary.tsx`, `NoteReader.tsx`, `ReaderCore.tsx`, `DrawingCanvas.tsx`, `HudShell.tsx`, `src/lib/hud-layers.ts`, `src/App.tsx`, `src/vite-env.d.ts`, `vite.config.ts`, `scripts/check-three-dedupe.mjs`, `docs/PROPOSAL_SECOND_BRAIN_WORKSPACE.md`.
- **Verification**: `spec:check` catches an emptied capability and is the gate this change is most accountable to. `npm test` must report unchanged counts — no test's subject moves.

## Sequencing

Third and last of three changes separating the feature's name from its view's name.

1. `the-icon-names-what-it-opens` — the HUD button's glyph, and the requirement that a control names the feature. That requirement is one of the twelve this change moves; it lands in `second-brain-layer`.
2. `the-brain-is-the-feature-the-galaxy-is-the-view` — the renderer identifiers, and the naming rule into `renderer-structure` (scoped to code identifiers, explicitly not to spec prose — which is why this change does not sweep the 137 occurrences above).
3. **this change** — the capability split.

Last because it is the only one where a mistake changes what the system is required to do, and because writing `second-brain-layer` after the rename means it describes code that already uses its vocabulary.
