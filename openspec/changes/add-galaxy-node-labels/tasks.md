## 1. Pure selection policy

- [x] 1.1 Create `src/lib/galaxy-labels.ts` with `selectLabels(nodes, cameraPos, { maxDistance, budget, eligible })` returning the ≤budget nearest eligible nodes within `maxDistance`, nearest first — squared distances only, no `sqrt` (design.md D3)
- [x] 1.2 Write `src/lib/galaxy-labels.test.ts` covering: nodes outside `maxDistance` excluded and inside included (boundary at exactly `maxDistance`), ordering is nearest-camera-first, a selection longer than `budget` truncated to the nearest `budget`, `eligible = null` filters nothing while a non-empty `eligible` excludes non-members, ghost nodes included, and nodes with no position yet skipped
- [x] 1.3 `npm test` green, `npm run lint` clean

## 2. Label sprite pool

- [x] 2.1 Create `src/lib/galaxy-label-sprites.ts` exporting `createLabelPool(budget)` → `{ group, apply(selection), dispose() }`, with a header comment stating why it carries no unit test (needs a 2D canvas context; `src/**/*.test.ts` runs in vitest's `node` environment — design.md D3)
- [x] 2.2 Build the pool: `budget` sprites in one `THREE.Group`, each with its own fixed 512×96 canvas + `CanvasTexture` (`minFilter = LinearFilter`, `generateMipmaps = false`), material `transparent: true`, `depthWrite: false`, `depthTest: true` (design.md D1)
- [x] 2.3 Implement `apply(selection)`: repaint a slot's canvas only when the id assigned to it changed, crop the texture to the measured text via `repeat`/`offset` and set the sprite scale to the measured aspect so short and long titles draw at the same text height, position each sprite at its node's live `x/y/z` plus `LABEL_Y_OFFSET` on Y, and hide the tail slots when the selection is shorter than the pool (design.md D2)
- [x] 2.4 Implement measured elision: draw shrinking prefixes + `…` until `measureText` fits the canvas width (spec: "A very long note title is elided")
- [x] 2.5 Paint a ghost node's title in the same faded grey the ghost node uses, and a real note's in a soft blue-white chosen not to bleed under bloom (design.md D6/D8)
- [x] 2.6 Implement `dispose()`: dispose every texture and material, remove the group from its parent — verify no leak across galaxy open/close cycles in task 5.6

## 3. Wire into the galaxy

- [x] 3.1 Add the tuning constants to `VaultGalaxy.tsx` beside `ZOOM_MIN_RADIUS`/`ZOOM_MAX_RADIUS`: `LABEL_MAX_DISTANCE = 180`, `LABEL_BUDGET = 24`, `LABEL_WORLD_HEIGHT = 5`, `LABEL_Y_OFFSET = 6`, `SELECT_INTERVAL_MS = 100`, each with the reasoning from design.md D9
- [x] 3.2 Create the pool in the mount effect (after the graph instance exists) and add its group to `fg.scene()`; dispose it in that effect's cleanup, alongside `fg._destructor()`
- [x] 3.3 Add a `useEffect` on `[running]` owning its own rAF loop: re-select every `SELECT_INTERVAL_MS` from `positionsRef` + `fg.camera().position` + `relevantIdsRef.current` as `eligible`, and `apply()` the current assignment every frame (design.md D5/D7)
- [x] 3.4 Wrap the loop body in try/catch like the gesture loop, but on error hide the labels and stop the loop rather than force-closing the galaxy (design.md Risks)
- [x] 3.5 Confirm the loop schedules nothing while `running` is false, and that its cleanup cancels the rAF and hides all labels
- [x] 3.6 Keep `VaultGalaxy.tsx`'s addition to wiring only — no canvas or selection logic in the component (design.md Context: the file is already 799 lines)
- [x] 3.7 `npm run build` (typecheck) and `npm run lint` clean

## 4. Documentation

- [x] 4.1 Add proximity titles to the galaxy section of `docs/GESTURES.md`, beside the `zoomToFit`-on-first-settle and focus-declutter notes — what reveals a title, that the count is budgeted, and that it needs no pointer
- [x] 4.2 Correct the stale over-convention line count for `src/components/VaultGalaxy.tsx` in `docs/TESTING.md` (recorded as 561, actually 799 before this change) to the post-change figure
- [x] 4.3 Check whether `docs/ARCHITECTURE.md`'s component/module map needs the two new `src/lib/` modules listed, and add them if it lists peers like `galaxy-nav.ts` — checked: ARCHITECTURE.md's Main Components list doesn't enumerate `src/lib/` files at all (no `galaxy-nav.ts` entry either), so no addition needed

## 5. Manual verification on a real vault

- [ ] 5.1 Open the galaxy on a vault with enough notes to frame far out: confirm it opens with no titles at all and reads as before
- [ ] 5.2 Fly in toward a cluster: titles appear for the near nodes only, and the far side of the graph stays unlabelled; pull back and they disappear again
- [ ] 5.3 Confirm titles track their nodes while the layout is still settling (open the galaxy and watch during the initial settle)
- [ ] 5.4 Focus a note (Cmd/Ctrl-click or pinch-tap): confirm no dimmed node carries a title, and the focused node and its one-hop neighbours do
- [ ] 5.5 Confirm titles work with hand control off (mouse-drag navigation only) and with it on
- [ ] 5.6 Toggle the galaxy off and on several times: no leaked labels, no growing memory, and titles still correct after remount
- [ ] 5.7 Put Iris to sleep with the galaxy open: rendering pauses and titles stop; on wake they resume correctly positioned
- [ ] 5.8 Verify on the high-fidelity quality path specifically that bloom does not smear the text illegibly, and adjust the label colour if it does
- [ ] 5.9 Confirm the tuning constants feel right on a real vault at both ends — titles are not permanently on, and not unreachably far — and adjust `LABEL_MAX_DISTANCE`/`LABEL_BUDGET` if not (design.md D9 records them as starting points)
- [ ] 5.10 Create a note whose filename contains `<img src=x onerror=alert(1)>`, get close enough to name it, and confirm the characters render literally with no script execution (spec: "A crafted note title is inert as an in-scene title")
- [x] 5.11 (found during manual pass) With mouse-only navigation (scroll-wheel zoom, no pan), a note off the camera's exact line of sight never revealed its title no matter how far zoomed in, while one on that line did — traced to selecting by the camera's eye position, which `TrackballControls`' zoom dollies toward a fixed orbit target rather than toward whatever's on screen. Fixed: measure from `controls.target` instead (design.md D10); spec.md and this file updated to record the requirement change.

## 6. Gates

- [ ] 6.1 `npm run build`
- [ ] 6.2 `npm test`
- [ ] 6.3 `npm run lint`
- [ ] 6.4 `npm run scan:secrets`
- [ ] 6.5 `npm run spec:check`
