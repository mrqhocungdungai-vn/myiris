## 1. Permission reporting as a pure module

- [ ] 1.1 Create `electron/os-permissions.mjs` — Electron-free (design D1): map a platform-reported status to the four states the spec names, keeping `restricted` distinct from not-determined and treating anything unrecognised as not-determined
- [ ] 1.2 In the same module, construct the settings location per permission: the link target (modern pane identifier, legacy one in a comment) and the written pane path that is always shown
- [ ] 1.3 Include the system-audio recording location, since the self-test's failing verdicts route there too even though its state cannot be read
- [ ] 1.4 Write `electron/os-permissions.test.mjs` — the four-state mapping including `restricted`, the unrecognised-state fallback, and the location construction for each permission
- [ ] 1.5 In `electron/ipc.mjs`, register the thin Electron calls: `systemPreferences.getMediaAccessStatus`, `systemPreferences.askForMediaAccess` (microphone/camera only), and `shell.openExternal` for the settings route — marshalling through `os-permissions.mjs`, holding no logic of their own
- [ ] 1.6 **Update `electron/ipc.test.mjs`'s `EXPECTED_HANDLE` / expected `on` channel lists** — it asserts "exactly the expected channels and no others" (`ipc.test.mjs:115`) and goes red the moment a channel is added
- [ ] 1.7 Expose the new methods on the preload bridge in `electron/preload.cjs`
- [ ] 1.8 **Add the new methods to the `IrisApi` type at `src/vite-env.d.ts:318`** — `tsc --noEmit` over `src/` fails without it
- [ ] 1.9 Manually diff `ipc.mjs`'s channel names against `preload.cjs` (required by `main-process-structure`; no automated test covers it)

## 2. The self-test arming

- [ ] 2.1 Create `electron/system-audio-self-test.mjs` — Electron-free, injected clock/timer, exposing `arm()`, `consume()`, `disarm()`, `isArmed()` (design D5)
- [ ] 2.2 Make the arming **one-shot**: `consume()` authorises exactly one grant and clears the arming, so a second request before re-arming is refused
- [ ] 2.3 Give the arming an absolute deadline from the first `arm()`, set to 6s — derived from `LIVENESS_PROBE_INTERVAL_MS × LIVENESS_PROBE_TICKS` (750ms × 6 = 4.5s) plus acquisition margin; re-arming while live does not push it out
- [ ] 2.4 Record which frame armed the test, so the grant can be restricted to it
- [ ] 2.5 Write `electron/system-audio-self-test.test.mjs`: one grant then refusal; an unused arming expires; re-arming does not extend the deadline; explicit disarm; `isArmed()` false before and after
- [ ] 2.6 Compose it into `renderer-security.mjs`. The display-media condition becomes `isSystemAudioEnabled() && (isListenOnlyEngaged() || selfTest.consume())` — **the escape hatch stays a precondition of every route**, per the `renderer-content-security` delta and `listen-only-mode`'s "System audio can be disabled entirely"
- [ ] 2.7 Refuse a self-test grant when `request.videoRequested` is true, rather than answering audio-only
- [ ] 2.8 Require `request.userGesture` on the self-test path, so "user-initiated" is established from main rather than asserted by the renderer over IPC
- [ ] 2.9 Grant only to the frame that armed the test (`WebContents.fromFrame(request.frame)` against the recorded id)
- [ ] 2.10 Disarm when the arming window goes away — reload, close, render-process-gone
- [ ] 2.11 Add IPC + preload for arming/disarming the self-test
- [ ] 2.12 Extend `electron/renderer-security.test.mjs`: out-of-mode request with nothing armed is denied; **the escape hatch denies even while armed**; an armed test grants once and the second request is denied; a video request on the self-test path is refused; a request from a non-arming frame is denied

## 3. The Permissions step

- [ ] 3.1 Extract the Permissions step from `src/components/SetupPanel.tsx` into its own component (design D7). It renders from **two** call sites — the settings body (`:833`) and the wizard step (`:886`) — both must keep working
- [ ] 3.2 Replace the `navigator.permissions.query` effect with the main-process status
- [ ] 3.3 Refresh on panel open, after an in-app prompt resolves, and on window focus — no polling timer (design D2)
- [ ] 3.4 Render `PermRow` per state: prompt while not-determined; granted with no redundant action; settings route while denied; managed-by-policy while restricted, with no prompt offered
- [ ] 3.5 Show the written pane path alongside the settings link, always — not only when something fails (design D4)
- [ ] 3.6 Say a relaunch is needed where a grant does not take effect until then, rather than showing a row that reads granted while capture still fails
- [ ] 3.7 Gate the microphone and camera device pickers on the OS-truthful state
- [ ] 3.8 **Verify device labels survive the `getUserMedia` → `askForMediaAccess` swap.** `enumerateDevices` exposes labels on the browser engine's own permission check, and the app installs no `setPermissionCheckHandler`; if labels come back blank, follow a successful `askForMediaAccess` with a one-shot `getUserMedia` that is immediately stopped — which also confirms capture actually works post-grant
- [ ] 3.9 Add the System audio entry, stating what listen-only mode captures by pointing at `listen-only-mode`'s existing disclosure rather than authoring a second one
- [ ] 3.10 Under `IRIS_SYSTEM_AUDIO=0`, the entry says system audio is disabled and offers no test

## 4. The system-audio self-test in the renderer

- [ ] 4.1 **Add an `onLive` callback to `watchCaptureLiveness` in `src/lib/system-audio.ts`** — it currently emits nothing on real signal, so "heard" is unobservable (design D6). `useAudioPipeline` passes none and is unaffected; re-run the listen-only tests since this edits the mode's live path
- [ ] 4.2 Resolve the OS version before attempting capture, and report "this macOS does not provide system-audio capture" (below 14.2) as its own verdict (design D8)
- [ ] 4.3 Wire the test action: ask main to arm, then acquire an audio-only `getDisplayMedia` stream
- [ ] 4.4 Judge the result with `watchCaptureLiveness` / `isCaptureSilent` — no second definition of silence
- [ ] 4.5 Report the four outcomes distinctly: heard, obtained-but-silent, not obtainable, OS too old
- [ ] 4.6 State on the silent verdict that this is expected when nothing is playing
- [ ] 4.7 Offer the settings route (system-audio recording location) on the silent and not-obtainable verdicts
- [ ] 4.8 Disclose before running that the test itself opens a capture and may raise the OS's own prompt
- [ ] 4.9 Stop the stream and disarm on every exit path, including unmount mid-test — reuse the epoch-guard pattern from `useAudioPipeline.ts:193-199`
- [ ] 4.10 Extract the outcome resolution into `src/lib/` and unit-test it there (the repo has no React component-test harness; every `src/` test targets `src/lib/` or a hook)

## 5. Packaging and docs

- [ ] 5.1 Add `build.mac.extendInfo` usage-description strings for microphone, camera and audio capture — the bundle currently inherits the framework's placeholders ("This app needs access to audio capture"), and this change deliberately raises those prompts
- [ ] 5.2 Set `build.mac.minimumSystemVersion` to match what system-audio capture requires; the bundle currently declares 12.0
- [ ] 5.3 Update `docs/ARCHITECTURE.md`'s module/file map for `os-permissions.mjs`, `system-audio-self-test.mjs` and the new IPC surface

## 6. Verification

- [ ] 6.1 `npm run build`
- [ ] 6.2 `npm test`
- [ ] 6.3 `npm run lint`
- [ ] 6.4 `npm run scan:secrets`
- [ ] 6.5 `npm run spec:check`
- [ ] 6.6 Confirm `os-permissions.mjs` and `system-audio-self-test.mjs` are importable in a plain vitest file (already enforced by `electron-graph.supply.test.mjs`, which derives its covered set from the filesystem — this is a confirmation, not new coverage)

## 7. Manual acceptance on macOS 15

- [ ] 7.1 With camera never granted, confirm the Camera row reads not-granted — the measured case where the old panel showed "✓ Granted"
- [ ] 7.2 Grant camera in System Settings, return to the app, and confirm the row updates on focus **and that capture actually works**, not merely that the row changed
- [ ] 7.3 Deny microphone, confirm the row offers the settings route rather than a retry, that the link lands on the Microphone pane, and that the written path is shown regardless
- [ ] 7.4 Run the self-test with audio playing (expect heard) and with the machine silent (expect the silent verdict with its explanation and settings route)
- [ ] 7.5 Confirm system audio is unreachable with nothing armed, that an armed test grants exactly once, and that it is unreachable again afterwards
- [ ] 7.6 With `IRIS_SYSTEM_AUDIO=0`, confirm the entry offers no test and that no capture is reachable even if arming is attempted
- [ ] 7.7 Repeat 7.4 and 7.5 in a `npm run package:mac:host` build — the origin rule, the bundle identity and the capture all have to hold where the app ships

## 8. Manual acceptance on macOS 26

None of the measurements behind this change were taken on macOS 26, and this is
the surface Apple has been actively changing there — the recording pane was
renamed and consolidated, upgrading can require re-granting, and point releases
have altered which processes appear in it. Nothing below may be inferred from a
green run on macOS 15.

- [ ] 8.1 Verify the settings deep links resolve to the right panes on macOS 26 — several `x-apple.systempreferences` anchors are known to have broken there. If an anchor is dead, the written path must still carry the user through
- [ ] 8.2 Confirm the system-audio recording anchor specifically, since it is the newest of the three and the one with no readable state behind it
- [ ] 8.3 Run the self-test on macOS 26 with audio playing and confirm the loopback capture still delivers
- [ ] 8.4 Confirm whether granting system-audio recording requires an app relaunch on 26, and that task 3.6's message fires when it does
- [ ] 8.5 Test on a machine upgraded from an earlier macOS, not only a clean install — the consolidated pane can require re-granting
- [ ] 8.6 Record the results per OS version in this change directory before archiving, so the next person knows which claims were verified where
