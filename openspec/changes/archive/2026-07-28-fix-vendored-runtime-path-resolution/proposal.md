## Why

"Hey Iris" never wakes the app in a production build. Not intermittently, not with poor sensitivity — the wake-word listener never starts at all, and nothing tells the user.

The cause is one line in `src/hooks/useWakeWord.ts`'s `configureOrt()`:

```ts
ort.env.wasm.wasmPaths = import.meta.env.DEV
  ? `${window.location.origin}/runtime/ort/`   // absolute — works
  : `${import.meta.env.BASE_URL}runtime/ort/`; // relative — breaks in prod
```

`onnxruntime-web` loads its own WASM glue through a runtime `import(url)`. A dynamic `import()` inside a bundled chunk resolves a relative specifier against **that chunk's own URL**, not against the document. Vite emits the app chunk under `dist/assets/`, so `"./runtime/ort/…"` resolves to `dist/assets/runtime/ort/…`, while `scripts/vendor-runtime-assets.mjs` puts the file at `dist/runtime/ort/…`. Observed, verbatim, from a packaged-style run:

```
[wakeword] init failed Error: no available backend found.
ERR: [wasm] TypeError: Failed to fetch dynamically imported module:
file:///…/dist/assets/runtime/ort/ort-wasm-simd-threaded.jsep.mjs
```

The failure then goes **silent**. `getSessions()` rejects → `init()`'s catch calls `onError` → `App.tsx` routes it to `pushLog`, whose state is declared as `const [, setLogs] = useState<LogLine[]>([])` and rendered by no component. The user sees an enabled wake-word toggle, a hint reading *"Say "Hey Iris" or press W to wake"*, and no reaction to the phrase — with no error anywhere. That silence is why this read as a sensitivity problem for as long as it did, and it is a second defect worth fixing alongside the first.

**Where it came from, and why it was not caught.** Commit `2d9ab5d` (`harden-security-boundaries`) replaced the `onnxruntime-web` CDN URL with the vendored path, correctly satisfying `renderer-content-security` — and introduced the `DEV`/prod branch above to work around an unrelated Vite dev-server behaviour. The dev branch is absolute and correct; only the prod branch is wrong, and it has been broken from that commit onward.

`harden-wake-word-detection` landed immediately afterward, so its manual verification (task 6.2, "say 'Hey Iris' and confirm it still wakes") ran against an already-broken production path — but under `npm run dev`, which takes the working branch. The change was archived on that evidence. This is the structural failure worth naming: an environment-conditional path means a verification performed in one environment says nothing about the other, and every check this repo runs by default (`npm run build`, `npm test`, `npm run dev`) exercises the dev branch only.

## What Changes

- **Resolve the vendored runtime path against the document, once, for both environments.** Pre-resolving with `new URL(path, document.baseURI)` yields an absolute URL in dev *and* prod, which is correct for a module-relative dynamic `import()` and also preserves the dev-server workaround the `import.meta.env.DEV` branch was added for. The branch collapses to a single expression — one path, one behaviour, nothing that only runs in one environment. This is not a new invention: `src/components/DrawingCanvas.tsx:12` already does exactly this for Excalidraw's vendored fonts, for exactly this reason. The change generalizes a pattern the repo arrived at once and did not apply elsewhere.
- **Give the resolution a pure, testable seam.** The URL computation moves to `src/lib/asset-url.ts` with a colocated test, per the repo's test-harness spec, so the `assets/` regression is asserted by `npm test` without loading a model, an `AudioContext`, or Electron.
- **Apply it to the other vendored runtime too.** `src/hooks/useHandControl.ts:38-39` passes bare relative strings to MediaPipe. Those work today — a script element's `src` resolves against the document — but leaving them would archive a `SHALL` the tree visibly contradicts. The edit is provably output-identical in both environments (design D4), and it removes the asymmetry that made this bug possible: two vendored runtimes, two loading mechanisms, two meanings for the same relative string, and no way to tell by reading the call site.
- **Surface wake-word initialization failure to the user.** A listener that cannot start must say so, instead of presenting an armed-looking toggle. This closes the gap the archived `harden-wake-word-detection` design flagged in D6 and explicitly left out of scope. Two things about the current hook make the naive version wrong and are handled explicitly: `onError` today carries both a fatal init failure *and* a recoverable microphone fallback that arms successfully, and the hook emits no success signal at all — so "clear the warning on recovery" is unimplementable without adding one (design D3).
- **Add a repeatable end-to-end wake check.** A script that boots the production build against a synthesized "Hey Iris" clip via Chromium's fake-audio-capture flags and asserts a wake fired — converting "verify by hand in dev" into one command that exercises the production `file://` path. This is the only artifact here that would actually have caught the bug, and it is deliberately outside `npm test` because it boots Electron.

No behaviour changes for a working install: the detection rule, threshold, consecutive-frame gate, AGC constraint, and cooldown are all untouched and were never at fault, and gesture control's computed URLs are unchanged in both environments.

**What this change does not promise.** The unit test proves the helper computes the right URL; it cannot prove the helper is the thing actually handed to `onnxruntime-web`. Only the end-to-end check can. If the e2e task is dropped for scope, this class of bug can recur and the honest mitigation is the visible-failure requirement, not the unit test. The e2e check also covers the production `file://` path and **not** asar — a distributed `.app` resolves inside an archive, which only the manual packaged check reaches (design D9).

## Capabilities

### New Capabilities

_None._ This repairs behaviour already owned by `wake-sleep-voice` and already promised by `renderer-content-security`.

### Modified Capabilities

- `renderer-content-security`: the shipped-code requirement gains an explicit rule that references handed to a vendored third-party runtime are resolved to absolute URLs against the document's base URL — because the runtimes disagree about what a relative path means (see design D4) — with a stated carve-out for paths whose consuming API already resolves against the document, and the packaged-build scenario is strengthened from assets being *present* to the runtimes actually *initializing*.
- `wake-sleep-voice`: the wake-word requirement gains a rule that a listener which fails to initialize surfaces that failure rather than appearing armed — distinguishing a fatal failure from a recoverable microphone fallback, requiring a genuine success signal for recovery, and binding every surface that shows the wake instruction — plus a scenario covering the packaged build specifically.

## Impact

- **Code**: `src/hooks/useWakeWord.ts` (the `configureOrt` path, plus a fatal/non-fatal error split and a new `onReady` callback), `src/hooks/useHandControl.ts` (two constants through the same helper), a new `src/lib/asset-url.ts` + test pair for the URL helper, a small `src/lib/` caption helper + test so the visible-failure scenarios are machine-checked, `src/App.tsx` (hold and clear the init error; both the deck and HUD captions).
- **Main process**: `electron/window.mjs` only — a `console-message` forwarder inside the existing `IRIS_WAKE_DEBUG` branch, so the e2e check can read the renderer console. No new module: `electron-graph.supply.test.mjs` pins the set of Electron-importing modules to exactly four.
- **Scripts**: a new end-to-end wake check under `scripts/`, plus its generated audio fixture. Not wired into `npm test`.
- **Config**: none. No new `IRIS_*` keys, no `.env.example` change — the check reuses `IRIS_START_PROD`, `IRIS_WAKE_WORD`, `IRIS_WAKE_DEBUG`, `IRIS_WAKE_THRESHOLD`, `IRIS_WAKE_CONSECUTIVE`.
- **Dependencies**: none added. The fixture is generated by macOS's built-in `say`/`afconvert` plus in-script WAV padding, which is safe to depend on given `platform-support` already restricts Iris to macOS.
- **Docs**: `openspec/specs/renderer-content-security/spec.md` and `openspec/specs/wake-sleep-voice/spec.md` on archive.
- **Ruled out, do not "fix"**:
  - The three model `fetch()` URLs at `src/hooks/useWakeWord.ts:67-71` look identical to the broken line twelve lines above and are correct — `fetch()` resolves against the document. Confirmed by the observed failure being `no available backend found` rather than a 404, so all three loads succeeded on the broken build. They stay relative, with the reason recorded at the call site (design D5).
  - `src/hooks/useAudioPipeline.ts:165-171`'s AudioWorklet try/fallback stays as-is: it is a runtime fallback attempted in both environments rather than an environment branch, and the worklet is the app's own source rather than a vendored third-party runtime (design D6).
  - The wake-gate logic, threshold presets, and AGC constraint from `harden-wake-word-detection` are all correct; the listener never reached them.
