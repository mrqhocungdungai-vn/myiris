## Why

Iris runs a WebGL orb (bloom postprocessing), MediaPipe GPU inference, and 24 kHz audio playback at the same time. Two render-path defects burn that frame budget continuously:

**BUG F — `useHandControl` calls `setState` every rAF frame.** Both the hand-present branch (`src/hooks/useHandControl.ts:245`) and the no-hand branch (`:264`, plus the initial `:136`) push a brand-new `HandState` object into React state ~60×/second. `useHandControl` is called in `App.tsx:778` and App has **no `memo` anywhere in its tree**, so every frame re-renders all 1291 lines: `CenterStage → ReactorCore → <Canvas>` (R3F reconciles the whole scene graph), the Work Stream and up to 20 cards, Comms, and HudShell. Line 264 is the worst: with **no hand in frame** it still re-renders the entire tree 60×/second for nothing. And `start()` enables hand control unconditionally (`App.tsx:756`), so this is the default state of every awake session.

**BUG G — the Glass HUD orb never stops rendering, and its gestures are dead.** `HudShell` renders `<ReactorCore>` (`src/components/HudShell.tsx:255`) without a `running` prop, so it defaults to `true` (`ReactorCore.tsx:235`) → `frameloop="always"`. The HUD is the always-on-top overlay meant to stay up while you work in *other* apps — exactly when the deck would pause — so WebGL + `EffectComposer`/`Bloom` runs 60fps forever, including while Iris is **asleep**. That violates `orb-expressions` "Orb render loop pauses when inactive" (SHALL pause when asleep). The same call site omits `rotationRef`/`scaleRef`, so fist-rotate and pinch-scale — required by `two-hand-gestures` "Fist rotates and pinch scales the orb", which is not deck-scoped — silently do nothing in HUD. That is a functional regression, not just a perf one.

## What Changes

Wave 1 lands as **two commits**, one per bug (they are independent — no shared code — but form the render-path frame-budget unit and land together).

**Commit 1 — BUG F: hand data to a ref, React state only on semantic change.**
- Keep per-frame hand data (cursor point, landmarks, pinch distance) in a ref; publish to React state **only when a semantic field changes** (hand present↔absent, gesture class, pointing/openPalm/fist, hand count). The no-hand branch early-returns when the previous state was already empty, so an empty frame triggers no work. The imperative-read pattern already exists — `liveHandRef` (`App.tsx:779-780`) and the scroll/orb rAF loops (`816-846`, `854-889`) already read hand data from a ref.
- `HandReticles` (`App.tsx:1293`) moves its per-hand reticles from the smoothed point ref imperatively (its own rAF / transform writes), so reticle motion no longer costs an App re-render.
- **Coupled and landing in this same commit:** `dwellRef` is written in an effect (`App.tsx:809-810`) but **read during render** (the `handAction` memo at `:891`, the `HandReticles` `dwelling` prop at `:1293`). It only works today because the memo's deps include `hand.point?.x/y` (`:910-911`), which change every frame *because of BUG F*. Once point stops driving re-renders, the "Hold · opening" label would go stale — so `dwellRef` becomes a small state/version counter that bumps on dwell-state change (enter target / fire), in this same commit. Not before, not after.
- Make hand control conditional rather than unconditionally-on where cheap (at minimum, no per-frame work when disabled or no hand).

**Commit 2 — BUG G: pass `running` and the gesture refs into the HUD orb.**
- Thread `running={awake}` into `HudShell`'s `<ReactorCore>` so the overlay orb pauses when Iris is asleep (satisfying `orb-expressions`), while continuing to render when awake even if the OS window is unfocused — the HUD is the ambient always-visible overlay, unlike the deck.
- Thread `orbRotationRef`/`orbScaleRef` (already held in `App.tsx:852-853`) through `HudShell` into `<ReactorCore>` so fist-rotate and pinch-scale work in HUD (satisfying `two-hand-gestures`).

Not in scope (the "other renderer items" table in the plan — separate work): `ReactorCore` per-frame `THREE.Color`/`Vector3` allocations, the `ScriptProcessorNode`→`AudioWorklet` migration, and the `window.confirm` main-thread block. This change fixes the two render-loop defects that dominate the budget; those are follow-ons.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `orb-expressions`: "Orb render loop pauses when inactive" currently phrases its focus clause around "the deck window." Clarify that in HUD mode the overlay orb pauses when Iris is asleep but keeps rendering while awake even when the OS window is unfocused, since the HUD is the always-visible overlay whose orb is the ambient liveness indicator. This pins the deliberate deck-vs-HUD divergence so a future change does not "fix" the HUD orb to pause on blur and break the glanceable overlay.

BUG F changes no spec: it is a behavior-preserving performance refactor; every `two-hand-gestures` scenario (reticles, dwell-click, fist/pinch, two-palm resize, open-palm scroll) must still hold and is the regression checklist. BUG G's gesture half is drift against `two-hand-gestures` (code catching up), needing no delta.

## Impact

- `src/hooks/useHandControl.ts` — publish semantic-only state; per-frame data via ref; no-hand early-return.
- `src/App.tsx` — `dwellRef`→state/version; `handAction` memo deps drop `hand.point?.x/y`; `HandReticles` fed a point ref; hand control gated.
- `src/components/HandReticles.tsx` — imperative per-frame reticle positioning.
- `src/components/HudShell.tsx` + its call site in `App.tsx:1094` — new `running`, `orbRotationRef`, `orbScaleRef` props threaded to `<ReactorCore>`.
- `orb-expressions` living spec — one MODIFIED requirement (HUD clarification).
- No new dependency, no data migration. Renderer code remains out of the automated harness except pure helpers; verification is manual FPS/behavior checks in tasks.
