## MODIFIED Requirements

### Requirement: HUD layout and deck transitions
HUD mode SHALL present the upstream Glass HUD layout — orb cluster with mute/wake/sleep/exit controls, a collapsible tasks column, a comms panel, the camera dock with hand skeleton, and a drawing toggle that shows/hides the excalidraw drawing panel (see the `hud-drawing-canvas` capability) — and mode switches SHALL animate via the `hud:mode` event (deck-leaving / hud-entering transitions). The app SHALL always start in deck mode. The drawing panel SHALL be hidden by default so the enumerated controls above are what a freshly-entered HUD presents.

#### Scenario: Entering the HUD
- **WHEN** the user toggles HUD mode from the deck
- **THEN** the deck animates out, the overlay appears with orb/tasks/comms/camera and the drawing toggle (drawing panel hidden), and `hud:mode` reflects `hud`

#### Scenario: Exiting to deck for management actions
- **WHEN** the user activates the HUD's exit control
- **THEN** the app returns to deck mode where pipeline roles, model choice, sessions, project folder, and setup remain available (these surfaces do not exist inside the HUD)

#### Scenario: Drawing toggle lives in the hover-revealed orb control cluster
- **WHEN** HUD mode is active and the user reveals the bottom-right orb control cluster (hover / focus)
- **THEN** a drawing toggle icon is present in that `.hud-controls` row alongside the mic/speaker/sleep/hand/exit controls, and activating it reveals the drawing panel while leaving the rest of the HUD layout intact
- **AND** while the cluster is at rest the drawing toggle is hidden like the other controls
