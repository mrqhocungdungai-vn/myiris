## Why

Iris has one concept written under two names, and the boundary between them is a translation table.

**Second Brain is the feature** — a vault of markdown notes, `[[wikilink]]`s, focus, a reader, availability gating, an IPC surface. **Galaxy is how it is currently drawn** — nodes, links, a camera, dwell, an anchor ring, label sprites, a backdrop, bloom.

The main process already says this correctly: every IPC channel is `secondbrain:*`, every bridge method is `*SecondBrain*` (`electron/preload.cjs:152-201`, `src/vite-env.d.ts:481-507`), every capability module is `second-brain*.mjs`. The **drawing** modules also say it correctly: `src/lib/galaxy-nav.ts` exports 30 pure functions and not one knows what a note is, and `galaxy-anchor.ts`, `galaxy-scene.ts`, `galaxy-label-sprites.ts` speak only geometry.

The band between them does not. It names the **feature** after the **view**, and because the two ends of the app disagree, every crossing costs a line:

```tsx
// src/App.tsx
secondBrainActive: hud.galaxyActive,                    // :572
secondBrainActive={hud.galaxyActive}                    // :780
onToggleSecondBrain={hud.toggleGalaxy}                  // :781
onForceCloseSecondBrain={() => hud.closeGalaxy()}       // :784
// src/hooks/useHandGestures.ts
secondBrainActive: galaxyActive,                        // :176
```

Five lines that do nothing but restate one fact in the other dialect, and one more each time a callback crosses the seam.

The cost today is that a reader holds both names at once. The cost tomorrow is specific and larger. `src/lib/gestureContext.ts:23` **takes feature state in and returns a view name out** — `if (secondBrainActive) return "galaxy"` — while its four other members (`reader`, `drawing`, `history`, `deck`) are interaction contexts. The moment a second feature is drawn as a galaxy, `resolveGestureContext` must answer `"galaxy"` for two features whose bindings differ (opening a note is not opening a folder), and `gesture-label.ts:105` starts naming a binding the user does not have. **Doing this now is a rename. Doing it then is a logic change with a live defect in front of it.**

Why it is safe to do in one pass: `tsc` runs `strict` over all of `src/`, so an incomplete rename is a build failure rather than a latent bug.

## What Changes

The test applied to every identifier, and the only rule this change follows:

> If the galaxy were handed a folder tree tomorrow instead of vault notes, would this name still be true?
>
> Still true → it is `galaxy`. Its meaning depends on a note, vault, wikilink or tag → it is `secondBrain`.

- **The HUD's exclusive-layer slot is named for the feature it holds.** `HudLayer = "drawing" | "galaxy" | null` is asymmetric — `"drawing"` is a feature name, `"galaxy"` is a view name — and the slot's own header comment gives away which is meant ("the drawing surface and the second-brain galaxy"). It becomes `"drawing" | "secondBrain"`, with `isGalaxy` → `isSecondBrain`, and `useHudMode`'s `galaxyActive`/`toggleGalaxy`/`closeGalaxy`/`openGalaxy` following. **The five translation lines are deleted, not moved** — after the rename the values already carry the names their consumers use.
- **`GestureContext` stops mixing its axes.** Its `"galaxy"` member becomes `"secondBrain"`, so the resolver's input and output are one vocabulary and all five members are interaction contexts. `gesture-label.ts`'s `galaxyAction` → `secondBrainAction` follows.
- **The remaining feature-named-as-view call sites follow**: `sidecar-router.ts`'s `hud.closeGalaxy` (a vault disappearing closes the *feature*), `useIrisSubscriptions.ts`'s `openGalaxy`/`openNoteFromGalaxy` (voice opens the *second brain*, then a note), `useHandGestures.ts`'s `galaxyActive` prop, `App.tsx`'s `galaxyPositionsRef`.
- **One main-process identifier is corrected**: `electron/capabilities/second-brain.mjs:199` holds `let galaxyActive`, written by the `secondbrain:activate`/`deactivate` channels. It tracks the feature.
- **The rule is written into `renderer-structure`**, so what survives is the test rather than this change's list of renames — a list goes stale the moment someone adds an identifier.

**Zero behavior change, and it is checkable.** No IPC channel is added, removed or renamed; `window.iris` is untouched; no prop's meaning changes; no file is split; no dependency moves. **`npm test`'s file and test counts must be identical before and after** — this change adds no test because it adds no behavior, so a moved count means something other than a rename happened.

### Deliberately not here

- **No `src/lib/galaxy-*.ts` or `src/hooks/useGalaxy*.ts` module is renamed.** They are the view, already correctly named, and renaming them toward the feature is the same category error in reverse. `src/lib/webgl-quality.ts`'s `galaxy: { bloom }` key — sitting beside `orb` and `deck` as a peer WebGL surface — is the worked example the rest is being brought into line with, and it must survive untouched. A `git diff --stat` listing any of these files is a failed change, and that is an acceptance criterion rather than a note.
- **`src/lib/preferences.ts:35` — `"iris.galaxyGestureDebug"`.** A shipped `localStorage` key. Renaming it silently discards a developer's stored flag; the alternative is writing a migration for a devtools-only debug overlay. Left as-is, and this proposal is the record of why.
- **No model-facing prose.** The strings in `run-context.mjs`, `second-brain-announcements.mjs` and `second-brain-declarations.mjs` that say "the second-brain galaxy" are prompt text — editing them changes what Gemini is told, which is a behavior change needing its own justification and its own gate. They also name the feature and its current view together, which is not wrong.
- **No spec prose sweep.** `openspec/specs/` holds 137 occurrences of "galaxy" in `second-brain-gesture-nav` alone, 36 of them the phrase "the galaxy is active" describing feature state. Those sentences are **not false today** — with one galaxy they describe a real observable state — and sweeping 36 normative sentences in a 1000-line spec risks altering a `SHALL` to buy prose consistency. See the Sequencing note.
- **`VaultGalaxy.tsx` is not split.** The research behind this work justified splitting it partly on size — "716 lines, over the 250–450 convention". That is measured wrong: the convention counts **code** lines (`scripts/check-file-size.mjs`'s `countCodeLines`), and by that measure the file is **438** — inside the convention, and correctly absent from `scripts/file-size-baseline.json`. What remains of the argument is that `GalaxyView` should not know what a note is so a second data source can use it, and there is no second data source — the same reasoning that research used to defer `galaxy-rail.ts`. This change makes that split cheap later; it does not require it now.

## Capabilities

### New Capabilities

(none — this renames code that already exists, and adds no behavior.)

### Modified Capabilities

- `renderer-structure`: gains the naming rule this change applies — a renderer identifier is named for the feature or for the view, decided by one stated test, and no boundary restates one fact in two vocabularies. **Scoped to code identifiers**, explicitly not to spec prose or capability folder names, so it does not write a requirement the spec tree violates on the day it lands.

## Impact

- **Renamed, renderer** (8 files): `src/lib/hud-layers.ts`, `src/lib/gestureContext.ts`, `src/lib/gesture-label.ts`, `src/lib/sidecar-router.ts`, `src/hooks/useHudMode.ts`, `src/hooks/useIrisSubscriptions.ts`, `src/hooks/useHandGestures.ts`, `src/App.tsx`. `src/components/HudShell.tsx` follows for one prop.
- **Renamed, main** (1 identifier): `electron/capabilities/second-brain.mjs`'s `galaxyActive`.
- **Tests following the rename** (5): `hud-layers.test.ts`, `gestureContext.test.ts`, `gesture-label.test.ts`, `sidecar-router.test.ts`, `hudChrome.test.ts`. Their assertions must not change — only their spellings.
- **Unmodified**: `electron/preload.cjs`, every IPC channel, `src/vite-env.d.ts`'s bridge declarations, every `galaxy-*` drawing module, `webgl-quality.ts`, `preferences.ts`.

## Sequencing

Second of three changes separating the feature's name from its view's name.

1. `the-icon-names-what-it-opens` — the HUD button's glyph. Two lines, user-visible, independent of this change.
2. **this change** — the renderer identifiers. Zero behavior change.
3. `a-hyphen-is-not-a-boundary` — splits the `second-brain-galaxy-view` capability into `second-brain-layer` and `galaxy-view`, and repoints the citations that would otherwise name a capability that no longer exists.

This one comes before the spec split so that when `second-brain-layer` is written, the code it describes already uses the vocabulary it uses. Reversed, the new spec and the code would disagree until this change landed.

**Known debt, recorded rather than silently skipped:** `second-brain-gesture-nav` holds 36 sentences of the form "the galaxy is active" that mean the second-brain layer is up, and by the same test its own folder name is questionable — most of its content is camera navigation that would survive a change of data source. Neither is fixed in this arc. The sentences are not false while one galaxy exists, and renaming a second capability inside change 3 would double its blast radius. Both become worth doing when a second galaxy consumer arrives, which is also when it will be clear what needs distinguishing.
