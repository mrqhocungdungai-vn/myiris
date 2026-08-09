## Why

Iris already produces a running account of what she is doing. The main process
emits `{ type: "log", level, message }` from the run executor, the run hooks
(including every time the destructive-command guard refuses something), the live
session, the run stream, hotkey registration and the pipeline installer; the
renderer adds its own through `pushLog` — session switches, model changes, a PO
question that went unanswered, a parked brief that was never sent.

**All of it is thrown away.** `src/App.tsx:169` reads

```ts
const [, setLogs] = useState<LogLine[]>([]);
```

— written on every event, read by nobody. The array is built, sliced to eighty,
and discarded, and the codebase already knows: a comment at `App.tsx:1184`
routes a refusal to a visible notice instead "because the log list is discarded
(see setLogs above) — and an invisible refusal is indistinguishable from Iris
quietly doing the work anyway."

That sentence is the argument for this change, generalized. Every one of those
lines is the app telling the user something about itself, and right now the only
ones that survive are the handful important enough to have earned their own
banner. Between them, Iris works in complete silence.

The camera frame is where that account belongs. It is already the surface that
shows the machine looking back — the tracking overlays, the readout reporting
the host — and a live scroll of what the app is actually doing completes it.
A HUD that reports the hardware but not the software is half an instrument.

## What Changes

**The camera preview gains an activity strip: the five most recent log lines,
newest at the bottom.** Nothing new is logged and nothing new is measured — the
stream already exists, and this change is mostly the deletion of the discard.

**How much of it shows depends on how the app was started.** A development run
shows everything down to routine progress; a production run shows only what
warrants attention. The threshold is a property of the build, not a preference
and not a control — the same event stream, read at two different depths.

**The strip occupies a fixed band at the bottom of the frame and never grows.**
Five lines, each truncated to one line, whether there are five lines to show or
none. A strip that resizes with its content would move everything above it, and
the gesture chip sits directly above it.

**It never obscures the eye overlays.** The tracking ring and the readout panel
paint over it, deliberately: this capability's job is to fill the bottom band,
not to compete for it. The readout panel's own placement rule already allows it
to reach the bottom of the frame when the tracked face is low, and that rule is
not being re-opened for this.

**The gesture chip moves up to sit above the strip**, keeping its bottom-left
corner and everything about how it reads.

Explicitly **not** in this change:

- *New logging.* No new emission points, no new `debug` level, nothing added to
  the main process's event vocabulary. If the development view turns out to be
  too quiet, that is the next change and it is a different one.
- *Capturing the renderer's console.* It would make a development run noisier,
  but almost all of that noise belongs to third-party libraries rather than to
  Iris, and a strip reporting the app's own work should not be padded with a
  bundler's chatter.
- *Interaction.* Nothing here is clickable, scrollable, dwellable, or
  dismissible. It is a readout.
- *Retention.* Nothing is written to disk and nothing survives a restart. The
  existing in-memory cap is the whole of the retention story.
- *A control for the threshold.* The mode decides it. A control would make it a
  preference, which invites persisting it, which makes the production build's
  quietness something a user can accidentally lose.

## Capabilities

### New Capabilities

- `camera-activity-log`: the app's own log, surfaced in the camera preview as a
  fixed band of recent lines, at a depth the build mode decides.

Its own capability rather than a requirement inside `eye-tracking-hud`: that
capability is about tracking a face and drawing instruments on the eyes, and it
already states that its overlays "SHALL NOT be specialized per surface" and are
positioned entirely from eye geometry. A strip pinned to the frame regardless of
whether a face is present has none of that in common with it beyond sharing a
parent element.

### Modified Capabilities

None. `eye-tracking-hud` needs no delta: the stacking rule below is stated from
this capability's side ("the strip yields"), so nothing about the eye overlays
changes, and the readout's placement and clipping rules are untouched.

## Impact

- `src/lib/activity-log.ts` + `src/lib/activity-log.test.ts` — **new.** Level
  ranking, the mode threshold, and the pure selector that turns the store into
  the lines to draw. In the style of `src/lib/eye-hud.ts` and
  `src/lib/telemetry-format.ts`: no DOM, so the rule that decides what a
  production build hides is testable rather than inspectable.
- `src/components/CameraLog.tsx` — **new.** The strip.
- `src/App.tsx` — one line: start reading the state it already writes. The
  comment at 1184 explaining why a refusal could not be a log line is now false
  and goes with it.
- `src/components/CameraDock.tsx`, `src/components/HudShell.tsx` — one prop
  each, on the path the eye props already take.
- `src/styles/deck.css` — the strip, and the gesture chip's new offset.
- `docs/ARCHITECTURE.md` — the camera frame's contents.
- No main-process change at all. No new IPC channel, no new event type, no new
  dependency, nothing on disk.
