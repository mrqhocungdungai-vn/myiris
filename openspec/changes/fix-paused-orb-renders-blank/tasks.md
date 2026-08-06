## 1. A paused surface still draws

- [x] 1.1 Change `src/components/ReactorCore.tsx:343` from
      `frameloop={running ? "always" : "never"}` to `"always" : "demand"`
- [x] 1.2 Same change in `src/components/HoloBackdrop.tsx:83`
- [x] 1.3 Handle the settle-vs-freeze problem named in design.md: `useFrame` lerps
      `energyRef` toward `targetEnergy(state)` at 0.06/frame, so under `"demand"` a
      state change that triggers one redraw would leave the orb part-way to the new
      colour. Make a paused orb settle at its target state rather than freeze
      mid-transition
- [ ] 1.4 Verify by hand that a paused orb (deck window unfocused) shows a correct
      still orb, and that it is not animating — both halves matter, since 1.1 could
      just as easily produce a continuously-running loop

## 2. The pause decision as pure logic

- [x] 2.1 Add `src/lib/orb-frameloop.ts` exporting a resolver over
      (surface: `deck-orb` | `hud-orb` | `backdrop`, awake, windowFocused) →
      whether that surface advances frames
- [x] 2.2 Encode the asymmetry `orb-expressions` specifies: deck orb and backdrop
      take the focus term, HUD orb does not; all three stop advancing when asleep
- [x] 2.3 Add `src/lib/orb-frameloop.test.ts` covering the full truth table, with the
      HUD-awake-unfocused row asserted explicitly — that is the row the spec argues
      for at length and the one a future refactor is most likely to "simplify" away
- [x] 2.4 Replace the three inline expressions with calls to it: `src/App.tsx:1733`
      (backdrop), `1775` (deck orb), `1658` (HUD orb)

## 3. Confirm the GPU saving survived

- [ ] 3.1 Measure idle GPU/CPU for the deck with the window unfocused, before and
      after the change, and record both numbers
- [ ] 3.2 If `"demand"` is redrawing continuously, find the prop that churns rather
      than reverting to `"never"` — a blank orb is not an acceptable resting state
- [ ] 3.3 Confirm an unfocused deck is not advancing frames: the orb should be
      visible and still, not visible and animating

## 4. Make the focus signal reliable

- [x] 4.1 Resynchronise `windowFocused` from `document.hasFocus()` at the moment the
      listeners attach (`src/App.tsx:455-468`), closing the startup race where the
      window is shown on `ready-to-show` after the first render
- [x] 4.2 Emit window focus/blur from the main process over the existing
      `emitToRenderer` channel in `electron/window.mjs`, alongside `hud:mode`
- [x] 4.3 Subscribe in `electron/preload.cjs` following the `onHudMode` pattern, and
      consume it in `App.tsx` as the authoritative source, keeping the DOM listeners
      as the same-process fast path
- [ ] 4.4 Confirm the main-process events fire on the HUD↔deck transition path, where
      `exitHud()` calls `mainWindow.focus()` on a window that is already focused —
      that no-op is why the symptom currently survives switching modes

## 5. Verify

- [x] 5.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
- [ ] 5.2 Manual — the originally reported path: start Iris fresh and confirm the
      deck orb is drawn, not just its CSS ring and radar
- [ ] 5.3 Manual — the second reported path: sleep, wait, wake, and confirm the deck
      orb is drawn
- [ ] 5.4 Manual: wake by voice from another app, so the deck window never receives
      focus, and confirm the orb is drawn
- [ ] 5.5 Manual: HUD mode still renders exactly as before, including while awake and
      unfocused — this change must not regress the one surface that always worked
- [ ] 5.6 Manual: switch deck → HUD → deck and confirm the orb survives the round trip
- [ ] 5.7 Record which defect actually cleared the symptom. If task group 1 alone
      fixed it, say so in the commit rather than implying both were load-bearing
