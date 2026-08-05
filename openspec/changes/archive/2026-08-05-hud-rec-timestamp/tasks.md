# Tasks

## 1. The pure formatter

- [x] 1.1 Add `src/lib/rec-clock.ts` with `formatRecStamp(date: Date): string` returning `DD/MM/YYYY · HH:MM:SS`, 24-hour, every field zero-padded. Do **not** use `toLocaleString` — its output varies with host locale and ICU version, which makes the stamp unpredictable across machines and the assertion unwritable (design D5)
- [x] 1.2 Unit-test it in `src/lib/rec-clock.test.ts` (`.ts`, colocated — a `.test.tsx` is silently uncollected): a mid-day time, midnight (`00:00:00`, not `24:` and not `12:` AM), noon, a single-digit day/month, and a December 31st — the cases where an off-by-one or a missing pad is invisible in a screenshot
- [x] 1.3 Assert the returned length is constant across all of those, which is what the fixed-width requirement actually means

## 2. The overlay and its control

- [x] 2.1 Hold the state in `HudShell` — the control is in its left column and the stamp renders inside `HudCamera`, so the state sits at their common owner and passes down as a prop. **Not** lifted to `App.tsx` and **not** persisted (design D3): a REC indicator restored from disk claims a recording that is not happening
- [x] 2.2 Render the stamp in the camera frame's **top-left** corner while on — a `RECORDING` line with a red dot plus the clock, as one block. That corner is free: `.cam-status` is top-right, `.gesture-chip` bottom-left (design D2)
- [x] 2.3 Drive it with a `setInterval` at 1 Hz, created when the overlay turns on and **cleared when it turns off** or the component unmounts. Not `requestAnimationFrame`: nothing here changes per frame, and the HUD already runs a WebGL orb plus two MediaPipe loops on this thread (design D4, `main-thread-budget`)
- [x] 2.4 Put the toggle in a row **beside the camera-size pill**, above the frame — not inside the picture. The camera's controls belong together or the second one is not findable (design D2; the first attempt put it in-frame and the user reported the feature as missing). It **must** carry `.hud-hit`: HUD mode is click-through by default, so a control without it cannot be clicked at all
- [x] 2.5 Give it the REC vocabulary (a `Rec` pill that lights coral when on) but a tooltip that says what it does — shows/hides the date and time on the camera, and that Iris records nothing — never "start/stop recording" (spec: "The control explains itself as a display toggle")
- [x] 2.6 Do **not** add an elapsed timer, file size, duration, or saved-file text anywhere. Those are the affordances that make a display toggle read as a real recorder (spec: "No capture-only affordances are shown")

## 3. Styling

- [x] 3.1 Style the stamp in `src/styles/hud.css` with **tabular/fixed-advance figures** so it cannot shift as digits change. Deliberately **heavier and larger than `.cam-status`**: that one is a glanceable operator status, this one has to be read back off compressed video by a viewer sitting further away — the first pass matched `.cam-status` and was reported as too small and too light to see
- [x] 3.2 Style the toggle as a `.hud-comms-toggle` pill, matching the camera-size control it sits beside — only its lit state differs (coral rather than cyan, so "on" reads as a recording light). Check both pills still fit across `.hud-left`'s 300px at once
- [x] 3.3 Size the stamp in **container units** (`cqw` against `.camera-frame`, which gains `container-type: inline-size`) rather than px, so one setting is correct at both camera sizes instead of being tuned for one and wrong at the other. This is what closes the px-vs-frame risk the eye-HUD readout still carries

## 4. Verification

- [x] 4.1 `npm run build` — typecheck passes
- [x] 4.2 `npm test` — full suite passes, including the new formatter tests
- [x] 4.3 `npm run lint` — zero warnings
- [ ] 4.4 `npm run scan:secrets` — clean. **Not run:** `gitleaks` is not installed on this machine, so the gate fails closed and this change has never been scanned
- [x] 4.5 `npm run spec:check` — no drift
- [x] 4.6 Manual: the toggle turns the stamp on and off; the time advances every second; it is clickable while the rest of the HUD stays click-through; a restart comes back with the stamp off
- [x] 4.7 Manual: **check the stamp against the eye HUD's readout panel**, with gesture control on and a face in frame, at both camera sizes — the panel hangs upper-left of its eye and its top edge lands near the stamp (design D2 risk). This is the one collision a unit test cannot reach
- [x] 4.8 Manual: record the HUD with an external screen-recorder and confirm the date and time are legible in the resulting video at its normal playback size — the whole point of the change, and the one thing that cannot be verified from inside the app
- [x] 4.9 Once implementation is complete and all gates pass, archive this change (`/opsx:archive`) so the `glass-hud-mode` delta syncs into `openspec/specs/`

## Notes

- `src/components/HudShell.tsx` is now 581 lines, over the 250–450 convention band. It was already over before this change (538); the ~43 lines added here did not cause it but did not help. The natural split is `HudCamera` into its own file — deliberately **not** done as part of this change, so the diff stays about the feature.
