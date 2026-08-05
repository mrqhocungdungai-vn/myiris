## Purpose

A HUD mode in which the Iris window becomes a transparent, click-through desktop overlay — glass regions pass clicks through to the apps underneath while interactive HUD islands (orb cluster, tasks column, comms panel, camera dock) stay clickable — so the user can keep Iris visible and controllable while working in other applications.

## Requirements

### Requirement: HUD overlay mode with click-through glass
The app SHALL offer a HUD mode in which the window covers the desktop as a transparent overlay: all glass regions are pointer-transparent (clicks reach the apps underneath), while elements marked `.hud-hit` are interactive. The renderer SHALL report pointer presence over interactive elements via `hud:interactive`, and the main process SHALL toggle window click-through accordingly (`setIgnoreMouseEvents` with event forwarding).

#### Scenario: Working through the glass
- **WHEN** HUD mode is active and the pointer is over a glass (non-`.hud-hit`) region
- **THEN** clicks and typing reach the application underneath the overlay

#### Scenario: Interacting with a HUD island
- **WHEN** the pointer moves over a `.hud-hit` element (task card, toggle, orb controls)
- **THEN** the window becomes interactive and the element responds to click and gesture dwell-click normally

### Requirement: HUD layout and deck transitions
HUD mode SHALL present the upstream Glass HUD layout — orb cluster with mute/wake/sleep/exit controls, a collapsible tasks column, a comms panel, the camera dock with hand skeleton, and a drawing toggle that shows/hides the excalidraw drawing panel (see the `hud-drawing-canvas` capability) — and mode switches SHALL animate via the `hud:mode` event (deck-leaving / hud-entering transitions). The app SHALL always start in deck mode. The drawing panel SHALL be hidden by default so the enumerated controls above are what a freshly-entered HUD presents.

#### Scenario: Entering the HUD
- **WHEN** the user toggles HUD mode from the deck
- **THEN** the deck animates out, the overlay appears with orb/tasks/comms/camera and the drawing toggle (drawing panel hidden), and `hud:mode` reflects `hud`

#### Scenario: Exiting to deck for management actions
- **WHEN** the user activates the HUD's exit control
- **THEN** the app returns to deck mode where the pipeline bar, model choice, sessions, project folder, and setup remain available (these surfaces do not exist inside the HUD)

#### Scenario: Drawing toggle lives in the hover-revealed orb control cluster
- **WHEN** HUD mode is active and the user reveals the bottom-right orb control cluster (hover / focus)
- **THEN** a drawing toggle icon is present in that `.hud-controls` row alongside the mic/speaker/sleep/hand/exit controls, and activating it reveals the drawing panel while leaving the rest of the HUD layout intact
- **AND** while the cluster is at rest the drawing toggle is hidden like the other controls

### Requirement: Claude task parity inside the HUD
Task cards rendered in the HUD tasks column SHALL carry the same Claude-specific presentation as the deck Work Stream: verb badge, model, chain badge, live step timeline with toggle, and realtime updates from the existing sidecar events.

#### Scenario: A stateless run followed from the HUD
- **WHEN** a stateless run streams tool events while HUD mode is active
- **THEN** the HUD card shows the same step timeline and completion state the deck card would, without leaving HUD mode
