## Why

HUD mode is the surface that is on screen while the user screen-records or livestreams — that is already why it has a camera-size control. What a recording of it cannot show is **when it was recorded**. A viewer watching the video later has no way to date it, and the user has no way to prove when it was made without editing a timestamp in afterwards.

The camera frame is the natural place to put one: it is the part of the HUD an audience is already looking at, it is present in every recording of the app, and it is the one region whose contents are already understood as instrument overlay rather than interface.

## What Changes

- **A toggle beside the HUD's camera-size control** — `.hud-hit`, like every interactive HUD element — that turns a live date/time overlay on and off. Off by default. It sits next to the Cam pill because that is where the camera's controls already are; a second control for the same object, placed anywhere else, is not findable by someone who has learned the first.
- **While on, the camera frame shows a RECORDING marker and the current date and time in its top-left corner**, updating every second, so any recording of the HUD is visibly marked as one and carries the wall-clock time it was made.
- **The marker uses recording-light vocabulary** (a pulsing red dot, the way a camera's own light reads to an audience), because that is what makes it legible in a video. **It does not capture, record, or save anything** — Iris's recording is done by whatever screen-recorder the user is already running. Its tooltip says so plainly, and the spec forbids any presentation that implies the app is capturing video.
- **HUD mode only.** The deck's camera dock has no such control, on the same terms as the camera-size control: the deck is not the surface anyone records.
- **Not persisted.** It starts off on every launch. A "REC" indicator that survived a restart would assert something about a recording that is not happening, which is exactly the misreading the point above exists to prevent.

## Impact

- Affected specs: `glass-hud-mode` (one ADDED requirement)
- Affected code: `src/components/HudShell.tsx` (the control and the overlay, inside `HudCamera`), `src/lib/rec-clock.ts` (new — the pure formatter), `src/styles/hud.css`
- No new dependency, no main-process change, no IPC. The clock is `Date` read on a one-second interval that exists only while the overlay is on.
- The timestamp occupies the camera frame's top-left corner, which is currently free — `.cam-status` is top-right and `.gesture-chip` is bottom-left. The eye HUD's readout panel is the one neighbour close to it (it hangs upper-left of its eye), so the two are checked together rather than assumed independent.
