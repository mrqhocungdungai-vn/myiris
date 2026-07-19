## Context

Today the Orbital Deck's non-HUD background is entirely CSS: `deck.css`/`base.css` paint layered radial gradients (`hud-nebula`, `hud-glow`, `hud-vignette`) behind the panels, and the center orb is `ReactorCore` — a `<canvas>` 2D animation driven by `state`, `inputLevelRef`/`outputLevelRef`, `thinking`, `wakeKey`, `rippleKey` (see `openspec/specs/orb-expressions/spec.md`). None of these files or `ReactorCore`'s WebGL-ness are covered by any existing 3D dependency — the project has zero WebGL today.

The `deepspace-skin` spec requires `tokens.css`/`base.css`/`deck.css`/`fx.css`/`overlays.css`/`index.css` to stay byte-for-byte unmodified (upstream-verbatim, diffable). This change must not touch those files.

Gesture input already exists via `useHandControl` (`src/hooks/useHandControl.ts`), backed by MediaPipe `GestureRecognizer` (canned classes: `Closed_Fist`, `Open_Palm`, `Pointing_Up`, plus others unused today). Each tracked hand exposes 21 mirrored landmarks. Existing bindings, all gated by app state in `App.tsx`/`ReaderOverlay.tsx`:
- `Pointing_Up` + dwell (~300ms) → click (global, any mode)
- `Open_Palm` (single hand) → scroll the work stream, only when the reader is **closed** (`!expandedTaskId`)
- `Open_Palm` (both hands) → resize the reader, only when it's **open**
- `Closed_Fist` → close the reader, only when it's **open**

When the reader is closed, `Closed_Fist` is currently a no-op everywhere in the app — that's the gap this change fills for orb rotation. Pinch (thumb tip landmark 4 to index tip landmark 8 distance) is not a canned MediaPipe class and is not bound to anything today.

Reference aesthetic: Jarvis-CV (`/Users/mrq-learn-ai/work_space/tools/GitHub/Jarvis-CV`), a Next.js + Three.js/`@react-three/fiber`/`@react-three/drei`/`@react-three/postprocessing` project. Its `ArcReactor` scene (glowing core sphere + two counter-rotating `Torus` rings + a wireframe outer sphere, lit with `EffectComposer`+`Bloom`) and its `DynamicNetwork` component (a drifting node/edge particle graph, also bloom-lit) are the two pieces of visual language this change ports — as inspiration/structure, not a verbatim code copy, and re-themed onto Iris's own `tokens.css` cyan/violet palette instead of Jarvis's colors.

## Goals / Non-Goals

**Goals:**
- Deck mode (not Glass HUD) gets a holographic WebGL backdrop (particle/node network) and a WebGL Arc Reactor orb, both token-colored.
- `ReactorCore`'s existing prop contract and expressive behaviors (thinking swirl, wake pulse, ripple, flashes) are fully preserved — callers (`CenterStage.tsx`) do not change their usage.
- Both new render loops stop consuming GPU when Iris is asleep or the window is unfocused.
- The orb becomes gesture-controllable (fist rotates, pinch scales) without colliding with any existing gesture binding.
- `deepspace-skin`'s upstream-verbatim files are untouched; the new layer is strictly additive.

**Non-Goals:**
- Glass HUD (`HudShell`/`hud.css`) is not touched by this change.
- No scene-switching carousel (Jarvis's Arc Reactor / Globe / Solar Array cycling) — only one backdrop and one orb, no `activeScene` state.
- No webcam/face-tracking parallax (Jarvis's `HUD.tsx` nose-tracked parallax) — out of scope.
- No new Gemini/Claude tool surface, IPC channel, or pipeline behavior change.

## Decisions

### 1. New dependencies: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`
Pin to the versions already proven together in Jarvis-CV (React 19-compatible): `three@^0.181.2`, `@react-three/fiber@^9.4.0`, `@react-three/drei@^10.7.7`, `@react-three/postprocessing@^3.0.4`. Iris's `package.json` already pins `react`/`react-dom` to `"latest"`, which resolves to React 19 today, so no React downgrade/upgrade is needed. Add these four to the README's exact-dependency table alongside the other pinned SDK/asset versions, per repo convention.

**Alternative considered**: hand-rolled WebGL (raw `<canvas>` + custom GLSL) to avoid the dependency weight. Rejected — R3F/drei/postprocessing is what makes the Jarvis look achievable without reinventing bloom/orbit math, and the project already accepts real npm dependencies for capability (e.g. `@anthropic-ai/claude-agent-sdk`).

### 2. Two separate new components, not one
`HoloBackdrop` (new, owns the particle/node network, mounted once at the deck root, `z-index` below `.deck-panel`s and above `.hud-nebula`/`.hud-glow`) and a rewritten `ReactorCore` (same file/name, same props, internals swapped from `<canvas>` 2D to an R3F `<Canvas>`). Keeping them separate matches the proposal's capability split (`holo-deck-backdrop` vs `orb-expressions`) and lets each pause independently — the orb's loop must track `thinking`/audio-level updates every frame; the backdrop only needs ambient drift.

**Alternative considered**: one shared `<Canvas>` for both backdrop and orb (single WebGL context, cheaper). Rejected for this change — `ReactorCore` is positioned inside `.orb-stage` deep in `CenterStage.tsx`'s DOM tree while the backdrop must sit at the `.deck` root to render behind every panel; sharing a context would require hoisting the orb's render tree up through portals, a bigger refactor than this visual change warrants. Revisit later if two WebGL contexts prove too expensive.

### 3. Backdrop is CSS-additive, not a `deepspace-skin` edit
`HoloBackdrop` ships its own new stylesheet (e.g. `src/styles/holo.css`) imported alongside, never editing `deck.css`/`base.css`. It's absolutely positioned inside `.deck` (which already clips to the rounded frame via `overflow: hidden`), sandwiched the same way `.hud-nebula`/`.hud-glow` already are, so `deepspace-skin`'s "unmodified" and "no unstyled/broken element" scenarios both keep holding.

### 4. Palette via `tokens.css` CSS variables read into Three.js materials
Since Three.js materials need JS color values, not CSS var references, read `getComputedStyle(document.documentElement).getPropertyValue('--cyan')` (etc.) once at mount (and on a `prefers-color-scheme`/theme-change listener if one exists) rather than hardcoding hex values, so the WebGL surfaces stay in sync with `tokens.css` if it's ever retuned.

### 5. Render-loop pause on asleep/unfocused
Both `HoloBackdrop` and `ReactorCore` accept a `running: boolean` prop (or read the same signal `App.tsx` already tracks: `sidecarRunning`/awake state, plus a new `window.document.hasFocus()`/`visibilitychange`+`blur`/`focus` listener). When `running` is false: stop calling `requestAnimationFrame`/R3F's internal loop (via `<Canvas frameloop="demand">` + manually invalidating only on relevant changes, or `frameloop="never"` while paused), freeze at the last frame. On resume, restart continuous rendering.

**Alternative considered**: unmount the `<Canvas>` entirely while paused (true 0 GPU, guaranteed). Rejected as default — remount cost (shader compile, context creation) on every wake would add visible latency to the wake animation the orb is supposed to play immediately; `frameloop="never"` already gets GPU usage to ~0 without teardown cost. Revisit if profiling shows idle GPU isn't actually near-zero.

### 6. Gesture bindings: fist = rotate, pinch = scale, gated on reader-closed
Extend `useHandControl`'s per-hand output with a `pinchDistance` (normalized landmark[4]-to-landmark[8] distance) alongside the existing categorical `fist`/`openPalm`/`pointing`. In `App.tsx`, when `handControl && !expandedTaskId` (mirroring the existing `Open_Palm`-scroll gate): a **primary-hand** `fist` drives incremental orb rotation (delta of hand `point` while `fist` stays true, cleared on release, analogous to Jarvis's `globeRotation`), and pinch distance (either hand) maps to orb scale (clamped, analogous to `globeScale`). This is new state (e.g. `orbRotation`/`orbScale` refs) threaded into `ReactorCore` as two new optional props, passed from `CenterStage`/`App.tsx`.

**Alternative considered**: gate on hand position being physically over the `.orb-stage` DOM rect (hover-to-engage) instead of global-while-reader-closed. Rejected — Jarvis's own model is global-to-the-scene (no per-object hover targeting), and Iris's camera/gesture UX today is already global-while-a-mode-is-active (e.g. `Open_Palm` scroll isn't hover-gated either), so this stays consistent with the existing interaction model.

## Risks / Trade-offs

- **[Risk] Continuous WebGL rendering drains battery/GPU on laptops even when "awake" but idle.** → Mitigation: decision 5 (pause on asleep/unfocused); additionally cap backdrop particle count and skip `Bloom` post-processing if a lightweight perf check (e.g. `navigator.hardwareConcurrency` or a dropped-frame counter) suggests a low-power device — tracked as a task, not blocking initial ship.
- **[Risk] Two independent `<Canvas>` contexts (backdrop + orb) may exceed WebGL context limits or hurt perf on integrated GPUs.** → Mitigation: documented as a known trade-off in Decision 2; if real-world testing shows a problem, a follow-up change can merge them.
- **[Risk] Gesture rotate/zoom firing unintentionally while the user's hand is just resting/moving during normal use (no explicit "engage" gesture).** → Mitigation: this mirrors Jarvis's own always-on gesture model, and is scoped to only when hand-control is enabled *and* the reader is closed (already a deliberate opt-in surface); revisit with a dead-zone/threshold on rotation delta if it proves too twitchy in practice.
- **[Risk] New pinned dependencies (three/fiber/drei/postprocessing) add real bundle size to an Electron app.** → Mitigation: this is an explicit, user-approved trade-off (grilled and confirmed) for visual quality; no lazy-loading is planned since the backdrop/orb render on every deck mount.
- **[Risk] `orb-expressions` and `two-hand-gestures` are both being modified by this change; if a future upstream sync touches either spec, conflicts are more likely than before.** → Mitigation: neither spec's upstream-verbatim CSS files are touched, only their `spec.md` requirements and the Claude-custom TSX/hook files, which were already expected to diverge from upstream.

## Migration Plan

1. Add pinned dependencies to `package.json`; run `npm ci` / `npm run build` to confirm the typecheck still passes with the new types.
2. Build `HoloBackdrop` + `holo.css` first (additive, no risk to existing orb), verify it renders behind panels in dev (`npm run dev`).
3. Rewrite `ReactorCore` internals to WebGL behind its existing prop interface; verify all `orb-expressions` scenarios (thinking swirl, wake pulse, ripple, task flashes) still fire visually identical in intent.
4. Wire pause-on-asleep/unfocused for both surfaces.
5. Add `pinchDistance` to `useHandControl`, wire fist-rotate/pinch-scale in `App.tsx`/`CenterStage.tsx`, gated on `!expandedTaskId`.
6. No rollback flag is planned (this is a pure visual/UX change, not a load-bearing runtime path like PO/DEV); rollback is a plain `git revert` if needed.

## Open Questions

- Exact particle/node count and Bloom intensity for the backdrop are left as implementation-time tuning (visual judgment call during `tdd`/`code-review`, not a spec-level requirement).
