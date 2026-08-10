## MODIFIED Requirements

### Requirement: Each hand pose has one job, and together they navigate the galaxy

When hand control is enabled and the galaxy is active with no reader open, two open palms SHALL be the galaxy's **only** camera drive, and spreading or closing them SHALL move the camera toward or away from **a note** — never toward an arbitrary point in space. Zooming is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

**`Closed_Fist` SHALL turn the camera around the locked note**, by the hand's movement delta, and SHALL drive nothing at all while no note is locked (see "A fist drives the camera only around a note the user chose"). Together with the two-palm travel this is what makes the galaxy navigable in three dimensions: an open palm chooses where to go, a fist chooses the angle to see it from, and two palms cover the distance. Turning around a note the user deliberately chose is navigation; turning around whatever the anchor happened to be — which is what an earlier revision did — was drift, and is why the pose was briefly given no job at all.

**A pose that drives the camera SHALL NOT also aim it.** Only the open palm aims. A fist that also aimed would re-target on the very movement that is turning the view, which is the same defect as a two-palm midpoint carrying the aim while the palms part.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: a single `Open_Palm` **aims** (choosing the note to lock, committing nothing), `Pointing_Up` targets a node dwell, `Victory` **inspects** a node (no camera motion, and nothing selected or opened — see "A held two-finger pose reveals a node's link cluster"), `Closed_Fist` turns the camera around the locked note whatever the other hand is doing — inert while nothing is locked —, two open palms zoom the middle of the view, and **any other pose — an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**.

**Two open palms SHALL be the only zoom.** A fist together with an open palm SHALL NOT zoom; the fist SHALL keep turning the view and the palm SHALL be ignored. The pair used to fly the camera toward the locked note, and it failed on its own terms: the span it read was the distance BETWEEN the hands, so the "holding" fist had equal authority over the flight — moving it changed the camera distance exactly as much as moving the palm did. Worse, the same movement of the same hand meant *turn* alone and *fly* with a palm beside it, disambiguated by a hand the user was not attending to. One pose, one job: the fist is the angle, two open palms are the distance.

**While ANY hand drives the camera, nothing SHALL aim.** The rule that a pose driving the camera may not also aim it extends to the whole frame: a fist in frame means a drive is live, so the open palm beside it is part of that drive rather than an aim. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**A hand that drives nothing SHALL also show nothing.** The pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") SHALL be produced only by a pose that means to point at something — the inspect pose, or a charging `Pointing_Up` dwell — and SHALL NOT follow a hand that is merely present in frame. A highlight that tracks any hand in any pose lights a cluster the user did not ask about, then another as the hand drifts, which is noise rather than feedback: it reads as the view reacting to the user's hand rather than answering their question. A camera drive SHALL suppress it too, because while the camera is being flown the hand's position means "camera", not "target".

The camera SHALL look at the galaxy's **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") — never at an assumed world origin, and no longer at the graph's centroid unconditionally. **The anchor a camera drive takes SHALL always be a note**, resolved as the note nearest the sight (see `second-brain-galaxy-view`, "The camera is aimed by a sight that follows the hands") within a bounded screen distance and excluding nodes behind the camera. Where two candidate notes overlap on screen, the one **nearer the camera** SHALL win, because that is the one drawn over the other and therefore the only one the user can see to aim at; depth SHALL NOT otherwise outrank aim, since a note's distance is invisible to the user except through that overlap. When no note is near enough the current anchor SHALL be kept, so aiming at empty space neither throws the view back to the middle of the vault nor sends it to some distant note the user never aimed at.

**Aiming and zooming SHALL be carried by different numbers of hands.** A SINGLE open palm SHALL aim, and while two open palms are up there SHALL be no aim point at all, so a zoom cannot re-target however unevenly the hands move. Aiming SHALL commit to nothing, and where more than one hand could aim, the one furthest RIGHT on screen SHALL win — the preview is mirrored, so that is the user's right hand. The sight mark SHALL be shown only while the user is actually aiming, and SHALL be hidden while two palms are zooming, since a mark shown then would claim the zoom is going where it is not.

When a note is locked, the zoom SHALL travel toward it — this SHALL NOT depend on which hands are up, since what the camera flies toward is the user's choice and not a property of their pose. When NO note is locked, the zoom SHALL move in and out along the axis the camera is already looking down — the point at the centre of the view, at the distance the camera is currently working at — rather than toward the graph's centroid, which after any travel is usually off-centre and would drift the view sideways.

Bringing up a second palm SHALL NOT drop the note already chosen: ceasing to aim keeps the lock rather than clearing it. A change of target SHALL NOT move the camera, and SHALL NOT alter how far the hands must spread to cover the remaining distance: the reference the spread is measured against SHALL be preserved across a re-target rather than re-read from the hands' current separation, or the spread already spent would stop counting and the travel remaining would collapse mid-gesture.

Seeding SHALL re-derive from the **live** camera, so a gesture drive that begins after the user moved the camera with the mouse continues from where the mouse left it rather than jumping back to where gesture control last was — **including what the camera is aimed at**, not only where it sits. The camera drive SHALL be smooth and stable: the displayed distance SHALL be eased toward what the hands ask for rather than tracking it frame for frame, since the hand-tracked separation carries noise that would otherwise reach the camera at full gain. These bindings SHALL engage only while the galaxy is active and no reader is open, so they never collide with the reader's `Closed_Fist`-closes-reader binding or with the deck's fist-rotates-the-orb binding. **Mouse drag/scroll camera control SHALL remain working after every exit from a gesture drive** — not only when a gesture is released, but also when hand control is switched off mid-drive, a reader opens mid-drive, Iris goes to sleep mid-drive, or the hand simply leaves the frame; the gesture drive SHALL NOT be able to leave the built-in camera controls permanently disabled for the rest of the galaxy session, and SHALL NOT restore them by overwriting what the camera was aimed at.

#### Scenario: Spreading two palms flies the camera to a note

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the user spreads two open palms with the sight over a note
- **THEN** the camera travels toward that note and its aim settles onto it, so the note ends up framed at the centre of the view where it can be dwelled on

#### Scenario: A fist turns the view around the locked note

- **WHEN** a note is locked, the galaxy is active with no reader open, and the user makes a `Closed_Fist` and moves it
- **THEN** the camera turns around that note following the hand's movement, and what is locked does not change — a fist does not aim

#### Scenario: Choosing, turning and travelling compose into navigation

- **WHEN** the user aims an open palm at a note to lock it, then makes a fist to turn around it, then raises two open palms and spreads
- **THEN** the same note stays locked throughout, the view angle changes on the fist, and the camera travels toward it on the spread

#### Scenario: The drive takes hold of the note the hand is over

- **WHEN** a note is near the sight and the user brings up two open palms
- **THEN** that note becomes the anchor and the camera flies toward it — not toward the graph's centroid, and not toward whatever happens to sit at the centre of the screen

#### Scenario: The nearer of two overlapping notes wins

- **WHEN** two notes project close enough together to overlap on screen and the sight is over both
- **THEN** the nearer one — the one drawn over the other, and so the only one the user can see — becomes the target

#### Scenario: A note beside the sight does not lose to a nearer one elsewhere

- **WHEN** one note sits under the sight and another, nearer the camera, sits well away from it on screen
- **THEN** the note under the sight wins, because depth only settles which of two overlapping notes was meant

#### Scenario: Aiming at empty space keeps the current target

- **WHEN** the user brings up two open palms while no note is near the sight
- **THEN** the current anchor is kept — the mark does not run away to a distant note, and the view is not thrown back to the middle of the vault

#### Scenario: A fist and a palm reel the camera in on the locked note

- **WHEN** a note is locked and the user holds a fist while moving the other open palm away from it
- **THEN** the camera travels toward the locked note, and the lock does not change — the palm is supplying distance, not aim

#### Scenario: A dropped pose mid-zoom cannot re-lock

- **WHEN** one hand's pose is briefly not recognized during a zoom, leaving a single open palm in frame beside a fist
- **THEN** no new target is chosen — the note stays locked

#### Scenario: Two palms zoom without re-aiming

- **WHEN** the user is zooming with two open palms and their hands part unevenly, moving the midpoint between them
- **THEN** the camera's target does not change and the sight mark is not shown — two hands supply distance only

#### Scenario: Choosing a note with one hand, then zooming to it with two

- **WHEN** the user aims one hand at a note until it locks, then brings up a second open palm and spreads
- **THEN** the locked note is kept and the camera travels toward it — raising the second hand does not drop the choice

#### Scenario: Zooming with nothing chosen

- **WHEN** the user zooms with two open palms and no note is locked
- **THEN** the camera moves in and out along the axis it is already looking down, keeping what is at the centre of the view at the centre

#### Scenario: A pinch does nothing in the galaxy

- **WHEN** the galaxy is active and the user closes their thumb and index finger together, tightly or loosely, anywhere over the graph
- **THEN** the camera does not move, nothing is selected, and any charging node dwell is unaffected

#### Scenario: A tight pinch read as a fist still does nothing

- **WHEN** the user's pinched hand is classified as `Closed_Fist` by the recognizer
- **THEN** it drives nothing, exactly as any other fist does — there is no drive for it to fight with, so the camera does not flip between behaviors

#### Scenario: A resting hand does not move the camera

- **WHEN** the galaxy is active with hand control on and the user's hand is simply present in frame in some other pose (a single open palm, or an unrecognized gesture)
- **THEN** the camera does not move

#### Scenario: A resting hand highlights nothing

- **WHEN** the galaxy is active with hand control on and the user's hand moves across the graph in a pose that drives nothing
- **THEN** no node's cluster is highlighted as it passes — the view is unchanged by a hand that is not pointing at anything

#### Scenario: A camera drive suppresses the highlight

- **WHEN** the user engages the two-palm camera drive
- **THEN** no pointed-at highlight follows the hand for the duration of that drive

#### Scenario: The camera drive resumes from where the mouse left it

- **WHEN** the user moves the camera with a mouse drag and then brings up two open palms
- **THEN** the drive continues from the camera's current position and its current aim — it does not snap back to where the previous gesture drive ended, and it does not re-aim at the graph's centroid

#### Scenario: Mouse camera control still works

- **WHEN** the user drags or scrolls on the galaxy with a mouse/trackpad
- **THEN** the built-in camera controls respond as before — the gesture drive does not disable mouse control

#### Scenario: Mouse control survives every exit from a gesture drive

- **WHEN** a gesture camera drive ends by any route — the gesture is released, hand control is switched off mid-drive, a note opens mid-drive, Iris goes to sleep mid-drive, or the hand leaves the frame
- **THEN** mouse drag/zoom still works for the rest of the galaxy session and the camera does not jump when mouse control resumes

#### Scenario: Handing control back does not re-aim the camera

- **WHEN** a gesture camera drive ends and mouse control resumes
- **THEN** what the camera is aimed at is left as the drive left it, rather than being reset to the graph's centroid

#### Scenario: A fist and a palm turn the view rather than flying it

- **WHEN** a note is locked and the user holds a fist while the other open palm moves
- **THEN** the camera turns around the locked note, and does not travel toward it

#### Scenario: Two palms fly toward the locked note

- **WHEN** a note is locked and the user spreads two open palms
- **THEN** the camera travels toward that note rather than along the centre of the view

## ADDED Requirements

### Requirement: A locked note is visibly marked

A locked note SHALL carry a mark distinct from every other ring, shown whether or not a camera drive is live, and it SHALL be chromatic where the other marks are achromatic.

The lock is the basis every hand gesture is addressed to: what a fist turns around, what a zoom flies toward, and whether most of the language does anything at all. A user who cannot see whether they hold one cannot tell why the same gesture acts or does nothing, and that ambiguity is indistinguishable from the drives behaving arbitrarily.

The mark SHALL NOT outlive the lock: whatever clears the lock SHALL clear the mark.

Without a lock, the only gestures that SHALL act on the galaxy are the two-palm zoom on the centre of the view and the `Victory` reveal. Aiming and the dwell SHALL remain available, because they are how a lock is acquired and how a note is opened.

#### Scenario: Locking a note shows it

- **WHEN** the user aims an open palm at a note until it locks
- **THEN** that note is marked, and the mark stays while they change pose

#### Scenario: Backing out to the overview clears the mark

- **WHEN** the user zooms far enough out that the lock is released
- **THEN** the mark goes with it
