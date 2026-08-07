## 1. Extractions first, so the component does not grow (D12)

- [x] 1.1 Move the gesture rAF loop (`VaultGalaxy.tsx:713-964`) into `src/hooks/useGalaxyCameraDrive.ts` with no behaviour change; confirm the five gates still pass before anything else is touched
- [x] 1.2 Create `src/lib/galaxy-anchor-rings.ts` mirroring `galaxy-label-sprites.ts`'s shape — `createRingPair() → { group, apply(candidatePos, anchorPos), dispose }` — with `apply` mutating in place, never allocating per frame
- [x] 1.3 Create `src/lib/galaxy-rail.ts` for the rail's data derivation, kept separate from anchor policy because the two change for different reasons

## 2. Anchor policy — pure module and tests

- [x] 2.1 Create `src/lib/galaxy-anchor.ts` with the three-variant `GalaxyAnchor` union (`centroid` / `node` / `point`) and `resolveAnchor(anchor, positions, centroid)`, falling back to the centroid when a node id no longer resolves (D1)
- [x] 2.2 Add `pickAnchorAtCenter(nodes, camera, rect, current, thresholdPx)` — `nearestNodeAt` with the rect's centre as the query point and `current` as the incumbent, returning the existing anchor unchanged when nothing is in range (D2)
- [x] 2.3 Add `shouldReleaseAnchor(radius, graphBoundingRadius, maxRadius)` — releases past a multiple of the graph's extent **or** when the radius is at the dolly clamp, so a large vault cannot make the release unreachable (D5)
- [x] 2.4 Add `easeAnchor(displayed, target, dtMs)` — the ~180 ms lerp of the displayed look-at point only (D3)
- [x] 2.5 Add `isHandLowered(point, viewportHeight)` to `src/lib/galaxy-nav.ts` — true in the bottom third, compared against the window because hand points are window pixels (D6)
- [x] 2.6 Write `src/lib/galaxy-anchor.test.ts`: unresolvable node falls back to centroid, a `point` anchor round-trips, incumbent dead-band prevents flapping between neighbours, nothing-in-range keeps the current anchor, release fires both past the extent multiple and at the clamp, ease converges and no-ops at target
- [x] 2.7 Extend `src/lib/galaxy-nav.test.ts` for `isHandLowered` boundaries

## 3. Wire the anchor into the camera

- [x] 3.1 Split `centerRef` into `centroidRef` + `anchorRef` + `displayedAnchorRef`, and extend the existing dirty-flag pass to compute the graph's bounding radius alongside the centroid
- [x] 3.2 Change `writeCameraFromSpherical` so the **orbit origin is the target anchor** and only the **look-at argument is the displayed (easing) anchor** — the two roles must not share one value, or the camera lurches by the anchor delta on every engage (D3)
- [x] 3.3 Change the drive-engage path (currently `VaultGalaxy.tsx:877`) to call `pickAnchorAtCenter` first, then seed the spherical from `camera.position − targetAnchor`, never writing the camera's position (D4)
- [x] 3.4 Add a `syncControlsTarget(anchor)` helper: write `controls.target` directly when the controls are enabled, and leave it to the release path when they are not (D4b)
- [x] 3.5 Change `restoreControlsIfNeeded` to copy the anchor instead of the centroid, **and only when this engage actually changed the anchor** — otherwise a grab over empty space writes a stale anchor over the user's mouse pan (D4b)
- [x] 3.6 Add a `controls`-change path that records a mouse pan as a `{kind:"point"}` anchor, since `TrackballControls._panCamera` mutates `target` in place and no other code will see it (D1)
- [x] 3.7 Apply `shouldReleaseAnchor` in the zoom drive
- [x] 3.8 Lower `ZOOM_MIN_RADIUS` from 15 to ~8 (after 3.3 and 3.7, which is what makes the new floor meaningful)
- [x] 3.9 Anchor to the opened note in the click and dwell open paths, routing through `syncControlsTarget`
- [x] 3.10 Add a `wheel` handler that anchors to the hovered node when one is hovered, reusing `mouseHoverRef`, routing through `syncControlsTarget`
- [x] 3.11 Collapse the drive to `null` when `isHandLowered` holds, routing through the existing drive-released path so reference clearing, control restore and highlight clearing come for free (D6)

## 4. Visual feedback

- [x] 4.1 Mount the ring pair from 1.2, re-selecting the candidate on the existing `SELECT_INTERVAL_MS` cadence while updating transforms every frame
- [x] 4.2 Pick ring treatments distinguishable from the pointed-at highlight and the focus ring, avoiding collisions with `TAG_COLORS`, the ghost grey, `DWELL_HIGHLIGHT_COLOR` and `FOCUS_HIGHLIGHT_COLOR`
- [x] 4.3 Gate the rings and reticle on hand control on, galaxy active, no reader open, and the render loop running, so they stop when Iris sleeps
- [x] 4.4 Add the centre reticle as a `pointer-events: none` element **outside** any chrome island, following the `.hud-galaxy-gesture-debug` precedent — inside chrome it would make `hudChromeAtPoint` (`VaultGalaxy.tsx:845`) kill node dwell and inspect at screen centre (D10)

## 5. Step rail

- [x] 5.1 Implement the rail data in `src/lib/galaxy-rail.ts`: one-hop entries via `focusNeighborhood([centreId], links)` with the centre note filtered out of its own list, degree-ordered entry points for the no-centre case, and the composed island class string exported so it can be asserted without a DOM (D7, D9)
- [x] 5.2 Unit-test 5.1: centre note excluded, ghost neighbours included and flagged not-openable, degree ordering, empty graph yields an empty rail, and the class string contains `HUD_CHROME_CLASS` — omitting it silently makes the rail unreachable by hand
- [x] 5.3 Build the rail component — entries as plain `<button>`s carrying title, tag colour and link count, sized for hand use (~200×44 px), ghost entries marked not openable, keyed by note id so React does not recycle an element between unrelated notes
- [x] 5.4 Give the rail island `HUD_CHROME_CLASS` and `hud-hit`, and add its `hud.css` rules; verify the entry activates through the existing universal dwell with **no** edit to `App.tsx`'s dwell rule — an edit being necessary would contradict the chrome rule this design rests on, so stop and re-plan rather than making one
- [x] 5.5 Implement the step handler in `GalaxyCanvas` (it needs `fgRef`; the rail component takes it as a prop): fly with `cameraPosition(pos, anchorPos, 600)` preserving the camera's current viewing direction and changing only distance, set the anchor to the destination, recentre the rail (D8, D12)
- [x] 5.6 Disable rail entries for a short interval after a step so a still-held hand cannot step again — the dwell keys fire-once on element identity and the rail repopulating hands it a fresh element (D11)
- [x] 5.7 Clear the rail's centre note on every galaxy-close route, on the same terms that already clear the open note and the focus
- [x] 5.8 Confirm stepping changes no focus, opens no note, and leaves the voice-layer context untouched
- [x] 5.9 Add a comment at the flight call site recording why an interrupting drive does not jump (`Tween.end()` snaps to the destination and `setCameraPos` overwrites it in the same synchronous call, so no frame renders in between) — it is not evident from the code

## 6. Docs, manual pass, gates

- [x] 6.1 Update `docs/GESTURES.md` with the anchor model, the lowered-hand release and the rail; keep `CLAUDE.md` a router
- [x] 6.2 Document the new tuning constants in the style of the existing galaxy constants
- [x] 6.3 Seed a 200–500 note test vault — `scripts/seed-galaxy-test-vault.mjs`, revised after 7.x to write several MUTUALLY UNLINKED clouds, since entry-point coverage per region is unobservable in a vault that happens to be one connected graph
- [ ] 6.4 Manual pass on that vault: entry points reaching every cloud, anchor prediction, orbit around a node, zoom into a dot, rail traversal, a held hand after a step, lowered-hand release, whether the anchor visibly drifts while the layout settles, that a mouse pan survives a full engage/release cycle, and that engaging a drive mid-flight does not jump — the last two cannot be unit-tested because both vitest projects are `environment: "node"`
- [x] 6.5 Resolve the design's open question (candidate ring during a drive) from the manual pass
- [x] 6.6 Run all five gates: `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`

## 7. Entry points cover every region (D7b, from the manual pass)

- [x] 7.1 Add `connectedRegions(nodes, links)` to `src/lib/galaxy-rail.ts` — undirected components over the same link list everything else reads
- [x] 7.2 Add `railRoots({ nodes, links, budget })`: one entry per region (its most connected note) as a guarantee, then fill the remaining budget by degree overall, with regions of a single unlinked note contributing nothing
- [x] 7.3 Rename `railEntries` to `railNeighbours` and drop its no-centre branch — the two questions now have two functions, and one name answering both is what let the coverage hole hide
- [x] 7.4 Unit-test 7.1-7.3: a region unreachable from the main body still gets an entry, the guarantee survives more regions than the budget, a one-note region with no links is excluded, a single-region vault still gets a spread of hubs, and the neighbour list is unchanged
- [x] 7.5 Render the rail as two sections — entry points always, the centre note's neighbours below — with the centre note named so the user knows where they are
- [x] 7.6 Confirm the step lock (D11) covers both sections, since either can be the element under a still-held hand

## 8. The sight follows the hands (D14, from the manual pass)

- [x] 8.1 Add `sightPoint(hand, fallback)` to `src/lib/galaxy-nav.ts` — two-palm midpoint, else the primary hand's point, else the view's centre
- [x] 8.2 Generalise `pickAnchorAtCenter` to `pickAnchorAt(..., point, ...)`, with `rectCentre` left as the named fallback rather than the rule
- [x] 8.3 Position the reticle from the sight every frame by direct `transform` write, never React state
- [x] 8.4 Resolve the orbit's anchor from the sight at engage and hold it — its input is the hand's travel, so a live sight would re-aim on the motion meant to be turning the camera
- [x] 8.5 Re-resolve the zoom's anchor from the sight for the whole drive, sharing one `reseedAroundAnchor` with the zoom-out release so a mid-drive change cannot move the camera
- [x] 8.6 Unit-test 8.1-8.2: the midpoint holds still while palms spread symmetrically, the fallbacks chain, and a node under an off-centre sight wins over one at screen centre
- [ ] 8.7 Manual pass on the sight specifically: whether aiming by hand actually lands, and whether the dolly stalls from the anchor flapping between neighbours mid-zoom
- [x] 8.8 Fix the dolly-stalls-while-moving finding from 8.7 (D17): the zoom's per-frame re-aim was calling `pickAnchorAt` fresh every frame instead of reading the ring's own throttled pick, so a moved sight reset the zoom reference far more often than the visible candidate ever suggested — `pivotPickRef` now shares one evaluation between both consumers

## 9. The pivot is the mark, and notes are findable by name (D15/D16)

- [x] 9.1 Add `sightPivotPoint(camera, rect, point, depthPoint)` — the sight ray crossed with the plane at the current working depth, with scratch vectors so the loop allocates nothing
- [x] 9.2 Add `pickPivotAt(...)`: a node when one is near the sight, else the point under it — no "keep the current anchor" case, which is what let the last-opened note act as an invisible pivot
- [x] 9.3 Engage both drives through `pickPivotAt`; keep the zoom's live re-aim on `pickAnchorAt` (nodes only), since a point pivot re-derived each frame would chase the aim ease that recentres it
- [x] 9.4 Redraw the sight as a plus rather than a ring, keeping the engaged treatment
- [x] 9.5 Add `railSearch({ query, nodes, links })` — title match, case- and diacritic-folded, ranked exact/prefix/substring then by connectedness
- [x] 9.6 Put a search field in the rail island; matches replace the entry points while a query is up and are steppable on the same terms
- [x] 9.7 Unit-test 9.1-9.2 and 9.5: the pivot lands off-centre under an off-centre sight and mirrors about the centre, a stale anchor is never kept, diacritics are ignored, and the ranking holds
- [ ] 9.8 Manual pass: whether "turn around the mark" reads well when the sight is off to one side (the aim eases onto it, so the view swings by that offset), and whether the search makes the rail worth having
- [x] 9.9 Propose the voice half of the search as its own change — there is no second-brain tool on the Gemini surface today, so it needs a tool declaration, a main-process handler, and a route into this component
