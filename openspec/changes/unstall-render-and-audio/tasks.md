## 1. Commit 1 — Item 1: allocation-free orb render loop (`ReactorCore.tsx`)

- [x] 1.1 Build `PALETTE_COLORS: Record<ReactorState, { primary; secondary; accent; glow: THREE.Color }>` at module scope by parsing each `PALETTES` entry once (design D1). Keep `PALETTES` (strings) for any non-hot-path reference
- [x] 1.2 In `useFrame`, replace every `mat.color = rgbToColor(palette.x)` / `mat.emissive = rgbToColor(...)` with in-place `mat.color.copy(pc.x)` / `mat.emissive.copy(pc.glow)` where `pc = PALETTE_COLORS[reactorState]` (lines ~139,140,147,148,157,165,180). Never assign a cached instance to a material (aliasing — design D1)
- [x] 1.3 Replace `new THREE.Vector3(s,s,s)` in the scale lerp (`:133`) with a module-level scratch `_scaleVec.set(s,s,s)` before `.lerp(_scaleVec, 0.12)` (design D2)
- [x] 1.4 Confirm `rgbToColor` is no longer called from `useFrame` (it may remain for one-time setup, or be removed if unused)

## 2. Commit 1 — verification (manual; ReactorCore is out of the Vitest harness)

- [x] 2.1 Orb is visually identical in every state (idle/online/listening/speaking/working): colors, glow, ring motion, core pulse, thinking sparks
- [x] 2.2 With a temporary allocation probe (or Chrome DevTools Memory allocation timeline) over ~10 s of steady-state rendering, confirm the per-frame path allocates ~nothing (no sawtooth from `THREE.Color`/`Vector3` churn)
- [x] 2.3 Fist-rotate / pinch-scale still drive the orb (the scale lerp still tracks `scaleRef`)
- [x] 2.4 `npm run build` passes

## 3. Commit 2 — Item 2a: extract + test the downsample (`src/lib/downsample.ts`)

- [x] 3.1 Move `downsampleTo16k(input: Float32Array, inputRate: number): Int16Array` to `src/lib/downsample.ts` (pure); import it in `useAudioPipeline.ts` for any main-thread use (design D3)
- [x] 3.2 Add `src/lib/downsample.test.ts` (Vitest): a known Float32 buffer at 48 kHz → expected 16 kHz `Int16Array` length and sample values; include an edge case (input shorter than one output sample). `npm test` green

## 4. Commit 2 — Item 2b: AudioWorklet capture (`useAudioPipeline.ts` + worklet)

- [x] 4.1 Add the worklet module (`src/worklets/mic-downsample.js` or `public/`): an `AudioWorkletProcessor` (registered as `"mic-downsample"`) whose `process()` downsamples input ch0 to 16 kHz using the SAME algorithm as `src/lib/downsample.ts` and `this.port.postMessage(bytes, [bytes])` (design D4). Keep it line-for-line identical to the lib algorithm
- [x] 4.2 In `startCapture`: `await context.audioWorklet.addModule(<url>)` (resolve via `new URL("../worklets/mic-downsample.js", import.meta.url)`; fall back to `public/` if packaged `file://` cannot resolve it — design D4), create `new AudioWorkletNode(context, "mic-downsample")`, wire `source → workletNode`, set `workletNode.port.onmessage = (e) => window.iris.sendAudioChunk(e.data)`. Store it in `inputProcessorRef` (retype to `AudioWorkletNode`)
- [x] 4.3 Keep the passive `analyser` tap unchanged (`source → analyser`, `inputAnalyserRef`) so the input-level meter still drives the HUD
- [x] 4.4 Update `stopCapture` to disconnect the worklet node and close the context; null all refs. No `ScriptProcessorNode` remains
- [x] 4.5 Log a clear error and degrade gracefully if `addModule`/`AudioWorkletNode` throws (worklet load failure must be diagnosable, not silent)

## 5. Commit 2 — verification (manual; worklet + Web Audio are out of the harness)

- [x] 5.1 In `npm run dev`: mic round-trips — speak, confirm Gemini hears/responds (16 kHz send path intact) and the input-level meter still reacts
- [x] 5.2 In a packaged build (`npm run package:mac`): the worklet loads under `file://` and the mic round-trips there too (the D4 packaging risk — this gates the commit)
- [x] 5.3 Barge-in still interrupts (unrelated to this change, but re-check capture didn't regress start/stop)
- [x] 5.4 `npm run build` passes; `npm test` passes (incl. `downsample.test.ts`)

## 6. Spec and record

- [x] 6.1 `openspec validate unstall-render-and-audio` passes
- [x] 6.2 Re-read the `main-thread-budget` requirements against the landed code: orb loop allocates nothing per frame + visually identical; capture downsampling runs in the worklet, send format byte-identical, capture lifecycle clean
- [ ] 6.3 Two commits on `develop`, one per item (commit 1 = ReactorCore alloc, commit 2 = AudioWorklet incl. the lib extract + test + worklet). Do not squash. Co-Authored-By trailer
- [x] 6.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark the ReactorCore-alloc and ScriptProcessorNode rows done; note item 1 hoists palettes + in-place `.copy()`/`.set()` (no visual change), item 2 moves downsampling to an AudioWorklet with a shared unit-tested `src/lib/downsample.ts` (16 kHz send byte-identical), and record the new `main-thread-budget` capability. Note the remaining table rows (window.confirm→async, dwell-destructive guard/`data-no-dwell`, webcam opt-in, camera-error-stuck, barge-in flush race, output-context leak, stale-closure comment) are still open before Wave 2 (BUG I.2–I.5)
