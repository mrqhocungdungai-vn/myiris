## Context

`ReactorCore`'s `useFrame` (`src/components/ReactorCore.tsx:118-183`) drives the orb every frame. It reads a `palette: Palette` (rgb *strings*, from static `PALETTES` at `:17-23`) and writes materials/transforms. Each write goes through `rgbToColor(rgb)` (`:25-28`) which does `rgb.split(",").map(n => parseFloat(n)/255)` and `new THREE.Color(...)` — ~8 calls/frame (`:139,140,147,148,157,165,180`) — plus `new THREE.Vector3(...)` at `:133`. None of the *values* vary per frame; only which material is written and by how much (energy/level scalars).

`useAudioPipeline`'s `startCapture` (`src/hooks/useAudioPipeline.ts:100-130`) builds `source → ScriptProcessorNode(1024) → destination`, and `source → analyser` for the level meter. The `onaudioprocess` handler (`:110-121`) runs on the main thread every 1024 samples (~21 ms at 48 kHz), calls `downsampleTo16k(input, context.sampleRate)` (`:3`), and `window.iris.sendAudioChunk(chunk)`. `stopCapture` (`:133-144`) disconnects the nodes and closes the input context.

The two live in different subsystems but share one failure mode named repeatedly in the plan: work that stalls the main thread stutters the 24 kHz playback schedule (`playGeminiAudio`, `:166-194`). They are the direct continuation of F/G/H's frame-budget theme; grouping them lets a single new `main-thread-budget` capability capture the invariant.

## Goals / Non-Goals

**Goals:**

- Zero per-frame allocation in the orb render loop; identical visual output.
- Mic downsampling off the main thread via `AudioWorklet`; byte-identical 16 kHz PCM to Gemini.
- A pure, unit-tested `downsampleTo16k` shared in intent with the worklet.
- No IPC-surface change (`sendAudioChunk` unchanged), no dependency, no behavior change.

**Non-Goals:**

- `window.confirm` (spec'd DEV gate + dwell-coupling — its own change).
- Audio-playback correctness bugs (barge-in flush race, output context leak — their own change).
- `memo`-ing the App tree, gesture/camera lifecycle — separate items.
- Changing the meter tap, bloom, or any expressive-state mapping.

## Decisions

### D1 — Pre-parse palettes once; write colors in place with `.copy()`

**Chosen:** at module scope build `PALETTE_COLORS: Record<ReactorState, { primary: THREE.Color; secondary: THREE.Color; accent: THREE.Color; glow: THREE.Color }>` by parsing each `PALETTES` entry once. In `useFrame`, replace `mat.color = rgbToColor(palette.primary)` with `mat.color.copy(pc.primary)` (and `.emissive.copy(...)`, etc.), where `pc = PALETTE_COLORS[reactorState]`.

`.copy()` (not assigning the cached instance) is deliberate: assigning `mat.color = pc.primary` would make several materials share one `THREE.Color` instance, so a later in-place mutation of any of them (or of the cache) would corrupt the others. `.copy()` writes channel values into each material's own color object — zero allocation, no aliasing.

*Considered:* a per-frame `if (state !== lastState)` guard to skip color writes entirely. Rejected as unnecessary — `.copy()` of three floats is trivially cheap, and the writes also fold in per-frame emissive-intensity/opacity math that depends on `energy`/levels anyway. The allocation was the cost, not the assignment.

### D2 — Reuse a scratch `Vector3` for the scale lerp

**Chosen:** a module-level `const _scaleVec = new THREE.Vector3()`; in the loop, `_scaleVec.set(s, s, s); groupRef.current.scale.lerp(_scaleVec, 0.12)`. Single instance reused every frame. Safe because `lerp` only reads its argument.

### D3 — Extract `downsampleTo16k` to `src/lib/downsample.ts`, unit-tested

**Chosen:** move the pure downsample function to `src/lib/downsample.ts` and cover it with a Vitest unit test (a known input Float32 at a given rate → expected 16 kHz `Int16Array`). This is exactly the "pure `src/lib` helper" the Vitest harness is meant to cover (Wave 0.0), and it locks the algorithm so the worklet copy cannot silently drift. The hook imports it for any main-thread use; the worklet uses the same algorithm (see D4).

### D4 — `AudioWorklet` for capture; keep the analyser tap; hand chunks back via the port

**Chosen:** add a worklet module defining an `AudioWorkletProcessor` whose `process(inputs)` downsamples the first input channel to 16 kHz and `this.port.postMessage(bytes)` (transferring the `ArrayBuffer`). In `startCapture`: `await context.audioWorklet.addModule(<worklet url>)`, create `new AudioWorkletNode(context, "mic-downsample")`, wire `source → workletNode` (no connection to `destination` needed — capture is a sink via the port, not audible), set `workletNode.port.onmessage = (e) => window.iris.sendAudioChunk(e.data)`. Keep `source → analyser` unchanged for the meter. `stopCapture` disconnects the worklet node, closes the context, nulls the refs (`inputProcessorRef` now holds the `AudioWorkletNode`).

**Worklet packaging is the real risk.** The worklet must be a URL-loadable module in both `npm run dev` (Vite dev server) and the packaged Electron build (`file://`). Approach: author it as a standalone asset and resolve its URL with `new URL("../worklets/mic-downsample.js", import.meta.url)` so Vite emits and fingerprints it. If that does not resolve under packaged `file://`, fall back to placing it in `public/` and loading by relative path. Because an `AudioWorklet` module runs in an isolated global scope, it cannot `import` the hook's function directly across all bundler setups; the worklet inlines the same downsample algorithm as `src/lib/downsample.ts`, and D3's shared test is the guard against divergence. Verification must cover **both** dev and a packaged build (`npm run package:mac`).

*Considered:* keeping `ScriptProcessorNode` but moving downsample to a Web Worker. Rejected — the `onaudioprocess` callback itself is what runs on the main thread; only an `AudioWorklet` moves the audio callback off it.

## Risks / Trade-offs

**Worklet fails to load in the packaged app** → the highest-risk item; capture would silently break. Mitigated by explicit dev+packaged verification (D4) and a load-failure log/fallback path. This is why it is its own commit, landing only after the packaged smoke test passes.

**Worklet downsample diverges from `src/lib/downsample.ts`** → the shared Vitest test (D3) pins the algorithm; a divergence shows up as a failing test or an audibly wrong send. Keep the two implementations line-for-line identical.

**Aliased `THREE.Color` corruption** → avoided by `.copy()` semantics (D1); never assign a cached instance to a material.

**`addModule` is async, capture start is now awaited longer** → `startCapture` is already `async` and awaited; the one-time module load adds negligible startup latency and happens before the first chunk.

**No automated coverage for the render loop or the worklet wiring** → renderer/R3F/Web Audio is out of the Vitest harness (Wave 0.0 D5); only `downsample.ts` is unit-tested. The rest is the manual checklist: a temporary allocation probe / DevTools memory timeline for the orb, and mic round-trip (voice actually reaches Gemini) in dev and packaged builds.
