## 1. The pose partition

- [x] 1.1 Widen `driveFor`'s input type in `src/lib/galaxy-nav.ts` so it can read the pose per tracked hand, and add the `"select"` drive for a hand showing `Victory` — partition order: two open palms → zoom, `Victory` → select, `Pointing_Up` → dwell, `Closed_Fist` → orbit (design.md D4)
- [x] 1.2 Update `driveFor`'s doc comment: it currently states the partition and says a pinch has no meaning; the pinch rule stays, `Victory` is added
- [x] 1.3 Extend `src/lib/galaxy-nav.test.ts`: `Victory` → `"select"`, two open palms still win over a `Victory` hand, a `Victory` hand alongside another pose still yields `"select"`, and no other pose gained a meaning
- [x] 1.4 `npm test` green, `npm run lint` clean

## 2. Pointed-at highlight rendering

- [x] 2.1 Add the highlight colour constants to `VaultGalaxy.tsx` beside `DIM_NODE_ALPHA`/`LINK_BASE_COLOR`: a bright near-opaque link colour for incident links, with a comment recording that width is deliberately not used (design.md D1)
- [x] 2.2 Extend `makeLinkColor` to take the pointed-at id: a link incident to it gets the highlight colour, everything else keeps the existing base/dimmed logic
- [x] 2.3 Extend `makeNodeColor` to take the pointed-at hop set: a node in it is never dimmed, and the pointed-at node itself keeps the existing dwell highlight colour (design.md D5 — no third colour)
- [x] 2.4 Rename `repaintFocus()` → `repaintHighlight()` and derive both sets in it — the focus hop set as today, plus the pointed-at hop set via the same `focusNeighborhood` — so one function remains the only place either is computed (design.md D6)
- [x] 2.5 Verify every existing caller of `repaintFocus()` still funnels through it: `applyGraph`, the focus-change effect, and the mount effect's first paint

## 3. Mouse producer

- [x] 3.1 Add `.onNodeHover()` to the graph setup: store the hovered node's id in a ref (null for a ghost node, per spec), never repaint inline
- [x] 3.2 Coalesce the repaint on `requestAnimationFrame` — at most one repaint per frame no matter how many hover changes fire (design.md D6)
- [x] 3.3 Cancel any pending coalesced frame in the mount effect's cleanup, so a repaint cannot land after `_destructor()`

## 4. Hand producer

- [x] 4.1 In the gesture loop, compute the hand target whenever no camera drive is engaged — not only while `drive === "dwell"` — so any pose highlights what it is near, and none is computed during orbit/zoom (design.md D3)
- [x] 4.2 Make the effective pointed-at value `handTarget ?? mouseHover` at the one place the repaint reads it (design.md D2)
- [x] 4.3 Add a second `DwellState` ref for the select drive; feed it the target only while `drive === "select"`, using the point of the hand actually showing `Victory` (from `hand.hands`), not the primary hand's point (design.md D4)
- [x] 4.4 On a select dwell firing, call the existing `onToggleNodeRef.current(id)` — the same path Cmd/Ctrl-click uses, so the focus has one producer path
- [x] 4.5 Confirm the two dwells cannot interfere: each gets a null candidate whenever its own drive is not live, which `dwellStep` already resets on
- [x] 4.6 Add `select` to the gesture debug readout's `drive` line so the new drive is observable while tuning
- [x] 4.7 `npm run build` (typecheck) and `npm run lint` clean

## 5. Documentation

- [x] 5.1 Add `Victory` and the pointed-at highlight to the galaxy pose table in `docs/GESTURES.md`
- [x] 5.2 Correct the same table's stale pinch rows — it still documents "a pinch released quickly toggles focus" and "a pinch held dollies the camera", both removed by `two-palm-galaxy-zoom`; replace them with the two-open-palms zoom and the "a pinch means nothing" rule that `driveFor` actually implements
- [x] 5.3 Update the paragraph in `docs/GESTURES.md` that says selection is reachable "by mouse" only

## 6. Manual verification

- [ ] 6.1 Mouse: hover a node → its links brighten and its neighbours stay full strength; move off → everything returns exactly as before
- [ ] 6.2 Mouse: hover a node while a focus is active and the rest of the graph is dimmed → the hovered node and its neighbours come up to full strength, the rest stays dimmed, and the focus chip does not change
- [ ] 6.3 Mouse: sweep quickly across a dense cluster → no stutter, and the highlight keeps up (this is what the rAF coalescing is for)
- [ ] 6.4 Mouse: hover a ghost node → no cluster highlight
- [ ] 6.5 Hand: move a hand near nodes in a neutral pose → clusters highlight as it passes, nothing opens or is selected
- [ ] 6.6 Hand: engage an orbit and a zoom → no highlight follows the hand during either
- [ ] 6.7 Hand: hold `Victory` over an unselected node → after ~300 ms it becomes focused (green ring, dimming applies, focus chip names it) and no note opens
- [ ] 6.8 Hand: keep holding `Victory` on the same node → it does NOT toggle again; move away and back → it toggles
- [ ] 6.9 Hand: hold `Victory` over an already-focused node → it is released from the focus
- [ ] 6.10 Hand: confirm `Victory` is not misread as `Pointing_Up` (which would open the note instead of selecting) — check with the gesture debug readout on (`localStorage.setItem("iris.galaxyGestureDebug", "on")`)
- [ ] 6.11 Hand: with two hands in frame, one showing `Victory` over a node and the other in another pose → the `Victory` hand's node is the one selected
- [ ] 6.12 Mix: select one note by gesture and another by Cmd/Ctrl-click → both appear in the same focus chip
- [ ] 6.13 Confirm `Pointing_Up` still opens a node at the same speed as before, and that the fist orbit / two-palm zoom are unchanged

## 7. Gates

- [x] 7.1 `npm run build`
- [x] 7.2 `npm test`
- [x] 7.3 `npm run lint`
- [x] 7.4 `npm run scan:secrets`
- [x] 7.5 `npm run spec:check`
