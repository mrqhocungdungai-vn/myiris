# two-hand-gestures

## ADDED Requirements

### Requirement: Two hands tracked with per-hand stabilization
The gesture engine SHALL track up to two hands simultaneously (`numHands: 2`), stabilize gesture classification per hand (per-hand candidate/stable maps), expose a `TrackedHand[]` state (id, smoothed point, mirrored landmarks, gesture flags), and select a primary hand (preferring the pointing hand, with anti-flicker continuity). The MediaPipe package version and WASM URL version SHALL remain equal (0.10.35).

#### Scenario: Both hands visible
- **WHEN** two hands are in the camera frame
- **THEN** the state lists two tracked hands with independent gesture classification, and one is designated primary

#### Scenario: Pin preserved
- **WHEN** dependencies are inspected
- **THEN** `@mediapipe/tasks-vision` and the WASM_URL version are both 0.10.35

### Requirement: Universal point-and-hold click
A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including PO question answer options, step-timeline toggles, chips, and close buttons.

#### Scenario: Dwell-click a button
- **WHEN** the user points at a PO question option button and holds for the dwell duration
- **THEN** that option is selected exactly as a mouse click would

#### Scenario: Dwell-open still works
- **WHEN** the user points at a task card and dwells
- **THEN** the reader opens for that task (existing behavior preserved)

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
