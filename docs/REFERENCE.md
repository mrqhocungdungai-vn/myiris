# Exact Google Models, SDKs & Assets (pinned reference)

[← Back to README](../README.md)

Use this table as the single source of truth for **which Google pieces we use**,
so future changes don't reintroduce wrong/deprecated names or version drift.

| Purpose | Exact identifier we use | Where it's set | Source |
| --- | --- | --- | --- |
| Gemini Live model | `models/gemini-3.1-flash-live-preview` | `electron/main.mjs` (`GEMINI_LIVE_MODEL` env override) | Google AI Studio / Gemini API |
| Gemini voice | `Zephyr` | `electron/main.mjs` (`GEMINI_LIVE_VOICE` env override) | Gemini Live prebuilt voices |
| Gemini SDK | `@google/genai` `^2.10.0` | `package.json` | npm |
| Gemini built-in search tool | `{ googleSearch: {} }` | `electron/main.mjs` `tools` | Gemini Live tools |
| Gesture/hand ML runtime | `@mediapipe/tasks-vision` `^0.10.35` | `package.json` | npm |
| MediaPipe WASM fileset | `public/runtime/mediapipe/vision_wasm_internal.{js,wasm}` | `src/hooks/useHandControl.ts` (`WASM_URL`) | vendored from `node_modules/@mediapipe/tasks-vision/wasm/` by `scripts/vendor-runtime-assets.mjs` |
| MediaPipe model asset | `public/runtime/mediapipe/gesture_recognizer.task` | `src/hooks/useHandControl.ts` (`MODEL_URL`) | vendored (downloaded once, cached) by `scripts/vendor-runtime-assets.mjs` from Google Cloud Storage |
| Wake-word ONNX runtime | `onnxruntime-web` `^1.27.0` | `package.json` | npm |
| Wake-word ONNX WASM fileset | `public/runtime/ort/ort-wasm-simd-threaded.jsep.{mjs,wasm}` | `src/hooks/useWakeWord.ts` (`ort.env.wasm.wasmPaths`) | vendored from `node_modules/onnxruntime-web/dist/` by `scripts/vendor-runtime-assets.mjs` |
| Wake-word model assets | `melspectrogram.onnx`, `embedding_model.onnx`, `hey_iris.onnx` | `public/wakeword/` (bundled, no runtime fetch) | vendored from the "Hey Iris" openWakeWord training run |
| WebGL 3D engine | `three` `^0.181.2` | `package.json` | npm |
| React renderer for Three.js | `@react-three/fiber` `^9.4.0` | `package.json` | npm |
| Three.js helpers | `@react-three/drei` `^10.7.7` | `package.json` | npm |
| Bloom/post-processing | `@react-three/postprocessing` `^3.0.4` | `package.json` | npm |
| Second-brain galaxy 3D graph | `3d-force-graph` `1.80.0` (exact) | `package.json` | npm |
| Note frontmatter parser | `gray-matter` `4.0.3` (exact) | `package.json` | npm |
| Electron | `42.5.0` (exact) | `package.json` | npm |

## Known footguns / lessons (avoid repeating these)

- **Use the exact Live model name `gemini-3.1-flash-live-preview`.** Live models
  are a distinct family from regular `gemini-*` chat models; a normal chat model
  name will fail to open a Live session. Keep the `models/` prefix.
- **The MediaPipe and onnxruntime-web WASM filesets are vendored, not
  CDN-fetched.** `scripts/vendor-runtime-assets.mjs` copies them straight from
  the installed `node_modules` package into `public/runtime/` (wired into
  `npm run build` and `postinstall`), so the shipped WASM version can never
  drift from the pinned npm version the way a hand-typed CDN URL could — there
  is no `@x.y.z` to remember to bump. See `renderer-content-security` in
  `openspec/specs/`: the renderer executes only code shipped inside the app,
  enforced by a CSP that blocks any remaining third-party script/WASM origin.
- **The gesture model asset is vendored too**, downloaded once by the same
  script and cached in `public/runtime/mediapipe/` (skipped on subsequent
  builds if already present) — the only remaining network dependency is that
  one-time vendoring step, not first app launch.
- **Only one WASM variant is copied per runtime**, matching what the app's own
  import actually resolves at runtime (see design.md of
  `harden-security-boundaries` for how each was determined): onnxruntime-web
  resolves to the `ort-wasm-simd-threaded.jsep` pair (not the smaller
  non-jsep/asyncify/jspi variants) because the bare `import "onnxruntime-web"`
  hits the package's default bundle, which hardcodes that filename; MediaPipe
  resolves to the `vision_wasm_internal` pair (SIMD, non-module) since
  Electron's bundled Chromium always supports WASM SIMD.
- **Gemini Live audio formats are fixed:** send **16 kHz** PCM, receive **24 kHz**
  PCM. Don't assume a single sample rate for both directions.
- **Gemini 3.1 Live function calls are synchronous** — never block a tool call on
  long Claude work; return a `run_id` immediately and track completion separately.
- **Send realtime input with `sendRealtimeInput`** (not the deprecated
  `media_chunks` path) for audio/text streaming.
- **Keep exactly one `three` copy resolved.** `3d-force-graph` bundles its own
  `three`; `package.json`'s `overrides.three` + `vite.config.ts`'s
  `resolve.dedupe: ["three"]` collapse it (and any transitive copy, e.g.
  `stats-gl`) onto the app's single `three`. `npm run build` fails via
  `scripts/check-three-dedupe.mjs` if a second copy reappears.
- **`electron` is pinned to an exact version, not `"latest"`.** `webPreferences.sandbox: true` and the renderer's Content-Security-Policy (`renderer-content-security`) both depend on a fixed, known Electron version rather than one that can silently shift on the next `npm ci`.
