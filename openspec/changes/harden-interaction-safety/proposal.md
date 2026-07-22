## Why

Two renderer defects combine into one sharp hazard: a hands-free dwell-click can freeze the whole app, and it can fire an irreversible action by accident.

**Item 3 — `window.confirm` blocks the entire renderer main thread.** The DEV soft-gate confirmation (`src/App.tsx:503`) uses native `window.confirm(...)`. A synchronous modal dialog halts the renderer's event loop until dismissed: `requestAnimationFrame` stops, the orb freezes, the 24 kHz audio playback schedule stalls, and MediaPipe gesture tracking pauses. This is the one blocking dialog left in the renderer (verified: no other `window.confirm`/`alert`/`prompt`).

**Item 4 — dwell-click can activate destructive controls with no opt-out.** The universal point-and-hold loop (`src/App.tsx:812-833`) matches `button, a, [data-task-id], [role="button"]` and calls `.click()` after a 300 ms hover, with **no exclusion**. So a hand lingering over the "Remove token" button, "New session", or the project-folder switch fires an irreversible action the user never intended.

The two compound: a dwell-click on the role chip triggers the agent switch, which pops the blocking `window.confirm` — so a hovering hand can freeze audio and the orb. Fixing both closes the compound hazard: confirmations stop blocking the thread, and destructive controls stop being dwell-reachable.

Out of scope (their own later changes): the camera-lifecycle items (webcam should be opt-in and persisted; a transient camera error sticks forever), the audio-playback correctness bugs (barge-in flush race, output `AudioContext` never closed), and the `handleSidecarEvent` stale-closure comment.

## What Changes

Two commits, one per item (independent code, unified by "a gesture-driven interaction must never freeze the app or fire an irreversible action").

**Commit 1 — Item 3: non-blocking confirmation modal.**
- Replace `window.confirm(...)` in the DEV soft-gate path with a non-blocking in-app modal: a small `confirm` state `{ message, resolve }` rendered as an overlay with Confirm / Cancel buttons, plus an `askConfirm(message): Promise<boolean>` helper that sets the state and resolves the promise on the user's choice.
- The role-switch handler (already `async`) `await askConfirm(...)` in place of the synchronous call; Cancel aborts the switch exactly as `!ok` does today. The confirm/cancel **semantics** are preserved — only the blocking is removed. The orb and audio keep running while the dialog is open.

**Commit 2 — Item 4: dwell-exclude destructive controls (`data-no-dwell`).**
- In the dwell loop, treat an interactive element that is (or is contained within) a `[data-no-dwell]` element as **not** dwell-actionable: no `.click()`, and the dwell indicator does not engage on it. Such controls remain fully operable by mouse and by voice.
- Mark the destructive / irreversible controls with `data-no-dwell`: the "Remove token" button (`SetupPanel.tsx:333`), the "New session" control (`App.tsx` `onNewSession`/`createSession`), and the project-folder switch (which resets the session). Criterion: the action loses data or cannot be undone. Non-destructive controls (task cards, PO answer options, toggles, close buttons) keep dwelling exactly as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `main-thread-budget`: **one ADDED requirement** — the renderer SHALL NOT block its main thread on synchronous modal dialogs (`window.confirm`/`alert`/`prompt`); confirmations use a non-blocking in-app modal. This extends the capability's existing intent (keep the main thread free for the 60 fps render loop and the 24 kHz audio schedule) to cover blocking dialogs, which stall exactly those. ADDED, not MODIFIED — it is a new concern alongside the existing allocation / off-thread-audio requirements.
- `two-hand-gestures`: **one MODIFIED requirement** — "Universal point-and-hold click" currently says dwell triggers a click on **any** interactive element. The fix contradicts that literal "any" by carving out `[data-no-dwell]` destructive controls, so the requirement must be updated (not merely supplemented) to state the exclusion and why (a hovering hand must not fire an irreversible action; those controls stay mouse/voice-operable).

## Impact

- `src/App.tsx` — replace `window.confirm` with `await askConfirm(...)`; add `confirm` modal state + `askConfirm` helper + the overlay render; dwell loop (`~813`) skips `[data-no-dwell]`; tag "New session" and the project-folder control.
- `src/components/SetupPanel.tsx` — `data-no-dwell` on the "Remove token" button (and any other destructive control there).
- Possibly a small `ConfirmModal` component under `src/components/` (or inline overlay) + minimal CSS.
- `main-thread-budget` living spec — one ADDED requirement (no blocking dialogs).
- `two-hand-gestures` living spec — one MODIFIED requirement (dwell excludes `[data-no-dwell]`).
- No new dependency, no data migration, no IPC-surface change.
