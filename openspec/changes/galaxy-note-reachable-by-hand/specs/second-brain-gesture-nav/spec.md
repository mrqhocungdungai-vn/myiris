## MODIFIED Requirements

### Requirement: A closed fist orbits the galaxy camera

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta. Zooming the camera is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Victory` **inspects** a node (no camera motion, and nothing selected or opened — see "A held two-finger pose reveals a node's link cluster"), `Closed_Fist` orbits, two open palms zoom, and **any other pose — a single open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**A hand that drives nothing SHALL also show nothing.** The pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") SHALL be produced only by a pose that means to point at something — the inspect pose, or a charging `Pointing_Up` dwell — and SHALL NOT follow a hand that is merely present in frame. A highlight that tracks any hand in any pose lights a cluster the user did not ask about, then another as the hand drifts, which is noise rather than feedback: it reads as the view reacting to the user's hand rather than answering their question. A camera drive SHALL suppress it too, because while an orbit or a zoom is engaged the hand's position means "camera", not "target".

The camera SHALL look at the galaxy's **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") — never at an assumed world origin, and no longer at the graph's centroid unconditionally. **Engaging a camera drive SHALL re-resolve the anchor to the node nearest the centre of the screen**, within a bounded screen distance and excluding nodes behind the camera, so each grab takes hold of whatever the user is looking at. When no node is near enough, the current anchor SHALL be kept rather than reset — a grab over empty space SHALL NOT throw the view back to the middle of the vault. Because a re-resolved anchor never moves the camera (that rule belongs to the anchor itself), engaging remains snap-free.

The orbit drive SHALL be **relative**: the first frame after it (re)engages SHALL seed its reference from the hand point and apply no motion, with subsequent frames applying only the delta from that reference, so engaging a fist never snaps the camera. Seeding SHALL re-derive from the **live** camera, so a gesture drive that begins after the user moved the camera with the mouse continues from where the mouse left it rather than jumping back to where gesture control last was — **including what the camera is aimed at**, not only where it sits. The camera drive SHALL be smooth and stable (built on the smoothed hand point, with small per-frame deltas). These bindings SHALL engage only while the galaxy is active and no reader is open, so they never collide with the reader's `Closed_Fist`-closes-reader binding or with the deck's fist-rotates-the-orb binding. **Mouse drag/scroll camera control SHALL remain working after every exit from a gesture drive** — not only when a gesture is released, but also when hand control is switched off mid-drive, a reader opens mid-drive, Iris goes to sleep mid-drive, or the hand simply leaves the frame; the gesture drive SHALL NOT be able to leave the built-in camera controls permanently disabled for the rest of the galaxy session, and SHALL NOT restore them by overwriting what the camera was aimed at.

#### Scenario: Fist orbits the camera

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the primary hand shows `Closed_Fist` while moving
- **THEN** the galaxy camera orbits around the current anchor following the hand's movement delta

#### Scenario: Each grab takes hold of what is at the centre of the screen

- **WHEN** a node is near the centre of the screen and the user closes a fist
- **THEN** that node becomes the anchor and the orbit turns around it — not around the graph's centroid

#### Scenario: A grab over empty space keeps the current anchor

- **WHEN** the user closes a fist while no node is near the centre of the screen
- **THEN** the anchor is left as it was and the orbit continues around it, rather than reverting to the graph's centroid

#### Scenario: A pinch does nothing in the galaxy

- **WHEN** the galaxy is active and the user closes their thumb and index finger together, tightly or loosely, anywhere over the graph
- **THEN** the camera does not move, nothing is selected, and any charging node dwell is unaffected

#### Scenario: A tight pinch read as a fist orbits, and only orbits

- **WHEN** the user's pinched hand is classified as `Closed_Fist` by the recognizer
- **THEN** it orbits the camera like any other fist — there is no second drive for it to fight with, so the camera does not flip between behaviors

#### Scenario: A resting hand does not move the camera

- **WHEN** the galaxy is active with hand control on and the user's hand is simply present in frame in some other pose (a single open palm, or an unrecognized gesture)
- **THEN** the camera does not orbit or dolly

#### Scenario: A resting hand highlights nothing

- **WHEN** the galaxy is active with hand control on and the user's hand moves across the graph in a pose that drives nothing
- **THEN** no node's cluster is highlighted as it passes — the view is unchanged by a hand that is not pointing at anything

#### Scenario: A camera drive suppresses the highlight

- **WHEN** the user engages an orbit or a zoom
- **THEN** no pointed-at highlight follows the hand for the duration of that drive

#### Scenario: Gesture orbit resumes from where the mouse left the camera

- **WHEN** the user moves the camera with a mouse drag and then engages a fist to orbit
- **THEN** the orbit continues from the camera's current position and its current aim — it does not snap back to where the previous gesture drive ended, and it does not re-aim at the graph's centroid

#### Scenario: Mouse camera control still works

- **WHEN** the user drags or scrolls on the galaxy with a mouse/trackpad
- **THEN** the built-in camera controls respond as before — the gesture drive does not disable mouse control

#### Scenario: Mouse control survives every exit from a gesture drive

- **WHEN** a gesture camera drive ends by any route — the gesture is released, hand control is switched off mid-drive, a note opens mid-drive, Iris goes to sleep mid-drive, or the hand leaves the frame
- **THEN** mouse drag/zoom still works for the rest of the galaxy session and the camera does not jump when mouse control resumes

#### Scenario: Handing control back does not re-aim the camera

- **WHEN** a gesture camera drive ends and mouse control resumes
- **THEN** what the camera is aimed at is left as the drive left it, rather than being reset to the graph's centroid

## ADDED Requirements

### Requirement: A lowered hand releases every camera drive

A hand that has dropped to the lower part of the camera frame SHALL NOT drive the
galaxy camera: an orbit or a zoom in progress SHALL be released, and a new one
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

#### Scenario: Lowering the hand stops an orbit

- **WHEN** the user is orbiting the camera with a fist and lowers their hand toward the bottom of the frame
- **THEN** the orbit is released and the camera stops moving, leaving the view where it was

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

When the rail is not centred on any note — a freshly-opened galaxy — it SHALL offer
entry points drawn from the graph itself, ordered so the most connected notes come
first. A user who has just opened the galaxy SHALL therefore be able to start
moving without first having to aim at anything.

**The rail exists because aiming at a node is not something a hand can do
reliably.** A note's dot is a few pixels across in a view that occludes itself, and
hand tracking is imprecise by an order of magnitude more than that; flying a camera
to a chosen note also means holding a pose for far longer than an arm tolerates. The
rail replaces both problems with one repeated choice from a small set, each target
large enough to be hit and each step short enough to be made with a rested arm.

The rail SHALL be reachable by hand **without any new gesture and without any
galaxy-specific pointing rule**: it SHALL be ordinary HUD chrome and SHALL be
activated by the universal point-and-hold click that already reaches every other
piece of chrome above an open layer (see `two-hand-gestures`). It SHALL be equally
operable by mouse. Adding a pose for it SHALL NOT be necessary and SHALL NOT be
done.

The flight SHALL be animated rather than instantaneous, so the user sees where in
the galaxy they have been taken and can build a sense of the vault's shape; and it
SHALL leave the destination as the camera's anchor, so an orbit made straight
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

#### Scenario: A fresh galaxy offers entry points

- **WHEN** the user opens the galaxy and has not yet stepped anywhere
- **THEN** the rail offers entry points ordered with the most connected notes first, so a first step can be taken without aiming at any node

#### Scenario: Repeated steps traverse the graph

- **WHEN** the user activates an entry, then an entry on the resulting rail, then another
- **THEN** each step moves the camera and the rail one hop further, so a note several hops away is reached by a sequence of choices

#### Scenario: The rail's neighbourhood matches the rest of the galaxy

- **WHEN** the rail is centred on a note that is also focused
- **THEN** the notes the rail lists are exactly the notes the focus declutter keeps bright for that note — the two cannot disagree about one hop

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
