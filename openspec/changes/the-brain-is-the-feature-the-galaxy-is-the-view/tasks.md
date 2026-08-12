## 1. Preconditions

- [x] 1.1 All five gates green on a clean tree (`npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`). **Record `npm test`'s file and test counts** — task 3.2 requires them to be identical afterwards.
- [x] 1.2 Record the five translation lines this change must delete, so their disappearance is checkable rather than claimed: `src/App.tsx:572`, `:780`, `:781`, `:784`, and `src/hooks/useHandGestures.ts:176`.
- [x] 1.3 Confirm the boundary the rename must not cross: `git grep -n "secondbrain:" -- electron/preload.cjs` and the `*SecondBrain*` block at `src/vite-env.d.ts:481-507`. **Both are already correct and are untouched by every task below** — a diff touching either means a rename ran past its edge.
- [x] 1.4 Confirm `the-icon-names-what-it-opens` has landed or is independently in flight. It touches only `HudShell.tsx:10` and `:400`, which this change does not, so the two do not conflict in either order.

## 2. The rename — one commit

Done as a single commit deliberately: `tsc --strict` covers all of `src/`, so a half-finished rename is a build failure and there is no useful intermediate state to bank. **Every hunk is a symbol rename.** If a diff moves logic, back it out — that is a different change.

- [x] 2.1 `src/lib/hud-layers.ts`: `HudLayer` member `"galaxy"` → `"secondBrain"`; `isGalaxy()` → `isSecondBrain()`. Rewrite the module header, which currently describes the slot as holding "the drawing surface and the second-brain galaxy" — that asymmetry is the defect; it should name both members as features. The slot itself, `toggleLayer`, `layerAfterLeavingHud` and `layerActive` are unchanged.
- [x] 2.2 `src/lib/hud-layers.test.ts`: follow the rename. The six tests must assert the same rules under new spellings — **if an assertion changes rather than a spelling, stop**: the rename altered behavior.
- [x] 2.3 `src/hooks/useHudMode.ts`: `HudModeControl`'s `galaxyActive` / `toggleGalaxy` / `closeGalaxy` / `openGalaxy` → `secondBrainActive` / `toggleSecondBrain` / `closeSecondBrain` / `openSecondBrain`. Keep `openSecondBrain`'s doc comment — it explains that the voice path *opens* rather than toggles, which is why it exists apart from the toggle.
- [x] 2.4 `src/lib/gestureContext.ts`: `GestureContext` member `"galaxy"` → `"secondBrain"`, and `resolveGestureContext`'s `if (secondBrainActive) return "galaxy"` → `return "secondBrain"`, so its input and output share one vocabulary. `orbGestureEngaged` already takes `secondBrainActive` and needs no change.
- [x] 2.5 `src/lib/gesture-label.ts`: `galaxyAction()` → `secondBrainAction()`, and the `gestureContext === "galaxy"` branch at `:105`. Its header sentence about mirroring `driveFor`'s pose partition in `galaxy-nav.ts` **stays as written** — `galaxy-nav.ts` is the view, and that citation is correct.
- [x] 2.6 `src/lib/gestureContext.test.ts` and `src/lib/gesture-label.test.ts`: follow the rename. Both assert on the member string, so a partial rename fails here as well as in `tsc`.
- [x] 2.7 `src/lib/sidecar-router.ts`: the `hud: { closeGalaxy }` collaborator → `closeSecondBrain`, and the comment at `:73` — a vault disappearing closes the *feature*, not a view. `src/lib/sidecar-router.test.ts` follows.
- [x] 2.8 `src/hooks/useIrisSubscriptions.ts`: `openGalaxy` → `openSecondBrain`, `openNoteFromGalaxy` → `openNoteFromSecondBrain`. Keep the comment at `:118` explaining that opening closes the drawing layer by construction — it describes the slot, which is unchanged.
- [x] 2.9 `src/hooks/useHandGestures.ts`: the `galaxyActive` prop → `secondBrainActive` (`:37`, `:47`, `:99`, `:113`, `:133`, `:151`, `:207`). This **deletes** the translation at `:176` outright rather than relocating it.
- [x] 2.10 `src/App.tsx`: `hud.galaxyActive` → `hud.secondBrainActive` and siblings at `:376`, `:384`, `:395-403`, `:530`, `:572`, `:780-784`, `:936`; `openNoteFromGalaxy` → `openNoteFromSecondBrain`; `galaxyPositionsRef` → `secondBrainPositionsRef`. **The four lines at `:572`, `:780`, `:781`, `:784` are deleted, not rewritten.**
- [x] 2.11 `src/components/HudShell.tsx`: the `galaxyPositionsRef` prop follows 2.10. Its `secondBrain*` props are already correct and do not move. `src/lib/hudChrome.test.ts` follows if it references a renamed symbol.
- [x] 2.12 `electron/capabilities/second-brain.mjs`: `let galaxyActive` (`:199`, used at `:386`, `:689`, `:706`) → `secondBrainActive`. It is written by `secondbrain:activate`/`deactivate` and tracks the feature. Comments in this file that say "the galaxy" while describing what the user sees are correct and stay.

## 3. Acceptance

- [x] 3.1 **The rename is total.** `git grep -n "galaxyActive\|toggleGalaxy\|closeGalaxy\|openGalaxy\|isGalaxy\|openNoteFromGalaxy\|galaxyPositionsRef" -- src electron` returns nothing.
- [x] 3.2 **The suite is the same size.** `npm test` reports the file and test counts recorded in 1.1. This change adds no test because it adds no behavior; a changed count means something other than a rename happened.
- [x] 3.3 **The translation lines are gone.** No line in `src/` assigns one vocabulary's value to the other's name for this concept. The five recorded in 1.2 are the specific check; `git show` the diff and confirm each was removed rather than re-spelled.

  **Recorded on completion, because 2.10 and this task overstated one thing.** Only *one* of the five was literally deleted: `useHandGestures.ts:176` collapsed to the shorthand `secondBrainActive,` and the line stopped existing. The other four could not be, and the task text should have said so:
  `App.tsx:572` is a required argument in `resolveGestureContext`'s object literal, and `:780`/`:781`/`:784` are three props `HudShell` requires. A prop cannot be deleted for having the same name as its value. What each of them *stopped being* is a translation — both sides now read `secondBrain`, so no reader holds two names and no future rename has to touch them again. That was the property the change was for; "deleted" was the wrong word for how four of the five would achieve it.
- [x] 3.4 **The view modules were not touched, and this is what makes it a correction rather than a sweep.** `git diff --stat` lists no `src/lib/galaxy-*.ts`, no `src/hooks/useGalaxy*.ts`, no `src/components/GalaxyStepRail.tsx`, no `src/components/GalaxyErrorBoundary.tsx`, no `src/lib/webgl-quality.ts`, no `src/lib/preferences.ts`.
- [x] 3.5 **Nothing behavioral moved.** `electron/preload.cjs` unmodified; no IPC channel string changed; `"iris.galaxyGestureDebug"` unchanged; no model-facing prose in `run-context.mjs`, `second-brain-announcements.mjs` or `second-brain-declarations.mjs` changed. Each is declined in the proposal with a reason — this is where "still declined" is verified rather than assumed.
- [ ] 3.6 All five gates green. Commit.
- [ ] 3.7 `renderer-structure`'s delta is synced into the living spec, **with its code-identifiers-only scope intact**. That scope is the load-bearing part: without it the requirement is violated by `openspec/specs/` the day it lands (36 sentences in `second-brain-gesture-nav`), and a rule the tree does not satisfy stops being read.
- [x] 3.8 `docs/ARCHITECTURE.md`: update the renderer file map and HUD-layer description to the new vocabulary. Check `docs/research/renderer-findings.md` for stale symbol names — it is a research record, so correct only what would now mislead and do not rewrite its findings.

## 4. Out of scope

Ticked at the end to record each was confirmed still absent, not that work was done.

- [x] 4.1 **No `galaxy-*` drawing module renamed.** They are the view and are correctly named; `webgl-quality.ts`'s `galaxy` key is the worked example. Renaming them toward the feature is the same error in reverse.
- [x] 4.2 **No spec split.** `second-brain-galaxy-view` is untouched here — that is `a-hyphen-is-not-a-boundary`.
- [x] 4.3 **No spec prose swept.** 137 "galaxy" occurrences across `openspec/specs/`, 36 of them "the galaxy is active" in `second-brain-gesture-nav`. Not false today, and sweeping 36 normative sentences risks altering a `SHALL` to buy prose consistency. Recorded as known debt in the proposal's Sequencing note.
- [x] 4.4 **`VaultGalaxy.tsx` not split, `GalaxyNode` not made generic.** The size argument was measured wrong (438 code lines, not 716 — the convention counts code lines), and the reuse argument waits on a second data source that does not exist.
- [x] 4.5 **`"iris.galaxyGestureDebug"` not renamed.** A shipped `localStorage` key; renaming discards a developer's stored flag and a migration costs more than a debug overlay returns.
