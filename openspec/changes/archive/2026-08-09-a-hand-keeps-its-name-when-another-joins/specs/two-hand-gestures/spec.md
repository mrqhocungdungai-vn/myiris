## ADDED Requirements

### Requirement: A hand keeps its identity when another hand joins

Per-hand state — smoothing history and the consecutive-frame gesture stabilizer — SHALL be keyed by an identity that follows the physical hand. That identity SHALL NOT depend on **how many hands are in frame**, so that raising or lowering a second hand does not rename the first.

Where the model reports handedness, that SHALL be the identity. Where it does not, the fallback SHALL still be count-independent.

Per-hand state SHALL be discarded when the hand is no longer in frame, so a hand that leaves, moves, and returns is treated as one that appeared rather than resuming a position it has since left. A stale smoothed point is not merely inaccurate: it is the value a camera drive seeds its reference from, so it starts the drive both displaced and mis-scaled.

#### Scenario: Raising a second hand does not disturb the first

- **WHEN** one hand is tracked and a second enters the frame
- **THEN** the first hand's smoothed position and stabilized pose continue uninterrupted

#### Scenario: A hand that returns does not resume a stale position

- **WHEN** a hand leaves the frame, moves elsewhere, and returns
- **THEN** its smoothing starts from where it now is

#### Scenario: Two hands never share one memory

- **WHEN** two hands are tracked at once
- **THEN** each has its own smoothing history and its own gesture stabilization
