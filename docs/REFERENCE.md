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
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` `^0.3.210` | `package.json` | npm |
| Bundled Claude Code binary | `2.1.210` — **coupled to the SDK version**, not pinned separately | `@anthropic-ai/claude-agent-sdk-darwin-{x64,arm64}` (the SDK's own optional deps); the mapping is in the SDK's `manifest.json` | npm |
| Bundled OpenSpec CLI | `@fission-ai/openspec` `^1.7.0` | `package.json` | npm |
| Electron | `42.5.0` (exact) | `package.json` | npm |
| Linter | `oxlint` `1.76.0` (exact) | `package.json`, rules in `.oxlintrc.json` | npm |
| Secret scanner | `gitleaks` `8.30.1` — **not lockfile-pinned** | Homebrew, outside npm | `brew install gitleaks` |

**`inputAudioTranscription` is a side channel, not the model's understanding.**
Gemini Live is a voice-to-voice model with tool use: audio goes in, and speech
and function calls come out. The transcription is a separate recognizer over the
same audio, enabled by one line in `live-config.mjs` — turn it off and
comprehension is unchanged. **Nothing downstream may treat it as authoritative.**
The tool call's parameters are the output of the component that actually heard
the user; the transcript is corroboration whose errors are silent, which is
exactly why it must never outrank the call. If a call arrives too thin to act
on, widen the tool schema — the channel the model speaks through — rather than
promoting a second channel to compensate.

## The diagnostic log

`~/.myiris/logs/iris.log` — JSONL, one record per line, rotated by size.
Declared in `app-paths.mjs` like every other path Iris owns, so it is under the
state root rather than macOS's `~/Library/Logs`: everything Iris keeps is in one
place a user can find, back up, or delete as a unit.

```bash
tail -f ~/.myiris/logs/iris.log                                # follow it
jq -r 'select(.level=="error") | "\(.at) \(.src) \(.msg)"' ~/.myiris/logs/iris.log
jq -r 'select(.src=="renderer")' ~/.myiris/logs/iris.log        # interface faults only
```

Every record carries `at`, `level`, `src`, `msg`, plus whatever the source
attached. `src` is the field that matters most:

| `src` | what it is |
| --- | --- |
| `main.stdout` / `main.stderr` | everything the main process prints, captured by teeing those two streams (`log-tee.mjs`) — including output from dependencies, which no logging call of ours could have reached |
| `event` | the internal event stream, tapped in `emitEvent`. Most of the app's account, and never printed at all |
| `renderer` | the interface process's uncaught exceptions, its console warnings and errors, `render-process-gone`, `unresponsive`, and preload failures |

**Three things about it are load-bearing, not incidental:**

- **It records everything by default, at every level, in production as well as
  development.** The file is where you look *after* something went wrong, so
  what mattered cannot be decided before it happens. That is deliberately the
  opposite of the camera preview's activity strip (`camera-activity-log`),
  whose depth *does* follow the build mode — that one is a glance. Nothing
  couples the two, so narrowing what is shown can never narrow what is recorded.
- **Credentials are masked before anything is written**, from every source,
  including output Iris did not produce. Redaction fails toward masking: a log
  slightly harder to read is recoverable, a token pasted into a bug report is
  not. The masked form says `[redacted]` so "no token was present" and "a token
  was here" stay distinguishable.
- **A failing log cannot take the app down.** Open, write, rotate and close are
  each wrapped; a fault disables the sink for the session and reports itself
  **once**, to the stream, never back into the log. An unwritable location costs
  the log and nothing else — verified by pointing it at one and watching the app
  start normally.

Configuration is `IRIS_LOG`, `IRIS_LOG_LEVEL`, `IRIS_LOG_MAX_BYTES` and
`IRIS_LOG_KEEP`, all documented in `.env.example`. Total disk is
`(IRIS_LOG_KEEP + 1) × IRIS_LOG_MAX_BYTES` — 20 MB by default, computable in
advance rather than discovered from a full disk.

Note the one thing the tee does **not** change: captured output still reaches
its original destination byte-for-byte, and `write`'s backpressure return value
is passed straight back to the caller. Swallowing either would be a change to
the app's behavior for the log's benefit.

## Known footguns / lessons (avoid repeating these)

**Bumping the Agent SDK is also a Claude Code bump and a ~250 MB asset change.**
The SDK ships the CLI as a per-platform native binary in its own
`optionalDependencies`; SDK `0.3.210` carries CLI `2.1.210`. Two consequences:
(1) npm installs only the binary matching the *host* arch, and `npm install
--os/--cpu` does **not** override that (npm 11 still fails `EBADPLATFORM`) — so
`scripts/prepare-mac-binaries.mjs` fetches the foreign-arch tarball with `npm
pack` and unpacks it, and `scripts/prune-foreign-arch.mjs` (an electron-builder
`afterPack` hook) removes the wrong one from each `.app`. (2) The binary must be
in `asarUnpack`: a subprocess cannot be exec'd from inside an asar archive, and
Electron's `require.resolve` returns the *packed* path, so
`electron/bundled-binaries.mjs` rewrites `app.asar` → `app.asar.unpacked`.

**`require.resolve('<pkg>/package.json')` is not a reliable way to find a
package root.** It works for packages with no `exports` map (the Claude binary
packages) but is a hard `ERR_PACKAGE_PATH_NOT_EXPORTED` for ones that have an
`exports` map without a `./package.json` entry — `@fission-ai/openspec` is
exactly that. `bundled-binaries.mjs` falls back to resolving the package's main
entry and walking up.

- **Use the exact Live model name `gemini-3.1-flash-live-preview`.** Live models
  are a distinct family from regular `gemini-*` chat models; a normal chat model
  name will fail to open a Live session. Keep the `models/` prefix.
- **`usageMetadata`'s regime is not part of the Live API's contract, and the
  token ledger does not assume one.** `LiveServerMessage.usageMetadata` is
  documented only as "usage metadata about model response(s)"; whether
  `totalTokenCount` is **per-message** or **cumulative for the session** is
  unstated, and observed behaviour differs across model versions. So
  `electron/token-ledger.mjs` treats a reading at or above the previous one as
  cumulative and a reading below it as a restart-or-per-message, banking what it
  has counted so far — correct under both, and monotone by construction. That
  restart path is also what absorbs a rotated socket (Live sessions rotate on a
  connection lifetime limit during ordinary use), so the panel's total never
  drops mid-conversation. **This is the fact to re-check when the model pin
  above moves**: a bump can change the regime, and the ledger will keep
  producing a monotone total either way rather than reporting the change.
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
- **A renderer key handler must match `event.code`, not `event.key`, for any
  chord holding Option.** macOS rewrites `event.key` while Option is down —
  `⌥W` arrives as `"∑"` — so an Option chord matched on `event.key` silently
  never fires. Every current renderer handler matches `Escape`, `Enter`, or a
  digit, so none is affected today; the rule is for the next one. Iris's own
  Option chords are `globalShortcut` registrations in the main process, where
  this does not apply — see the `wake-sleep-voice` spec.
- **A malformed global accelerator does not reliably fail loudly.** Electron 42
  returns `true` for `globalShortcut.register("Altt+W", …)` — the registration
  reports success and the key simply never fires. Other spellings throw instead,
  which is why `main.mjs`'s `registerHotkey()` wraps the call: an unhandled
  throw inside the `whenReady()` callback would skip every registration after
  it. Treat "the hotkey I set in `.env` does nothing" as a likely typo, not a
  conflict.
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
- **No dependency uses `"latest"` — every one is pinned or caret-ranged.** This
  started as an `electron`-only rule (`webPreferences.sandbox: true` and the
  renderer's Content-Security-Policy both depend on a fixed, known Electron
  version rather than one that can silently shift on the next `npm ci`), but the
  reasoning was never electron-specific and 11 packages — including the whole
  toolchain — sat on `"latest"` until they were pinned. The hazard is not
  theoretical: while that was true, `typescript@latest` reached **`7.0.2`**
  against a lockfile holding `6.0.3`, so one `npm install` from a fresh clone
  would have landed a TypeScript major. `npm ci` is safe (it installs from the
  lock); `npm install` was not.
- **Node.js `>=24.0.0` is required, and the requirement is enforced, not merely
  documented.** `package.json`'s `engines.node` declares it and `.npmrc`'s
  `engine-strict=true` makes `npm install`/`npm ci` fail with `EBADENGINE` below
  it — without that flag npm only warns and installs anyway, which is how the
  README came to claim "Node 20+" long after the real floor had moved. `.nvmrc`
  pins `24` for `nvm use`; `npm ci --engine-strict=false` is the one-off escape.
  This is a **build-toolchain** requirement: a packaged Iris ships its own Node.
- **The `gitleaks` package on npm is NOT gitleaks.** `npm view gitleaks` returns
  version `1.0.0`, last published **2022-05-03**, from a personal repository
  (`ycjcl868/gitleaks`), described only as `"> custom rules"`. The real tool is a
  Go binary at `8.30.1`, installed via Homebrew. This matters because `gitleaks`
  is the one tool in the check chain **not** resolvable from `package-lock.json`,
  and that asymmetry is an open invitation for a future maintainer to "fix" it by
  adding the npm package — which would silently replace a security scanner with
  an abandoned stranger's code. The unpinned nature is deliberate and documented,
  not an oversight to correct. Behavior is specified in the
  `workflow-quality-gates` capability.
- **Every WebGL surface renders on one of two paths, chosen by a single
  preference (`webgl-quality-mode`) — never re-derive a surface's settings at
  its call site.** `src/lib/webgl-quality.ts`'s `deriveWebglSettings` is the
  one place that maps the preference to the orb's `gl`/`dpr`, whether the
  deck backdrop mounts, and whether the galaxy adds its bloom pass; a second
  hand-written conditional anywhere else is exactly the drift this module
  exists to prevent. **The light path's device pixel ratio clamp must be
  `Math.min(devicePixelRatio, 1.5)`, never a bare `1.5`** — on a non-Retina
  display a bare constant would render *above* native resolution instead of
  saving pixels. The orb's `<Canvas>` is `key`ed on the preference because
  `dpr`/`antialias`/`powerPreference` are fixed at WebGL context creation and
  cannot be changed on a live context; the galaxy is the one surface that
  does **not** re-key on a live change (its `addBloom` pass is read once at
  open time), because recreating it would lose settled force-graph node
  positions its own capability requires be preserved.
- **`@types/node`'s major must track the Node that *Electron* embeds — not
  `engines.node`.** Modules under `electron/` run on Electron's bundled Node
  (42.5.0 → Node 24.17.0), and `tsconfig.electron.json` typechecks all of them
  against the root `@types/node`. Types for a newer Node admit APIs that do not
  exist at runtime, and the mismatch is silent because `skipLibCheck` is on. The
  authority is the `@types/node` range `electron` itself declares (`^24.9.0`
  today); `engines.node` agreeing is a coincidence that a future Electron bump
  would end. `npm run build` fails via `scripts/check-types-node.mjs` when they
  diverge. Behavior is specified in the `test-harness` capability.

## Agent SDK `Options` — what Iris sets, and what it deliberately does not

`Options` declares **63** fields. Iris sets **23**. The other 40 are listed here
with a reason, so an audit starts from a decision rather than a blank, and so an
omission is distinguishable from an oversight. The set Iris sets is asserted
field-by-field by `electron/sdk-options.test.mjs`, which also checks every field
name against the installed `sdk.d.ts` — the guard for the failure mode described
below.

**The failure this exists to prevent.** For months Iris passed
`appendSystemPrompt` at the top level of `Options`. It is not a declared field:
the SDK's normalizer destructures it into the rest object and never reads it, so
The live-session instruction reached nothing while the code and its tests both
claimed it was in force. Measured against the running SDK — a query with only
`appendSystemPrompt` answers *"I don't have a codeword"*; the same text under
`systemPrompt: { preset, append }` answers correctly. **An option the SDK does
not read is worse than an absent one.**

Two more measured facts worth keeping here, because both are invisible at the
call site (full workings in the change's `design.md` D1):

- **A run with `agent` set does not receive the `claude_code` preset.** The
  main-thread `AgentDefinition`'s prompt replaces the base prompt; only
  `systemPrompt`'s *append* half survives. Token-counted: `preset` alone adds
  ~3 259 tokens, `agent` + `preset` adds **0**. Every verb run is in this
  case — the persona body *is* their base prompt. Only plain-Claude runs get the
  preset. There is no opt-in to inherit it alongside a definition.
- **`AskUserQuestion` is only exposed when `canUseTool` is set**, and
  `disallowedTools` removes it even then. That list is therefore the whole mechanism: it is why a stateful
  verb can ask, why a stateless verb working from a settled task list cannot, and why `execute` given no
  specification at all can — the list is a declared field of the verb resolved against project state
  (`verbs.mjs`), narrowed again at run start by whether anything can relay an answer (`run-exec.mjs`).

### Unused, with reasons

| Option | Why not |
| --- | --- |
| `allowedTools` | `skills` is the single place skills are enabled; nothing else needs auto-allowing under `bypassPermissions`. |
| `tools`, `toolAliases` | Iris restricts by exception (`disallowedTools`), not by allowlist — a whitelist would silently break a persona whenever Claude Code gains a tool. |
| `continue` | Iris resumes by explicit session id per role and workstream; "most recent in this directory" is exactly the cross-role bleed the session model prevents. |
| `fallbackModel` | A deliberately chosen model that silently downgrades would make the user believe they are debugging on a model they are not. Failing loudly is the intended behavior. |
| `enableFileCheckpointing` | Evaluated and declined: `rewindFiles()` is a method on the **live** `Query`, and the stateless shape — which is what edits code — is torn down when its run finalizes, so the undo it would enable cannot be reached. See `design.md` D9. |
| `includePartialMessages` | Evaluated and declined **twice, on different grounds**. Originally: "the voice layer speaks once at run end" (`design.md` D9). That premise is gone — a canvas conversation now speaks *during* a turn (`the-canvas-becomes-a-conversation`), so the reason was re-examined rather than inherited. It stays declined because an `assistant` message already arrives complete, several times within a turn, which delivers the same property (hearing the answer form) at the granularity of a thought instead of a token. Token-level partials would add sentence-boundary buffering, and the option can only be set when a session is created — which for a *shared* session means whichever verb opened it decides for the other. |
| `effort` | Evaluated and declined **for now**: it moves both spend and quality, and this change sets every number from measurement. Largely covered today by the per-role model selector. See `design.md` D9. |
| `taskBudget` | Alpha, and it changes model *behavior* (API-side pacing) rather than adding a ceiling. `maxTurns`/`maxBudgetUsd` are the guard. |
| `thinking`, `maxThinkingTokens` | Same reason as `effort`, plus `maxThinkingTokens` is deprecated in favour of `thinking`. |
| `sandbox` | Iris does **not** claim a `bypassPermissions` run is contained. The `PreToolUse` denylist is documented as a guard against accidents, not as containment; adopting `sandbox` is a security posture change, not option conformance. |
| `persistSession` | Transcripts are what `resume` reads; disabling persistence would end cross-run context, which is the pipeline's core promise. |
| `sessionStore`, `sessionStoreFlush`, `loadTimeoutMs` | Alpha external-transcript mirroring. Iris is a single-machine desktop app; there is nowhere to mirror to. |
| `forkSession`, `sessionId`, `resumeSessionAt` | Iris has one linear conversation per role per workstream. Forking or rewinding to a mid-conversation point has no interface and no use case yet. |
| `agentProgressSummaries` | Costs a periodic conversation fork per subagent to produce text for a progress UI Iris does not have; the step timeline already shows tool activity. |
| `forwardSubagentText` | Would multiply stream volume to render a nested transcript the deck does not display. |
| `toolConfig` | Its one use is `askUserQuestion.previewFormat`, and Iris relays questions **by voice** — a rendered HTML preview has nothing to render into. |
| `strictMcpConfig` | Would be redundant: `settingSources` already excludes `user`, and the canvas MCP is passed in-process. Adopting it would also block a project's own `.mcp.json`, which a run legitimately works with. |
| `includeHookEvents` | Iris registers hook callbacks directly; the mirrored `hook_started`/`hook_response` system messages would be duplicate telemetry. |
| `betas` | No beta is needed; `context-1m` would change cost characteristics that the budgets were measured against. |
| `onElicitation`, `onUserDialog`, `supportedDialogKinds` | Both are MCP/CLI dialog surfaces with no voice equivalent. Unhandled elicitations are auto-declined, which is the correct headless behavior. |
| `permissionPromptToolName` | Mutually exclusive with `canUseTool`, which is how the live question relay works. |
| `planModeInstructions` | Only applies to `permissionMode: 'plan'`, which is an escape hatch (`IRIS_CLAUDE_PERMISSION_MODE`), not a supported mode. |
| `promptSuggestions` | Predicts a *typed* next prompt. Iris has no prompt box — the user speaks. |
| `settings`, `managedSettings` | Iris's policy is expressed in the options object itself, in code, under test. A second settings layer would put half of it somewhere unversioned. |
| `executable`, `executableArgs` | The bundled Claude is a **native binary**, so no JS runtime is involved. |
| `extraArgs`, `spawnClaudeCodeProcess` | Escape hatches for CLI flags and spawning the SDK does not model. Using either would move configuration out of the typed surface the options test guards. |
| `debug`, `debugFile` | The `stderr` callback already captures diagnostics and attaches them to a failed run; a debug file nobody reads is a disk leak. |
