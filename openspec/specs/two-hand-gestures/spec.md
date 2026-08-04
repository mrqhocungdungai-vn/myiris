## Purpose

TBD — two-hand tracking, dwell-click, two-palm reader resize, and per-hand reticles/skeleton for the gesture-driven UI.
## Requirements
### Requirement: Two hands tracked with per-hand stabilization

The gesture engine SHALL track up to two hands simultaneously (`numHands: 2`), stabilize gesture classification per hand (per-hand candidate/stable maps), expose a `TrackedHand[]` state (id, smoothed point, mirrored landmarks, gesture flags), and select a primary hand (preferring the pointing hand, with anti-flicker continuity). The MediaPipe package version and WASM URL version SHALL remain equal (0.10.35).

#### Scenario: Both hands visible

- **WHEN** two hands are in the camera frame
- **THEN** the state lists two tracked hands with independent gesture classification, and one is designated primary

#### Scenario: Pin preserved

- **WHEN** dependencies are inspected
- **THEN** `@mediapipe/tasks-vision` and the WASM_URL version are both 0.10.35

### Requirement: Gesture control is an opt-in, persisted preference

Gesture (hand/camera) control SHALL be an opt-in preference that is persisted across sessions, defaulting to **off**. The gesture engine SHALL acquire the camera and load its MediaPipe assets only while the preference is enabled; launching or connecting Iris SHALL NOT turn on the webcam or load those assets by default. Toggling the preference SHALL persist the new value (like the sound and camera-device preferences), so enabling it once carries to the next session, and disabling it releases the camera.

#### Scenario: Camera stays off at launch by default

- **WHEN** Iris connects and the user has never enabled gesture control
- **THEN** the webcam is not acquired and MediaPipe assets are not loaded — the camera LED stays off

#### Scenario: The preference persists across sessions

- **WHEN** the user enables gesture control and later relaunches Iris
- **THEN** gesture control is enabled again on the next session without re-toggling, and disabling it likewise persists as off

### Requirement: Device-selectable camera acquisition

The gesture engine's camera acquisition SHALL accept a selected video input device identifier (a `deviceId`, or a `"System Default"` sentinel) and use it to constrain `getUserMedia`: the System Default sentinel SHALL preserve the unconstrained `facingMode: "user"` behavior, while an explicit `deviceId` SHALL be requested via an exact `deviceId` constraint with no `facingMode` constraint applied. A change to the selected device SHALL be treated as a reason to re-acquire the camera stream — tearing down the previous stream, recognizer, and tracking loop before acquiring the new one — including while gesture control is already enabled and running.

If the selected device cannot be opened (not present among current devices, or `getUserMedia` rejects), the engine SHALL surface that failure through its existing error-reporting path and SHALL NOT silently retry with a different device or with the system default; gesture control remains unavailable until the failure is resolved (e.g. the user starts the missing device or selects a different one). When a subsequent acquire succeeds — or when gesture control is disabled — the engine SHALL clear the previously reported error, so a transient failure does not remain displayed after it has been resolved.

#### Scenario: System Default preserves prior behavior

- **WHEN** the selected device is System Default (or no selection has ever been made)
- **THEN** the camera is acquired exactly as before this change, with no `deviceId` constraint

#### Scenario: Explicit device selected

- **WHEN** a specific `deviceId` is selected
- **THEN** `getUserMedia` is called with that `deviceId` as an exact constraint and no `facingMode` constraint

#### Scenario: Device changes while gesture control is running

- **WHEN** gesture control is active and the selected device changes
- **THEN** the previous stream, recognizer, and tracking loop are torn down and a new stream is acquired from the newly selected device, without requiring the user to toggle gesture control off and on

#### Scenario: Selected device unavailable

- **WHEN** the selected device cannot be opened (missing or rejected by `getUserMedia`)
- **THEN** the failure is reported through the existing hand-control error path and gesture control does not silently start using a different camera

#### Scenario: Error clears when a re-acquire succeeds

- **WHEN** a camera failure has been reported and a later acquire succeeds (the user fixed the device or selected a different one), or gesture control is disabled
- **THEN** the previously reported error is cleared and no longer displayed

### Requirement: Universal point-and-hold click

A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including PO question answer options, step-timeline toggles, chips, and close buttons — EXCEPT elements explicitly marked as dwell-excluded (`[data-no-dwell]`, or any element contained within one), and EXCEPT while a reader overlay or a fullscreen HUD layer (the second-brain galaxy or the drawing panel) owns the gesture surface, since those layers bind the pointing hand to their own semantics. Dwell exclusion SHALL be reserved for destructive or irreversible controls — those whose action loses data or cannot be undone (e.g. removing the saved subscription token, starting a new session, switching the project folder) — so that a merely hovering hand cannot fire them. Excluded controls SHALL remain fully operable by mouse and by voice; only the hands-free dwell path skips them, and the dwell indicator SHALL NOT engage on them. The HUD's own control island (the button row that hosts the layer toggles) SHALL remain dwell-activatable even while a fullscreen layer is active, so any layer the user can open hands-free can also be closed hands-free.

#### Scenario: Dwell-click a button

- **WHEN** the user points at a PO question option button and holds for the dwell duration
- **THEN** that option is selected exactly as a mouse click would

#### Scenario: Dwell-open still works

- **WHEN** the user points at a task card and dwells
- **THEN** the reader opens for that task (existing behavior preserved)

#### Scenario: Dwell over a destructive control does nothing

- **WHEN** the user's hand dwells over a control marked `[data-no-dwell]` (e.g. "Remove token", "New session")
- **THEN** no click is triggered and the dwell indicator does not engage on it
- **AND** the same control is still activatable by a mouse click or by voice

#### Scenario: DOM dwell is suppressed under a fullscreen layer

- **WHEN** the second-brain galaxy or the drawing panel is active
- **THEN** the DOM point-and-hold click does not fire on elements beneath that layer — the layer's own gesture bindings own the pointing hand

#### Scenario: The HUD control island stays dwell-reachable under a fullscreen layer

- **WHEN** a fullscreen HUD layer (the galaxy or the drawing panel) is active and the user dwells over the HUD control island's toggle for that layer
- **THEN** the toggle still activates, so the layer can be closed hands-free without reaching for the mouse or Esc

### Requirement: Two-palm reader resize

When a reader overlay is open — the task run-reader or the vault note reader, which share the same reader core — two simultaneously open palms SHALL scale (and reposition per upstream behavior) the reader; a fist SHALL still close it; open-palm hold-to-scroll SHALL keep working on the reader body. Panel hold-to-scroll SHALL NOT engage while a reader overlay or a fullscreen HUD layer (the galaxy or the drawing panel) is active, since those layers own the gesture surface. The reader's per-frame gesture work SHALL only run while the hand-control preference is enabled.

#### Scenario: Resize with two palms

- **WHEN** the reader is open and both hands show open palms
- **THEN** moving the hands apart/together scales the reader and the action indicator reports the resize mode

#### Scenario: Both readers respond to the same bindings

- **WHEN** the open reader is the vault note reader (rather than the task run-reader)
- **THEN** fist-close, two-palm resize, and open-palm scroll behave identically — the bindings belong to the shared reader core, not to one reader

#### Scenario: Panel scroll is suppressed under a fullscreen layer

- **WHEN** the galaxy or the drawing panel is active
- **THEN** open-palm hold-to-scroll does not scroll the deck panels beneath it

### Requirement: Per-hand reticles and hand skeleton

The UI SHALL render one reticle per tracked hand (secondary hand visually distinct) via a `HandReticles` component, and the camera dock SHALL render a 21-landmark hand skeleton for each tracked hand.

#### Scenario: Reticles follow hands

- **WHEN** two hands are tracked
- **THEN** two reticles render at their smoothed screen positions and the camera dock shows both skeletons

### Requirement: Fist rotates and pinch scales the orb

When hand control is enabled, the UI is in deck mode, the reader overlay is closed, and no fullscreen HUD layer (the second-brain galaxy or the drawing panel) is active, the primary hand showing `Closed_Fist` SHALL incrementally rotate the Arc Reactor orb by the hand's movement delta, and either tracked hand's thumb-tip-to-index-tip pinch distance SHALL scale the orb within a clamped range. These bindings SHALL NOT engage while the reader overlay is open, so they never collide with the existing reader-open `Closed_Fist`-closes-reader or two-palm-resize bindings; and they SHALL NOT engage while the galaxy or the drawing panel owns the HUD surface, so a fist meant to orbit the galaxy camera never also rotates the orb underneath it. They SHALL NOT engage while the Glass HUD overlay is active at all — in HUD the orb is a small floating puck over the user's desktop rather than the stage, so the gesture surface belongs to the content the overlay hosts (the transcript, the work stream, and whatever layer is open), and a fist or pinch made anywhere over the HUD SHALL leave the orb untouched even when no fullscreen layer is open. The orb component's rotation and scale inputs SHALL remain part of its prop surface and SHALL keep being applied whenever they are driven — only the deck's driver is scoped, not the orb's ability to rotate or scale. The gesture action indicator SHALL report the binding that is actually live for the current context, never a binding that the active layer or the current UI mode has taken over.

#### Scenario: Fist rotates the orb

- **WHEN** hand control is enabled, the UI is in deck mode, the reader is closed, no fullscreen HUD layer is active, and the primary hand shows `Closed_Fist` while moving
- **THEN** the orb's rotation follows the hand's movement delta

#### Scenario: Pinch scales the orb

- **WHEN** hand control is enabled, the UI is in deck mode, the reader is closed, no fullscreen HUD layer is active, and a tracked hand's thumb-index pinch distance changes
- **THEN** the orb's scale follows the pinch distance, clamped to a reasonable range

#### Scenario: Reader-open gestures unaffected

- **WHEN** the reader overlay is open
- **THEN** `Closed_Fist` still closes the reader and two open palms still resize it exactly as before, with no orb rotation or scale applied

#### Scenario: Galaxy-active gestures do not touch the orb

- **WHEN** the second-brain galaxy (or the drawing panel) is active
- **THEN** a `Closed_Fist` or pinch drives that layer's own camera/tools and does NOT rotate or scale the orb behind it

#### Scenario: The Glass HUD never rotates or scales the orb

- **WHEN** the Glass HUD overlay is active, hand control is enabled, no reader and no fullscreen layer is open, and the user makes a `Closed_Fist` while moving or changes their pinch distance
- **THEN** the HUD orb's rotation and scale are unchanged, and the hand's motion is free to serve the HUD's content bindings instead

#### Scenario: Entering the HUD mid-gesture leaves the orb where it was

- **WHEN** the user is rotating or scaling the orb on the deck and the UI switches to the Glass HUD while the gesture is still held
- **THEN** the binding disengages, the orb stops following the hand, and its rotation and scale hold at their last deck values rather than snapping

#### Scenario: Returning to the deck restores the binding

- **WHEN** the UI leaves the Glass HUD back to deck mode with hand control enabled, the reader closed and no fullscreen layer active
- **THEN** a `Closed_Fist` rotates the orb again, and the first frame after re-engaging seeds its movement reference without applying rotation, so the orb's rotation does not jump — scale, being an absolute mapping of the current pinch distance rather than a delta, resumes tracking the hand's present pinch as it already does after any other disengagement

#### Scenario: The action indicator names the live binding

- **WHEN** the galaxy is active and the user makes a fist (which orbits the galaxy camera)
- **THEN** the gesture action indicator reports the orbit binding, not "idle" and not "rotate orb"

#### Scenario: The action indicator does not name orb rotation in the HUD

- **WHEN** the Glass HUD is active with no reader and no fullscreen layer open, and the user makes a `Closed_Fist`
- **THEN** the gesture action indicator does not report an orb rotate binding, because that binding cannot fire in this context

