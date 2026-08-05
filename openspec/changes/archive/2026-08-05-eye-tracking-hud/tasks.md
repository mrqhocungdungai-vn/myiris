> **Read before starting:** proposal.md, design.md, and this change's spec delta.
> In design.md, **D11 is the code layout** (which file holds what, and the
> `vitest` glob that forces the pure-logic extraction); **D6–D10** are the design
> substance — the ring stack and its three motion laws, the partial-arc rotation
> pivot, the acquire transition, the readout's tether/frame/churn, and the
> anisotropic-overlay pitfall. The visual constants throughout are **first
> guesses, not measured values** — nothing here has been run against a real face
> at real webcam scale, so expect to re-tune the boost multiplier and the panel
> offset first (design.md, Risks). What must *not* be re-tuned away are the
> stated relationships; each is a spec requirement with its own scenario.

## 1. Vendor the model asset

- [x] 1.1 Add `FACE_MODEL_URL` and a `vendorFaceModel()` step to `scripts/vendor-runtime-assets.mjs`, mirroring the existing `vendorGestureModel()` (download-once, skip-if-present, into `public/runtime/mediapipe/face_landmarker.task`) — spec: "The on-device model asset is fetched once and cached, never at renderer runtime"
- [x] 1.2 Wire it into `main()`'s results array alongside the existing vendored assets
- [x] 1.3 Run the vendoring script locally and confirm the asset downloads once, then confirm a second run skips the download

## 2. The tracking hook — test-first

- [x] 2.1 Write `src/lib/eye.ts` + `src/lib/eye.test.ts` (design D11) — the pure eye-state logic: presence-equality check, per-eye center/radius derivation from landmark positions. Tests first. Follows `src/lib/hand.ts`/`hand.test.ts` exactly, including `import type`-ing the state types from the hook. **`.test.ts`, never `.test.tsx`** — `vitest.config.mjs`'s `unit` project globs `src/**/*.test.ts`, so a `.tsx` test is silently never collected and passes by not running
- [x] 2.2 Write `src/hooks/useEyeTracking.ts`: `useEyeTracking(stream, enabled)` — takes the `MediaStream` `useHandControl` returns and creates its **own detached `<video>`** (`document.createElement`, never mounted), copying `useHandControl.ts:128`; returns `{ state, stateRef }`, mirroring `useHandControl`'s dual publish pattern (design D4), and exporting the `EyeState`/`TrackedEye` types `lib/eye.ts` imports — reuse `smoothPoint` from `lib/hand.ts` rather than reimplementing smoothing
- [x] 2.3 Confirm iris landmark indices against the installed `@mediapipe/tasks-vision` package's own `FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS`/`_RIGHT_IRIS` constants at implementation time — don't trust a hardcoded index from this doc without re-verifying against the actual installed version
- [x] 2.4 Configure `FaceLandmarker.createFromOptions` with `runningMode: "VIDEO"`, `numFaces: 1`, GPU delegate, blendshapes/transformation-matrix outputs left off (design D1)
- [x] 2.5 Confirm a failed model load degrades to the empty state with no thrown/user-visible error — spec: "A failed model load degrades quietly"

## 3. Wiring into both surfaces

- [x] 3.1 Call `useEyeTracking(handStream, handControl)` in `src/App.tsx` beside `useHandControl`, and thread `{ eye, eyeRef }` to both surfaces exactly as `hand`/`liveHandRef` already reach them (design D3/D12) — **not** from inside either camera component; the surfaces are mutually exclusive, so a component-level hook would tear down and re-create `FaceLandmarker` on every deck↔HUD switch
- [x] 3.2 Confirm no second `getUserMedia` call is made — one camera permission prompt, one active-camera indicator
- [x] 3.3 Confirm the hook's lifecycle is tied to the same `handControl` boolean the rest of the app uses — no new toggle, no new persisted preference — and that disabling gesture control tears down eye tracking the same frame hand tracking tears down
- [x] 3.4 Mount `EyeReticle` + `EyeReadout` inside `.camera-frame` in **both** `CameraDock.tsx` and `HudShell.tsx`'s `HudCamera` — `HudShell` already imports `HandSkeleton` from `CameraDock` for exactly this, so follow that import. Keep both files to the mounts only: the rendering lives in `EyeReticle.tsx`/`EyeReadout.tsx` (design D11), and `CameraDock.tsx` is 147 lines now — both overlays inline would push it past the 250–450 band with three unrelated responsibilities
- [x] 3.5 Verify tracking survives a deck↔HUD switch with no model re-initialization and no tracking gap — spec: "Tracking survives a UI mode switch"
- [x] 3.6 Mount a **new** `<svg>` overlay for this capability with a viewBox matching `.camera-frame`'s aspect — `4 / 3` in both `deck.css` and `hud.css`, and `useHandControl` requests `640×480` (also 4:3), so one viewBox like `0 0 400 300` serves both surfaces and `object-fit: cover` crops nothing and the **default** `preserveAspectRatio` — do NOT reuse or copy `HandSkeleton`'s `viewBox="0 0 100 100" preserveAspectRatio="none"`, which is anisotropic and would render every circle as a 4:3 ellipse (design D10; spec: "Overlay geometry and text are not distorted by the frame's aspect ratio"). Verify by drawing one throwaway `<circle>` and checking it is round before building anything on top of it

## 4. Ring HUD geometry — test-first

Build against design D6's layer table (L0–L7), which gives the reference radius/stroke/color/period for every layer. The **numbers** are a tuning starting point; the **three motion laws plus the two supporting constraints** stated alongside the table are spec requirements — see 4.5–4.7 below.

- [x] 4.1 Write `src/lib/eye-hud.ts` + `src/lib/eye-hud.test.ts` (design D11) — the pure geometry helpers (`polarPoint`, `arcPath`, `tickLine`, `wingPath`). Pure math, no DOM or MediaPipe dependency: the cleanest test targets in this change, and the only parts of the rendering that *can* be tested at all under `environment: "node"`
- [x] 4.2 In `src/components/EyeReticle.tsx` (new — design D11; do not add this to `CameraDock.tsx`), build the static layers: the wing brackets (L0), the 24-tick alternating coral/amber dial with long ticks every 90° (L1), the solid coral bezel (L3), the inner highlight rim, and the center crosshair (L7) — spec: "The ring HUD reads as an oversized, multi-color 'lock-on' instrument"; the dial + bezel are also what satisfies "A static reference is always present", so don't animate them for extra motion
- [x] 4.3 Add the full-circle rotating layers — the segmented cyan ring (L2), the dashed coral ring (L4), the dashed amber ring (L6). These rotate via plain CSS (`transform-box: fill-box; transform-origin: center` is exactly correct for a full circle centered on the local origin — no imperative rotation needed here; contrast task 5.2)
- [x] 4.4 Size the whole ring group with a deliberate boost beyond the true iris radius (design D5) — spec: "The ring is legibly larger than the eye"; tune the multiplier by eye against a real camera/face — the reference value is a first guess and this is the constant most likely to be wrong, since apparent iris size varies with the camera
- [x] 4.5 Give every rotating layer an asymmetric interruption (unequal gap, dash pattern, or open arc) — spec: "Rotation is perceptible on every moving element". A solid continuous circle that rotates looks static; if a layer needs to be solid, make it one of the static layers instead
- [x] 4.6 Assign rotation directions so that **adjacent** rotating layers counter-rotate (reference: L2 CW / L4 CCW / L5 CW / L6 CCW) — spec: "Adjacent rotating rings counter-rotate". Alternating only between the outermost and innermost layer does not satisfy this
- [x] 4.7 Pick rotation periods that are pairwise distinct **and not integer multiples of one another** (reference: 12 / 7 / 3.2 / 5 s) — spec: "Rotations never lock into a single rigid spin". Round numbers like 4/8/12 are the trap here; verify by watching the stack for a full minute, not by reading the constants
- [x] 4.8 Confirm every layer is stroke-only with additive glow, no fills — spec: "The eye stays visible through the ring"

## 5. The two imperative-transform requirements: the accent arc, and the acquire transition

Both of these are cases where the obvious declarative CSS mechanism is *wrong* on an element whose transform is under per-frame imperative control — D7 and D8 are two instances of one rule. Neither is a style preference; both are spec requirements.

- [x] 5.1 Build the accent arc (L5) as a partial arc with a fading-gradient stroke (an SVG `<linearGradient>`), positioned via the same tracked-eye transform as the rest of the ring
- [x] 5.2 Rotate it via an explicit per-frame SVG `rotate(deg)` write, NOT `transform-box: fill-box; transform-origin: center` — spec: "A partial-arc element rotates around the tracked eye's center, never its own bounding box"; see design D7 for why the CSS approach visibly wobbles for any non-full-circle shape
- [x] 5.3 Place the arc's marker dots (and anything else that should travel with its sweep) in that same rotated group so they stay locked to it every frame
- [x] 5.4 Manually verify: watch the arc through several full rotations and confirm its center point does not appear to drift/orbit
- [x] 5.5 Implement the acquire transition (design D8) — on the no-face → face presence transition, hold the acquisition timestamp and derive an eased progress factor from elapsed time, multiplying it into the scale the rAF loop already writes for the ring group. Reference: converge from a noticeably larger scale over ~250–400ms with an overshoot/settle beat
- [x] 5.6 Do NOT implement the acquire with a CSS `transition`/`@keyframes` on the ring group's transform — the loop rewrites that transform every frame and cancels it; spec: "Acquisition does not fight per-frame tracking". The per-layer rotations from 4.3 are unaffected — those live on child elements whose transforms CSS owns exclusively
- [x] 5.7 Manually verify: walk into frame and confirm the ring converges rather than popping in at full size; then move your head *during* the convergence and confirm it tracks and converges simultaneously with no stutter or snap-back

## 6. The placeholder panel — a tethered callout, not a card

Read design D9 before starting. "An angular panel with cut corners" is where the obvious reading of the brief lands, and it is a styled UI card; D9 lists the four properties that separate that from the reference, each individually easy to drop.

- [x] 6.1 Build `src/components/EyeReadout.tsx` (new) as an **HTML element** absolutely positioned over the camera frame (design D10), tracked at its assigned eye's live position with a fixed offset, its transform written per frame by the same rAF loop — not as SVG; SVG text forgoes the font metrics, `letter-spacing` and tabular figures that 6.5 depends on. `src/components/HandReticles.tsx` is this exact pattern already working in this codebase (HTML overlay, per-frame transform writes, semantically-gated mount) — follow it
- [x] 6.2 Give it an **implied frame**: corner brackets with no closed outline, one chamfered corner for orientation, translucent dark background — spec: "The panel has no closed border" and "The scene shows through the panel". A bordered rectangle is the exact thing this requirement exists to forbid
- [x] 6.3 Build the **tether** in the ring's SVG overlay (design D10): origin dot at the tracked eye, elbow polyline outward, terminating tick at the panel's near edge — spec: "A tether visibly connects the panel to its eye"
- [x] 6.4 Recompute **both** tether endpoints every frame from the one shared frame-normalized panel position the HTML element also uses — do not measure one element off the other, and do not parent the tether statically to either end (design D10's seam; risk noted in design.md)
- [x] 6.5 Populate it with clearly placeholder content — header strip with an inverted label + status token, label/value rows with the value column **right-aligned in tabular/fixed-advance figures**, and at least one **segmented** bar meter (discrete cells, not a smooth fill). Denser than readable. Do not wire any of it to a real signal
- [x] 6.6 Make the values **churn** continuously — spec: "Values churn while the panel is open". Then verify the layout is immune to it: cycle values across differing digit counts and confirm no row shifts or changes width (spec: "Changing values do not move anything")
- [x] 6.7 Palette: informational cyan for the panel with amber on a single accent value, against the ring's coral/amber alert tone — spec requires the division be *semantic* (ring alerts, panel reports), not just two things that differ
- [x] 6.8 Add the periodic scan-line sweep down the panel
- [x] 6.9 Stagger the panel's arrival behind the ring's acquire (design D8/D9): tether extends first, panel appears at its end — spec: "The panel arrives after the ring locks"

## 7. Keeping the panel in frame — test-first

- [x] 7.1 Place the panel with a **pure function** of its eye's position alone in `src/lib/eye-hud.ts` — `anchorX = eyeX - offset`, no frame-bounds term, no carried side, no threshold. Unit-test that it holds across a full sweep of eye positions, including hard against both edges
- [x] 7.2 Let `.camera-frame`'s `overflow: hidden` clip the panel where that offset runs off the frame's left edge, rather than relocating it — spec: "An eye near the left edge clips the panel rather than moving it". The content is placeholder telemetry, so clipping loses nothing real
- [x] 7.3 **Do not** flip the panel to its eye's other side, with or without hysteresis. That was implemented first and is doubly wrong: the flipped position is the ring eye's half of the frame, so the two elements collide, and any pose-dependent relocation reads as a malfunction no deadband can fix (design D9). The tether's elbow is likewise one-sided now
- [x] 7.4 Manually verify by physically moving to each frame edge in turn — this is the one behavior a unit test can't reach and a casual check will miss (design.md risk)

## 8. Fixed eye-to-element assignment

- [x] 8.1 Hardcode the assignment the spec names: **ring on the eye at the frame's right, panel on the eye at its left**. Start from the on-screen side and derive the landmark index from it — the preview is mirrored, so the subject's own right eye is the one at the frame's right, and MediaPipe's "right" iris (469–472) is the ring's
- [x] 8.2 Record the assignment **in on-screen terms too** (which side of the displayed frame each element appears on), in a comment and in the docs — the first pass stated the mirroring backwards in design D5 and inverted the indices to compensate, which is why the on-screen side is the binding vocabulary and the landmark label the derived one
- [x] 8.3 Confirm nothing in the implementation could cause the assignment to flip frame-to-frame (e.g. an unstable sort/ordering of detected eyes) — `useEyeTracking`'s eyes array should always be built in the same fixed order per detection

## 9. HUD camera-zoom toggle

Design D12. This is `glass-hud-mode` behavior arriving through this change, so its requirements live in this change's **`specs/glass-hud-mode/spec.md`** delta ("The HUD camera frame has a user-controlled size that is remembered"), not in the `eye-tracking-hud` delta — which only requires that the overlays scale with whatever frame they are drawn in.

- [x] 9.1 Give `.hud-camera` two widths in `src/styles/hud.css` — current (300px) and enlarged (~390px at 4:3) — as CSS custom properties, so the factor is one edit point. Do **not** change `.hud-left`'s `width: 300px`: that column also holds the comms toggle and bubbles, which would widen by 30% too
- [x] 9.2 Add the toggle button, following `.hud-comms-toggle` (the existing precedent for a small labeled pill control on a `.hud-left` island). It **must** carry `.hud-hit` — HUD mode is click-through by default, so a control without that class cannot be clicked at all. Place it as a sibling above the camera so it keeps the column's 300px width and does not move when the frame resizes
- [x] 9.3 Persist the choice with the renderer's existing preference pattern in `App.tsx`: a `*_STORAGE_KEY` constant, a `load…()` initializer as the `useState` seed, a write on toggle — as `handControl`/sounds/WebGL-quality/ambient-capture all already do. **Default to the current size**, and have the initializer treat an absent or unparseable value as that default, so the failure mode is "reverts to normal", never "stuck enlarged"
- [x] 9.4 Confirm the overflow is harmless — `.hud-left` is `position: absolute` with no `overflow` clipping, so the extra width extends rightward into empty overlay space; check the frame's `.hud-hit` region still matches its box at **both** sizes so click-through stays correct
- [x] 9.5 Transition the resize if desired — safe here, unlike D8's case: the frame's width is CSS-owned and never written per frame, and the overlays inside are in normalized/viewBox coordinates, so they scale smoothly with it
- [x] 9.6 Confirm the reticle needed no re-tuning at either size (it derives from normalized iris radius × boost, so it scales automatically) — spec: "Resizing a camera frame rescales its overlays live"
- [x] 9.7 Check the readout in **all three** states — deck, HUD normal, HUD enlarged — since its type is px-set and does not scale with the frame, so a size tuned in one can read cramped or lost in another. If no single value serves all three, scale the panel with the frame; do not vary its content or offset per state (design D12)

## 10. Styling

- [x] 10.1 Add all new rules to `src/styles/claude.css` — never to `deck.css` or another upstream-verbatim stylesheet, per this repo's existing convention
- [x] 10.2 Reuse existing keyframes (`orb-spin`, `orb-spin-rev`, `pulse-dot`, all already in `deck.css`) rather than defining new ones for equivalent motion — the whole rotating stack is these two keyframes with a different `animation-duration` per layer, since neither bakes in a duration; the direction alternation of task 4.6 is the choice between them, and the distinct periods of task 4.7 are the durations
- [x] 10.3 Reuse existing color tokens (`--cyan-rgb`, `--amber-rgb`, `--coral-rgb` from `tokens.css`) rather than introducing new color values
- [x] 10.4 Reuse `--font-mono` and the existing monospace-token treatment (cf. `.cam-status` in `deck.css` — 8.5px, `0.16em` tracking, uppercase) for the panel's type rather than re-deriving it

## 11. Docs

- [x] 11.1 Add an "Eye HUD (decorative)" section to `docs/GESTURES.md` describing the shipped behavior in **both** surfaces, including HUD mode's camera-zoom button, why it exists (livestream framing vs. working space), and that it is remembered — write it against the shipped code; the file currently mentions eyes nowhere
- [x] 11.2 Note the shipped code's actual file/function names in that section, and add a one-line pointer from `CLAUDE.md`'s table only if the gesture row doesn't already cover it (per the router convention)

## 12. Verification

- [x] 12.1 `npm run build` — typecheck passes
- [x] 12.2 `npm test` — full suite passes, including new unit tests for the extracted eye-state, ring-geometry, and panel-placement pure logic (tasks 2.1, 4.1, 7.1)
- [x] 12.3 `npm run lint` — zero warnings
- [x] 12.4 `npm run scan:secrets` — clean
- [x] 12.5 `npm run spec:check` — no drift against the archived spec
- [x] 12.6 Manual verification, ring: gesture control on/off correctly gates the whole feature; both eyes track smoothly with head movement; the ring reads clearly larger than the iris **and is circular, not elliptical**; each neighbouring pair of rotating layers counter-rotates; a full minute of watching shows no moment where the stack locks into one rigid spin; every rotating layer's motion is visible on its own; the bezel/dial stay static; nothing fills over the eye; the accent arc spins without wobble; the ring converges on acquisition and still tracks a moving head mid-convergence; only one camera permission prompt appears
- [x] 12.7 Manual verification, HUD zoom: the button toggles the frame between both sizes and is clickable while the rest of the HUD stays click-through; the choice survives an app restart; a profile with no stored value starts at the current size; the overlays track correctly and rescale at both sizes; comms bubbles did **not** change width
- [x] 12.8 Manual verification, panel: no closed border, the camera image shows through it, **its text is not horizontally stretched**; the tether stays joined at both ends throughout head movement; values churn without any row shifting or changing width; the panel arrives after the ring locks; the panel stays left of its eye at every head position — clipped at the frame's left edge rather than moved, and never overlapping the ring on the other eye
- [x] 12.9 **Measure the two-inference-loop cost** (design.md, Risks — currently assumed, not demonstrated): with the eye HUD on vs. off, confirm the hand pointer stays equally responsive and the preview does not drop frames. Hand tracking is a functional input device and this decorative overlay must not degrade it; if it does, throttle `FaceLandmarker` to every Nth frame rather than reducing hand-tracking fidelity
- [x] 12.10 Confirm the layout landed as D11 specifies: every new test is `*.test.ts` (a `.test.tsx` would be silently uncollected), colocated beside its source with no `__tests__` directory, all verified logic lives in `src/lib/`, and no file exceeded the 250–450 line band — re-check `CameraDock.tsx` in particular
- [x] 12.11 Once implementation is complete and all gates pass, archive this change (`/opsx:archive`) so **both** delta specs — `eye-tracking-hud` and `glass-hud-mode` — sync into `openspec/specs/`
