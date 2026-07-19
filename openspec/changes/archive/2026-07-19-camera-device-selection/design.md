## Context

Today `useHandControl.ts` opens the camera with a single hardcoded `getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })` call inside a `useEffect` keyed only on `enabled`. Cleanup already fully tears down the recognizer and stream on every effect re-run (`useHandControl.ts:263-270`), which matters below. `CameraDock`/`HudCamera` only render the `stream` this hook returns — they never call `getUserMedia` themselves. `SetupPanel.tsx`'s `requestCam()` opens a throwaway `getUserMedia({video: true})` purely to trigger the OS permission prompt, then stops it immediately; it is unrelated to device selection.

The trigger for this change: the user needs gesture control to read from **OBS Virtual Camera** instead of a physical webcam, and today there is no way to express that — the browser/OS default device is always used.

## Goals / Non-Goals

**Goals:**
- Let the user pick a specific video input device (including virtual devices like OBS Virtual Camera) for gesture control, from Settings.
- Keep the current unconstrained behavior available as an explicit "System Default" choice.
- Apply a new selection immediately, including mid-session while gesture control is already running.
- Fail loudly (no silent camera swap) when the previously selected device can't be opened.

**Non-Goals:**
- No camera switcher in the live deck/HUD (CameraDock/HudCamera) — Settings is the only place to change it.
- No live preview thumbnail in Settings.
- No resolution/frame-rate/facing-mode configuration — device identity only.
- No change to `SetupPanel`'s permission-test `requestCam()` flow, or to the sidecar `SidecarMode` type (unused, unrelated).

## Decisions

**1. Persist the selection in renderer `localStorage`, not main-process/`.env` storage.**
A video-input device choice is a browser-`MediaDevices` concept scoped to this Electron renderer profile on this machine — it isn't project/workstream state (like `agent_sessions`/`agent_models` in `~/.iris/claude-sessions.json`) and isn't a secret/env value (like the `.env`-backed config IPC in `setup-panel`). `localStorage` already has a precedent for renderer-only UI prefs (`SOUNDS_STORAGE_KEY` in `App.tsx`). Alternative considered: route through the `config:get`/`config:save` IPC pair like other SetupPanel settings — rejected because that pair is specifically for `.env`-backed config and would force a meaningless env var for a per-machine hardware pointer.

**2. Store the device by a stable identifier, with a reserved `"default"` sentinel for System Default.**
`localStorage` holds either the sentinel string `"default"` or a real `deviceId` string. On read, `"default"` (or an empty/missing value, e.g. first run) maps to the pre-change unconstrained behavior: `getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })`. Any other stored value is treated as an explicit device and passed as `{ video: { width: 640, height: 480, deviceId: { exact: <id> } } }` — `facingMode` is dropped for explicit-device selection since it's meaningless for virtual devices and can conflict with `deviceId` constraints on some platforms.

**3. Thread the selection into `useHandControl` as a parameter, add it to the effect's dependency array.**
`useHandControl(enabled, deviceId)` — the existing `useEffect(() => {...}, [enabled])` becomes `[enabled, deviceId]`. Because cleanup already fully stops the old stream/recognizer/rAF loop before `setup()` runs again, adding `deviceId` to the deps array gives hot-swap "for free": changing the selection in Settings updates the `deviceId` state passed down from `App.tsx`, which naturally re-triggers the effect and re-acquires the stream with the new device. No new imperative restart API is needed.

**4. Gate the device dropdown behind the existing Camera permission state, not behind a separate check.**
`SetupPanel.tsx` already tracks Camera permission (`watch("camera", setCam)`) for the Permissions row. `enumerateDevices()` only returns non-empty `label`s once permission has been granted at least once in this origin. The new dropdown reuses that same `cam` state: rendered disabled/hidden with a hint ("Grant camera permission above to see device names") while `cam !== "granted"`, and enabled once granted. Alternative considered: enumerate anyway and show generic `"Camera 1"/"Camera 2"` names — rejected per user decision, since generic names can't distinguish a physical webcam from OBS Virtual Camera, which is the entire point of this feature.

**5. Live-refresh the device list via `navigator.mediaDevices.ondevicechange` while the panel is mounted.**
A `devicechange` listener re-runs `enumerateDevices()` and updates the dropdown's option list. This is what makes "start OBS, its Virtual Camera appears in the list" work without closing/reopening Settings. Listener is added/removed in a `useEffect` scoped to the SetupPanel's mounted lifetime (or wherever the picker component lives), matching the permission-`watch` pattern already used for mic/cam state.

**6. No silent fallback on an unavailable saved device; reuse the existing hand-control error path.**
If the stored `deviceId` is not present in the current device list (or `getUserMedia` throws, e.g. `OverconstrainedError`/`NotFoundError`) when `useHandControl` tries to acquire the stream, the hook's existing `error` state captures it and `App.tsx`'s existing `if (handError) pushLog("error", ...)` (already present today for any hand-control failure) surfaces it — no new UI/announcement channel. Gesture control simply does not turn on/stays off; the code never substitutes a different camera silently. Separately and independent of runtime failure, the Settings dropdown marks the saved device as "(unavailable)" whenever it doesn't currently appear in the live-refreshed device list from decision 5 — this is a pure list-membership check against `enumerateDevices()` output, not a `getUserMedia` probe.

**7. Always render the dropdown, regardless of device count.**
No conditional hide-when-only-one-camera logic. Simpler state, consistent UI, and avoids the dropdown appearing/disappearing as OBS is started/stopped (which would fight with decision 5's live refresh).

## Risks / Trade-offs

- **[Risk]** Some virtual-camera drivers (OBS Virtual Camera on certain OSes) may register a persistent device entry that stays in `enumerateDevices()` output even while OBS itself is closed, producing a black/frozen frame or a hang instead of a clean `getUserMedia` rejection. → **Mitigation**: the "unavailable" indicator in decision 6 is a best-effort UX hint based on list membership, not a guarantee; the authoritative signal stays the actual `getUserMedia` failure surfaced through the existing error/log path. Implementation (DEV) should verify actual OBS Virtual Camera behavior on this machine's OS during implementation and note any divergence in code comments if the failure mode differs from a clean rejection.
- **[Risk]** `deviceId` values from `enumerateDevices()` are origin-scoped and can be unstable across reboots/driver reinitialization for some physical USB cameras. → **Mitigation**: this only degrades the saved choice back to "unavailable" (decision 6 behavior) if the ID no longer resolves — no crash, no silent wrong-camera use; the user re-picks in Settings.
- **[Trade-off]** No preview thumbnail (per user decision) means a wrong pick is only discovered when gesture control is actually turned on and the CameraDock feed is visibly wrong — acceptable since device names (esp. "OBS Virtual Camera") are already unambiguous.

## Migration Plan

No data migration: first run under this change has no `localStorage` key yet, which resolves to `"default"`/System Default — byte-identical to today's hardcoded behavior. No rollback flag needed; this is additive and backward-compatible by construction (default path unchanged).

## Open Questions

- None outstanding — all decision points were resolved with the user during grilling (see `proposal.md`/task discussion). Implementation should confirm the actual behavior of OBS Virtual Camera's device-list presence when OBS is closed on the target OS (see first risk above) while building the "unavailable" indicator.
