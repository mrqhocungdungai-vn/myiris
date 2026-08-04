## Context

See proposal.md — Why.

Three facts about the current code shape the approach:

1. **The orb binding is the only leak.** `App.tsx` runs three rAF gesture loops
   (dwell-click, open-palm hold-to-scroll, orb rotate/scale). The first two already
   bail on `drawingActive || secondBrainActive`, and the note reader only renders
   while `secondBrainActive` is true, so they cannot fire behind a fullscreen HUD
   layer. Only the orb loop's `engaged` predicate omits `uiMode`.
2. **`uiMode` is orthogonal to `GestureContext`.** `resolveGestureContext` returns
   `reader | galaxy | drawing | history | deck` — a *layer* axis. HUD is not a fifth
   layer: a reader or a galaxy can be open inside the HUD. So this cannot be
   expressed by adding a `"hud"` member to that union.
3. **The indicator's "deck" branch also serves the HUD.** `App.tsx:1272-1282` is
   reached whenever the context is `deck`, in either UI mode, and it hardcodes
   `"Closed_Fist · rotate orb"`. In the HUD that label is already a lie today; the
   branch has precedent for a mode-sensitive answer, since `drawingActive` is
   special-cased right next to it.

## Goals / Non-Goals

**Goals:**

- One predicate decides whether the orb binding is live, read by both the rAF loop
  and the action indicator, so the two can never disagree about it again.
- The predicate is a pure function in `src/lib/`, unit-testable without React, a
  canvas, or a webcam.

**Non-Goals:**

- Rewriting the other two deck loops onto `resolveGestureContext`. Their existing
  guards are correct for this change's purposes; the resolver's own header records
  that adoption as deliberate known debt, and widening it here would put working
  code at risk for no behavioral gain.
- Changing `ReactorCore`'s prop surface. It keeps `rotationRef` / `scaleRef` and
  keeps applying them. Only the driver narrows — which is what keeps
  `orb-expressions`' "accepts optional rotation and scale inputs and visually
  applies them" requirement true without a delta.
- Giving the HUD any *new* fist or pinch binding. This change frees the gesture, it
  does not spend it.

## Decisions

### D1 — A dedicated exported predicate, not an inline `uiMode !== "hud"`

Add `orbGestureEngaged(...)` to `src/lib/gestureContext.ts`, taking the flags the
binding depends on (`handControl`, `handPresent`, `uiMode`, `readerOpen`,
`drawingActive`, `secondBrainActive`) and returning a boolean.

*Why over the one-line inline fix:* the inline edit is smaller but re-creates the
exact defect this file was written to fix — its header documents the precedence
being "re-derived independently at every gesture-loop call site with disagreeing
spellings". The loop and the indicator are two such call sites, and today they
already disagree: the loop bails on `drawingActive`, the indicator prints
`Closed_Fist · idle` for the same case in a separate hand-written branch. A shared
predicate makes the HUD condition impossible to add to one and forget in the other.

*Why in `gestureContext.ts` rather than a new file:* it is the same subject at the
same altitude (which gesture owns the surface right now), the file is 27 lines, and
the repo's convention targets 250–450, so a new module would be splitting for its
own sake.

### D2 — The indicator reports `Closed_Fist · idle` in the HUD

Reuse the label `drawingActive` already produces rather than inventing a new one.
The user-visible truth is the same in both cases — the fist is recognised and bound
to nothing here — so a second spelling would only add vocabulary.

*Alternative considered:* naming a HUD-specific binding (e.g. `Closed_Fist · —`).
Rejected: the indicator's job per the spec is to report the live binding, and there
isn't one.

### D3 — `uiMode` joins the effect's dependency array

This is what makes the two mid-gesture scenarios fall out for free rather than
needing explicit teardown code: React re-creates the effect on a mode switch, which
discards the `prevFistPoint` closure local. Rotation therefore re-seeds on the next
engaged frame and applies no delta, and the refs are never written while
disengaged, so the orb holds its last deck pose.

Scale is deliberately left as-is. It maps pinch distance absolutely
(`0.7 + norm * 0.45`), so it resumes tracking the hand's present pinch the moment
the binding re-engages. That is pre-existing behaviour on every disengagement — the
reader closing, the galaxy exiting — and this change neither introduces nor fixes
it. The spec records it explicitly so the behaviour is described rather than
discovered.

## Risks / Trade-offs

- **The predicate grows a sixth boolean parameter and becomes hard to call
  correctly** → it takes a named object, matching `resolveGestureContext`'s existing
  signature, so arguments cannot be silently transposed.
- **A future HUD binding for the fist is added without noticing the orb no longer
  claims it** → the spec's HUD scenario states the orb is untouched, not that the
  fist is unbound, so a later change can bind it without contradicting this one.
- **The indicator and the loop drift again if a future context is added** → mitigated
  but not eliminated: D1 shares the *engaged* decision, not the label mapping. The
  label branch remains hand-written per context, which is the same shape the reader
  and galaxy branches already have.

## Migration Plan

None — no persisted state, no config, no data. The change is inert on the deck and
removes a binding in the HUD; reverting is a straight revert.
