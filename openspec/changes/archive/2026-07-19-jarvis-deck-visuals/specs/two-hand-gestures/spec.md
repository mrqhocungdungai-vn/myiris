## ADDED Requirements

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
