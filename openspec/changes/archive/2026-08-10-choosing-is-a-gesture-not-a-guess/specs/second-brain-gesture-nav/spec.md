## MODIFIED Requirements

### Requirement: A locked note is visibly marked

A locked note SHALL carry a mark distinct from every other ring, shown whether or not a camera drive is live, and it SHALL be chromatic where the other marks are achromatic.

The lock is the basis every hand gesture is addressed to: what a fist turns around, what a zoom flies toward, and whether most of the language does anything at all. A user who cannot see whether they hold one cannot tell why the same gesture acts or does nothing, and that ambiguity is indistinguishable from the drives behaving arbitrarily.

The mark SHALL NOT outlive the lock: whatever clears the lock SHALL clear the mark.

**A lock SHALL outrank the zoom.** Backing the camera out SHALL NOT release a lock; the return-to-overview release SHALL apply only while nothing is locked. A zoom that could delete the lock would make the most ordinary navigation gesture destroy the user's choice without being about it, and would leave the drive that is supposed to honour that choice with nothing to honour. The locked note SHALL be changed by aiming at another one.

The rule is stated in terms of the HAND because the hand is the only thing that is the user's. Bringing a locked note to the centre slides the world under a sight that has not moved, so a note nobody aimed at arrives beneath it — and taking it re-centres, sliding the world again. Naming the camera motions one at a time would leave the next one uncovered; requiring the user's own movement covers all of them, including ones not yet designed.

Screen separation is the measure because it is the question itself: a user cannot be aiming at a particular note when they cannot resolve one from its neighbours, and the sight sweeping across a dozen of them is not a dozen choices. It also scales itself — the same two notes are tens of pixels apart from across the vault and hundreds apart from among them — so approaching a cluster is what makes its notes choosable, and nothing needs to say so.

A note plainly elsewhere on screen SHALL still be taken at once.

Without a lock, the only gestures that SHALL move the camera are the two-palm zoom on the centre of the view.

**Choosing SHALL be a gesture of its own — `Thumb_Up` — and never inferred.** While it is held the user is choosing; while it is not, they are not. The sight and the candidate mark SHALL appear only with it, so nothing on screen claims a choice is being made when none is.

Nothing SHALL infer intent from how the hand moved: no floor on how far a note must be from the current target on screen, no floor on how far the hand must travel, and no moving of the camera to steady the view for aiming. Those rules existed because a raised open palm could not be told apart from a deliberate one, and each was added to survive the last — together they made a deliberate reselection fail for reasons the user could not see. A declared pose removes the question rather than answering it better.

A single open palm SHALL therefore mean nothing at all: a hand that is merely raised is not a statement.

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

#### Scenario: A crowded neighbour cannot steal the target from far away

- **WHEN** the camera is outside a dense cluster and the sight passes over a note close on screen to the current target
- **THEN** the target does not change

#### Scenario: The same neighbour is choosable from among the cluster

- **WHEN** the camera has moved in until those two notes are plainly apart on screen, and the sight settles on the neighbour
- **THEN** the neighbour becomes the target

#### Scenario: The view moves under a still hand

- **WHEN** the camera glides to centre a newly locked note and a different note passes under the motionless sight
- **THEN** the target does not change

#### Scenario: The hand moves to a new note

- **WHEN** the user travels the sight across to another note
- **THEN** that note becomes the target

#### Scenario: The galaxy is silent until asked

- **WHEN** the user raises an open palm over the galaxy without the aiming gesture
- **THEN** no sight and no candidate mark appear, and the target does not change

#### Scenario: Choosing is immediate once declared

- **WHEN** the user holds `Thumb_Up` and moves the sight onto a note beside the current target
- **THEN** that note is offered as the candidate, however close the two are on screen and however little the hand travelled
