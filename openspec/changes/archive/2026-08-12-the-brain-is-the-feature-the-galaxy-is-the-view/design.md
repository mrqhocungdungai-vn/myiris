## Context

See proposal.md — Why. What shapes the approach is the *distribution* of the misnaming rather than its size, and the distribution is unusual: both ends of the app are already correct and the defect is confined to the band between them.

Measured on a clean tree:

| Band | State |
| --- | --- |
| Main process + IPC | **Correct** — `secondbrain:*` channels, `*SecondBrain*` bridge methods, `second-brain*.mjs` modules. One misnamed local (`second-brain.mjs:199`). |
| The seam — HUD slot, gesture context, routers, subscriptions, `App.tsx` | **Feature named after view.** 8 files, 5 translation lines. |
| Drawing modules — `galaxy-nav`, `galaxy-anchor*`, `galaxy-scene`, `galaxy-label-sprites`, `galaxy-graph`, `galaxy-labels`, `useGalaxy*` | **Correct.** 30 pure exports in `galaxy-nav.ts` alone, none of which knows what a note is. |

Two constraints decide everything below. `tsc` runs `strict` over all of `src/`, so an incomplete rename is a build failure — this is what makes a one-pass rename the safest available refactor and the reason nothing is deferred "to finish later". And nothing being renamed is a string with an external consumer: every symbol here is a TypeScript identifier or union member used only inside `src/`, so there is no channel name, storage key, DOM class or model-facing prose in the blast radius.

## Goals / Non-Goals

**Goals**

- One vocabulary at every boundary, so no call site translates between two names for one thing.
- `resolveGestureContext` takes and returns one vocabulary, closing the specific future defect the proposal names.
- Zero behavior change, demonstrable rather than asserted — the test-count check in tasks 1.1/3.2 is the demonstration.
- The rule survives as spec, not as this change's list of renames.

**Non-Goals**

- No abstraction is introduced to *anticipate* a second galaxy consumer. This makes the eventual `GalaxyView` extraction cheap; it does not perform it, and it does not add a seam only a hypothetical consumer would use.
- No behavior moves between modules. Every commit is a rename. A diff hunk that relocates logic is out of scope for this change, not merely for that commit.
- The `galaxy-*` module names are **not** made more neutral (`graph-nav`, `scene-*`). "Galaxy" is the right name for the view; making the view's own modules apologise for it is the same category error in reverse.

## Decisions

### D1 — The rule is a question, not a list, and it is written into the spec

> *If the galaxy were handed a folder tree tomorrow instead of vault notes, would this name still be true?*

Still true → `galaxy`. Depends on a note, vault, wikilink or tag → `secondBrain`.

A list of renames goes stale the moment someone adds an identifier; a question is checkable at the point of naming. That is why it lands in `renderer-structure` rather than only here, where it would be archived along with the change.

**Alternative rejected — rename everything to `secondBrain`.** This is the intuitive reading of "refactor the galaxy vocabulary into second brain", and it is wrong: it would rename ~25 correctly-named files whose contents are pure geometry, destroying the asset that makes eventual reuse possible.

### D2 — The rule is scoped to code identifiers, and the scope is load-bearing

The requirement added to `renderer-structure` governs **identifiers** — types, union members, a hook's returned fields, props, modules. It does **not** govern prose, in a spec or a comment or a user-facing string, and it does not govern capability folder names.

This is a decision, not an omission, and it is the one most likely to be misread later. An identifier is a name a compiler and every call site must agree on, so an ambiguous one becomes a defect the moment two things answer to it. Prose describing what a user currently sees stays true for as long as that is what they see: `openspec/specs/second-brain-gesture-nav/spec.md` contains **36 sentences** of the form "the galaxy is active", and every one of them is a correct description of an observable state while exactly one galaxy exists.

Written wider, the requirement would be violated by the living spec on the day it landed. **A rule the tree does not satisfy is worse than no rule, because it stops being read** — and the repo already has the counter-example: `check-spec-drift.mjs` exists because a previous vocabulary sweep's criterion missed 72 occurrences while reporting success.

### D3 — The HUD layer slot holds a feature name, and its asymmetry is the evidence

`HudLayer = "drawing" | "galaxy" | null` answers "which fullscreen feature owns the HUD?", so its two members should be the same *kind* of name. `"drawing"` is a feature; `"galaxy"` is how the other feature happens to be drawn.

The slot itself is correct and stays: one slot rather than two booleans is what makes "at most one layer open" true by construction, and `layerAfterLeavingHud()` is what makes both layers HUD-only. Only the member name changes, so `hud-layers.test.ts` keeps asserting the same rules under new spellings — which is why task 2.2 says a changed *assertion* is a stop signal.

**This is the smallest rename and the highest-value one, because it is the one that deletes code.** The five translation lines exist precisely because `App.tsx` and `useHandGestures.ts` must convert the slot's answer into their consumers' vocabulary. Rename the slot and there is nothing left to convert.

### D4 — `GestureContext` is a set of interaction contexts, and one member was not one

`resolveGestureContext` reads `secondBrainActive` in and returns `"galaxy"` out. Its four other members — `reader`, `drawing`, `history`, `deck` — name *what owns the hand right now*. `"galaxy"` names a rendering technique.

The asymmetry between fixing it now and later is the whole argument for including it here rather than deferring it with the structural work. Today it is a rename. Once a second feature is drawn as a galaxy, `"galaxy"` is a legitimate answer for both, their gesture bindings differ, and `gesture-label.ts`'s indicator names a binding the user does not have — at which point the fix needs a discriminating parameter and a precedence decision, with a live defect in front of it.

Both `gestureContext.test.ts` and `gesture-label.test.ts` assert on the member string, so a partial rename fails the suite as well as the typecheck.

### D5 — One commit, because `tsc` makes it atomic

There is no useful intermediate state: a half-renamed seam does not compile, so committing in slices banks nothing and only makes the diff harder to read as one movement. The safety net is not per-commit revertibility here but the typechecker, and it is stronger.

The corollary is task 2's rule that every hunk must be a rename. A commit this size can hide a logic change comfortably, and nothing in the gates would catch it — which is what tasks 3.2 (test counts unchanged) and 3.4 (view modules untouched) exist to make visible.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| An incomplete rename ships a half-translated seam | `tsc --strict` over all of `src/` makes it a build failure. This is the property the whole approach rests on. |
| A logic change hides inside a large rename commit | Tasks 3.2 and 3.4: the test counts must be unchanged, and no view module may appear in `git diff --stat`. Neither is satisfiable by a rename that quietly did more. |
| A rename silently changes behavior | Nothing renamed is a string with a consumer — no IPC channel, no `localStorage` key, no DOM class, no prompt text. The three categories that *would* be risky are declined in the proposal for exactly this reason, and task 3.5 verifies they stayed declined. |
| The rename overshoots into the correctly-named view modules | Task 3.4 makes "untouched" an acceptance criterion rather than an intention. `webgl-quality.ts`'s `galaxy` key is the specific canary. |
| The new rule is later read as "always prefer `secondBrain`" | D1's question is the requirement's text, so what survives is the test rather than a direction, and `webgl-quality.ts` is named in it as the counter-example. |
| The rule is later read as governing spec prose, and someone sweeps 36 sentences | D2's scope is written into the requirement itself, with the count and the reason. |

## Migration Plan

None. No persisted state, no IPC contract, no user-visible label. Rollback is a single `git revert` of one commit.

## Open Questions

None that would change the specs, the approach or the task breakdown. The two genuinely open items — whether to split `VaultGalaxy.tsx` and whether `second-brain-gesture-nav` should be renamed and its prose swept — are recorded as declined-with-reason in the proposal rather than as questions, because each has a stated trigger (a second data source; a second galaxy consumer) and neither is a judgement call left hanging.
