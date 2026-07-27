## Why

Iris always captures from the OS default microphone — there is no way to pick a specific input device (e.g. an external USB mic, an audio interface, or a virtual device) short of changing the OS default and restarting the app. The Setup Panel already solves this exact problem for the gesture camera; the microphone has no equivalent.

## What Changes

- Add a microphone device selector to `SetupPanel.tsx`'s "Permissions" section, directly under the existing Microphone permission row, mirroring the camera selector's UI pattern (`ThemedSelect`, "System Default" first option, gated on mic permission being granted, live-refreshed on `devicechange`).
- Persist the selection to `localStorage` (`iris.micDeviceId`) the same way `iris.cameraDeviceId` is persisted today, and thread it down from `App.tsx` into **both** places Iris opens a mic stream: `useAudioPipeline` (Gemini Live capture) and `useWakeWord` (local "Hey Iris" detection). These two are temporally exclusive (`useWakeWord` only runs while `!sidecarRunning`), but both are "the microphone the user picked" and must honor the same selection — a user who picks a specific mic because the system default has bad wake-word recognition would otherwise see the picker silently do nothing while idle.
- `useAudioPipeline`'s `startCapture()` and `useWakeWord`'s `init()` both add `deviceId: { exact }` to their `getUserMedia` audio constraints when a specific device is selected (System Default = no `deviceId` constraint), keeping existing constraints (`echoCancellation`/`noiseSuppression`/`autoGainControl`/channel count/sample rate) unchanged.
- Changing the selector while a session is actively listening (`useAudioPipeline`) or while wake-word is armed and idle (`useWakeWord`) immediately tears down and rebuilds whichever capture graph is currently live, on the new device; the Gemini Live session itself is undisturbed in the former case.
- **Diverges from the camera selector's failure behavior:** if the selected/persisted device fails to open (unplugged, stale id, `OverconstrainedError`/`NotFoundError`), automatically retry capture with no `deviceId` (System Default), update the dropdown and persisted value to match, and log a warning — mic capture keeps working rather than silently stopping or merely flagging the selection as unavailable (which is what the camera selector does). This applies to both capture paths.
- Deck-only: no equivalent control in Glass HUD, and no voice/tool exposure to Gemini.

## Capabilities

### New Capabilities
- `microphone-device-selection`: device enumeration, selection UI, persistence, hot-swap, and auto-fallback behavior for the mic input device used by both `useAudioPipeline` (Gemini Live capture) and `useWakeWord` (local wake-word detection).

### Modified Capabilities
- `setup-panel`: adds a microphone device selector to the Permissions section, alongside the existing camera device selector.

## Impact

- **New files:** `src/lib/mic-device.ts` + `src/lib/mic-device.test.ts` — the sentinel and pure constraint-building shared by both hooks, following the repo's existing `src/lib/*.ts` + colocated test convention (`downsample.ts`, `hand.ts`, `tasks.ts`) and the `test-harness` living spec.
- **Affected files:** `src/components/SetupPanel.tsx` (new selector UI + device enumeration state), `src/App.tsx` (persisted `micDeviceId` state, prop threading to both hooks, fallback reconciliation), `src/hooks/useAudioPipeline.ts` (accept `micDeviceId`, shared constraint helper, `mutedRef`, capture epoch guard, auto-fallback, `restartCapture`), `src/hooks/useWakeWord.ts` (accept `deviceId` + dependency array, shared constraint helper, same auto-fallback).
- **Docs:** corrects `CLAUDE.md`'s stale "no test runner is configured" line, which contradicts `npm test` (vitest), the three existing `src/lib/*.test.ts` files, and the `test-harness` spec — and which would otherwise steer an implementer away from this change's required unit test.
- **No IPC/main-process changes** — renderer-only `navigator.mediaDevices` work, same surface as the existing camera selector. Verified: `electron/main.mjs`'s `setPermissionRequestHandler` approves `media`/`audioCapture`/`videoCapture` by permission type with no per-device logic, so nothing there needs to change.
- **No breaking changes** — System Default remains the behavior for anyone who never opens the selector.
- **Sequencing:** two other fully-planned, unimplemented changes (`harden-wake-word-detection`, `harden-security-boundaries`) touch the same `useWakeWord.ts` and `SetupPanel.tsx`; design.md recommends implementing this change **last** of the three and explains why.
