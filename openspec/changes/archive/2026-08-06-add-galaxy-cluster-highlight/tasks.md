## 1. The pose partition

- [x] 1.1 Add an `"inspect"` drive to `driveFor` in `src/lib/galaxy-nav.ts` for a hand showing `Victory`, plus a helper exposing that hand itself so the caller hit-tests with its point — partition order: two open palms → zoom, `Victory` → inspect, `Pointing_Up` → dwell, `Closed_Fist` → orbit (design.md D4)
- [x] 1.2 Update `driveFor`'s doc comment: the pinch rule stays, `Victory` is added, and the partition decides only what *acts*
- [x] 1.3 Rename the drive from `"select"` to `"inspect"` throughout — it reveals and commits to nothing, and a name that says "select" is how the withdrawn behaviour would creep back
- [x] 1.4 Extend `src/lib/galaxy-nav.test.ts`: `Victory` → the inspect drive, two open palms still win over a `Victory` hand, a `Victory` hand alongside a pointing hand still inspects, the pose is read per hand, and no other pose gained a meaning
- [x] 1.5 `npm test` green, `npm run lint` clean

## 2. Highlight rendering

- [x] 2.1 Add the lit-link colour constant to `VaultGalaxy.tsx` beside `DIM_NODE_ALPHA`/`LINK_BASE_COLOR`, with a comment recording that width is deliberately not used (design.md D1)
- [x] 2.2 Lift the graph-wide opacity ceiling (design.md D1b): set `linkOpacity(1)`, and rebalance `LINK_BASE_COLOR` to `0.175` alpha and `DIM_LINK_ALPHA` to `0.025` so every resting and dimmed link renders at exactly the opacity it does today, while a lit link can reach `0.98`
- [x] 2.3 Keep the lit alpha a hair under 1.0 — `three-forcegraph` flips a link's material to `transparent: false` / `depthWrite: true` at `opacity >= 1`, and a lit link must not change rendering mode mid-hover
- [x] 2.4 Extend `makeLinkColor` to take the pointed-at id: a link incident to it gets the lit colour, everything else keeps the existing base/dimmed logic
- [x] 2.5 Collapse `makeNodeColor`/`makeLinkColor`'s two sets (`relevantIds` + `pointedIds`) into one `litIds` — "the nodes exempt from dimming" — with the caller deciding what it is (design.md D7)
- [x] 2.6 Make the reveal a spotlight: `litIds` is the pointed-at node's one-hop cluster while something is pointed at, the focus's when nothing is, and null when neither — so everything outside the lit cluster dims, pointing takes precedence over the focus's dimming, and releasing restores it by recomputation rather than from a saved copy (design.md D7)
- [x] 2.7 Keep a focused node returned before the dimming is considered, so a selection stays visible while the spotlight is elsewhere
- [x] 2.8 Delete `relevantIdsRef` — with every producer funnelling through `repaintHighlight`, the focus set is a local and there is nothing to keep in sync
- [x] 2.9 Rename `repaintFocus()` → `repaintHighlight()` and derive both hop sets in it via the same `focusNeighborhood`, so one function remains the only place either is computed (design.md D6)
- [x] 2.10 Verify every existing caller still funnels through it: `applyGraph`, the focus-change effect, and the mount effect's first paint

## 3. Mouse producer

- [x] 3.1 Add `.onNodeHover()` to the graph setup: store the hovered node's id in a ref (null for a ghost node), never repaint inline
- [x] 3.2 Coalesce the repaint on `requestAnimationFrame` — at most one repaint per frame no matter how many hover changes fire (design.md D6)
- [x] 3.3 Cancel any pending coalesced frame in the mount effect's cleanup, so a repaint cannot land after `_destructor()`

## 4. Hand producer

- [x] 4.1 Compute the hand target only while the drive is `dwell` or `inspect` — **not** under any non-camera pose, which is the first pass's withdrawn behaviour (design.md D3)
- [x] 4.2 Make the effective pointed-at value `handTarget ?? mouseHover` at the one place the repaint reads it (design.md D2)
- [x] 4.3 For the inspect drive, hit-test from the point of the hand actually showing `Victory` (from `hand.hands`), not the primary hand's point (design.md D4)
- [x] 4.4 Remove the select dwell entirely — the second `DwellState` ref, its `dwellStep` call, and the `onToggleNode` call it fired. A reveal commits to nothing, so there is nothing to debounce and nothing to fire (design.md D4)
- [x] 4.5 Confirm the focus now has exactly one producer again: the Cmd/Ctrl-click in `onNodeClick`. `onToggleNode` stays for it and for nothing else
- [x] 4.6 `inspect` shows in the gesture debug readout's `drive` line
- [x] 4.7 Confirm the hand's highlight is cleared when the loop suspends (reader open, hand control off, sleep) so it cannot outlive the hand
- [x] 4.8 `npm run build` (typecheck) and `npm run lint` clean

## 5. Documentation

- [x] 5.1 Correct the `Victory` row in the galaxy pose table in `docs/GESTURES.md`: it reveals a node's cluster while held and selects nothing
- [x] 5.2 Correct the highlight paragraph: the producers are mouse hover, the inspect pose, and a charging dwell — **not** a hand in any pose
- [x] 5.3 Remove the claim that both a gesture and the modifier-click feed the focus; the mouse is the only producer again
- [x] 5.4 Correct the same table's stale pinch rows — it still documents "a pinch released quickly toggles focus" and "a pinch held dollies the camera", both removed by `two-palm-galaxy-zoom`

## 6. Manual verification

- [x] 6.1 Mouse: hover a node → its links are **obviously** lit AND the rest of the galaxy dims around it; move off → everything returns exactly as before
- [x] 6.1b Judge the spotlight's magnitude on a hover *sweep* — the whole graph dims and undims as the pointer moves between nodes. If it reads as flashing rather than as a spotlight, soften `DIM_NODE_ALPHA`/`DIM_LINK_ALPHA` for the transient case (design.md D7 records this as the one judgement call to confirm in use)
- [x] 6.2 Compare the graph at rest against the previous build → resting and focus-dimmed links look identical (this is what the alpha rebalance has to preserve)
- [x] 6.3 Mouse: hover a node while a focus is active → the hovered cluster becomes the only lit thing (including over what the focus was keeping bright), the focused nodes are still visibly focused, the focus chip does not change, and releasing restores the focus's dimming exactly
- [x] 6.3b Hand: hold `Victory` near a node → the rest of the galaxy dims around its cluster, and releasing restores everything
- [x] 6.4 Mouse: sweep quickly across a dense cluster → no stutter, and the highlight keeps up
- [x] 6.5 Mouse: hover a ghost node → no cluster highlight
- [x] 6.6 Hand: hold `Victory` near a node → its links blaze; **release → the view returns to normal with nothing left lit and nothing selected**
- [x] 6.7 Hand: sweep `Victory` across several nodes → one cluster at a time, nothing accumulates, the focus chip stays empty
- [x] 6.8 Hand: move a hand across the graph in a neutral pose → **nothing lights up at all**
- [x] 6.9 Hand: engage an orbit and a zoom → no highlight follows the hand during either
- [x] 6.10 Hand: confirm `Victory` is not misread as `Pointing_Up` — a sustained misread would *open a note* instead of revealing it. Check with the gesture debug readout on (`localStorage.setItem("iris.galaxyGestureDebug", "on")`): the drive line must read `inspect`, not `dwell`
- [x] 6.11 Hand: with two hands in frame, one showing `Victory` near a node and the other in another pose → the `Victory` hand's node is the one revealed
- [x] 6.12 Confirm the focus still works by Cmd/Ctrl-click, and that no gesture changes it
- [x] 6.13 Confirm `Pointing_Up` still opens a node at the same speed as before, and that the fist orbit / two-palm zoom are unchanged

## 7. Gates

- [x] 7.1 `npm run build`
- [x] 7.2 `npm test`
- [x] 7.3 `npm run lint`
- [x] 7.4 `npm run scan:secrets`
- [x] 7.5 `npm run spec:check`
