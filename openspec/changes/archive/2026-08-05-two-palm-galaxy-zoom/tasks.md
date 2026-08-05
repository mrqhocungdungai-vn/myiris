## 1. Smooth every tracked hand (design D4)

- [x] 1.1 In `src/hooks/useHandControl.ts`, replace the single `smooth` point with a per-hand smoothing map keyed by hand id (EMA, alpha 0.5 — the value the primary hand already uses), and publish every hand's smoothed point in the `hands` array
- [x] 1.2 Keep the primary hand's published `point` (the top-level `HandState.point`) reading from that same per-hand entry, so there is one smoothed value per hand rather than two that can disagree
- [x] 1.3 Clear the smoothing map on the no-hand transition, alongside `stableGestureById.clear()` / `candidateGestureById.clear()`, so a returning hand seeds fresh instead of easing in from its last-seen position
- [x] 1.4 Extract the smoothing step as a pure helper so it can be unit-tested without a camera

## 2. Pure policy: stateless partition and the ratio zoom law (design D3, D5)

- [x] 2.1 In `src/lib/galaxy-nav.ts`, delete `PoseDriveState`, `INITIAL_POSE_DRIVE_STATE`, `PINCH_ENGAGE`, `PINCH_RELEASE`, `RELEASE_STREAK_TO_DISENGAGE`, `TAP_MAX_MS`, and the `"tap"` member of `GalaxyDrive`
- [x] 2.2 Rewrite `driveFor` as a stateless function of the frame's hand state: two open palms (`hands.filter(h => h.openPalm).length >= 2`) → `"zoom"`, `pointing` → `"dwell"`, `fist` → `"orbit"`, otherwise `null`; drop `pinchDistance` from `DriveHand`
- [x] 2.3 Replace `radiusStep` with a pure `zoomRadius({ refRadius, refDist, curDist, min, max })` implementing `clamp(min, max, refRadius * refDist / curDist)`, flooring both `refDist` and `curDist` at the same 80px minimum `ReaderCore` uses
- [x] 2.4 Add a pure helper for the distance between two tracked hands' points, so the driver and the tests measure it the same way
- [x] 2.5 Leave `nearestNodeAt`, `dwellStep`, `orbitStep`, and `focusNeighborhood` untouched

## 3. Galaxy driver (design D1, D5)

- [x] 3.1 In `src/components/VaultGalaxy.tsx`, change `zoomReferenceRef` from `{ pinch, radius }` to `{ dist, radius }`, seeded from the two-hand distance on the frame the zoom drive engages
- [x] 3.2 Apply `zoomRadius` in the zoom branch, replacing the `pinchDelta` computation and the `ZOOM_SENSITIVITY` constant
- [x] 3.3 Delete the `drive === "tap"` block and stop threading `poseStateRef` through the loop
- [x] 3.4 Leave the `controls.enabled` disable/restore path, `ensureCenterFresh`, and `writeCameraFromSpherical` exactly as they are
- [x] 3.5 Confirm `onToggleNode` is still wired for the Cmd/Ctrl-click path in `onNodeClick` and is no longer called from the gesture loop

## 4. Action indicator (design D6)

- [x] 4.1 In `src/App.tsx`, replace the galaxy branch's `hand.pinchDistance < 0.08` test with `hand.hands.filter(h => h.openPalm).length >= 2` and the label `"Two palms · zoom"`
- [x] 4.2 Remove `hand.pinchDistance` from that `useMemo`'s dependency list (it stays used by the deck orb loop, which is a separate effect)
- [x] 4.3 Verify the galaxy branch's ordering matches `driveFor`'s partition so the label can never name a binding that is not live

## 5. Debug readout (design D7)

- [x] 5.1 Add a `localStorage`-backed flag, default off, following the existing renderer preference pattern
- [x] 5.2 Render the readout only while the galaxy is active and the flag is on: hand count, per-hand stabilized gesture, `curDist`, `refDist`, ratio, resulting radius, live drive, fps
- [x] 5.3 Drive it from the existing gesture rAF loop via a ref and direct DOM writes — no second loop, and no React state update per frame

## 6. Tests

- [x] 6.1 Rewrite the `driveFor` block in `src/lib/galaxy-nav.test.ts`: two open palms → zoom, fist → orbit, pointing → dwell, single open palm / unrecognized / resting hand → null, and a pinched hand at any thumb-index distance → whatever its canned class says, never a zoom
- [x] 6.2 Delete the pinch, tap-discrimination, release-streak and hold-window tests along with the code they cover — do not leave them skipped
- [x] 6.3 Test `zoomRadius`: spreading (larger `curDist`) shrinks the radius, closing grows it, both clamps hold, and the `refDist`/`curDist` floors keep the result finite when hands nearly touch
- [x] 6.4 Test the per-hand smoothing helper: it converges toward the target, smooths each hand independently, and a cleared entry seeds from the current position rather than the previous one
- [x] 6.5 Check whether `src/lib/gestureContext.test.ts` or any other test asserts the removed pinch behavior, and update it

## 7. Gates and manual pass

- [x] 7.1 `npm run build` (tsc src + tsc electron + vite build)
- [x] 7.2 `npm test`
- [x] 7.3 `npm run lint`
- [x] 7.4 `npm run scan:secrets`
- [x] 7.5 `npm run spec:check`
- [x] 7.6 Manual pass with the debug readout on: two palms zoom in and out across the camera's range; a fist orbits; a tight pinch orbits and never flips; opening a note moves two-palm to the reader and closing it returns the binding to the camera; mouse drag/scroll still works after every gesture exit
