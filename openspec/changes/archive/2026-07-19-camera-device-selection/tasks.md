## 1. Gesture engine: device-selectable camera acquisition

- [x] 1.1 Change `useHandControl` signature to `useHandControl(enabled, deviceId)`, where `deviceId` is either the `"default"` sentinel or a real `MediaDeviceInfo.deviceId` string
- [x] 1.2 Build the `getUserMedia` video constraints from `deviceId`: `"default"` (or unset) keeps `{ width: 640, height: 480, facingMode: "user" }`; any other value uses `{ width: 640, height: 480, deviceId: { exact: deviceId } }` with no `facingMode`
- [x] 1.3 Add `deviceId` to the setup effect's dependency array (`[enabled, deviceId]`) so a selection change tears down the current stream/recognizer/rAF loop (existing cleanup already does this) and re-acquires with the new device
- [x] 1.4 Confirm a `getUserMedia` rejection for a missing/invalid device (e.g. `OverconstrainedError`, `NotFoundError`) flows into the existing `error` state as-is, with no added retry or fallback-to-default logic

## 2. Settings: camera device selector in SetupPanel

- [x] 2.1 Add a small localStorage helper (mirroring the existing `SOUNDS_STORAGE_KEY` pattern in `App.tsx`) to read/write the selected camera device id, defaulting to `"default"` when unset
- [x] 2.2 In `SetupPanel.tsx`, add device-list state populated from `navigator.mediaDevices.enumerateDevices()` filtered to `kind === "videoinput"`, refreshed only once Camera permission (`cam === "granted"`) is true
- [x] 2.3 Add a `navigator.mediaDevices.ondevicechange` listener (added/removed with the panel's mount lifetime) that re-runs the enumeration in 2.2 so devices appearing/disappearing at runtime update the list live
- [x] 2.4 Render the camera device dropdown in the Permissions section: options are `"System Default"` followed by each enumerated device's label; disabled/hidden with an explanatory hint while `cam !== "granted"`
- [x] 2.5 If the currently saved device id is not present in the live device list, visually mark it as unavailable in the dropdown (e.g. a distinct option label/state) without changing the underlying saved value
- [x] 2.6 On dropdown change, persist the new selection via the helper from 2.1 immediately (no separate "Save" step required, consistent with other instant toggles in the panel)

## 3. Wire the selection into gesture control

- [x] 3.1 In `App.tsx`, read the persisted camera device selection (via the helper from 2.1) and pass it as the `deviceId` argument to `useHandControl`
- [x] 3.2 Ensure a change made in Settings while the app is running (same window) is reflected in the value passed to `useHandControl` without requiring an app restart — e.g. lift the selection into shared state read by both `SetupPanel` and `App.tsx`, or re-read on a `storage`/custom event when the panel saves
- [x] 3.3 Verify the existing `if (handError) pushLog("error", ...)` call in `App.tsx` already surfaces the new unavailable-device error case with no additional code needed

## 4. Verification

- [x] 4.1 Run `npm run build` (`tsc --noEmit` + vite build) and confirm it passes
- [ ] 4.2 Manual: `npm run dev`, grant camera permission, confirm "System Default" behaves identically to pre-change gesture control
- [ ] 4.3 Manual: start OBS Virtual Camera, open Settings without restarting the app, confirm "OBS Virtual Camera" appears in the dropdown (devicechange live refresh), select it, confirm the live CameraDock/HudCamera feed switches to it immediately while gesture control is on
- [ ] 4.4 Manual: with OBS Virtual Camera selected, quit OBS, and confirm gesture control fails with a visible error in the Work Stream/Comms log (no silent fallback to another camera) and the Settings dropdown marks the saved selection as unavailable; note the actual OS-level failure mode observed (clean rejection vs. black/frozen frame) per the risk flagged in `design.md`
