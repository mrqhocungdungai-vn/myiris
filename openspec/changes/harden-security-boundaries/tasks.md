## 1. Close the voice-layer instruction boundary (D2)

- [ ] 1.1 Add a helper in `electron/main.mjs` that builds a fenced untrusted-data region: generates a per-call random token, opens/closes the region with a delimiter carrying that token, and neutralises any literal `SYSTEM_EVENT_` prefix or delimiter occurrence inside the text by altering (never deleting) it
- [ ] 1.2 Rewrite `announceClaudeCompletion`'s envelope so every `instructions_to_iris` line precedes the region opener, the run result is emitted only inside the fenced region, and the envelope states the region is untrusted content to summarize rather than directions to follow
- [ ] 1.3 Audit the other `SYSTEM_EVENT_*` builders (`announceAgentSelection`, workspace/session-start/PO-question events) for any that embed text Iris did not author, and route those through the same helper
- [ ] 1.4 Verify by hand: submit a task whose result contains the literal strings `SYSTEM_EVENT_CLAUDE_COMPLETE` and the region delimiter, confirm Iris summarizes it as text and neither string takes effect

## 2. Make the review gate non-disarmable by the model (D3)

- [ ] 2.1 Remove the `set_prompt_review_mode` declaration from `buildPipelineToolDeclarations` and delete the `setPromptReviewModeTool` wrapper
- [ ] 2.2 Delete the `set_prompt_review_mode` case from `executeClaudeTool` and its entry in `PIPELINE_ONLY_TOOLS`, letting the existing `default` branch return `Unknown tool` — no new refusal path, and a more honest error than the pipeline-unavailable message
- [ ] 2.3 Update `buildSystemInstructionText`'s review-gate prose: drop the promise that Iris can toggle the mode, and instead direct the user to the PipelineBar toggle when asked
- [ ] 2.4 Confirm `setPromptReviewMode()` remains the single setter and that the UI toggle, `IRIS_PROMPT_REVIEW` startup default, persistence, and the `prompt_review_mode` sidecar event are all unchanged
- [ ] 2.5 Confirm `respond_to_task_review` and `submit_claude_task` are untouched — park, voice approve, voice cancel, and UI approve/edit/cancel all still work end to end
- [ ] 2.6 Verify the chat-only path still behaves per `pipeline-availability`: with the pipeline unavailable, `respond_to_task_review` is undeclared, and review-mode mutation is undeclared in both modes

## 3. Close the config write/read asymmetry (D4, D5)

- [ ] 3.1 Add value validation to `writeUserConfig` that runs before the file is read or written and throws an error naming the offending key when a value contains a line break or other control character
- [ ] 3.2 Confirm the validation is all-or-nothing: a multi-key save containing one bad value writes none of them and leaves the file byte-identical
- [ ] 3.3 Surface the rejection through `config:save` / `config:save-po-token` so the SetupPanel shows the actionable message instead of failing silently
- [ ] 3.4 Add a shared executable-path validator (exists, is a regular file, is executable by the current user) and apply it in `claudeBinary()` and `openspecBinary()`
- [ ] 3.5 Make a failing explicit override (`IRIS_CLAUDE_BIN` / `IRIS_OPENSPEC_BIN`) a loud error naming the setting, with no fallback to the probe list or to the bare command name
- [ ] 3.6 Verify by hand: attempt to save a config value containing a newline and confirm it is refused and no extra variable appears in `.env`; point `IRIS_CLAUDE_BIN` at a non-executable file and confirm the run fails naming the setting

## 4. Vendor the renderer runtimes (D6)

- [ ] 4.1 Determine which `onnxruntime-web` WASM variant the current import actually fetches at runtime (resolves the first Open Question) and record the answer in design.md
- [ ] 4.2 Add a build script that copies the required ORT variant, the MediaPipe `vision_wasm_internal` pair, and the gesture `.task` model from `node_modules` into `public/`, and wire it into `npm run build` so shipped assets stay in lockstep with `package.json`
- [ ] 4.3 Point `ort.env.wasm.wasmPaths` (`src/hooks/useWakeWord.ts`), `WASM_URL` and `MODEL_URL` (`src/hooks/useHandControl.ts`) at the vendored local paths, using `import.meta.env.BASE_URL` as `useWakeWord` already does for its ONNX models
- [ ] 4.4 Confirm the vendored assets land in `dist/` and inside the packaged app — `electron-builder`'s `files` already includes `dist/**`, so this is a verification, not a config change
- [ ] 4.5 Verify with the network disabled: wake word arms and triggers, and gesture control initializes — a wrong-variant copy must surface as a hard failure here
- [ ] 4.6 Update the CLAUDE.md footgun note so the MediaPipe version pin refers to the vendored copy rather than a CDN URL

## 5. Enforce the shipped-code rule with CSP (D7)

Do not start this group until group 4 is complete — enabling `default-src 'self'` while the runtimes still load from jsDelivr breaks wake word and gestures outright.

- [ ] 5.1 Confirm the host and scheme the Gemini Live SDK connects to, so `connect-src` is correct before the policy is enabled (resolves an Open Question; an omitted host kills the voice session)
- [ ] 5.2 Determine whether MediaPipe at the pinned version needs `worker-src blob:`, and include the allowance only if it does (resolves an Open Question)
- [ ] 5.3 Add a `transformIndexHtml` hook in `vite.config.ts` that injects the CSP `<meta http-equiv>` into `index.html`, emitting the strict policy for `build` and the relaxed one for `serve` — deliberately NOT `webRequest.onHeadersReceived`, which does not apply to the `file://` production load (D7)
- [ ] 5.4 Write the production policy: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` limited to `'self'` plus the confirmed Live endpoint, plus whatever 5.2 established
- [ ] 5.5 Write the development variant adding what Vite's dev server needs (`'unsafe-inline'` styles, `ws:` to the local HMR socket) and confirm hot reload still works
- [ ] 5.6 Verify the policy is actually present and enforced in the **packaged** build, not only in dev — inspect the loaded document and confirm a deliberately remote script is blocked under `file://`
- [ ] 5.7 Run the full manual pass in both `npm run dev` and a packaged build: boot, wake, voice round trip, audio playback, HUD toggle, gestures, wake word, submit a task, park and approve a review
- [ ] 5.8 Confirm no external script, module, or WASM origin remains anywhere in renderer source

## 6. Contain navigation and scope device permissions (D9, D10)

Independent of groups 4 and 5 — this closes the hole that would make the CSP moot, so it can land first if the vendoring work stalls.

- [ ] 6.1 Register an `app.on('web-contents-created')` guard in `electron/main.mjs` that cancels `will-navigate` for any target outside the app's own origin, covering both the dev URL and the packaged `file://` document
- [ ] 6.2 Add `setWindowOpenHandler` returning `deny`, routing external URLs to `shell.openExternal` so the three panel links still work
- [ ] 6.3 Cancel `dragover`/`drop` at the document level in `src/App.tsx` so a dropped file or URL cannot start a navigation
- [ ] 6.4 Make `setPermissionRequestHandler` check the requesting web contents' origin and grant media/audio/video only to the app's own document
- [ ] 6.5 Verify by hand: drag an HTML file onto the window (app must not navigate), click each external link (opens in the system browser, no new app window), and confirm mic and camera still work for the app itself

## 7. Apply the secrets contract to the Gemini key (D11)

- [ ] 7.1 Change `getFullConfig()` to expose a presence flag instead of `geminiApiKey`, and update `electron/preload.cjs` / `src/vite-env.d.ts` to match
- [ ] 7.2 Add `GEMINI_API_KEY` to `KEEP_ON_EMPTY_CONFIG_KEYS` so a global Save with an empty field cannot blank a stored key
- [ ] 7.3 Render the key field empty with a "configured" indicator, mirroring the subscription token's control
- [ ] 7.4 Give `config:test-gemini` a stored-key path so the test works with the input left empty, without returning the key
- [ ] 7.5 Verify by hand: first-run onboarding accepts a key; reopening settings shows the field empty and marked configured; a global Save does not erase it; the connection test works both for a freshly typed key and a stored one

## 8. Withhold unneeded credentials from workers (D12)

- [ ] 8.1 Generalise `computePoSessionEnv` into a shared worker-env helper that derives a child environment by subtraction, and route both the DEV spawn and the PO session through it so the two cannot drift
- [ ] 8.2 Remove `GEMINI_API_KEY` from both workers' environments, keeping the existing `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` exclusion for PO exactly as it is
- [ ] 8.3 Verify which credential the DEV subprocess actually authenticates with when both a `/login` session and `CLAUDE_CODE_OAUTH_TOKEN` are present — do not withhold the token from DEV until this is answered, since guessing wrong silently moves DEV's billing
- [ ] 8.4 If 8.3 confirms DEV does not rely on the token, withhold it from DEV and confirm a DEV run still succeeds on the expected billing path
- [ ] 8.5 Verify by hand: run a task that prints its own environment and confirm the voice key is absent, then confirm a normal PO turn and DEV run both still complete

## 9. Verify and land

- [ ] 9.1 Run `npm run build` (`tsc --noEmit` + vite build) and confirm it passes clean
- [ ] 9.2 Re-read each delta spec in this change against the implemented behavior and confirm every scenario holds
- [ ] 9.3 Update CLAUDE.md where this change alters documented behavior: the voice tool list, the review-gate description, the config conventions section, and the renderer's navigation/permission posture
- [ ] 9.4 Consider pinning `electron` to an exact version — it is currently `"latest"` in `package.json`, which contradicts the project's own convention of pinning load-bearing identifiers and means a future `npm ci` can change the security defaults this change depends on
- [ ] 9.5 Archive the change so the delta specs sync into `openspec/specs/`
