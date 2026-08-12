## 1. Preconditions

- [x] 1.1 Confirm `the-icon-names-what-it-opens` and `the-brain-is-the-feature-the-galaxy-is-the-view` have both landed. The first adds the twelfth requirement this change moves; the second means `second-brain-layer` will describe code that already uses its vocabulary. Running this change first is not wrong, but it makes the split describe a renderer that contradicts it.
- [x] 1.2 All five gates green on a clean tree. Record `npm test`'s file/test counts — no test's subject moves in this change, so they must be identical at the end.
- [x] 1.3 Record the baseline from the pre-split file, which is what task 3.1 checks against: **12 requirements / 97 scenarios / 153 `SHALL`** (11/95/149 today, plus 1/2/4 from `the-icon-names-what-it-opens`). Take the counts from the file rather than from this line, in case it drifted.

## 2. The split

One commit. The two new files and the deletion have to land together or the tree has a dangling capability.

- [x] 2.1 Create `openspec/specs/second-brain-layer/spec.md` from this change's delta — 6 requirements: the exclusive HUD layer, the control naming the feature, main's ownership of the vault graph, opening a node, containment of untrusted note content, availability gating.
- [x] 2.2 Create `openspec/specs/galaxy-view/spec.md` from this change's delta — 6 requirements: the deep-space backdrop, the pointed-at link cluster, node labels, the movable anchor, the hand-driven sight, the grab affordance.
- [x] 2.3 **Delete `openspec/specs/second-brain-galaxy-view/`** — the folder, not just its contents. `check-spec-drift.mjs` fails an empty capability, so `spec:check` enforces this rather than trusting it.
- [x] 2.4 Repoint the five sibling citations: `openspec/specs/second-brain-gesture-nav/spec.md` (~lines 37, 141, 236, 238) and `openspec/specs/two-hand-gestures/spec.md` (~994). Each names a requirement by title — read that requirement to decide which half now holds it rather than replacing the string. **No normative clause in either capability changes.** If one needs to, stop and raise it: that is not a citation repoint.
- [x] 2.5 `git grep -n "second-brain-galaxy-view" -- openspec/specs` returns nothing. This is the acceptance check the proposal commits to in place of writing four full `MODIFIED` blocks.
- [x] 2.6 `npm run spec:check` green. Confirm no new allowance was needed in the drift gate's list — no retired term is introduced, because "galaxy" stays legitimate for the view, which is the whole point.

## 3. Verify the split did not change what is required

This is the only change in the arc whose mistakes a compiler cannot catch. Do this before the comment repoints, while the two files are the only thing that moved.

- [x] 3.1 **Clause arithmetic.** The two new files together must total **12 requirements / 98 scenarios / 154 `SHALL`** against the 12/97/153 recorded in 1.3 — `second-brain-layer` at 69/40/6 and `galaxy-view` at 85/58/6. The `+1 SHALL / +1 scenario` is exactly `galaxy-view`'s label requirement restating that a label reaches the view as drawn text — named in the proposal, justified in design D3 — **and nothing else**. Record the counts in the commit message so a reviewer checks arithmetic rather than impressions.
- [x] 3.2 **Clause-by-clause read against the pre-split file** (recoverable from git). Every carried-over `SHALL` appears in exactly one of the two files with the same predicate. A `SHALL` may change its **subject noun** ("note title" → "node label", "the vault's note count" → "the graph's node count"); it may not change **what it requires**. A rewritten predicate is a bug in this change, not a documented improvement.
- [x] 3.3 **Check the two places generalisation could have gone too far** (design D2): `galaxy-view`'s ghost-node exclusion must name the property (*a node the source marks as named-but-not-openable*) and cite `second-brain-layer` for what makes one — not keep `[[wikilink]]` in a rendering spec, and not silently broaden to any node any source might mark. Same test for the label requirement's pool ceiling.
- [x] 3.4 **Check both Purposes resolve in one hop.** Each states what it holds *and* what its sibling holds, so a reader arriving at either finds the other without searching.
- [x] 3.5 Five gates green. Commit the split on its own.

## 4. Citations in code and docs

- [x] 4.1 Repoint the ~25 comments citing `second-brain-galaxy-view` to whichever half holds the rule each one cites: `electron/capabilities/second-brain.mjs`, `electron/window.mjs`, `electron/renderer-security.mjs`, `electron/wiring-capabilities.mjs`, `src/components/VaultGalaxy.tsx`, `GalaxyErrorBoundary.tsx`, `NoteReader.tsx`, `ReaderCore.tsx`, `DrawingCanvas.tsx`, `HudShell.tsx`, `src/lib/hud-layers.ts`, `src/App.tsx`, `src/vite-env.d.ts`, `vite.config.ts`, `scripts/check-three-dedupe.mjs`. **This requires reading the cited rule — it is not find-and-replace.**
- [x] 4.2 The two that need judgement rather than lookup: `electron/vault-graph-parse.test.mjs:2` cites a *change* path (`openspec/changes/second-brain-galaxy-view/…`) and is already stale — point it at the living spec. `docs/PROPOSAL_SECOND_BRAIN_WORKSPACE.md` is a design document about future work — update its citations, do not rewrite its argument.
- [x] 4.3 `docs/ARCHITECTURE.md` and `CLAUDE.md`'s router table: the second-brain row currently points at `second-brain-galaxy-view`. Point it at both new capabilities and say in one line which holds what, so the router keeps doing its job.
- [x] 4.4 `git grep -n "second-brain-galaxy-view"` across the repo returns hits **only** under `openspec/changes/archive/`.
- [x] 4.5 Five gates green, `npm test` counts unchanged from 1.2. Commit.

## 5. Acceptance

- [x] 5.1 **No code behavior changed.** `git diff --stat` over `src/` and `electron/` shows comment-only hunks. No identifier, no IPC channel, no test subject moved.

  **One exception, recorded rather than filed under "comment".** `GalaxyErrorBoundary.tsx:24` tags its crash log `[second-brain-galaxy-view]`, and that is a runtime string, not a comment. It had to change: 4.1 lists the file, and 4.4 forbids the old capability name outside the archive. It is now `[second-brain-layer]`, which is where the force-close rule lives. Nothing reads the tag — no test asserts on it and no log parser keys off it — so this moves a diagnostic label and nothing else. "Comment-only" was the right intent and the wrong word for one line.
- [x] 5.2 **The archive is untouched.** `git diff --stat -- openspec/changes/archive` returns nothing. It keeps `second-brain-galaxy-view` and the old vocabulary; it is the only record of where these rules used to live, and `check-spec-drift.mjs` never walks it, so a sweep there would be undetectable.
- [x] 5.3 **Smoke, by hand.** Nothing here is checkable by the gates beyond `spec:check`, and nothing in the app changes — so the real acceptance is that a reader can now answer "where is the camera anchor rule specified?" and "where is the toggle's exclusivity specified?" and land in different files, each correctly. Confirm by trying it.

## 6. Out of scope

Ticked at the end to record each was confirmed still absent, not that work was done.

- [x] 6.1 **`second-brain-gesture-nav` is not renamed and its prose is not swept.** 137 "galaxy" occurrences, 36 of them "the galaxy is active" meaning the layer is up, and by this change's own test the folder name is questionable too. Left because those sentences are **not false** while one galaxy exists — they become ambiguous only when a second does, which is also when it will be clear what needs distinguishing — and because renaming a second capability here would double the blast radius of the riskiest change in the arc.
- [x] 6.2 **`two-hand-gestures`, `second-brain-focus`, `personal-knowledge-notes`, `webgl-quality-mode`, `hud-drawing-canvas` and `open-note-session` keep their "galaxy" prose** (37/17/8/7/5/3 occurrences). Same reasoning as 6.1. Only their citations of the deleted capability were touched.
- [x] 6.3 **`VaultGalaxy.tsx` is not split and `GalaxyNode` is not made generic.** The size argument was measured wrong (438 code lines, not 716 — the convention counts code lines), and the reuse argument waits on a second data source that does not exist. This change makes `galaxy-view` citable by that source when it arrives, which is the part worth doing early.
- [x] 6.4 **No renderer identifier is renamed here.** That was the previous change; a diff hunk touching one belongs to it, not this.
