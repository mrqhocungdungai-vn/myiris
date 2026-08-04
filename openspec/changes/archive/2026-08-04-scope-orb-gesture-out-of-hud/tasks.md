## 1. The shared predicate

- [x] 1.1 Add `orbGestureEngaged({ handControl, handPresent, uiMode, readerOpen, drawingActive, secondBrainActive })` to `src/lib/gestureContext.ts`, returning `true` only in deck mode with hand control on, a hand present, the reader closed and neither fullscreen HUD layer active (design.md D1)
- [x] 1.2 Extend `src/lib/gestureContext.test.ts` to cover the predicate: engaged on the deck; disengaged for each of hand-control-off, no hand, HUD mode, reader open, drawing active, galaxy active; and disengaged in HUD even when every other condition is satisfied — the case that is broken today

## 2. Scope the binding

- [x] 2.1 Rewrite the orb rAF loop's `engaged` predicate in `src/App.tsx` to call `orbGestureEngaged`, and add `uiMode` to the effect's dependency array so a mode switch discards the `prevFistPoint` closure local (design.md D3)
- [x] 2.2 Update the loop's leading comment to record that the HUD is excluded and why, replacing the current comment's reader/drawing/galaxy-only rationale

## 3. Tell the truth in the indicator

- [x] 3.1 In `handAction`'s deck branch (`src/App.tsx`), return `Closed_Fist · idle` when the UI is in HUD mode, alongside the existing `drawingActive` case (design.md D2)
- [x] 3.2 Add `uiMode` to the `handAction` memo's dependency array

## 4. Verify

- [x] 4.1 Run the four gates — `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`
- [x] 4.2 Launch the app and confirm by hand: on the deck a fist still rotates the orb and a pinch still scales it; entering the Glass HUD and making a fist or pinch leaves the orb still while the indicator reads `Closed_Fist · idle`; returning to the deck rotates the orb again from its held pose without the rotation snapping
- [x] 4.3 Confirm `docs/GESTURES.md`'s gesture→action table still reads true, and add the HUD exclusion to it if it does not
