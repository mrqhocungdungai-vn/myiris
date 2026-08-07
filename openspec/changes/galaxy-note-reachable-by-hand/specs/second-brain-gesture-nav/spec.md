## REMOVED Requirements

### Requirement: A closed fist orbits the galaxy camera

**Reason**: the fist orbit is removed outright (design.md D20). The galaxy is a sphere, and an orbit only pays once it is flown accurately — four rounds of tuning it never made the one thing the user actually needs, arriving at a particular note in order to open it, any easier. Its replacement is not another camera gesture but a narrower one: the surviving two-palm drive always travels toward a *note*, which is what the requirement below states.
**Migration**: none in storage or configuration. A `Closed_Fist` over the galaxy now drives nothing; mouse drag continues to orbit the camera freely, and the gesture indicator reports idle for a fist rather than naming a binding that no longer exists.

## ADDED Requirements

### Requirement: Each hand pose has one job, and together they navigate the galaxy

When hand control is enabled and the galaxy is active with no reader open, two open palms SHALL be the galaxy's **only** camera drive, and spreading or closing them SHALL move the camera toward or away from **a note** — never toward an arbitrary point in space. Zooming is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

**`Closed_Fist` SHALL turn the camera around the locked note**, by the hand's movement delta. Together with the two-palm travel this is what makes the galaxy navigable in three dimensions: an open palm chooses where to go, a fist chooses the angle to see it from, and two palms cover the distance. Turning around a note the user deliberately chose is navigation; turning around whatever the anchor happened to be — which is what an earlier revision did — was drift, and is why the pose was briefly given no job at all.

**A pose that drives the camera SHALL NOT also aim it.** Only the open palm aims. A fist that also aimed would re-target on the very movement that is turning the view, which is the same defect as a two-palm midpoint carrying the aim while the palms part.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: a single `Open_Palm` **aims** (choosing the note to lock, committing nothing), `Pointing_Up` targets a node dwell, `Victory` **inspects** a node (no camera motion, and nothing selected or opened — see "A held two-finger pose reveals a node's link cluster"), `Closed_Fist` turns the camera, two open palms fly it, and **any other pose — an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**A hand that drives nothing SHALL also show nothing.** The pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") SHALL be produced only by a pose that means to point at something — the inspect pose, or a charging `Pointing_Up` dwell — and SHALL NOT follow a hand that is merely present in frame. A highlight that tracks any hand in any pose lights a cluster the user did not ask about, then another as the hand drifts, which is noise rather than feedback: it reads as the view reacting to the user's hand rather than answering their question. A camera drive SHALL suppress it too, because while the camera is being flown the hand's position means "camera", not "target".

The camera SHALL look at the galaxy's **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") — never at an assumed world origin, and no longer at the graph's centroid unconditionally. **The anchor a camera drive takes SHALL always be a note**, resolved as the note nearest the sight (see `second-brain-galaxy-view`, "The camera is aimed by a sight that follows the hands") within a bounded screen distance and excluding nodes behind the camera. Where two candidate notes overlap on screen, the one **nearer the camera** SHALL win, because that is the one drawn over the other and therefore the only one the user can see to aim at; depth SHALL NOT otherwise outrank aim, since a note's distance is invisible to the user except through that overlap. When no note is near enough the current anchor SHALL be kept, so aiming at empty space neither throws the view back to the middle of the vault nor sends it to some distant note the user never aimed at.

**Aiming and zooming SHALL be carried by different numbers of hands.** A SINGLE open palm SHALL aim, and while two open palms are up there SHALL be no aim point at all, so a zoom cannot re-target however unevenly the hands move. Aiming SHALL commit to nothing, and where more than one hand could aim, the one furthest RIGHT on screen SHALL win — the preview is mirrored, so that is the user's right hand. The sight mark SHALL be shown only while the user is actually aiming, and SHALL be hidden while two palms are zooming, since a mark shown then would claim the zoom is going where it is not.

When a note is locked, the drive SHALL travel toward it. When NO note is locked, the drive SHALL move in and out along the axis the camera is already looking down — the point at the centre of the view, at the distance the camera is currently working at — rather than toward the graph's centroid, which after any travel is usually off-centre and would drift the view sideways.

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

### Requirement: A lowered hand releases every camera drive

A hand that has dropped to the lower part of the camera frame SHALL NOT drive the
galaxy camera: a camera drive in progress SHALL be released, and a new one
SHALL NOT engage, until the hand is raised again.

Mid-air gesture control is physically tiring, so a user resting their arm is a
routine event rather than an edge case — and the pose a hand falls into while being
lowered is not chosen deliberately. Without this, lowering a tired arm drags the
camera across the graph, which both loses the view the user had worked to reach and
teaches them that putting their arm down is unsafe.

The release SHALL behave exactly like any other exit from a drive: the drive's
reference is released rather than frozen, mouse control returns intact, and raising
the hand and re-engaging seeds a fresh reference from the live camera, so nothing
jumps.

This SHALL apply to the camera drives only. It SHALL NOT suppress the dwell, the
inspect reveal, or the step rail — those are deliberate acts that already require
the hand to be held at a target, and a lowered hand simply will not be at one.

#### Scenario: Lowering the hands stops the camera drive

- **WHEN** the user is flying the camera with two open palms and lowers their hands toward the bottom of the frame
- **THEN** the drive is released and the camera stops moving, leaving the view where it was

#### Scenario: A drive does not engage from a lowered hand

- **WHEN** the user's hand is resting low in the frame and happens to read as a fist or as two open palms
- **THEN** no camera drive engages

#### Scenario: Raising the hand again resumes cleanly

- **WHEN** the user lowers their hand mid-drive and later raises it and re-engages
- **THEN** the drive seeds a fresh reference from the camera's live position and applies no motion on its first frame

#### Scenario: Mouse control survives a lowered-hand release

- **WHEN** a camera drive is released because the hand was lowered
- **THEN** mouse drag and zoom work immediately afterwards, exactly as after any other release

### Requirement: A note is reachable by stepping through its neighbours

While the galaxy is active, Iris SHALL offer a **step rail**: a set of activatable
entries naming notes the user can move to, each showing enough to choose by (the
note's title, and how it is grouped and connected). Activating an entry SHALL fly
the camera to that note, make it the note the rail is showing neighbours of, and
repopulate the rail with *that* note's neighbours — so the user reaches a note by a
sequence of ordinary choices rather than by piloting a camera.

The rail SHALL show the **one-hop neighbours** of the note it is currently centred
on, and that neighbourhood SHALL be the same one the focus declutter and the
pointed-at highlight already use, so nothing in the galaxy can disagree about what
one hop means.

**Stepping one hop at a time cannot reach a note the links do not lead to.** A
vault is routinely more than one cloud of linked notes — a set of notes written
about a separate subject need not link to anything in the main body at all — and a
rail that only ever walked one hop could never leave the cloud it started in.
Reaching those notes is not an edge case: they are precisely the ones a user cannot
find by looking, because they sit somewhere else in the view entirely.

The rail SHALL therefore **always** offer a set of **entry points** alongside the
current note's neighbours, whether or not it is centred on a note, and those entry
points SHALL **cover every disconnected region of the graph** — no region SHALL be
without one. Within that guarantee they SHALL be ordered so the most connected
notes come first, and no region's coverage SHALL be dropped in order to keep the
list short.

A user who has just opened the galaxy SHALL therefore be able to start moving
without aiming at anything, and a user who has walked several hops into one cloud
SHALL be able to leave it — for another cloud, or back to where they began —
without closing the galaxy and reopening it.

**The rail exists because aiming at a node is not something a hand can do
reliably.** A note's dot is a few pixels across in a view that occludes itself, and
hand tracking is imprecise by an order of magnitude more than that; flying a camera
to a chosen note also means holding a pose for far longer than an arm tolerates. The
rail replaces both problems with one repeated choice from a small set, each target
large enough to be hit and each step short enough to be made with a rested arm.

**A note SHALL be reachable by name, not only by walking the links.** The rail
SHALL offer a way to find notes whose title matches what the user is looking for,
and those matches SHALL be steppable on exactly the terms every other rail entry
is. Stepping is only as good as the reachability of a starting point, and link
topology cannot supply one: a user looking for a note is thinking about its
subject, not about what it happens to link to. Matching SHALL ignore case and
diacritics, since a vault's titles are prose and requiring the accents to be typed
exactly would make the feature useless in any language that has them.

The rail SHALL be reachable by hand **without any new gesture and without any
galaxy-specific pointing rule**: it SHALL be ordinary HUD chrome and SHALL be
activated by the universal point-and-hold click that already reaches every other
piece of chrome above an open layer (see `two-hand-gestures`). It SHALL be equally
operable by mouse. Adding a pose for it SHALL NOT be necessary and SHALL NOT be
done.

The flight SHALL be animated rather than instantaneous, so the user sees where in
the galaxy they have been taken and can build a sense of the vault's shape; and it
SHALL leave the destination as the camera's anchor, so a camera drive made straight
afterwards turns around the note just reached.

**One deliberate act SHALL take exactly one step.** A hand still held over the rail
after a step SHALL NOT step again: the rail changing under a stationary hand is not
a new decision by the user, and a rail that repeats would fly the camera through the
graph for as long as the hand stayed up. Another step SHALL require the hand to leave
the rail and return, on the same terms every other hands-free activation already
requires.

**Stepping SHALL NOT select anything.** The note the rail is centred on is not the
focus (see `second-brain-focus`): moving through the rail SHALL leave the focus
exactly as it was, SHALL NOT open a note, and SHALL NOT change what the voice layer
or a run reads. This preserves the recorded decision that no gesture selects a
note — the rail navigates, it does not select.

A rail entry for a note with no backing file (an unresolved `[[wikilink]]` target)
SHALL still be steppable, since flying to it is not opening it, and its entry SHALL
be marked as not openable so the user is not misled about what activating it does.

The rail SHALL exist only while the galaxy does. Whenever the galaxy is not active
the rail SHALL NOT be shown and the note it was centred on SHALL be cleared, on
exactly the terms that already clear an open note reader and the focus — so no
galaxy-close route can leave it stranded over the transparent HUD or the deck, and
reopening the galaxy starts from the entry points rather than from wherever the user
had walked to.

#### Scenario: Stepping to a neighbour flies the camera there

- **WHEN** the rail is centred on a note and the user activates one of its neighbour entries
- **THEN** the camera flies to that note, the rail repopulates with that note's own neighbours, and the note just reached becomes the camera's anchor

#### Scenario: The rail is reachable by hand with no new gesture

- **WHEN** hand control is on, the galaxy is active, and the user points at a rail entry and holds for the dwell duration
- **THEN** the entry activates, through the same universal point-and-hold click that reaches any other HUD chrome — no galaxy-specific pointing rule and no additional hand pose is involved

#### Scenario: The rail works by mouse too

- **WHEN** hand control is off and the user clicks a rail entry
- **THEN** it activates identically — the hands-free path is additive, not a replacement

#### Scenario: A note is found by its name

- **WHEN** the user types part of a note's title
- **THEN** the rail offers the notes whose titles match, and activating one steps the camera to it exactly as any other entry does

#### Scenario: Accents need not be typed

- **WHEN** the user types a note's title without its diacritics
- **THEN** the note is still found

#### Scenario: A fresh galaxy offers entry points

- **WHEN** the user opens the galaxy and has not yet stepped anywhere
- **THEN** the rail offers entry points ordered with the most connected notes first, so a first step can be taken without aiming at any node

#### Scenario: A cloud of notes linked to nothing else is still reachable

- **WHEN** the vault contains a set of notes that link to each other but to nothing in the main body of the graph
- **THEN** the rail offers an entry point in that set too, so it can be reached without piloting the camera to it

#### Scenario: The entry points stay available after stepping

- **WHEN** the user has stepped several hops into one cloud
- **THEN** the entry points are still offered alongside that note's neighbours, so leaving for another cloud — or returning to the start — needs neither a hop-by-hop walk back nor closing the galaxy

#### Scenario: Coverage is not traded away for a short list

- **WHEN** the vault has more disconnected regions than the rail would otherwise list entry points for
- **THEN** every region still has one, and the rail accommodates them rather than dropping a region silently

#### Scenario: Repeated steps traverse the graph

- **WHEN** the user activates an entry, then an entry on the resulting rail, then another
- **THEN** each step moves the camera and the rail one hop further, so a note several hops away is reached by a sequence of choices

#### Scenario: The rail's neighbourhood matches the rest of the galaxy

- **WHEN** the rail is centred on a note that is also focused
- **THEN** the notes the rail lists **as that note's neighbours** are exactly the notes the focus declutter keeps bright for that note — the two cannot disagree about one hop. The entry points are a separate offering and are not part of that claim.

#### Scenario: Stepping changes no selection

- **WHEN** notes are focused and the user steps through the rail to an unrelated note
- **THEN** the focus is unchanged, no note opens, and nothing the voice layer or a run reads has changed

#### Scenario: A held hand steps once, not repeatedly

- **WHEN** the user activates a rail entry by dwell and keeps their hand where it is while the rail repopulates
- **THEN** no further step is taken — the camera stops at the note it was sent to, and stepping again requires the hand to leave the rail and return

#### Scenario: The flight is visible

- **WHEN** a step is activated
- **THEN** the camera travels to the destination over a short animation rather than cutting to it, so the user sees where in the galaxy they have gone

#### Scenario: A ghost note can be stepped to but not opened

- **WHEN** the rail shows an entry for an unresolved `[[wikilink]]` target and the user activates it
- **THEN** the camera flies to it and the rail recentres on it, while the entry is marked as not openable and no file read is attempted

#### Scenario: Closing the galaxy clears the rail

- **WHEN** the user has stepped several notes deep and the galaxy closes by any route (the toggle, opening the drawing panel, leaving the HUD by button/hotkey/tray, or a force-close after a crash)
- **THEN** the rail is dismissed with it, and reopening the galaxy starts from the entry points rather than from where the user had walked to
