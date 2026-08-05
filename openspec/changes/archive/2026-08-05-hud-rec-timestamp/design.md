## Context

HUD mode's camera frame already carries three overlay elements — `.cam-status` (top-right), `.gesture-chip` (bottom-left), and the eye HUD's reticle + readout — over a 4:3 `.camera-frame`. This change adds a fourth: a wall-clock stamp in the top-left corner, and the control that toggles it.

Everything here is renderer-local. There is no main-process involvement, no IPC, and no persistence, which is what keeps this a small change rather than a new capability.

## Decisions

### D1. The button toggles a *display*, and must never read as a recorder

The user's framing is "a record button", and what makes this legible in a recording is a `RECORDING` line with a red dot — the visual vocabulary an audience already reads as "this is a recording, and it is timestamped". The risk is precisely that legibility: the same vocabulary asserts that something is being captured.

Nothing is. Iris writes no video file, opens no capture stream beyond the camera preview the gesture tracking already owns, and stores nothing. The recording is being done by an external screen-recorder.

So the control carries the REC look, and:

- Its tooltip states what it actually does — shows/hides the on-camera date and time — in those terms, not "start/stop recording".
- The spec forbids any presentation implying capture: no elapsed-recording counter, no file-size or duration readout, no "saved to…" affordance.
- It is **not persisted** (D3), so it cannot come back on after a restart asserting a recording that was never happening.

This is the one decision in the change with a consequence beyond layout, which is why it is stated as a requirement rather than left to the implementation's choice of tooltip.

### D2. Placement: stamp top-left in the frame, control beside the size control

The stamp goes in the top-left corner because the user asked for it there and because that corner is free: `.cam-status` occupies top-right, `.gesture-chip` bottom-left.

The **control** goes in the row above the frame, immediately beside the camera-size pill. A first attempt put it inside the frame's bottom-right corner — the last free corner — and that was wrong for a reason worth recording: the camera already *has* a control, and it lives outside the frame. A second control for the same object, placed somewhere else entirely, is not discoverable by anyone who has already learned where the first one is. The user looked beside the Cam pill, found nothing, and reported the feature as missing. Grouping is not a nicety here; it is the whole of whether the control is findable.

The row also keeps `.hud-left`'s 300px width regardless of the frame's size, so neither pill moves when the camera is enlarged.

The stamp itself carries both a `RECORDING` line and the clock, as one block. Two separate marks in two corners would read as two unrelated overlays; stacked, they read as one stamp on the footage — which is what a viewer of the recording needs to take from it.

The one neighbour worth checking rather than assuming: the eye HUD's readout panel hangs *upper-left* of its eye (`rise: -0.08`, `height: 0.52`), so its top edge lands near the stamp's baseline in a standard-size frame. They are checked together, at both camera sizes, as an explicit task.

### D3. Not persisted, unlike the camera-size control

The camera-size control persists in `localStorage` because size is a standing preference: the user picks the one that suits their desk and never thinks about it again. This is the opposite kind of state — it belongs to one recording session, and the next launch is a different session.

The deciding argument is D1's: a REC indicator restored from disk claims a recording is in progress before the user has done anything. "Off on every launch" is both the simpler implementation and the only defensible default.

### D4. A one-second interval, alive only while the overlay is

The stamp needs second resolution, so it re-renders once a second — via `setInterval`, not `requestAnimationFrame`. There is no reason to wake per frame for a value that changes at 1 Hz, and the HUD already runs a WebGL orb, hand tracking, and two MediaPipe inference loops against the same main thread (`main-thread-budget`).

The interval is created when the overlay turns on and cleared when it turns off, so the default state costs exactly nothing. A one-second tick is a rounding error against what the HUD already does per frame — the point of this decision is the *cleanup*, not the frequency.

### D4b. The stamp is sized for a viewer of the recording, not for the operator

The camera frame's existing overlays (`.cam-status`, `.gesture-chip`) are 8.5–9.5px and light-weight, because they are glanceable status for the person sitting at the machine. The first pass matched them, and it was wrong: this stamp's whole audience is *someone watching the video later*, possibly on a smaller window, after compression has eaten the thin strokes. It has to be bigger and bolder than the overlays it sits beside, and looking out of place next to them is the correct outcome rather than a defect.

It is also sized in **container units** (`cqw` against `.camera-frame`, which gains `container-type: inline-size`) rather than px. Px type is the exact problem the eye-HUD readout already documents as an open risk — a size tuned at the standard frame is wrong at the enlarged one. `cqw` removes the choice entirely: one declaration, correct at both sizes, and automatically correct if the camera ever gains a third.

The two-layer `text-shadow` is for the same reason. A single tight shadow reads well over a dark shirt and vanishes over a window behind the user's head; the wide second layer is what keeps it legible over a blown-out background.

### D5. The formatter is pure and lives in `src/lib`

`formatRecStamp(date)` takes a `Date` and returns the string; the component holds the interval and the state. This follows the same rule as `eye-hud.ts` and `hand.ts`: vitest's `unit` project runs under `node` with no DOM, so anything to be verified has to be reachable without rendering. A formatter is exactly the piece where an off-by-one (a 12/24-hour slip, a missing zero pad, midnight) is both plausible and invisible in a screenshot.

Format: `DD/MM/YYYY · HH:MM:SS`, 24-hour, zero-padded throughout. Day-first because that is how the user's own locale writes dates; 24-hour because it removes the AM/PM ambiguity a viewer would otherwise have to resolve from context. Zero-padded and set in tabular figures so the stamp's width never changes as the digits do — the same rule the eye readout follows, for the same reason: a timestamp whose layout twitches once a second is more distracting than no timestamp.

Deliberately **not** `toLocaleString`: its output varies with the host's locale and ICU version, which makes the stamp unpredictable across machines and the test assertion unwritable without pinning a locale.

## Risks / Trade-offs

- **[Risk] The REC label is read as "Iris is recording"**, and someone later builds an actual recorder behind it, or a user believes a file is being written. → Mitigation: D1 states the constraint as a spec requirement rather than a code comment, including the specific affordances forbidden (elapsed counter, file readout). A future change that adds real capture must state so in the spec and change the wording; it cannot arrive silently behind this control.
- **[Trade-off] The stamp shows the machine's local time, with no timezone shown.** A viewer in another timezone learns when the recording was made *for the user*, not in their own terms. Adding an offset (`+07:00`) costs width in a small frame; it is deliberately left out and is a one-line change if it turns out to matter.
- **[Risk] Collision with the eye readout panel at the frame's top-left.** → Mitigation: an explicit manual check at both camera sizes, with the eye HUD on, called out as its own task rather than folded into general verification.
