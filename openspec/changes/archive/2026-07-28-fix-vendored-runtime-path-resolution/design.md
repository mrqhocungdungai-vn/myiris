## Context

`scripts/vendor-runtime-assets.mjs` copies `onnxruntime-web`'s WASM glue into `public/runtime/ort/`, which Vite copies verbatim to `dist/runtime/ort/`. `src/hooks/useWakeWord.ts:43-45` points `onnxruntime-web` at it:

```ts
ort.env.wasm.wasmPaths = import.meta.env.DEV
  ? `${window.location.origin}/runtime/ort/`
  : `${import.meta.env.BASE_URL}runtime/ort/`;
```

`vite.config.ts:62` sets `base: "./"`, which Vite expands to `import.meta.env.BASE_URL === "/"` in dev and `"./"` in a build — so the production branch assigns the relative string `"./runtime/ort/"`.

**How `onnxruntime-web` consumes it.** It appends the glue filename and performs a dynamic `import(url)`. Per the ES module specification, a relative specifier in a dynamic `import()` resolves against the URL of the **module performing the import** — here the bundled app chunk at `dist/assets/index-<hash>.js` — not against the document. The resolution is therefore:

| | resolved to | file exists |
| --- | --- | --- |
| what ORT imports | `dist/assets/runtime/ort/ort-wasm-simd-threaded.jsep.mjs` | no |
| what was vendored | `dist/runtime/ort/ort-wasm-simd-threaded.jsep.mjs` | yes |

The dev branch escapes this because `window.location.origin + "/runtime/ort/"` is already absolute, so no module-relative resolution happens. That is the entire reason the bug is invisible in `npm run dev`.

**Observed failure**, from a production-mode Electron run (`IRIS_START_PROD=1`) with renderer console forwarded:

```
[wakeword] init failed Error: no available backend found.
ERR: [wasm] TypeError: Failed to fetch dynamically imported module:
file:///…/dist/assets/runtime/ort/ort-wasm-simd-threaded.jsep.mjs
```

**Observed after pre-resolving the path against the document**, same harness, same synthesized clip:

```
[wakeword] fired score=0.941 run=2
[IRIS][gemini_status] "connecting"
[IRIS][gemini_status] "connected"
```

**The silence.** `getSessions()` rejects → `init()` catches at `src/hooks/useWakeWord.ts:283-287` → `onErrorRef.current?.(message)` → `src/App.tsx:620-623` passes it to `pushLog` → `src/App.tsx:90`'s `const [, setLogs] = useState<LogLine[]>([])`. The value is destructured away and no component takes a `logs` prop. The error is written to an array nobody reads. The archived `harden-wake-word-detection` design named this exact dead channel in D6 and deferred it as "its own change"; this is that change, because the deferral is what made a hard failure look like a tuning problem.

**Where the app loads from.** `electron/window.mjs:93-95`: `app.isPackaged || IRIS_START_PROD === "1"` selects `loadFile(<repoRoot>/dist/index.html)`, otherwise `loadURL(getAppDevUrl())`, which resolves to `http://127.0.0.1:5173` (`electron/renderer-security.mjs:23`). Those are the two document URLs every decision below is made against.

Constraints this design works within: `npm test` (vitest) may not boot Electron, spawn `claude`, need API keys, or touch the network (`openspec/specs/test-harness/spec.md`); pure logic belongs in `src/lib/*.ts` with a colocated `*.test.ts`; the module-level ONNX session cache must keep re-arming instant; `renderer-content-security` forbids any runtime fetch of script/WASM from a third-party origin, so reverting to the CDN URL is not an option; only `main.mjs`, `ipc.mjs`, `window.mjs` and `renderer-security.mjs` may touch Electron APIs (`openspec/specs/main-process-structure/spec.md`).

## Goals / Non-Goals

**Goals:**

- "Hey Iris" wakes the app in a packaged/production build, not only under `npm run dev`.
- One resolution path for both environments, so a future verification in either one covers the other.
- One resolution path for **every** vendored third-party runtime, so the next one is correct by construction rather than by luck.
- A wake-word listener that cannot start says so, instead of presenting an armed toggle.
- The packaged wake path is checkable by one command instead of by hand.

**Non-Goals:**

- Any change to the detection rule, threshold, consecutive-frame gate, cooldown, or capture constraints — `harden-wake-word-detection` got those right and they were never reached.
- Wiring up a general renderer log surface. `pushLog` stays dead for every other caller; this change makes exactly one failure visible, and D4 explains why widening further is a separate concern.
- Changing the model-asset `fetch()` calls (D5), the mic AudioWorklet's fallback (D6), the CSP policy, or the vendoring script.
- Adding a browser-automation dependency such as Playwright.

## Decisions

### D1: Pre-resolve against `document.baseURI`, and collapse the DEV/prod branch

**Chosen:** a pure helper in `src/lib/asset-url.ts`, called as

```ts
ort.env.wasm.wasmPaths = resolveVendoredAssetUrl("runtime/ort/", import.meta.env.BASE_URL, document.baseURI);
```

which computes `new URL(`${baseUrl}${subPath}`, documentBaseHref).href`.

`document.baseURI` is the document's **base URL** — precisely the thing `fetch`, a `<script src>`, and `audioWorklet.addModule` all resolve relative paths against, and therefore literally the thing the spec rule in D7 names. It is `file:///…/dist/index.html` in a production build and `http://127.0.0.1:5173/` under the dev server, so `BASE_URL` is interpreted exactly as it is everywhere else in the app, and the runtime receives an already-absolute URL that no module-relative resolution can move.

| | `BASE_URL` | `document.baseURI` | result |
| --- | --- | --- | --- |
| prod | `./` | `file:///app/dist/index.html` | `file:///app/dist/runtime/ort/` |
| dev | `/` | `http://127.0.0.1:5173/` | `http://127.0.0.1:5173/runtime/ort/` |

The dev result is byte-identical to what the old `DEV` branch produced: `BASE_URL` is `/` in dev, so the intermediate string is root-anchored and `new URL` discards the base's path, query and fragment entirely — the same value `window.location.origin + "/runtime/ort/"` produced. The Vite dev-server workaround that branch existed for is therefore preserved (Vite leaves an already-absolute URL alone rather than routing it through the transform that refuses `public/` assets). Both environments run one expression, which is the point: an environment-conditional path is a path where one branch is only ever exercised by one kind of run, and that is precisely how this bug shipped.

**Why `document.baseURI` and not `window.location.href`:** they coincide here only because `vite.config.ts:55`'s CSP sets `base-uri 'none'`, so no `<base>` element can ever take effect. That is a CSP side effect, not a design guarantee — and `location.href` is the document's *URL*, not its *base URL*. Naming the right one costs nothing and keeps the code true to the rule it implements.

**Prior art in this repo, which the first draft of this design missed.** `src/components/DrawingCanvas.tsx:12` already solves the identical problem for Excalidraw's vendored fonts:

```ts
window.EXCALIDRAW_ASSET_PATH = new URL("excalidraw-assets/", document.baseURI).href;
```

and its comment at `src/components/DrawingCanvas.tsx:4-10` states the same reasoning — explicitly choosing `document.baseURI` over `location.origin` because "a bare origin would resolve to the filesystem root instead of the app's own directory" under `file://`. So this pattern is the repo's existing answer, arrived at once and not generalized. D7 is what generalizes it.

**Why not keep the branch and just fix the prod side:** it would work, and it would leave the same trap armed for the next person. Two branches means the verification you performed covers half of what you shipped.

**Why not `import.meta.url` as the base:** it would resolve against the chunk, which is what ORT already does and is the bug.

**Why not move the assets to `dist/assets/`:** it makes the broken specifier accidentally correct while leaving the specifier ambiguous, and it couples the vendoring script's output layout to Vite's internal chunk directory.

### D2: Extract the URL computation to `src/lib/asset-url.ts`, with a colocated test

The hook keeps everything needing a browser. The pure question — *given a base path, a relative sub-path, and a document base URL, what absolute URL should the runtime be handed?* — moves to `src/lib/asset-url.ts`, following `downsample.ts` / `hand.ts` / `tasks.ts` / `wake-gate.ts` / `mic-device.ts`. Naming it here rather than leaving it as `src/lib/*.ts` so the tasks, the tests and the archive note all refer to one path.

The test asserts the prod and dev rows of the table in D1, both trailing-slash and no-trailing-slash sub-paths (MediaPipe is handed a directory without one — see D4), and — the actual regression assertion — that the result never contains an `assets/` segment.

**State plainly what this does and does not buy.** It buys a fast, Electron-free guard on the computation and a named place for the reasoning. It does **not** guarantee the hook passes the helper's output to `ort.env.wasm.wasmPaths`; a future edit could bypass it and every test would stay green. The unit test is necessary, not sufficient, and D8 is what covers the rest. Recording this here so the next reader does not over-trust a green `npm test` on this specific class of defect.

### D3: A wake-word listener that fails to start must be visible — and the hook cannot currently say either "failed" or "ready"

`useWakeWord`'s `onError` already carries the message. Two facts about the current hook make the naive implementation wrong, and both were found in review before any code was written:

**`onError` currently means two opposite things.** It is called from two places:

- `src/hooks/useWakeWord.ts:283-287` — the `init()` catch. Fatal: the listener is dead.
- `src/hooks/useWakeWord.ts:243-246` — the selected microphone was unavailable. **Non-fatal**: it reports the fallback via a second `fallbackDeviceId` argument, then immediately re-acquires on the System Default device and the listener arms successfully.

`src/App.tsx:620-623` handles both through one callback. Treating every `onError` as an init failure would put a permanent "wake word failed" affordance on a working listener for any user whose saved microphone is unplugged — failing this change's own scenario *"A successful arm shows no error"* and lying to the user in the opposite direction from the bug being fixed. The two signals must be separated. The `fallbackDeviceId` argument already distinguishes them, so the minimum viable rule is *only an `onError` without a `fallbackDeviceId` sets the failed state*; a distinct callback is cleaner and either is acceptable, but the choice must be explicit rather than inferred.

**The hook emits no success signal at all.** `src/hooks/useWakeWord.ts:280-282` installs the prediction interval and returns silently. There is no callback that means "armed". Without one, the only lever for clearing a stale failure is the `enabled`/`deviceId` effect re-run — which clears on re-arm *attempt*, not on success, producing a flicker-then-reappear that does not satisfy the recovery scenario. So this change adds an `onReady()` callback fired after the interval is installed and only when the effect has not been cancelled. Recovery is genuinely reachable: `src/hooks/useWakeWord.ts:74-77` nulls the cached `sessionsPromise` on failure, so a later arm retries the load rather than replaying the rejection.

The user-visible requirement is that the user can tell "armed and listening" from "failed to start" without opening a console. The wake hint at `src/App.tsx:1443` currently reads `"Say “Hey Iris” or press W to wake"` whenever `wakeWordEnabled`, which is an outright false statement when initialization has failed. Note the hint is consumed **twice** — `src/App.tsx:1495-1496` (deck) and `src/App.tsx:1602-1603` (HUD) — so a fix applied to one surface leaves the other still instructing the user to speak. Keyboard wake must keep working and must keep being offered, since it is unaffected.

**Make the caption decision checkable.** `vitest.config.mjs` runs `src/**/*.test.ts` under `environment: "node"`, with no jsdom and no testing-library dependency — so every scenario in this change's `wake-sleep-voice` delta is otherwise observable by no gate this repo runs. Extracting the caption decision as a pure `wakeCaption({ sidecarRunning, wakeWordEnabled, wakeFailed })` into `src/lib/` with a colocated test converts "no false instruction while failed" and "no error on a successful arm" into machine-checked assertions for the cost of one small file, and matches the repo's existing `src/lib/` discipline. The remaining scenarios stay manual, which this design states rather than leaves implied.

**Why not fix `pushLog` generally:** every other `pushLog` caller is equally unread, and building a log surface is a design question about the deck's information architecture, not about this bug. Making one hard failure visible is the part that belongs to this change; the general question stays open, as the archived D6 already noted.

### D4: `useHandControl.ts` comes into scope — the rule D7 states makes it necessary

`src/hooks/useHandControl.ts:38-39` hands MediaPipe two bare relative strings:

```ts
const WASM_URL = `${import.meta.env.BASE_URL}runtime/mediapipe`;
const MODEL_URL = `${import.meta.env.BASE_URL}runtime/mediapipe/gesture_recognizer.task`;
```

consumed at `src/hooks/useHandControl.ts:134` by `FilesetResolver.forVisionTasks(WASM_URL)`.

**It is not broken.** MediaPipe does not dynamic-`import()` its glue; `@mediapipe/tasks-vision/vision_bundle.mjs` loads it with

```js
const e = document.createElement("script");
e.src = t.toString();
```

and a script element's `src` resolves against the **document's** base URL, which is `dist/index.html` — so the relative path already lands on `dist/runtime/mediapipe/…`.

**It is nonetheless changed here, reversing this design's first draft.** That draft ruled it out as "unnecessary churn" while D7 simultaneously introduced a requirement — *a path handed to a vendored runtime SHALL be an absolute URL resolved against the document* — that `useHandControl.ts:38-39` visibly violates. Archiving that pair would put a `SHALL` into the living spec that the tree contradicts on the first grep, which is exactly the code-versus-spec disagreement `CLAUDE.md` forbids. Between narrowing the requirement to "runtimes that use dynamic `import()`" and bringing this call site into line, the second is correct: the requirement exists precisely because *you cannot tell which kind of runtime you have by reading the call site*, so a requirement phrased in terms of that distinction defeats itself.

**The edit is provably behaviour-neutral**, which is why it is safe to include rather than defer. Routing both constants through the same helper yields `new URL("./runtime/mediapipe", "file:///app/dist/index.html").href` → `file:///app/dist/runtime/mediapipe` — byte-identical to what document-relative resolution of the current string already produces, in both environments. MediaPipe appends `/vision_wasm_internal.js` to the fileset path, which works the same on an absolute URL; `modelAssetPath` is fetched, which also accepts an absolute URL. Task group 3 verifies gesture control still initializes rather than assuming it.

The asymmetry that caused this bug — two vendored runtimes, two loading mechanisms, two meanings for the same relative string, and no way to tell at the call site — is still the real lesson. The conclusion is now "pre-resolve both" rather than "leave the lucky one alone".

### D5: The model `fetch()` calls stay relative — say so, in the code

`getSessions()` at `src/hooks/useWakeWord.ts:63-80` builds three model URLs from a bare `import.meta.env.BASE_URL` and passes them to `fetch()` at `src/hooks/useWakeWord.ts:51`. This looks identical to the broken line twelve lines above it and **has no defect**: `fetch()` resolves a relative URL against the document's base URL, not against the importing module, so `./wakeword/melspectrogram.onnx` already lands on `dist/wakeword/`.

The failure evidence confirms it independently. The logged error is `no available backend found`, not the `Failed to fetch …: 404` that `src/hooks/useWakeWord.ts:52` would have thrown — so all three model fetches succeeded on the broken build. Only ORT's own glue import failed.

These are left as they are. They are also, unavoidably, the thing an implementer will stare at immediately after editing line 43. The rationale therefore belongs in the same comment block as the fix (task 2.3), which is the only place it sits next to both call sites at once.

### D6: The mic AudioWorklet fallback is an exception, recorded

`src/hooks/useAudioPipeline.ts:165-171` tries `new URL("../worklets/mic-downsample.js", import.meta.url)` and falls back to `${import.meta.env.BASE_URL}worklets/mic-downsample.js`. Two reasons it is outside D7's rule, stated so it does not become a second spec-versus-code contradiction at archive:

- It is **not** an environment-conditional branch. It is a runtime try/fallback: the first form is the Vite-bundled worklet URL, which the build rewrites, and the second is the `public/` copy. Both are attempted in both environments, so neither branch is exercised by only one kind of run — which is the property D7's second rule actually protects.
- The worklet is **the app's own source**, not a vendored third-party runtime, and `audioWorklet.addModule` resolves against the document, so the fallback string is already correct.

D7's rule is therefore scoped to vendored third-party runtimes. If the worklet path is ever reworked, this is the note that says the exception was deliberate.

### D7: State the rule where it can bind future runtimes

The `renderer-content-security` spec already promised the packaged build's vendored assets "resolve at the same paths they do in development" — a promise this bug broke while every file was present and every path string looked right. Two adjustments make it enforceable: a path handed to a vendored third-party runtime is resolved to an absolute URL against the document, and the packaged-build scenario asserts the runtimes *initialize* rather than that the files are shipped. Presence was never the property anyone cared about.

After D4 and D6, the rule and the tree agree: the two vendored third-party runtimes (`onnxruntime-web`, `@mediapipe/tasks-vision`) and Excalidraw's asset path all pre-resolve against the document; the model `fetch()`es and the app's own worklet are named exceptions with stated reasons.

### D8: An end-to-end wake check outside `npm test`

The test-harness spec forbids booting Electron inside `npm test`, and that rule is right — but it means the only automated coverage this bug could ever have had lives outside the runner. A script under `scripts/` closes that gap without weakening the rule.

**The fixture.** `say` and `afconvert` produce the phrase:

```bash
say "Hey Iris" -o hey-iris.aiff
afconvert hey-iris.aiff hey-iris.wav -f WAVE -d LEI16@16000 -c 1
```

The `-d LEI16@16000 -c 1` is load-bearing: Chromium's fake capture device requires 16-bit little-endian PCM, mono. Neither tool can generate silence or concatenate audio, and `sox` is not present on stock macOS — so the padding this check needs is done in the script itself: read the WAV, keep the 44-byte canonical header, prepend and append N seconds of zero samples, rewrite the two length fields. That is roughly twenty lines with no dependency, and it is deterministic, so the result can be cached instead of regenerated per run.

Padding is required for two reasons, not one. The 2-second ring buffer must fill before the phrase arrives, so the model sees a real utterance shape rather than a cold-start burst; and `--use-file-for-fake-audio-capture` **loops** its file by default (a `%noloop` suffix disables it), so an unpadded fixture produces back-to-back `"Hey IrisHey Iris"` with no gap. Leading silence must also comfortably exceed the time for `src/App.tsx:589-591`'s async `getConfig()` to land, because the `[wakeword] fired` line at `src/hooks/useWakeWord.ts:198` is gated on `settings.debug`, which arrives with that config — a wake that fires before it lands logs nothing and the check times out for the wrong reason.

**The launch.**

```bash
IRIS_START_PROD=1 IRIS_WAKE_WORD=true IRIS_WAKE_DEBUG=1 \
IRIS_WAKE_THRESHOLD=0.15 IRIS_WAKE_CONSECUTIVE=2 \
  node_modules/.bin/electron electron/main.mjs \
  --no-sandbox \
  --use-fake-device-for-media-stream \
  --use-file-for-fake-audio-capture=<fixture> \
  --user-data-dir=<throwaway>
```

The threshold and consecutive count are pinned deliberately. `electron/user-config.mjs:26` gives CLI environment precedence over `.env`, and `src/components/SetupPanel.tsx:81-82` writes `IRIS_WAKE_THRESHOLD` into `.env` whenever anyone saves settings — so an unpinned check fails red on a developer who happens to be on the Strict preset, for a reason that has nothing to do with this bug.

**Build freshness is part of the check, not a precondition to remember.** `electron/window.mjs:94` loads whatever `dist/index.html` is on disk. A script that launches without rebuilding will happily pass against a bundle built before the fix was typed — the exact silent-pass failure mode it exists to prevent. The script must either run the build itself or hard-fail when `dist/index.html` is missing or older than `src/`.

**Reading the renderer console.** This needs a `console-message` listener on the window's `webContents`, and there is one right answer for where it goes: `electron/window.mjs:100`, inside the existing `if (envFlag("IRIS_WAKE_DEBUG", false))` branch that already opens DevTools for exactly this diagnostic. Three reasons it must not live in the script instead:

- `scripts/` is covered by **no** typecheck — `tsconfig.json` includes only `src`, `tsconfig.electron.json` only `electron/**/*.{mjs,cjs}`. Electron 42 uses the single-object listener signature (`(details) => …` carrying `message`/`level`/`lineNumber`/`sourceId`), not the widely-documented `(event, level, message, line, sourceId)` form; the wrong one compiles fine and yields `undefined` at runtime, surfacing as a timeout with a misleading cause. In `window.mjs` it is a `npm run build` failure instead.
- `window.mjs` is one of the four modules permitted to touch Electron APIs (`openspec/specs/main-process-structure/spec.md`).
- A **new** `electron/*.mjs` that imports Electron would fail `npm test`: `electron-graph.supply.test.mjs:29` hardcodes `EXPECTED_ELECTRON_DEPENDENT = ["ipc.mjs", "main.mjs", "renderer-security.mjs", "window.mjs"]` and asserts exact set equality at line 65.

Gating it on the already-existing `IRIS_WAKE_DEBUG` also satisfies D8's own constraint that this must not be unconditionally enabled: that flag is off by default and is already the switch for renderer-console diagnostics.

**Pass/fail.** Pass when `[wakeword] fired` appears; fail on `[wakeword] init failed`; fail on a timeout with neither. `--no-sandbox` is required for the renderer to read the fixture. It belongs to the script's own `spawn` argv and must appear nowhere under `electron/` — `webPreferences.sandbox: true` at `electron/window.mjs:88` is what the app ships and is untouched by this change. Note the check does not run sandboxed regardless of that source line, since `--no-sandbox` disables it for the launched process tree; the invariant worth asserting is about the argv, not about the source line.

**No API key is needed**, which is what makes this runnable on a clean machine: `src/App.tsx:589-591` loads config unconditionally and merely opens the onboarding panel when unconfigured, `useWakeWord` stays armed at `src/App.tsx:610-611`, and `onWakeRef.current()` is called at `src/hooks/useWakeWord.ts:197` *before* the log line at `:198`, so a failing `start()` does not suppress the pass token.

**Why not Playwright**, as the upstream repo's `scripts/test-live-hermes-wake.mjs` uses: it is not currently a dependency here, and this check needs no DOM interaction — a log assertion on a launched Electron process is enough. Adding a browser-automation dependency for one script is a bigger call than this change should make on its own.

This is the one task in this change that would actually have caught the bug, and it is also the one most likely to be cut for scope. If it is cut, say so in the archive note rather than quietly dropping it.

### D9: "Production" here means `IRIS_START_PROD=1`, not asar — and the difference is stated

`electron/window.mjs:93` treats `app.isPackaged` and `IRIS_START_PROD === "1"` as the same branch, so both load `dist/index.html` over `file://`. But the e2e check launches from the repo, giving `file:///…/repo/dist/index.html`, whereas a distributed build gives `file:///…/Iris.app/Contents/Resources/app.asar/dist/index.html`. Same scheme, different resolution surface: in the asar case the dynamic `import()` target lives inside an archive.

The automated check therefore covers the production `file://` path and **not** asar. `package.json`'s `build.mac.target: ["dir"]` means `npm run package:mac` produces an unpacked `.app`, which is the closest cheap approximation — so asar coverage stays a manual task (group 6), run against that output, and is called out as such. Silently equating the two would reproduce this change's own thesis one level down: a verification performed in one environment saying nothing about the other.

## Risks / Trade-offs

- **The unit test cannot catch a regression that bypasses the helper.** → Stated in D2 rather than papered over; D8 is the real guard, and D3 makes a recurrence loud instead of silent.
- **If D8 is cut, the packaged wake path returns to being verified only by hand.** → Then D3 is load-bearing: the next occurrence surfaces as a visible error instead of a phantom sensitivity complaint. Record the cut in the archive note.
- **D4 changes a working call site.** → Accepted: it is provably output-identical (D4), it is verified by task 3.2 rather than assumed, and the alternative is archiving a `SHALL` the tree contradicts.
- **The e2e check depends on Chromium's fake-capture flags and on `say`/`afconvert`.** → Both are stable and macOS-only, which the app already is. If a future Electron drops the flags, the script fails loudly at the harness level, not silently as a pass.
- **A synthesized TTS voice is not a human voice.** The check proves the pipeline runs end to end and fires; it is not a detection-quality benchmark and must not be read as one. Scoring `0.941` on a synthetic clip says nothing about a real voice at 3 metres.
- **The e2e does not cover asar.** → Stated in D9 and assigned to a manual task rather than left as an implied equivalence.
- **`--no-sandbox` in the check script weakens the sandbox for that run.** → Scoped to a throwaway `--user-data-dir` on a developer machine; `harden-security-boundaries`' `webPreferences.sandbox: true` at `electron/window.mjs:88` is untouched.
- **Making one failure visible while every other `pushLog` stays unread is inconsistent.** → Accepted deliberately (D3). The alternative is designing a log surface inside a defect fix.
- **Three of the five `wake-sleep-voice` scenarios stay manual-only.** → The caption extraction in D3 machine-checks the two that carry the false-instruction risk; the rest are stated as manual rather than implied to be covered.

## Migration Plan

None. No config keys, no persisted state, no data. The fix is behaviour-restoring: an install that never woke starts waking, and an install that woke (dev) is unaffected because the computed dev URL is unchanged. Gesture control's computed URLs are unchanged in both environments (D4). Rollback is reverting the resolution lines.

## Open Questions

- **Where the init failure surfaces (D3)** — the wake hint is the smallest option and the one that is currently lying; a dedicated error affordance in the SetupPanel's wake-word row is the more discoverable one. Left to DEV, constrained by the spec requirement that the user can distinguish armed from failed without a console, and by the requirement that both the deck and HUD captions stop instructing the user to speak.
- **Whether the fatal/non-fatal split in D3 is done with a new `onInitFailed` callback or by branching on the existing `fallbackDeviceId` argument.** Both satisfy the requirement; the second is smaller, the first is harder to misread later.
