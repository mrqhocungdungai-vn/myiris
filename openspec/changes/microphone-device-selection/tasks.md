## 0. Sequencing checkpoint (read first)

- [ ] 0.1 Confirm the intended order before writing code. Three changes with zero implemented tasks converge on `src/hooks/useWakeWord.ts` and `src/components/SetupPanel.tsx`: `harden-wake-word-detection`, `harden-security-boundaries`, and this one. design.md recommends implementing **this change last**. Check whether the other two have landed; if they have not and the decision is to proceed anyway, note it here and adjust group 2 to target `useWakeWord`'s current shape (`onError`, `autoGainControl: true`, no `deviceId` param).
- [x] 0.2 ~~Correct the stale claim in `CLAUDE.md` about there being no test runner.~~ **Done during review, ahead of implementation** — the line was load-bearing (left as-is it would have told the implementer not to write the test in task 1.1). `CLAUDE.md`'s Commands section now documents `npm test` (vitest `4.1.10`), the `vitest.config.mjs` include globs, all 9 existing test files, the `test-harness` spec's dependency-injection convention, and the `vitest: command not found` → `npm ci` gotcha. The "no linter" half was verified still true and kept.

## 1. Pure constraint module (test-first)

- [ ] 1.1 Write `src/lib/mic-device.test.ts` before the implementation, covering: System Default sentinel returns the base constraints unchanged; an empty/undefined device id also returns base unchanged; a specific device id yields `deviceId: { exact: <id> }` merged onto base; the base object is not mutated; a base with `autoGainControl: false` keeps that value (the wake-word case). Follows the existing `src/lib/downsample.test.ts` / `hand.test.ts` pattern and must need no `AudioContext`, `getUserMedia`, or Electron, per the `test-harness` spec.
- [ ] 1.2 Implement `src/lib/mic-device.ts` exporting `SYSTEM_DEFAULT_MIC` and `micConstraints(base: MediaTrackConstraints, deviceId: string): MediaTrackConstraints`. Base constraints are a **parameter**, not hardcoded — the two consumers' base sets differ and `harden-wake-word-detection` deliberately sets `autoGainControl: false` on the wake-word stream only.
- [ ] 1.3 Confirm `npm test` passes and the new file runs in the clean-environment terms the `test-harness` spec requires.

## 2. `useAudioPipeline` device targeting

- [ ] 2.1 Change `useAudioPipeline({ onLog })` to `useAudioPipeline({ onLog, micDeviceId })`, store the current device id in a ref, and build `startCapture()`'s `getUserMedia` audio constraints via `micConstraints(...)` with the existing base (`echoCancellation`, `noiseSuppression`, `autoGainControl`, `channelCount: 1`) unchanged.
- [ ] 2.2 Add a `mutedRef` written by `toggleMute` alongside `setMuted` (the ref-mirror pattern already used for `inputLevelRef`/`outputLevelRef`), so mute state is readable from inside async continuations.
- [ ] 2.3 Add a capture epoch ref (mirroring `flushEpochRef` in the same file), incremented on `startCapture()` entry and re-checked after **every** await — `getUserMedia`, the worklet `addModule`, and the fallback retry. If the epoch advanced, stop the just-opened tracks and close the just-opened context instead of assigning to the live refs. This closes a real leak: the existing `if (… || inputContextRef.current) return;` guard cannot serialize concurrent calls because `inputContextRef.current` is only assigned on the function's last lines, so a losing stream currently ends up unreferenced and never stopped (mic stays hot, macOS recording indicator stays lit).
- [ ] 2.4 Immediately after acquisition and before wiring the stream into the graph, apply mute state to every audio track (`track.enabled = !mutedRef.current`), reading the **ref** so a mute toggled during the acquisition window is honored. Without this, a hot-swap while muted silently resumes transmitting while the indicator still shows muted.
- [ ] 2.5 Catch a `getUserMedia` rejection when a specific `deviceId` was requested; retry once with `micConstraints(base, SYSTEM_DEFAULT_MIC)` (subject to the same epoch check), and log a warning via `onLog` naming the device that failed and the fallback.
- [ ] 2.6 If the System Default retry also fails, log it the same way the existing AudioWorklet-load failure is logged, and leave capture stopped (no further fallback).
- [ ] 2.7 Make `start()` and the new `restartCapture()` return the actually-active device id after any fallback, so `App.tsx` reconciles persisted/displayed state from one deterministic value rather than a second callback channel.
- [ ] 2.8 Export `restartCapture(deviceId)` for `App.tsx`'s hot-swap: `stopCapture()` then `startCapture()` with the new device. It must not touch the output/playback context and must not reset `sessionStartRef` or `muted` (that is the full `stop()`'s job).

## 3. `useWakeWord` device targeting

**Before starting:** re-read task 0.1. If `harden-wake-word-detection` landed first, this hook's error channel is `onLog(level, message)` (not `onError`) and its base constraints already carry `autoGainControl: false` — use them as found. Do not move that change's sensitivity settings into the effect's dependency array; they are ref-threaded on purpose so a settings save never re-acquires the microphone.

- [ ] 3.1 Build `init()`'s `getUserMedia` audio constraints via `micConstraints(...)` from `src/lib/mic-device.ts`, passing whatever base constraints the hook has at implementation time.
- [ ] 3.2 Add a `deviceId` parameter to `useWakeWord` and add it — **and only it** — to the effect's dependency array (`[enabled, deviceId]`). The hook already fully tears down and re-initializes on `enabled` transitions, so this yields a correct hot-swap for free, mirroring `useHandControl`'s `[enabled, deviceId]`.
- [ ] 3.3 Catch a `getUserMedia` rejection when a specific `deviceId` was requested; retry once against System Default and report the fallback through the hook's existing error/log channel so the caller can reconcile persisted/displayed state.
- [ ] 3.4 If the System Default retry also fails, report it through that same channel, as an init failure is reported today.
- [ ] 3.5 Verify the module-level ONNX session cache is still reused across a device swap — re-arming on a new device must not reload the models.

## 4. `App.tsx` state and persistence

- [ ] 4.1 Add `MIC_STORAGE_KEY = "iris.micDeviceId"` and a `loadMicDeviceId()` reader, following the existing `CAMERA_STORAGE_KEY`/`loadCameraDeviceId` pattern, defaulting to `SYSTEM_DEFAULT_MIC` from `src/lib/mic-device.ts`.
- [ ] 4.2 Add `micDeviceId` state and a setter that persists to `localStorage`, following the existing camera setter.
- [ ] 4.3 Pass `micDeviceId` into `useAudioPipeline(...)` and `useWakeWord(...)`.
- [ ] 4.4 When `micDeviceId` changes while a session is capturing, call `restartCapture()` (task 2.8); when idle with wake word armed, rely on `useWakeWord`'s dependency array (task 3.2). Ensure the two paths cannot both fire for one change.
- [ ] 4.5 Reconcile the fallback-reported device id from both hooks (task 2.7's return value, task 3.3's report) back into `micDeviceId` state **and** `localStorage`, so the selector reflects what is actually live.
- [ ] 4.6 Pass `micDeviceId` and `onChangeMicDevice` down to `SetupPanel`.

## 5. `SetupPanel.tsx` selector UI

- [ ] 5.1 Import `SYSTEM_DEFAULT_MIC` from `src/lib/mic-device.ts` rather than re-declaring the literal — the camera sentinel is currently declared twice (`useHandControl.ts:78` exports one, `SetupPanel.tsx:31` re-declares a local copy); do not repeat that for the mic.
- [ ] 5.2 Add `micDeviceId`/`onChangeMicDevice` to `SetupPanel`'s inline props type (there is no separate `SetupPanelProps` interface — `cameraDeviceId`/`onChangeCameraDevice` are destructured straight out of the function signature's inline object type; extend that same type).
- [ ] 5.3 Add `micDevices` state and an `enumerateDevices()` + `devicechange`-listener effect filtered to `audioinput`, gated on `mic === "granted"`, mirroring the existing `camDevices` effect gated on `cam === "granted"`.
- [ ] 5.4 Build `micOptions` (System Default + enumerated devices, plus a "Previously selected microphone (unavailable)" entry only when the persisted id is absent from the live list *and* has not already been auto-fallback-corrected) following the `cameraOptions`/`cameraSelectionMissing` pattern.
- [ ] 5.5 Render the microphone `ThemedSelect` directly below the existing Microphone `PermRow` in the Permissions section, matching the camera selector's layout, with an explanatory hint instead when `mic !== "granted"`.
- [ ] 5.6 Add a `setup-note` line stating that this selector governs both voice conversation and local wake-word listening, and that it falls back to System Default automatically if the chosen device fails — both points differ from the camera selector's copy, so the text must not imply the two behave identically.
- [ ] 5.7 Update the Permissions `Section` hint if needed so it still reads correctly with two selectors under it.

## 6. Verification

- [ ] 6.1 `npm run build` passes (typecheck + build).
- [ ] 6.2 `npm test` passes, including the new `src/lib/mic-device.test.ts`.
- [ ] 6.3 Manually verify, with a second physical or virtual input device available: selection persists across an app restart; selecting a mic while a Gemini Live session is listening hot-swaps without dropping the Live connection; selecting a mic while idle with wake word on hot-swaps the listener and "Hey Iris" still fires afterward; muting then hot-swapping keeps the session muted; unplugging the selected device (and separately, launching with a stale persisted id) falls back to System Default with a logged warning — in both the session-capture and wake-word-listening cases.
- [ ] 6.4 Confirm no leaked capture: after several rapid selection changes during a session, exactly one input stream is live and macOS shows the recording indicator only while Iris is actually listening.
- [ ] 6.5 Re-base this change's `specs/setup-panel/spec.md` delta against the then-current `openspec/specs/setup-panel/spec.md` before archiving, so archiving does not drop another change's addition to the same `MODIFIED` requirement block (see design.md's sequencing note).
- [ ] 6.6 Run `openspec-archive-change` for `microphone-device-selection`, syncing `specs/microphone-device-selection/` and the `setup-panel` delta into `openspec/specs/`.
