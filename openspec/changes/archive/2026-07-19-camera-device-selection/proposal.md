## Why

Gesture control always opens whatever camera the OS/browser picks by default (`facingMode: "user"`, no `deviceId`). On a machine with multiple video sources — e.g. a built-in webcam and OBS Studio's Virtual Camera — there is no way to tell Iris which one to use. The user needs gesture control to run against OBS Virtual Camera specifically, which requires an explicit device picker.

## What Changes

- Add a camera device picker to the SetupPanel Permissions section: a dropdown listing `"System Default"` plus every enumerated `videoinput` device, gated behind the Camera permission already being granted (device labels are blank until then).
- The dropdown lives only in Settings — no picker/switcher elsewhere (e.g. CameraDock); changing camera requires opening Settings.
- The device list live-refreshes via `navigator.mediaDevices.ondevicechange` while Settings is open, so a device that appears/disappears at runtime (starting/stopping OBS Virtual Camera) shows up without reopening the panel.
- The choice persists (renderer `localStorage`, matching the existing sounds-toggle pattern) and takes effect immediately: saving a new selection restarts the gesture-control camera stream right away, even mid-session.
- `useHandControl` acquires its stream using the selected `deviceId` (dropping the hardcoded `facingMode` constraint once a specific device is chosen; `"System Default"` keeps today's unconstrained behavior).
- If the previously selected device is unavailable when gesture control tries to start (e.g. OBS not running), Iris does **not** silently fall back to another camera — it surfaces an explicit error through the existing hand-control error/log path and gesture control stays off. The Settings dropdown also visually marks a saved-but-currently-missing device as unavailable.
- No live camera preview thumbnail in Settings (name-only selection); no conditional hiding of the picker when only one camera is detected — it is always shown.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `setup-panel`: adds the camera device dropdown (list, permission gating, live device-change refresh, unavailable-device indication, persistence) to the Permissions section.
- `two-hand-gestures`: the camera acquisition requirement changes from an unconstrained/hardcoded `facingMode` stream to a device-selectable stream (explicit `deviceId` or system default), applied immediately on selection change, with explicit failure (no silent fallback) when the selected device can't be opened.

## Impact

- `src/components/SetupPanel.tsx`: new camera-select UI, device enumeration/live refresh, persistence read/write.
- `src/hooks/useHandControl.ts`: accept a selected device id, use it in the `getUserMedia` constraints, re-acquire the stream when the selection changes while enabled.
- `src/App.tsx`: thread the persisted device selection into `useHandControl`; existing `pushLog("error", ...)` path for hand-control errors covers the new unavailable-device error, no new UI channel needed.
- No changes to `electron/main.mjs`, IPC surface, or the PO/DEV/STUDY pipeline — this is renderer-only, browser `MediaDevices` API usage.
