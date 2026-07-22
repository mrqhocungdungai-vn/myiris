## Why

Wave 1 (F/G/H) removed the per-frame *re-render* and *emit* triggers that were burning the renderer's frame budget. Two defects remain that stall the main thread directly and glitch the 24 kHz audio playback schedule — the same symptom the plan calls "audio giật":

**Item 1 — `ReactorCore`'s render loop allocates every frame.** The `useFrame` callback (`src/components/ReactorCore.tsx:118-183`) calls `rgbToColor(...)` — a `String.split(...).map(parseFloat)` plus `new THREE.Color(...)` — about **eight times per frame** (`:139,140,147,148,157,165,180`) and `new THREE.Vector3(...)` once (`:133`). At 60 fps that is ~500–700 short-lived allocations per second feeding the GC, whose collection pauses land on the main thread and jitter the audio schedule. The palettes are static string constants (`:17-23`); nothing about the values changes per frame — only the target `THREE.Color`/material is written.

**Item 2 — mic capture runs a `ScriptProcessorNode` on the main thread.** `startCapture` (`src/hooks/useAudioPipeline.ts:100-130`) uses `context.createScriptProcessor(1024, 1, 1)` whose `onaudioprocess` handler (`:110-121`) runs **on the main thread** every ~21 ms at 48 kHz, downsampling to 16 kHz (`downsampleTo16k`, `:3`) and posting the chunk over IPC. `ScriptProcessorNode` is deprecated precisely because it contends with the UI thread — here directly against React and three.js. The correct home is an `AudioWorklet`, whose `process()` runs on the dedicated audio rendering thread.

Both are behavior-preserving perf fixes: identical orb colors, identical 16 kHz mono PCM sent to Gemini via `window.iris.sendAudioChunk` (a pinned contract — see CLAUDE.md "send 16 kHz PCM"). Neither changes any user-visible behavior; they remove main-thread/GC stalls that today are invisible until they regress.

Out of scope (deferred to their natural homes): the `window.confirm` DEV soft-gate block (`App.tsx:503`) is a **spec'd** behavior (`renderer-structure` "the DEV soft-gate confirm") and is coupled to the dwell-click safety item — it belongs with the dwell-safety change, not a pure-perf propose. The audio-playback correctness bugs (barge-in flush race, output `AudioContext` never closed) and the gesture/camera-lifecycle items are their own later changes.

## What Changes

Two commits, one per item (independent files; unified by the "keep the main thread free for the 60 fps render and the 24 kHz audio schedule" theme, the direct continuation of F/G/H).

**Commit 1 — Item 1: allocation-free orb render loop.**
- Pre-parse each palette's four rgb strings into `THREE.Color` instances once at module scope (`PALETTE_COLORS: Record<ReactorState, {...}>`); keep the raw string `PALETTES` for any non-hot-path use.
- In `useFrame`, write colors in place — `mat.color.copy(pc.primary)` / `mat.emissive.copy(pc.glow)` etc. — instead of `mat.color = rgbToColor(...)`. `.copy()` mutates the existing material color, allocating nothing and never sharing a cached reference into a material.
- Replace `new THREE.Vector3(s,s,s)` in the scale lerp (`:133`) with a module-level scratch `Vector3` reused via `.set(s,s,s)` before `.lerp(...)`.
- Net: zero allocation in the per-frame path; the orb looks and animates identically.

**Commit 2 — Item 2: move mic downsampling to an `AudioWorklet`.**
- Add a self-contained worklet module (an `AudioWorkletProcessor` whose `process()` downsamples the input to 16 kHz and `port.postMessage`s the PCM bytes), loaded via `context.audioWorklet.addModule(...)`.
- Extract the downsample math to `src/lib/downsample.ts` (pure, unit-tested in the Vitest harness); the worklet uses the same algorithm so the two cannot silently diverge.
- Replace the `ScriptProcessorNode` with an `AudioWorkletNode`: `source → workletNode` for capture (the node's `port.onmessage` forwards each 16 kHz chunk to `window.iris.sendAudioChunk` on the main thread — a cheap hand-off, no per-sample work on the UI thread). The passive `analyser` meter tap (`:105-108`) stays exactly as it is (source → analyser). `stopCapture` disconnects/closes the same way.
- The 16 kHz mono PCM stream to Gemini is byte-for-byte the same as today.

## Capabilities

### New Capabilities

- `main-thread-budget`: a new capability stating that the renderer keeps the main thread free enough to sustain the orb's 60 fps render loop and the 24 kHz audio playback schedule. Two requirements: (a) the orb render loop performs no per-frame heap allocation; (b) microphone capture and downsampling do not run on the main thread. This is the first spec home for the render-path/main-thread performance invariants Wave 1 has been enforcing (F/G/H had none beyond `orb-expressions`' render-loop pause) — encoding exactly the kind of invisible-until-regressed property that belongs in a spec.

### Modified Capabilities

None. Orb colors are unchanged (`orb-expressions` "colored from `tokens.css` per the current `reactorState`" stays true); the audio send contract is unchanged (not spec'd in OpenSpec — pinned in CLAUDE.md/README — and preserved byte-for-byte).

## Impact

- `src/components/ReactorCore.tsx` — module-scope `PALETTE_COLORS`; `useFrame` writes colors via `.copy()`/`.set()`; scratch `Vector3` for the scale lerp.
- `src/hooks/useAudioPipeline.ts` — `startCapture` uses `AudioWorkletNode` + `addModule`; `port.onmessage` → `sendAudioChunk`; `stopCapture` updated; `inputProcessorRef` becomes the worklet node.
- `src/lib/downsample.ts` — **new**, extracted pure `downsampleTo16k`; `src/lib/downsample.test.ts` — **new** Vitest unit test (fixture PCM → expected 16 kHz Int16).
- `src/worklets/mic-downsample.js` (or equivalent Vite-emitted asset) — **new** worklet module.
- Possibly `vite.config` — ensure the worklet asset is emitted/loadable in dev and packaged builds.
- `main-thread-budget` living spec — new capability, two ADDED requirements.
- No new dependency, no data migration, no IPC-surface change (`sendAudioChunk` contract unchanged).
