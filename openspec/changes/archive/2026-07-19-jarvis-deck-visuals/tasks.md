## 1. Dependencies

- [x] 1.1 Add `three@^0.181.2`, `@react-three/fiber@^9.4.0`, `@react-three/drei@^10.7.7`, `@react-three/postprocessing@^3.0.4` to `package.json`
- [x] 1.2 Run `npm install` and `npm run build` to confirm typecheck passes with the new deps and current React version
- [x] 1.3 Add the four new dependencies to the README's exact-dependency version table, matching the convention used for other pinned SDKs/assets

## 2. Holo backdrop (new, additive)

- [x] 2.1 Create `src/components/HoloBackdrop.tsx`: an R3F `<Canvas>` rendering a drifting, bloom-lit node/particle network
- [x] 2.2 Create `src/styles/holo.css` for the backdrop's positioning/z-index (absolutely positioned inside `.deck`, above `.hud-nebula`/`.hud-glow`, below `.deck-panel` content) — do not edit `deck.css`/`base.css`/any upstream-verbatim Deep Space file
- [x] 2.3 Read backdrop colors from `tokens.css` CSS variables (`--cyan`, `--violet`, etc.) at mount instead of hardcoding hex values
- [x] 2.4 Mount `HoloBackdrop` at the deck root in `App.tsx` (only rendered in the non-HUD deck branch)
- [ ] 2.5 Verify in `npm run dev` that the backdrop renders behind all deck panels without breaking legibility of any existing panel (pipeline bar, work stream, comms, telemetry) — smoke-tested (dev server + Electron launch with no runtime errors, build passes); still needs a human visual look, no screenshot tooling available for the Electron window from this session

## 3. Arc Reactor orb rewrite

- [x] 3.1 Rewrite `src/components/ReactorCore.tsx` internals to an R3F `<Canvas>` Arc Reactor (glowing core sphere, two counter-rotating `Torus` rings, wireframe outer sphere, `EffectComposer`+`Bloom`), preserving the existing prop signature (`state`, `inputLevelRef`, `outputLevelRef`, `thinking`, `wakeKey`, `rippleKey`) plus new optional `running`/`rotation`/`scale`. (Note: the unused legacy `levelRef` prop — confirmed via repo-wide grep to have zero callers — was dropped rather than ported, since it wasn't part of the `orb-expressions` contract and porting genuinely dead code isn't warranted.)
- [x] 3.2 Re-implement each `PALETTES`/state-driven color and energy mapping from the old canvas version against the new WebGL materials, colored per-state (unchanged palette source, now applied to Three.js materials instead of canvas fill/stroke styles)
- [x] 3.3 Re-implement the thinking swirl, wake double-pulse, and speech-lock ripple animations in the new WebGL orb
- [ ] 3.4 Manually verify each `orb-expressions` scenario still fires visually: thinking swirl on pause-before-reply, double pulse on wake, ripple on speech-lock, flashes on task delegate/complete — implemented and typechecked/built cleanly; still needs a human visual look (no screenshot tooling available for the Electron window from this session)
- [x] 3.5 Confirm `CenterStage.tsx` requires no prop-surface changes (build passes unchanged against the new `ReactorCore` signature — new props are optional/additive)

## 4. Render-loop lifecycle (pause when inactive)

- [x] 4.1 Add a shared `running` signal derived from Iris's awake/asleep state (`sidecarRunning`) plus a new `windowFocused` state driven by `focus`/`blur` listeners (initialized from `document.hasFocus()`)
- [x] 4.2 Wire `HoloBackdrop`'s `<Canvas frameloop="never">` to `sidecarRunning && windowFocused`, freezing/resuming its frame loop accordingly
- [x] 4.3 Wire the rewritten `ReactorCore`'s render loop (via `CenterStage`'s new `orbRunning` prop) to the same combined signal; `frameloop="never"` freezes the mounted scene in place rather than unmounting, so no expressive state is lost
- [ ] 4.4 Verify via dev tools performance/GPU monitor that both canvases stop advancing frames when asleep and when the window loses focus, and resume on wake/focus — implemented per R3F's `frameloop` contract and typechecked/built cleanly; still needs a human check with a live GPU/frame monitor, not available from this session

## 5. Gesture-driven orb rotation/scale

- [x] 5.1 Add a `pinchDistance` (normalized thumb-tip-to-index-tip distance, landmarks 4 and 8) to each `TrackedHand` (and the primary-hand top-level state) in `useHandControl.ts`, alongside the existing categorical `fist`/`openPalm`/`pointing` fields
- [x] 5.2 In `App.tsx`, derive incremental orb rotation (into an `orbRotationRef`, read every frame by `ReactorCore` — same pattern as the existing audio-level refs) from the primary hand's movement delta while `fist` is true, gated on `handControl && !expandedTaskId` (mirroring the existing `Open_Palm`-scroll gate); pitch (`x`) is clamped to ±0.8 rad, yaw (`y`) spins freely
- [x] 5.3 Derive orb scale (into an `orbScaleRef`) from `pinchDistance`, clamped to `[0.7, 1.15]` (tightened from an initial `[0.6, 1.6]` after live testing showed the outer wireframe sphere — already ~85% of the camera frustum height at scale 1 — got clipped by the square canvas viewport past ~1.15, showing an ugly hard square edge; also added a radial-gradient mask-image vignette on `.reactor-canvas` in a new `src/styles/reactor.css` as a defensive fade for any residual edge, without touching `deck.css`), same gating; also updated the `handAction` hint label to say "rotate orb" vs "close" depending on whether the reader is open, since `Closed_Fist` now means different things in each context
- [x] 5.4 Pass the new rotation/scale refs into `ReactorCore` via `CenterStage.tsx`, applied to the 3D group without disrupting existing expressive animations
- [x] 5.5 Verify no regression: `ReaderOverlay.tsx`'s own independent `Closed_Fist`-closes/two-palm-resize effects are untouched and only mount while the reader is open, while the new orb-gesture loop is gated on `!expandedTaskId` — the two are structurally exclusive, confirmed by code inspection (not a live hardware test)
- [ ] 5.6 Verify with the reader closed: fist rotates the orb, pinch scales it, and releasing the gesture leaves the orb at its last rotation/scale — implemented and typechecked/built cleanly; still needs a live camera/gesture test, not available from this session

## 6. Final verification

- [x] 6.1 `npm run build` passes (typecheck + build) — confirmed clean after every task group
- [ ] 6.2 Manual run (`npm run dev`) covering: deck boot, wake/sleep cycle, task submit/complete flashes, window blur/focus, reader open/close with gestures, fist-rotate/pinch-scale on the orb — smoke-tested twice (dev server + Electron launch with no runtime/transform errors, both new files served correctly by Vite); full manual walkthrough of every scenario still needs a human with a camera/webcam, not available from this session
- [x] 6.3 Confirm `git diff` touches no file under the `deepspace-skin`-owned upstream list (`tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, `index.css`) — verified via `git status`, none of the six files appear in the changed-file list
