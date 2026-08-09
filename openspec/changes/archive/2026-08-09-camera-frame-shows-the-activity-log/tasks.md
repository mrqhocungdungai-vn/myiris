## 1. The rule, in a pure module

- [x] 1.1 Create `src/lib/activity-log.ts` in the style of `src/lib/telemetry-format.ts` — level ranking, the build-mode threshold, and one selector from the store to the drawn lines (D3)
- [x] 1.2 The selector flips the ordering: the store is newest-first because `pushLog` prepends, the strip reads newest-last (D3)
- [x] 1.3 An unrecognized level must not vanish — anything the ranking does not know is treated as at least routine, never as below the threshold, so a level added later shows up rather than silently disappearing
- [x] 1.4 The threshold reads `import.meta.env.DEV` and nothing else. **No env override, no setting, no persistence** (D2)
- [x] 1.5 `src/lib/activity-log.test.ts` — the development and production thresholds each asserted against every level; the ordering flip; the count cap; fewer entries than the cap; none at all; an unknown level surviving; and that entries below the threshold are *hidden*, not dropped from the store

## 2. The strip

- [x] 2.1 Create `src/components/CameraLog.tsx` — presentational, no state of its own, no effects
- [x] 2.2 Fixed band: exactly the line count's worth of height whether it is full or empty (D4)
- [x] 2.3 One line per entry, truncated rather than wrapped
- [x] 2.4 Severity legible at a glance, and the warning tone not spent on routine entries
- [x] 2.5 Nothing interactive: no handlers, and `pointer-events: none` so the universal point-and-hold cannot find anything in it

## 3. Wiring

- [x] 3.1 `src/App.tsx` — read the state it already writes (`const [, setLogs]` → `const [logs, setLogs]`)
- [x] 3.2 Delete the comment at `App.tsx:1184` justifying a banner "because the log list is discarded". The banner stays; its stated reason is now false
- [x] 3.3 Thread `logs` to `src/components/CameraDock.tsx` and `src/components/HudShell.tsx`, on the path the eye props already take
- [x] 3.4 Confirm no main-process change is needed — no new channel, no new event type. If one turns out to be, D1's argument has failed and the approach should be revisited rather than the channel quietly added

## 4. Styles

- [x] 4.1 The band at the bottom of `.camera-frame`, **`z-index: 1`** — above the video and its scan, and below everything that tracks something: the hand skeleton (2), the ring (3), the readout (4). The design said 2; 1 is right, because the hand skeleton belongs above the strip too (D5)
- [x] 4.2 Translucent, no opaque ground; the camera image shows through
- [x] 4.3 Sized in container units against the frame, with the strip's layer carrying `container-type: inline-size` as `.eye-readout-layer` does (D6)
- [x] 4.4 Move `.gesture-chip` up to clear the band, keeping its corner and everything about how it reads
- [x] 4.5 Check the HUD's camera-zoom toggle rescales the strip live, with no re-tuning — measured: a 256px frame gives a 5.89px line and a 46px band, a 496px frame gives 8px and 62px, from one declaration

## 5. Verification

- [x] 5.1 Run all five gates — `/gates`, or `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`, `npm run spec:check`
- [x] 5.2 Render the strip at the deck dock's true width and confirm five lines fit without crowding the picture, and that a long entry truncates rather than wrapping
- [x] 5.3 Confirm the band holds its area with zero entries, one entry, and five
- [x] 5.4 Confirm an overlay positioned over the band is drawn on top of the strip, and that the overlay's own position is unchanged
- [x] 5.5 Manual, in the running app: drive real activity and watch it arrive — the destructive-command guard's refusal is the most satisfying one to trigger deliberately
- [x] 5.6 Manual: compare `npm run dev` against `npm start` and confirm the depth actually differs
- [x] 5.7 Documented in `docs/GESTURES.md`, not `ARCHITECTURE.md` — the camera frame's contents are described there and `ARCHITECTURE.md` does not mention the dock at all. `CLAUDE.md`'s router line updated
- [x] 5.8 Settle the design's open questions from the manual pass — whether five lines is right at the deck's size, and whether the production depth is too quiet to be worth the band

## Deferred — needs the running app

- 5.5 Driving real activity and watching it arrive, the destructive-command
  guard's refusal being the most satisfying one to trigger deliberately.
- 5.6 Comparing `npm run dev` against `npm start` in the app rather than in a
  test. The threshold itself is asserted at every level in
  `src/lib/activity-log.test.ts`; what is unverified is that `import.meta.env.DEV`
  is what the two commands actually differ on, which only the two commands can
  show.
- 5.8 Whether five lines is right at the deck dock's size, and whether the
  production depth is too quiet to be worth the band.

## Verified without the running app

Rendered in Chromium against the real stylesheet, at the deck dock's true 256px
frame and at a larger HUD-sized one, measuring rather than eyeballing:

- Five lines occupy 23.9% of the deck frame and 16.8% of the HUD frame, and the
  top line sits flush with the band's top edge (0.01px) with no clipping.
- The band holds the same area with five entries, two, and none — the gesture
  chip's gap above it is 12px in every case.
- A production-depth strip pins its two entries to the bottom of the reserved
  band, exactly where the newest of five would be.
- Long entries truncate to one line rather than wrapping.
- A readout panel positioned low, where its placement rule puts it over the
  band, is drawn on top of the strip.

## Found while implementing

**The strip's padding was silently unscaled.** `.cam-log` carried `em` padding
with no font-size of its own, so it resolved against the 16px default while the
text inside it scaled with the frame. Moving the font-size onto `.cam-log` and
letting `.rows` inherit fixed it; the band went from 26.1% of the deck frame to
23.9%.

**An empty band was still painting its wash.** A production run with nothing to
report is the common case, and a permanently dimmed strip of camera image with
nothing in it is a cost with no return. `:not(:has(.line))` drops the wash
without touching the reserved height.

**The enter animation's keyframes now state `to` explicitly.** Not because the
implicit one was wrong — it resolves to the underlying value per spec, and the
measurement that suggested otherwise turned out to be a harness reading a
value computed before the first frame — but because a from-state of one full
line of displacement is worth being explicit about.

---

The manual items above were run by the user on 2026-08-09 and reported as passing. Recorded here because a box ticked by someone who could not have performed the check is the one kind of entry this file must never contain — the manual passes are exactly the parts no unit test can stand in for.
