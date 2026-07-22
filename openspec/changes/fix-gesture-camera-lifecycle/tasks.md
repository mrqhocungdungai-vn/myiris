## 1. Commit 1 — Item 5: opt-in, persisted gesture control (`App.tsx`)

- [x] 1.1 Add `HAND_STORAGE_KEY = "iris.handControlEnabled"` and `loadHandEnabled(): boolean` (default `false`), mirroring `loadSoundsEnabled` with the same try/catch (design D1)
- [x] 1.2 Initialize `handControl` from `loadHandEnabled()` (`:74`)
- [x] 1.3 In `start()` (`:764`), remove the unconditional `setHandControl(true)` — either drop it or set from `loadHandEnabled()`; when the preference is off, no camera is acquired
- [x] 1.4 Convert the hand-control toggle to a `toggleHand()` that flips `handControl` and persists the new value (parallel to `toggleSounds`); wire it at the toggle call site (`~:1156`)
- [x] 1.5 Leave `stop()`'s `setHandControl(false)` as-is (live camera off; preference untouched)

## 2. Commit 1 — verification (manual; renderer is out of the Vitest harness)

- [ ] 2.1 Fresh profile (clear `localStorage`): launch/connect Iris — the camera LED stays off, no MediaPipe asset fetch, no gesture inference
- [ ] 2.2 Enable gesture control via the toggle → camera comes up and gestures work; relaunch → gesture control is enabled again without re-toggling
- [ ] 2.3 Disable the toggle → camera releases; relaunch → still off
- [x] 2.4 `npm run build` passes

## 3. Commit 2 — Item 6: clear camera error on resolve (`useHandControl.ts`)

- [x] 3.1 In `setup()`, after `getUserMedia`/`video.play()` succeed and `!cancelled` (`~:151-153`), call `setError(null)` so a resolved failure stops being reported (design D2)
- [x] 3.2 In the `!enabled` branch (`~:98-102`), also `setError(null)` so a stale failure does not linger on a disabled engine
- [x] 3.3 Do NOT clear at the top of `setup()` (before the async work) — that would flicker error→none→error on a repeat failure (design D2)
- [x] 3.4 Confirm the failure path (`:156`) and the "no silent retry / no silent device fallback" behavior are unchanged

## 4. Commit 2 — verification (manual)

- [ ] 4.1 Hold the camera with another app, enable gesture control → error is reported and gestures stay unavailable (unchanged)
- [ ] 4.2 Free the camera and re-enable (or reselect the device) → the acquire succeeds and the previously shown error clears
- [ ] 4.3 Disable gesture control while an error is showing → the error clears
- [x] 4.4 `npm run build` passes

## 5. Spec and record

- [x] 5.1 `openspec validate fix-gesture-camera-lifecycle` passes
- [x] 5.2 Re-read the deltas against the landed code: `two-hand-gestures` ADDED "opt-in, persisted" (camera off at launch by default, persists across sessions) and MODIFIED "Device-selectable camera acquisition" (error clears on successful re-acquire or on disable; no-silent-retry unchanged)
- [ ] 5.3 Two commits on `develop`, one per item (commit 1 = opt-in/persist, commit 2 = error clear). Do not squash. Co-Authored-By trailer
- [x] 5.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark the webcam-opt-in and camera-error-stuck rows done; note item 5 makes gesture control a persisted opt-in preference (default off; ADDED requirement) and item 6 clears the error on a successful re-acquire/disable (MODIFIED requirement). Note the remaining renderer rows (barge-in flush race, output-context leak, stale-closure comment) before Wave 2 (BUG I.2–I.5)
