## Context

`App.tsx` already has the exact pattern this needs: `soundsEnabled` and `cameraDeviceId` are `localStorage`-backed preferences loaded on mount (`loadSoundsEnabled`/`loadCameraDeviceId`, `:41-55`) and persisted through their setters (`toggleSounds` `:156-166`, `setCameraDeviceId` `:168-174`), each wrapped in try/catch so persistence is best-effort. `handControl` is plain `useState(false)` (`:74`), but `start()` overrides it to `true` unconditionally (`:764`), so the camera comes up on every connect regardless of intent. `stop()` sets it back to `false` (`:774`).

`useHandControl(enabled, deviceId)` runs its acquire effect on `[enabled, deviceId]` (`:301`). `setup()` (`:130-158`) initializes the recognizer, calls `getUserMedia`, and on success publishes and starts the loop; on any throw it `setError(...)` (`:156`). There is no `setError(null)` anywhere, so the error is monotonic for the effect's life — a re-run (toggle or device change) that succeeds leaves the old error visible. The `!enabled` early-return (`:98-102`) resets state and stream but also does not clear `error`.

## Goals / Non-Goals

**Goals:**

- No webcam acquisition / MediaPipe load unless the user has opted into gesture control; the preference persists like sound/camera-device.
- A resolved camera failure (successful re-acquire, or disabling gesture control) clears the reported error.
- No change to the "no silent retry, no silent device fallback" behavior.

**Non-Goals:**

- Audio-playback correctness (barge-in, output-context leak) and the stale-closure comment — separate changes.
- Changing device-selection semantics, gesture thresholds, or the tracking loop.
- A settings-panel redesign; reuse the existing toggle control and persistence idiom.

## Decisions

### D1 — Persisted `iris.handControlEnabled`, default off; `start()` reads it

**Chosen:** mirror the sound preference exactly. Add `HAND_STORAGE_KEY = "iris.handControlEnabled"` and `loadHandEnabled(): boolean` defaulting to `false` (opt-in) with the same try/catch. Initialize `handControl` state from `loadHandEnabled()`. Replace `setHandControl(true)` in `start()` (`:764`) with `setHandControl(loadHandEnabled())` (or simply drop it, since the initial state already reflects the preference and `start()` should not re-enable a preference the user turned off). The hand-control toggle becomes a `toggleHand()` that flips `handControl` and persists the new value (parallel to `toggleSounds`). `stop()` keeps `setHandControl(false)` for the live camera; it does not write the preference, so the next launch honors the stored intent.

Default **off** is a deliberate behavior change from today's always-on: the cost of always-on (camera LED, CDN asset fetch, GPU inference) is paid by every user including those who never gesture. The new ADDED requirement records this.

*Considered:* keeping `handControl` live-only and adding a separate `handControlPref` state. Rejected as redundant — a single persisted state read by `start()` and written by the toggle is enough; `stop()`'s transient `false` doesn't need to touch the preference.

### D2 — Clear the error on successful acquire and on disable

**Chosen:** in `setup()`, after `getUserMedia`/`video.play()` succeed and `!cancelled` (right where it publishes, `:151-153`), call `setError(null)`. Also add `setError(null)` in the `!enabled` branch (`:98-102`). This makes `error` reflect the *current* acquire outcome rather than being a monotonic latch. The catch (`:156`) still sets the error on failure; the spec's "no silent retry / no silent fallback" is untouched because clearing only happens on an acquire the user actually triggered (enable, or device reselect) that actually succeeded.

*Considered:* clearing at the top of `setup()` (before the async work). Rejected — that would blank the error during the acquire attempt and, if the attempt then fails, flicker error→none→error. Clearing only on confirmed success avoids the flicker and matches "until the failure is resolved."

## Risks / Trade-offs

**Default-off surprises existing gesture users** → intended and documented; the toggle is unchanged and enabling once persists. A one-time behavior shift, not a regression — the plan explicitly calls for opt-in.

**Error cleared too eagerly, hiding a real failure** → cleared only on a confirmed successful acquire (or explicit disable), never mid-attempt (D2), so a still-failing device keeps its error.

**Preference/live divergence** → `handControl` is the single source of truth; `start()` reads the persisted value, the toggle writes it, `stop()` only drops the live camera. No second state to drift.

**No automated coverage** → renderer + `getUserMedia` + MediaPipe are out of the Vitest harness (Wave 0.0 D5). Verification is manual: fresh profile launches with the camera LED off; enabling persists across relaunch; a busy-camera failure clears once the camera is freed and gesture control is re-enabled.
