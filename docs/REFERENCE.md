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
| MediaPipe WASM fileset | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm` | `src/useHandControl.ts` (`WASM_URL`) | jsDelivr CDN |
| MediaPipe model asset | `https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task` | `src/useHandControl.ts` (`MODEL_URL`) | Google Cloud Storage |
| Wake-word ONNX runtime | `onnxruntime-web` `^1.27.0` | `package.json` | npm |
| Wake-word ONNX WASM fileset | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/` | `src/hooks/useWakeWord.ts` (`ort.env.wasm.wasmPaths`) | jsDelivr CDN |
| Wake-word model assets | `melspectrogram.onnx`, `embedding_model.onnx`, `hey_iris.onnx` | `public/wakeword/` (bundled, no runtime fetch) | vendored from the "Hey Iris" openWakeWord training run |
| WebGL 3D engine | `three` `^0.181.2` | `package.json` | npm |
| React renderer for Three.js | `@react-three/fiber` `^9.4.0` | `package.json` | npm |
| Three.js helpers | `@react-three/drei` `^10.7.7` | `package.json` | npm |
| Bloom/post-processing | `@react-three/postprocessing` `^3.0.4` | `package.json` | npm |

## Known footguns / lessons (avoid repeating these)

- **Use the exact Live model name `gemini-3.1-flash-live-preview`.** Live models
  are a distinct family from regular `gemini-*` chat models; a normal chat model
  name will fail to open a Live session. Keep the `models/` prefix.
- **Keep the MediaPipe WASM URL version equal to the installed npm version.**
  Both are pinned to `0.10.35` today. A mismatch between the JS API
  (`@mediapipe/tasks-vision`) and the WASM fileset can cause subtle runtime/ABI
  breakage, so update the `@x.y.z` in `WASM_URL` whenever you bump the package
  (or self-host the WASM from the installed package instead of a CDN).
- **Keep the onnxruntime-web WASM URL version equal to the installed npm version**, same reasoning as MediaPipe above — both are pinned to `1.27.0` today.
- **MediaPipe WASM + model are fetched from Google/jsDelivr at first load**, so
  gesture control needs network access on first run. Vendor both locally if you
  need fully offline startup.
- **Gemini Live audio formats are fixed:** send **16 kHz** PCM, receive **24 kHz**
  PCM. Don't assume a single sample rate for both directions.
- **Gemini 3.1 Live function calls are synchronous** — never block a tool call on
  long Claude work; return a `run_id` immediately and track completion separately.
- **Send realtime input with `sendRealtimeInput`** (not the deprecated
  `media_chunks` path) for audio/text streaming.
