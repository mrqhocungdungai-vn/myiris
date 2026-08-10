## MODIFIED Requirements

### Requirement: A locked note is visibly marked

A locked note SHALL carry a mark distinct from every other ring, shown whether or not a camera drive is live, and it SHALL be chromatic where the other marks are achromatic.

The lock is the basis every hand gesture is addressed to: what a fist turns around, what a zoom flies toward, and whether most of the language does anything at all. A user who cannot see whether they hold one cannot tell why the same gesture acts or does nothing, and that ambiguity is indistinguishable from the drives behaving arbitrarily.

The mark SHALL NOT outlive the lock: whatever clears the lock SHALL clear the mark.

**A lock SHALL outrank the zoom.** Backing the camera out SHALL NOT release a lock; the return-to-overview release SHALL apply only while nothing is locked. A zoom that could delete the lock would make the most ordinary navigation gesture destroy the user's choice without being about it, and would leave the drive that is supposed to honour that choice with nothing to honour. The locked note SHALL be changed by aiming at another one.

**A newly locked note SHALL be brought to the centre of the view**, eased rather than snapped, and SHALL NOT be moved this way while a camera drive is engaged — the drive owns the aim, and a second writer would fight it. A lock the user is not looking at is a poor pivot: every drive works around it, and motion around a point in the corner of the view is hard to steer.

Without a lock, the only gestures that SHALL move the camera are the two-palm zoom on the centre of the view.

Aiming SHALL remain available without a lock, because gating it is circular: aiming is the only thing that creates a lock, so requiring one in order to aim means none can ever exist.

The dwell and the `Victory` reveal SHALL remain available without a lock for a different and unrelated reason: they do not move the camera. Each acts on the note it is pointed at, so neither needs a basis to act *around*, and the defect the lock requirement exists to prevent — a drive turning or flying around a pivot the user never chose — cannot arise for a gesture that names its own subject by pointing at it. These two exemptions SHALL NOT be justified by one another.

The reveal SHALL take a single `Victory` hand. A second adds nothing to it, and nothing SHALL require one.

#### Scenario: Locking a note shows it

- **WHEN** the user aims an open palm at a note until it locks
- **THEN** that note is marked, and the mark stays while they change pose

#### Scenario: Backing out to the overview clears the mark

- **WHEN** the user zooms far enough out that the lock is released
- **THEN** the mark goes with it

#### Scenario: A note can be opened with nothing locked

- **WHEN** no note is locked and the user holds `Pointing_Up` on a node until the dwell completes
- **THEN** the note opens, because opening acts on the node pointed at and moves no camera

#### Scenario: One Victory hand reveals

- **WHEN** the user makes a single `Victory` hand over a node
- **THEN** its link cluster is revealed, with no second hand required

#### Scenario: Zooming out keeps the lock

- **WHEN** a note is locked and the user spreads two open palms until the camera frames the whole graph
- **THEN** the note stays locked, keeps its mark, and remains what the zoom travels toward

#### Scenario: Locking brings the note to the centre

- **WHEN** the user locks a note sitting off to one side, with no camera drive engaged
- **THEN** the view glides until that note is at the centre
