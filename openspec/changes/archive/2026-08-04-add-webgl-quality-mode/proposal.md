## Why

Iris ran light until WebGL arrived. Before commit `bc32c3f`, the orb was a 2D canvas
and the repo had no `three` dependency at all; that single commit both added
`three` / `@react-three/fiber` / `@react-three/postprocessing` and rewrote the orb as
a WebGL scene. Since then the app has been too heavy for modest machines, and there
is no way for a user to opt out.

The cost is not the geometry — the orb scene is about nine meshes, a few thousand
triangles, and shrinking it would buy almost nothing. The cost is **post-processing
and pixel count**, and it is paid three times over:

- Every WebGL surface renders a `Bloom` / `UnrealBloomPass` pyramid — roughly a dozen
  blur passes per frame, over the full canvas.
- No surface clamps its device-pixel ratio, so on a Retina display every one of those
  passes runs over four times the pixels.
- The deck runs **two** such surfaces at once — the orb and a full-screen backdrop —
  and the galaxy adds a third, full-screen, when opened.
- The orb additionally requests `powerPreference: "high-performance"`, which on a
  dual-GPU Mac forces the discrete GPU: heat, fans, and battery drain even when the
  scene is trivial.

A user on a capable machine should keep all of it. A user on a modest one should get
an app that stays out of the way, and should not have to choose between the effects
and a usable computer.

## What Changes

- A new **WebGL quality preference**, surfaced as a single Off/On row in the setup
  panel, persisted across launches, **defaulting to off (the light path)**. Changing
  it applies immediately — no relaunch.
- On the **light path** (default): the orb renders without bloom, at a clamped device
  pixel ratio, without multisample antialiasing, without the high-performance GPU
  hint, and with unlit materials; the deck's WebGL particle backdrop is not created
  at all, leaving the existing CSS gradient layers as the deck's background; and the
  galaxy renders without its bloom pass, keeping its in-scene starfield backdrop.
- On the **high-fidelity path**: every surface renders exactly as it does today.
- The orb keeps a visible glow on the light path via a compositor-drawn CSS layer
  keyed to the orb's expressive state, so the light orb still reads as lit rather
  than as flat plastic.
- No expressive behaviour changes on either path: the wake pulse, speech-lock ripple,
  thinking swirl, task flashes, state palette, and render-loop pausing all keep
  working identically.
- **BREAKING (default behaviour):** a user upgrading gets the light path unless they
  turn the preference on. This is intentional — the heavy path is the thing being
  made opt-in.

## Capabilities

### New Capabilities

- `webgl-quality-mode`: the single definition of the quality preference — what it is,
  where it persists, that it defaults to the light path, that it applies immediately,
  and what each path means for every WebGL surface in the app. Every other spec
  points here rather than restating it.

### Modified Capabilities

- `orb-expressions`: the requirement that the orb renders "via WebGL … with counter-
  rotating rings and bloom" becomes conditional on the quality preference, with the
  light path defining its own glow. The expressive prop surface, the state palette,
  and the render-loop pausing rules are unchanged.
- `holo-deck-backdrop`: the deck's WebGL particle/node backdrop becomes conditional
  on the quality preference rather than unconditional. Its existing pause-on-sleep /
  pause-on-unfocus requirement still applies whenever it is rendered.
- `second-brain-galaxy-view`: the galaxy's node bloom becomes conditional on the
  quality preference. The opaque deep-space backdrop and drifting starfield are
  unconditional and stay, because they are painted inside the scene rather than by
  the bloom pass.
- `setup-panel`: the panel gains the quality row.

## Impact

- `src/components/ReactorCore.tsx` — canvas `gl` options, `dpr`, the effect composer,
  and the material choice all become quality-dependent; needs a remount on change,
  since `dpr` / `antialias` / `powerPreference` are fixed when the WebGL context is
  created.
- `src/components/HoloBackdrop.tsx` — mounted conditionally by `src/App.tsx`.
- `src/components/VaultGalaxy.tsx` — the bloom pass is added conditionally.
- `src/components/CenterStage.tsx`, `src/components/HudShell.tsx` — thread the
  preference to the orb at both of its mount sites.
- `src/components/SetupPanel.tsx`, `src/App.tsx` — the new row, its state, and its
  persistence, following the existing `iris.*` preference pattern.
- `src/styles/` — the light path's CSS glow layer.
- New pure helper under `src/lib/` deriving each surface's render settings from the
  preference, with unit tests.
- No dependency changes: `three` and the R3F packages are still required by the
  high-fidelity path and by the galaxy's force-graph rendering either way.
- `docs/REFERENCE.md` and `.env.example` are unaffected — this is a per-machine UI
  preference in local storage, not an `IRIS_*` environment option.
