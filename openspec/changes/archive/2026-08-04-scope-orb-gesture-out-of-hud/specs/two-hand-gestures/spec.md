## MODIFIED Requirements

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
