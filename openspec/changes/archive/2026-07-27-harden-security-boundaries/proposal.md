## Why

A security review of the codebase, conducted over three passes, found six ways an attacker can cross a trust boundary that Iris currently treats as solid.

The most serious: `announceClaudeCompletion` splices raw Claude output into the Gemini Live session inside an instruction-shaped envelope (`instructions_to_iris:` … `claude_result:`), and Gemini holds a tool — `set_prompt_review_mode` — that turns off the human approval gate and persists that to `.env`. Any third-party text Claude happens to read (a repo README, a fetched page, a file in someone else's project) can therefore instruct Gemini to disable the gate and dispatch a task, and every dispatched task runs `claude -p --permission-mode bypassPermissions`. The pre-dispatch review gate is the only thing standing between a voice session and arbitrary code execution on the user's machine, and it is currently disarmable by the very channel it exists to police.

Equally serious, and independent of the voice layer: navigation is only partially constrained. An existing `will-navigate` guard (added for `second-brain-galaxy-view`) allows through any `file://` URL unconditionally rather than just the app's own packaged document, so dropping a local file onto the window still navigates the window that carries the IPC preload — handing `window.iris` to foreign content, which the permission handler then grants microphone and camera to without checking who is asking. The renderer still registers no `dragover`/`drop` handling, so nothing stops that drop from starting a navigation in the first place. Separately, the existing `setWindowOpenHandler` already denies every `window.open` call, which as a side effect currently makes the three external panel links silently do nothing — a live regression to fix alongside the gap, not a hole to close from scratch.

Four supporting weaknesses widen the blast radius. Config values are written to `.env` without escaping newlines while the reader is line-based, so a value can forge additional environment variables — including `IRIS_CLAUDE_BIN`, which is spawned unvalidated. The renderer executes JavaScript glue fetched from a CDN at runtime with no CSP and no integrity check. `getFullConfig()` returns the Gemini API key in plaintext to the renderer, which `setup-panel`'s own living spec already forbids ("full values are not sent back to the renderer") and which the subscription token is already correctly protected against. And both role workers inherit `GEMINI_API_KEY` from `process.env` despite having no use for it, leaving a credential in the environment of a process that runs with `bypassPermissions` and reads untrusted content.

The through-line is that several of these individually-modest bugs chain: renderer code execution (via navigation or a compromised CDN) reads the Gemini key and writes config, config writing forges `IRIS_CLAUDE_BIN`, and the forged binary executes on the next task.

## What Changes

- **BREAKING (voice tool surface)**: `set_prompt_review_mode` is removed from the tool declarations given to Gemini. Turning the review gate off becomes a UI-only action. The gate's *state* and its persistence are unchanged; only who may flip it changes.
- Voice approval is **kept**. `respond_to_task_review` remains a Gemini tool — the fix targets the injection source, not the voice UX. `submit_claude_task` is likewise untouched.
- Claude output is no longer framed as instructions when injected into Gemini. `SYSTEM_EVENT_CLAUDE_COMPLETE` carries the result inside an explicit, non-instruction data region with a delimiter, and `SYSTEM_EVENT_*` markers occurring inside untrusted output are neutralised so a result cannot forge a new system event.
- Config writes reject values containing newlines or other control characters, closing the write/read asymmetry between `serializeConfigValue` and the line-based `parseEnvFile`.
- The resolved `claude` / `openspec` binary path is validated before it is spawned, so a forged `IRIS_CLAUDE_BIN` cannot silently redirect execution.
- The onnxruntime-web and MediaPipe WASM/JS glue bundles are vendored into the app instead of fetched from `cdn.jsdelivr.net` at runtime, and the renderer gets a Content-Security-Policy that forbids remote script execution.
- Navigation is contained: the window carrying the IPC preload can no longer be navigated off-origin (by a link, a script, or a dropped file), and external links open in the system browser instead of an application window. Without this, CSP is moot — navigating the window discards the document that carried the policy.
- The microphone/camera permission handler stops ignoring which content is asking and grants only to the app's own document.
- **BREAKING (settings UX)**: the Gemini API key stops being returned to the renderer. The key field renders empty with a "configured" indicator, mirroring how the subscription token already behaves. This brings the code into conformance with `setup-panel`'s existing requirement that full secret values are not sent back to the renderer.
- Worker environments are derived by subtraction rather than passed through: `GEMINI_API_KEY` is withheld from both role workers, generalising the `computePoSessionEnv` pattern that already exists for the PO session. Whether `CLAUDE_CODE_OAUTH_TOKEN` can also be withheld from DEV is left to verification rather than assumed, since guessing wrong moves DEV's billing silently.

## Capabilities

### New Capabilities
- `renderer-content-security`: the renderer executes only code shipped inside the app — no runtime-fetched script or WASM glue, and no navigating the privileged window to foreign content — enforced by a Content-Security-Policy, locally vendored model runtimes, navigation containment, and origin-scoped device permissions.

### Modified Capabilities
- `prompt-review-gate`: the review-mode flag becomes non-model-writable. The existing requirement "Both toggle paths funnel through one setter" narrows to UI + startup-env only; the voice tool path is removed. Approval and cancellation of a *parked* brief are unchanged, including over voice.
- `session-announcements`: a completion announcement must present Claude's output as data, not as instructions, and must not let that output forge a `SYSTEM_EVENT_*` marker.
- `config-persistence`: a config value written to the `.env` must round-trip through the reader as exactly one variable; values that cannot are refused rather than written. Values read back from config that feed a privileged sink (an executable path) are validated before use.
- `setup-panel`: its existing secrets contract ("full values are not sent back to the renderer") is currently honoured only for the subscription token. The Gemini API key adopts the same presence-only read, empty-render, and empty-means-keep behaviour, plus a way to test a stored key without returning it.
- `agent-subscription-auth`: it currently specifies env scrubbing only as a *billing* concern (excluding `ANTHROPIC_API_KEY` so it cannot override the subscription token), explicitly scoped to PO. A second, distinct concern is added — least privilege — covering both roles: a worker receives only the credentials it needs. The existing billing-scoped rule is unchanged.
- `pipeline-availability`: its tool-declaration inventory currently names `set_prompt_review_mode` as a pipeline tool gated by `pipelineAvailable`. That tool ceases to exist, and review-mode mutation becomes absent in *both* modes rather than gated by availability — so the inventory and its scenario must be corrected, or the living spec would keep describing a tool the app no longer declares.

## Impact

- `electron/main.mjs` — the bulk of the change:
  - voice boundary: `announceClaudeCompletion` (framing), `buildPipelineToolDeclarations` / `PIPELINE_ONLY_TOOLS` / `executeClaudeTool` (drop `set_prompt_review_mode`), `setPromptReviewModeTool` (removed), `buildSystemInstructionText` (review-gate prose no longer promises a voice toggle)
  - config: `serializeConfigValue` + `writeUserConfig` (reject control chars), `claudeBinary` / `openspecBinary` (validate before spawn), `getFullConfig` (stops returning the Gemini key)
  - renderer boundary: a new `app.on('web-contents-created')` guard (`will-navigate` + `setWindowOpenHandler`), and an origin check in `setPermissionRequestHandler`
  - worker env: the DEV spawn stops passing `process.env` through, routing through a shared subtraction helper instead
- `electron/po-session.mjs`: `computePoSessionEnv` generalises into that shared helper, keeping its existing `ANTHROPIC_*` exclusions intact.
- `src/hooks/useWakeWord.ts`, `src/hooks/useHandControl.ts`: point at vendored asset paths instead of the jsDelivr and `storage.googleapis.com` URLs.
- `src/App.tsx`: document-level `dragover`/`drop` cancellation. `src/components/SetupPanel.tsx`: the key field renders empty with a configured indicator; the connection test gains a stored-key path. `electron/preload.cjs` and `src/vite-env.d.ts` follow the config-shape change.
- `vite.config.ts`: a `transformIndexHtml` hook injects the CSP meta tag, strict for `build` and relaxed for `serve`. The policy is delivered through the document rather than a response header because production loads over `file://`, which response-header interception does not cover — see design D7.
- Build/packaging: a copy step vendors the WASM runtimes from `node_modules` into `public/`. `electron-builder`'s `files` already includes `dist/**`, so no packaging config change is expected.
- Users lose the ability to say "turn review mode off" — the PipelineBar toggle is the sole path. Existing `IRIS_PROMPT_REVIEW` env default and persistence are unaffected.
- First-run behaviour improves as a side effect: gesture and wake-word models no longer require network on first launch.
