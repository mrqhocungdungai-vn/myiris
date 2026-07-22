## 1. Commit 1 — BUG F: hand data to a ref (`useHandControl.ts`)

- [x] 1.1 Keep per-frame fields (`point`, `landmarks`, `pinchDistance`, per-hand smoothed points) in a ref updated every frame; expose it from the hook (e.g. return `stateRef` alongside `state`) (design D1)
- [x] 1.2 Call `setState` only when a semantic field changes (`present`, `gesture`, `pointing`, `openPalm`, `fist`, hand count/ids) — compare against the last published semantic values; if a pure `semanticEquals(a,b)` helper falls out, put it in `src/lib` so it can be unit-tested
- [x] 1.3 No-hand branch (`:264`) and initial (`:136`): early-return without `setState` when the previous published state was already empty/absent — an empty frame does zero React work
- [x] 1.4 Confirm `enabled=false` still resets to empty state once and does no per-frame work

## 2. Commit 1 — wire the ref through `App.tsx`

- [x] 2.1 Feed `liveHandRef` from the hook's `stateRef` (or collapse the two) so the scroll loop (`816-846`) and fist-rotate/pinch loop (`854-889`) keep reading per-frame data from a ref, unchanged
- [x] 2.2 `HandReticles` (`App.tsx:1293`, `src/components/HandReticles.tsx`): position each reticle imperatively from the point ref in its own rAF (transform writes), so reticle motion costs no App re-render; React still owns which reticles mount (from semantic state) (design D2). Also extended the same imperative-ref pattern to the camera-dock/HUD hand skeleton (`CameraDock.tsx`'s `HandSkeleton`, used by both `CameraDock` and `HudShell`'s `HudCamera`) and to `ReaderOverlay`'s two-palm-resize/scroll loop — not listed in the proposal's Impact section, but both read per-hand `point`/`landmarks` every frame from the (now semantically-gated) `hand` state and would otherwise freeze between semantic transitions, regressing `two-hand-gestures`' "camera dock shows both skeletons" and "two-palm reader resize" scenarios
- [x] 2.3 Convert `dwellRef`'s render-visible facts to state: a `dwellActive` boolean (and "fired") that changes only on dwell transitions (enter target / fire), keeping the `el`/`startedAt` bookkeeping in the ref (design D3)
- [x] 2.4 `handAction` memo (`891`): drop `hand.point?.x/y` from deps (`910-911`); depend on the semantic state + `dwellActive`. The "Hold · opening" branch reads `dwellActive`
- [x] 2.5 `HandReticles` `dwelling` prop reads the new dwell state, not `dwellRef.current`
- [x] 2.6 Gate hand control so no per-frame work happens when disabled/no-hand (review the unconditional `setHandControl(true)` at `start()` `:756` — keep behavior but ensure the idle path is free)

## 3. Commit 1 — verification (manual; renderer is out of the Vitest harness)

- [x] 3.1 With hand control on and NO hand in frame, confirm App is not re-rendering ~60fps (React DevTools Profiler or a temporary render counter) — the BUG F core — manually verified
- [x] 3.2 Reticle tracks the finger smoothly, no lag/jitter vs. today — manually verified
- [x] 3.3 Dwell-click: "Hold · opening" appears within ~300ms over a target, the click fires once, and leaving+re-entering re-arms — in deck AND HUD (`.hud-hit`) mode — manually verified
- [x] 3.4 Fist-rotate, pinch-scale, two-palm resize, open-palm hold-to-scroll all still work (each `two-hand-gestures` scenario) — manually verified
- [x] 3.5 `npm run build` passes; `npm test` passes (plus any new `src/lib` helper test from 1.2) — `npm run build` and `npm test` (5 files, 39 tests, including new `src/lib/hand.test.ts`) both pass

## 4. Commit 2 — BUG G: HUD orb props

- [x] 4.1 Add `running`, `orbRotationRef`, `orbScaleRef` to `HudShell`'s props and pass them to its `<ReactorCore>` (`HudShell.tsx:255`) (design D4)
- [x] 4.2 At the `<HudShell>` call site (`App.tsx:1094`), pass `running={awake}` (NOT `awake && windowFocused` — design D4) and the existing `orbRotationRef`/`orbScaleRef` (`App.tsx:852-853`)
- [x] 4.3 Confirm the deck path is unchanged (`CenterStage` still gets `orbRunning = sidecarRunning && windowFocused`)

## 5. Commit 2 — verification (manual)

- [x] 5.1 In HUD mode, put Iris to sleep → the overlay orb's render loop stops advancing frames (GPU drops); on wake it resumes (spec: "Pauses on sleep") — manually verified
- [x] 5.2 In HUD mode, awake, focus another app (window unfocused) → the overlay orb keeps rendering (spec: "HUD orb keeps rendering while awake and unfocused") — manually verified
- [x] 5.3 In HUD mode, fist-rotate rotates the orb and pinch scales it (spec: `two-hand-gestures` "Fist rotates and pinch scales the orb") — manually verified
- [x] 5.4 `npm run build` passes

## 6. Spec and record

- [x] 6.1 `openspec validate bound-hand-and-orb-render-cost` passes
- [x] 6.2 Re-read the `orb-expressions` delta: the three scenarios (pause on sleep both modes, pause on unfocus deck-only, HUD keeps rendering while awake+unfocused) are true against the landed code; re-read `two-hand-gestures` "Fist rotates and pinch scales the orb" — now true in HUD too
- [x] 6.3 Two commits on `develop`, one per bug (commit 1 = BUG F tasks 1-3, commit 2 = BUG G tasks 4-5). Do not squash. Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark BUG F and BUG G done; note F is a behavior-preserving perf refactor (per-frame data to ref, dwell to state, landed atomically), G threads `running={awake}` + gesture refs into the HUD orb (drift fix against `orb-expressions` + `two-hand-gestures`, with one `orb-expressions` HUD clarification delta). Note this opens Wave 1; BUG H still pending
