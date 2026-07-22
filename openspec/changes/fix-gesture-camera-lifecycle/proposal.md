## Why

Two camera/gesture lifecycle defects: the webcam turns on whether or not the user wants gestures, and a single transient camera failure disables gestures for the rest of the process.

**Item 5 — hand control turns on the webcam silently on every launch.** `start()` calls `setHandControl(true)` unconditionally (`src/App.tsx:764`). So every time Iris connects, the camera LED lights, MediaPipe's WASM + model are fetched from the CDN (`useHandControl.ts` `WASM_URL`/`MODEL_URL`), and GPU inference runs — even for users who never use gestures. Sound (`iris.soundsEnabled`) and camera device (`iris.cameraDeviceId`) are already persisted opt-in preferences (`App.tsx:38-55,156-174`); gesture control should be one too, defaulting off.

**Item 6 — a camera error sticks for the whole process.** `useHandControl`'s `setup()` sets `error` when `getUserMedia` (or recognizer init) rejects (`useHandControl.ts:156`) but **never clears it** on a later successful acquire. The effect re-runs on `[enabled, deviceId]` (`:301`), so toggling gesture control off/on or switching device re-acquires — but a stale `error` from one transient failure (camera briefly held by another app) remains displayed forever. This contradicts the living spec, which says gesture control is unavailable only "until the failure is resolved."

Out of scope (their own later changes): the audio-playback correctness bugs (barge-in flush race, output `AudioContext` never closed) and the `handleSidecarEvent` stale-closure comment.

## What Changes

Two commits, one per item (independent; unified as "the camera is held only when the user asked for gestures, and a resolved failure clears").

**Commit 1 — Item 5: gesture control is an opt-in, persisted preference.**
- Add a persisted preference `iris.handControlEnabled` (default **off**), loaded on mount exactly like `soundsEnabled`/`cameraDeviceId`.
- `start()` sets `handControl` from the persisted preference instead of forcing `true`; when off, no camera is acquired and no MediaPipe assets load.
- The existing hand-control toggle persists the new value (like `toggleSounds`), so enabling it once carries across sessions.
- `stop()` still turns the live camera off; the preference is unchanged so the next launch honors it.

**Commit 2 — Item 6: clear the camera error when a re-acquire succeeds.**
- In `setup()`, clear `error` once the camera is successfully acquired (after `getUserMedia`/`video.play()` resolve and the run is not cancelled), so a resolved failure stops being reported.
- Also clear `error` when gesture control is disabled (the `!enabled` branch), so a stale failure does not linger on a disabled engine.
- The "do not silently retry / do not fall back to another device" behavior is unchanged — only genuine resolution (a successful acquire the user triggered by fixing the device or reselecting) clears it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `two-hand-gestures`: **one ADDED requirement** — gesture control is an opt-in, persisted preference (default off); the engine acquires the camera only when it is enabled, so launching Iris does not turn on the webcam or load MediaPipe assets by default. This is a genuine new invariant (and a deliberate default change from today's always-on) with no existing requirement stating when hand control turns on.
- `two-hand-gestures`: **one MODIFIED requirement** — "Device-selectable camera acquisition" already says gesture control is unavailable "until the failure is resolved" but never states that resolving clears the error. Update it to make explicit that a successful (re-)acquire clears the previously reported error, and add a recovery scenario. This pins the drift fix without weakening the "no silent retry / no silent device fallback" rules.

## Impact

- `src/App.tsx` — add `HAND_STORAGE_KEY`/`loadHandEnabled()` (mirror sounds/camera); init `handControl` and `start()` from the persisted preference (remove the unconditional `setHandControl(true)`); the toggle persists.
- `src/hooks/useHandControl.ts` — `setError(null)` on successful acquire (`~:151-153`) and in the `!enabled` branch (`~:98`).
- `two-hand-gestures` living spec — one ADDED requirement (opt-in/persisted) + one MODIFIED requirement (error clears on resolve).
- No new dependency, no data migration, no IPC-surface change. Persistence is renderer `localStorage`, same as the existing preferences.
