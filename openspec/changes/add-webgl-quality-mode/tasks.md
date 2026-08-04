## 1. The settings module

- [x] 1.1 Add a pure module under `src/lib/` holding the preference's storage contract — the `iris.*` key, `"on"`/`"off"` values, and a reader that returns the light path for absent or unparseable values (design.md D6)
- [x] 1.2 In the same module, derive each surface's settings from the preference: the orb's `gl` options (`antialias`, `powerPreference`) and `dpr` (`Math.min(devicePixelRatio, 1.5)` on the light path, unclamped on the high-fidelity path — design.md D4), whether the deck backdrop mounts, and whether the galaxy adds its bloom pass (design.md D1)
- [x] 1.3 Write the unit test covering both paths: light-path settings, high-fidelity settings matching today's values exactly, the default-when-unset rule, and that the dpr clamp never exceeds the device's own ratio on a non-Retina display

## 2. Unify the orb accent

- [x] 2.1 Export a single `ORB_ACCENT` and have `CenterStage.tsx` and `HudShell.tsx` both read it, deleting their two hand-written copies (design.md D3) — do this before the glow work so the glow has one color source rather than a third copy

## 3. The orb's two paths

- [x] 3.1 Make `ReactorCore` take the preference and apply the derived settings: skip `EffectComposer`/`Bloom` on the light path, pass the derived `gl` and `dpr` to `<Canvas>`, and swap the two `meshStandardMaterial` rings to unlit materials on the light path (dropping the ambient and point lights with them)
- [x] 3.2 Key the `<Canvas>` on the preference so a change disposes the old WebGL context and creates a new one with the new options, leaving the ripple queue, level refs and rotation/scale refs above it untouched (design.md D2)
- [x] 3.3 Add the light path's CSS glow layer behind the orb canvas in `.orb-stage`, tinted from `--orb-accent` and varying with the orb's energy, in the change's own stylesheet — not in any upstream-verbatim Deep Space file (design.md D3)
- [x] 3.4 Thread the preference to the orb at both mount sites, `CenterStage.tsx` and `HudShell.tsx`, keeping the two prop lists parallel

## 4. The deck backdrop and the galaxy

- [x] 4.1 Mount `HoloBackdrop` conditionally from `src/App.tsx` so the light path creates no WebGL context for it at all, and confirm the Deep Space CSS gradient layers still read as a complete deck background on their own
- [x] 4.2 Skip `addBloom()` in `VaultGalaxy.tsx` on the light path, verifying the in-scene opaque backdrop, vignette and starfield still paint (they are added independently of the composer, so the desktop must still not show through)

## 5. The control

- [x] 5.1 Add the preference to `src/App.tsx` state, following the existing `iris.*` pattern: lazy `useState` initializer reading storage, toggle writing it back (design.md D6)
- [x] 5.2 Add the Off/On row to `SetupPanel.tsx` alongside the interface-sounds toggle, rendering regardless of pipeline availability, applying immediately without the panel's Save and without a reconnect or relaunch prompt
- [x] 5.3 Write the row's helper text so it states the trade-off — full effects at materially higher GPU cost, off by default

## 6. Verify

- [x] 6.1 Run the four gates — `npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`
- [x] 6.2 Verify the light path by hand: fresh profile starts light; orb reads as lit rather than flat; wake pulse, thinking swirl, speech-lock ripple and task flashes all render; deck has a full background with no backdrop context; galaxy opens with its opaque backdrop and starfield but no node glow
- [x] 6.3 Verify the high-fidelity path by hand against `main`: orb, backdrop and galaxy look as they do today
- [x] 6.4 Verify the toggle by hand: change it while Iris is awake and speaking with a layer open — conversation is uninterrupted, the orb resumes in its current expressive state rather than resetting to idle, the layer stays open; change it with the galaxy already open — the galaxy keeps its node positions and adopts the new path only on reopen
- [x] 6.5 Confirm the render-loop pausing rules still hold on both paths: orb and galaxy pause on sleep, deck orb and backdrop also pause on window blur, HUD orb keeps rendering while awake and unfocused
- [x] 6.6 Confirm `docs/REFERENCE.md`'s pinned-identifier and footgun sections still read true, and add the dpr clamp and the two-path rendering if they do not
