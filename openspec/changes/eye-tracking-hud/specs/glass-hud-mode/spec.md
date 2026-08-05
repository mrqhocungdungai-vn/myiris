## MODIFIED Requirements

### Requirement: HUD layout and deck transitions

HUD mode SHALL present the upstream Glass HUD layout — orb cluster with mute/wake/sleep/exit controls, a collapsible tasks column, a comms panel, the camera dock with hand skeleton and the decorative eye overlays (see the `eye-tracking-hud` capability), a camera-size control beside that dock, and a drawing toggle that shows/hides the excalidraw drawing panel (see the `hud-drawing-canvas` capability) — and mode switches SHALL animate via the `hud:mode` event (deck-leaving / hud-entering transitions). The app SHALL always start in deck mode. The drawing panel SHALL be hidden by default so the enumerated controls above are what a freshly-entered HUD presents.

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

#### Scenario: The HUD camera carries the same overlays as the deck's

- **WHEN** HUD mode is active with gesture control on and a face in frame
- **THEN** the HUD's camera dock shows the hand skeleton and the eye overlays, behaving identically to the deck's camera dock

## ADDED Requirements

### Requirement: The HUD camera frame has a user-controlled size that is remembered

HUD mode SHALL offer a control that switches its camera frame between two sizes: its standard size and an enlarged size roughly a third larger. The control SHALL be part of the HUD's own furniture, adjacent to the camera dock, and SHALL be marked as an interactive HUD element so it remains clickable while the surrounding glass stays click-through.

Two sizes exist because HUD mode serves two conflicting purposes: it is the surface on screen while livestreaming, where a larger face reads better to an audience, and it is also the working overlay kept up while using other applications, where a large camera consumes room other content needs. Neither size is correct for both, so this SHALL be a control rather than a fixed size.

The standard size SHALL be the default, so a user who never operates the control sees the HUD unchanged. The chosen size SHALL persist across app restarts. A stored value that is absent or unreadable SHALL resolve to the standard size — the failure mode SHALL be reverting to standard, never remaining stuck at the enlarged size with no way back.

Enlarging the camera SHALL NOT change the size of any neighbouring HUD element, and SHALL NOT affect the deck's camera dock, which has no such control.

Changing the size SHALL NOT disturb the camera preview's tracking overlays: they SHALL rescale with the frame and continue tracking throughout, without reinitializing.

#### Scenario: A freshly installed HUD is at the standard size

- **WHEN** HUD mode is entered with no previously stored camera-size choice
- **THEN** the camera dock is at its standard size, and the control offers to enlarge it

#### Scenario: Enlarging for a livestream

- **WHEN** the user activates the camera-size control from the standard size
- **THEN** the camera frame becomes roughly a third larger, showing the user's face correspondingly larger, and the control now offers to return to the standard size

#### Scenario: Shrinking back to reclaim working space

- **WHEN** the camera is enlarged and the user activates the control again
- **THEN** the frame returns to exactly its standard size

#### Scenario: The choice survives a restart

- **WHEN** the user enlarges the camera, quits the app, and reopens it in HUD mode
- **THEN** the camera is still enlarged, without the user setting it again

#### Scenario: An unreadable stored choice reverts to standard

- **WHEN** the stored camera-size choice is missing or cannot be interpreted
- **THEN** HUD mode presents the standard size rather than failing or remaining enlarged

#### Scenario: Neighbouring HUD elements keep their size

- **WHEN** the camera frame is enlarged
- **THEN** the comms panel and every other HUD element are unchanged in size and position, and the deck's camera dock is unaffected

#### Scenario: The control is clickable through the glass

- **WHEN** the pointer moves over the camera-size control while HUD mode is click-through
- **THEN** the window becomes interactive and the control responds, on the same terms as every other interactive HUD element

#### Scenario: Overlays follow the resize

- **WHEN** the camera size changes while a face is being tracked
- **THEN** the camera preview's overlays rescale with the frame and keep tracking without interruption or reinitialization
