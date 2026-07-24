## MODIFIED Requirements

### Requirement: Toggleable excalidraw drawing panel in Glass HUD

The app SHALL render an excalidraw-based drawing **panel**, available **only in Glass HUD mode**, controlled by a visibility toggle. The toggle SHALL be an icon button in the **bottom-right orb control cluster** (the `.hud-controls` row alongside the mic/speaker/sleep/hand/exit controls), which is hover-revealed and hidden during normal use — so the drawing affordance never clutters the resting HUD. The panel SHALL be a **bounded region** (not a full-screen overlay) so glass outside it remains click-through. The panel SHALL be **hidden by default**. When hidden, the HUD's click-through behavior SHALL be unchanged. In deck mode the drawing panel SHALL NOT be present.

The drawing panel is one of a set of **mutually-exclusive HUD layers**: at most one such layer (the drawing panel, or the second-brain galaxy view) SHALL be active at a time. Activating another exclusive HUD layer SHALL deactivate the drawing panel (its scene is persisted as on any deactivation), and activating the drawing panel SHALL deactivate any other exclusive HUD layer — so two heavy interactive layers are never active together.

#### Scenario: Activate the drawing panel in HUD

- **WHEN** the user activates the drawing toggle while in Glass HUD mode
- **THEN** the excalidraw panel appears as an interactive drawing surface within its bounded region
- **AND** glass outside the panel remains click-through to the apps underneath

#### Scenario: Deactivate returns to a clean overlay

- **WHEN** the user deactivates the drawing toggle
- **THEN** the panel is hidden and the HUD returns to its normal click-through overlay behavior

#### Scenario: Not present in deck mode

- **WHEN** the app is in deck mode
- **THEN** no drawing panel or drawing toggle is shown

#### Scenario: Opening the galaxy closes the drawing panel

- **WHEN** the drawing panel is active and the user activates the second-brain galaxy view
- **THEN** the drawing panel is deactivated (its scene persisted) and the galaxy becomes the single active HUD layer
- **AND** activating the drawing panel again while the galaxy is open deactivates the galaxy
