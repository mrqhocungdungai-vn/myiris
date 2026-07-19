## Why

The Orbital Deck's non-HUD background (the layered CSS gradients in `hud-nebula`/`hud-glow`/`hud-vignette`) and the 2D-canvas `ReactorCore` orb look flat and dated next to the reference aesthetic in the Jarvis-CV project (Three.js holographic Arc Reactor + drifting particle network, bloom-lit). The user wants the deck (not Glass HUD, which is out of scope) to read as a genuine holographic HUD instead of a static gradient with a 2D orb.

## What Changes

- Add a new WebGL backdrop layer (`three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`, versions matched to Jarvis-CV) rendering a drifting, bloom-lit particle/node network behind the deck panels — additive only, layered on top of the existing (unmodified) Deep Space CSS gradients from `deepspace-skin`.
- Replace `ReactorCore`'s 2D-canvas rendering with a 3D Arc Reactor (glowing core + two counter-rotating rings + bloom), preserving its existing prop contract (`state`, `inputLevelRef`/`outputLevelRef`, `thinking`, `wakeKey`, `rippleKey`) and all current expressive behaviors (thinking swirl, wake double-pulse, speech-lock ripple, task flashes).
- Both new WebGL surfaces render in Iris's existing `tokens.css` palette (cyan/violet), not Jarvis's own colors, and their render loops fully pause (0 GPU) when Iris is asleep or the deck window is unfocused, resuming on wake/focus.
- **BREAKING (internal only)**: add gesture-driven control of the Arc Reactor orb — a closed fist rotates it, a pinch (thumb-index distance) scales it — reusing the existing `useHandControl` MediaPipe hook. This only engages while the reader overlay is closed, so it does not collide with the existing `Closed_Fist`-closes-reader or two-palm-resize bindings.
- No change to Glass HUD (`HudShell`/`hud.css`) or to any of the upstream-verbatim Deep Space stylesheets (`tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, `index.css`) — those stay unmodified and diffable per the existing `deepspace-skin` spec.

## Capabilities

### New Capabilities
- `holo-deck-backdrop`: the new WebGL particle/node network ambient layer rendered behind the deck panels, additive to the existing Deep Space CSS background, token-colored, and paused when asleep/unfocused.

### Modified Capabilities
- `orb-expressions`: `ReactorCore`'s rendering technology moves from 2D canvas to a 3D (Three.js) Arc Reactor while preserving its existing expressive prop surface and behaviors; adds a requirement that its render loop pauses when asleep or the window is unfocused.
- `two-hand-gestures`: adds a new requirement for closed-fist-to-rotate / pinch-to-scale control of the Arc Reactor orb, scoped to only engage while the reader overlay is closed (no conflict with the existing fist-closes-reader or two-palm-resize bindings).

## Impact

- New dependencies: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (pinned versions, added to `package.json` and documented like other exact-identifier deps).
- Changed files: `src/components/ReactorCore.tsx` (rewritten to WebGL), a new backdrop component + its own stylesheet (not touching `deepspace-skin`'s files), `src/hooks/useHandControl.ts` (new pinch/rotate derivation), `src/components/CenterStage.tsx` and/or `src/App.tsx` (wiring gesture state into the orb, focus/sleep lifecycle).
- No change to DEV/PO/STUDY pipeline mechanics, IPC surface, or Gemini/Claude delegation — purely a renderer visual/interaction change scoped to deck mode.
