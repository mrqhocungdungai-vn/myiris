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

### Requirement: Device-selectable camera acquisition

The gesture engine's camera acquisition SHALL accept a selected video input device identifier (a `deviceId`, or a `"System Default"` sentinel) and use it to constrain `getUserMedia`: the System Default sentinel SHALL preserve the unconstrained `facingMode: "user"` behavior, while an explicit `deviceId` SHALL be requested via an exact `deviceId` constraint with no `facingMode` constraint applied. A change to the selected device SHALL be treated as a reason to re-acquire the camera stream — tearing down the previous stream, recognizer, and tracking loop before acquiring the new one — including while gesture control is already enabled and running.

If the selected device cannot be opened (not present among current devices, or `getUserMedia` rejects), the engine SHALL surface that failure through its existing error-reporting path and SHALL NOT silently retry with a different device or with the system default; gesture control remains unavailable until the failure is resolved (e.g. the user starts the missing device or selects a different one).

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

### Requirement: Universal point-and-hold click

A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including PO question answer options, step-timeline toggles, chips, and close buttons — EXCEPT elements explicitly marked as dwell-excluded (`[data-no-dwell]`, or any element contained within one). Dwell exclusion SHALL be reserved for destructive or irreversible controls — those whose action loses data or cannot be undone (e.g. removing the saved subscription token, starting a new session, switching the project folder) — so that a merely hovering hand cannot fire them. Excluded controls SHALL remain fully operable by mouse and by voice; only the hands-free dwell path skips them, and the dwell indicator SHALL NOT engage on them.

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

### Requirement: Two-palm reader resize

When the reader overlay is open, two simultaneously open palms SHALL scale (and reposition per upstream behavior) the reader; a fist SHALL still close it; open-palm hold-to-scroll SHALL keep working on the scrollable panels.

#### Scenario: Resize with two palms

- **WHEN** the reader is open and both hands show open palms
- **THEN** moving the hands apart/together scales the reader and the action indicator reports the resize mode

### Requirement: Per-hand reticles and hand skeleton

The UI SHALL render one reticle per tracked hand (secondary hand visually distinct) via a `HandReticles` component, and the camera dock SHALL render a 21-landmark hand skeleton for each tracked hand.

#### Scenario: Reticles follow hands

- **WHEN** two hands are tracked
- **THEN** two reticles render at their smoothed screen positions and the camera dock shows both skeletons

### Requirement: Fist rotates and pinch scales the orb

When hand control is enabled and the reader overlay is closed, the primary hand showing `Closed_Fist` SHALL incrementally rotate the Arc Reactor orb by the hand's movement delta, and either tracked hand's thumb-tip-to-index-tip pinch distance SHALL scale the orb within a clamped range. These bindings SHALL NOT engage while the reader overlay is open, so they never collide with the existing reader-open `Closed_Fist`-closes-reader or two-palm-resize bindings.

#### Scenario: Fist rotates the orb

- **WHEN** hand control is enabled, the reader is closed, and the primary hand shows `Closed_Fist` while moving
- **THEN** the orb's rotation follows the hand's movement delta

#### Scenario: Pinch scales the orb

- **WHEN** hand control is enabled, the reader is closed, and a tracked hand's thumb-index pinch distance changes
- **THEN** the orb's scale follows the pinch distance, clamped to a reasonable range

#### Scenario: Reader-open gestures unaffected

- **WHEN** the reader overlay is open
- **THEN** `Closed_Fist` still closes the reader and two open palms still resize it exactly as before, with no orb rotation or scale applied
