## ADDED Requirements

### Requirement: The camera turns and dollies around a movable anchor

The galaxy SHALL have a single **anchor** — the point the camera turns around and
dollies toward — and every camera drive, by hand or by mouse, SHALL use that one
anchor. It SHALL be the graph's centroid, one specific node, or a specific point
in space.

**A camera drive SHALL turn around whatever the sight is on, always.** When a node
is near the sight the anchor SHALL be that node, so dollying in arrives at a note.
When no node is near enough it SHALL be the point under the sight itself, at the
depth the camera is already working at — **not** the anchor left over from before.
An anchor that survives a grab aimed somewhere else is a pivot the user is not
pointing at and cannot see; most visibly it is the note they last opened, which
then follows them around invisibly. The mark on screen and the point the camera
turns around are the same thing, with no exception to remember.

A freshly-opened galaxy SHALL be anchored on the centroid, so the view a galaxy
opens with is unchanged by this requirement existing.

The anchor SHALL move to a node when:

- a camera drive engages and a node is near the **sight** — the mark showing where
  the user's hands are aimed (see below, and `second-brain-gesture-nav`, "A closed
  two open palms fly the galaxy camera to a note") — so the node they are pointing at becomes the
  thing they turn around;
- a note is opened, whether by click or by dwell — so closing the reader leaves the
  camera around that note's neighbourhood rather than the middle of the vault.
  This SHALL NOT survive the next camera drive: the drive re-resolves from the
  sight, so an opened note is where the camera is *left*, never a pivot that
  outlives the user aiming somewhere else;
- the user reaches a note through the step rail (see `second-brain-gesture-nav`);
- the mouse wheel is used while the pointer rests on a node — scrolling zooms into
  the dot under the pointer.

The anchor SHALL return to the centroid when the camera is dollied far enough out
that the whole graph is being framed, so backing away is the way back to the
overview and no separate control is needed to escape a node.

**Re-anchoring SHALL NOT move the camera.** The camera's position SHALL be held
exactly where it is and only its relationship to the new anchor recomputed, so
engaging a drive can never teleport the view. Where re-anchoring changes what the
camera is aimed at, that change of aim SHALL be eased rather than applied as a
jump: the anchor is chosen from what is *near* the centre of the screen, so it is
routinely a little off-centre, and a jump would read as the view flinching each
time the user grabs it.

**A camera the user positioned SHALL NOT be silently discarded.** Panning or
framing the view with the mouse SHALL set the anchor rather than be overwritten by
it. Previously a hand drive reset the camera's aim to the graph's centroid on
engage and again on release, so a fist thrown after the user had framed a region
by mouse threw that framing away; that SHALL NOT happen.

Nothing about the anchor SHALL change what is selected. Moving the anchor is a
navigation act: it SHALL NOT alter the focus (see `second-brain-focus`), SHALL NOT
open a note, and SHALL NOT change what the voice layer or a run reads.

#### Scenario: A fresh galaxy is anchored on the whole vault

- **WHEN** the user opens the galaxy
- **THEN** the camera frames the whole vault and turns around the graph's centroid, exactly as it did before the anchor existed

#### Scenario: Zooming reaches the note, not the middle of the ball

- **WHEN** a node is anchored and the user dollies the camera in as far as it will go
- **THEN** the camera arrives at that note, rather than at the centre of the graph

#### Scenario: Opening a note anchors the camera on it

- **WHEN** the user opens a note and then closes the reader
- **THEN** the camera turns around that note's position, so its neighbourhood is what the next camera drive explores

#### Scenario: Scrolling over a node zooms into it

- **WHEN** the pointer rests on a node and the user scrolls the mouse wheel
- **THEN** the camera moves toward that node

#### Scenario: Re-anchoring does not teleport the camera

- **WHEN** the anchor moves from one point to another
- **THEN** the camera stays exactly where it is and only what it turns around changes — nothing jumps to a new position

#### Scenario: A change of aim is eased, not snapped

- **WHEN** re-anchoring aims the camera at a node that was near but not exactly at the centre of the screen
- **THEN** the aim moves onto it smoothly rather than snapping in a single frame

#### Scenario: A mouse-framed view survives a hand drive

- **WHEN** the user frames a region of the galaxy with the mouse and then engages a hand camera drive
- **THEN** the camera stays exactly where the mouse left it and the drive does not reset its aim to the graph's centroid, on engage or on release. The pivot moves to whatever the user's sight is on, because that is what engaging a drive means — but nothing is discarded silently and nothing reverts to the middle of the vault.

#### Scenario: The last-opened note does not become an invisible pivot

- **WHEN** the user opens a note, closes the reader, and then engages a camera drive with the sight over empty space
- **THEN** the camera turns around the point under the sight, not around the note they opened

#### Scenario: Backing out returns to the whole vault

- **WHEN** a node is anchored and the user dollies the camera out far enough to frame the whole graph
- **THEN** the anchor returns to the centroid, so the view frames the vault as a whole again and further retargeting is suspended until the camera comes back in

#### Scenario: The anchor selects nothing

- **WHEN** the anchor moves to a node by any route
- **THEN** the focus is unchanged, no note opens, and nothing the voice layer or a run reads has changed

### Requirement: The camera is aimed by a sight that follows the hands

While hand control is enabled and the galaxy is active, Iris SHALL show a **sight**
— a mark of where the camera drives are aimed — and that sight SHALL follow the
user's hands rather than being fixed to the centre of the screen.

**A sight fixed at the centre of the screen cannot be aimed.** The only way to put
something under it is to fly the camera until that thing is in the middle, which is
the hardest part of navigating the galaxy demanded *before* the easy part is
allowed to begin. Zooming then moves toward whatever happened to be at the centre,
which from the user's side is arbitrary — the gesture has no relationship to the
region they were looking at. Reading the sight off the hands inverts it: the user
puts their hands over the region and acts, in one motion, with no camera work
first.

The galaxy's one camera drive takes its input from the **distance between the
hands**, so the sight SHALL keep aiming for the whole of the drive: the hands'
midpoint is unaffected by them parting, which leaves it free to go on aiming while
they spread. Spreading the palms SHALL therefore travel toward whatever the sight
is on at that moment, not toward wherever it happened to be when the pose was
first recognized.

#### Scenario: The sight follows the hands rather than the centre of the screen

- **WHEN** hand control is on, the galaxy is active, and the user moves their hands across the frame
- **THEN** the sight moves with them, and a camera drive engaged there aims at what the sight is over — not at whatever sits at the centre of the screen

#### Scenario: The sight keeps aiming while the hands spread

- **WHEN** the user moves both hands onto a different note part-way through a spread
- **THEN** the drive re-aims onto what the sight is over at that moment, rather than staying on whatever it was over when the pose was first recognized

#### Scenario: A sight with no hand in frame falls back to the centre of the view

- **WHEN** hand control is on and the galaxy is active but no hand is in frame
- **THEN** the sight rests at the centre of the view, so there is always a defined aim point

### Requirement: What a grab will take hold of is visible before the grab

While hand control is enabled and the galaxy is active, Iris SHALL show which node
a camera drive would anchor to if engaged now, and — while a drive is engaged —
that a drive is engaged at all. While a node is anchored, that node SHALL be marked
distinctly from the candidate.

This is not decoration. An anchor that moves is *harder* to use than a fixed one
unless the user can predict where it will land: without the marks, engaging a
drive is a guess about which node the system picked, and a guess that lands wrong
is indistinguishable from the camera misbehaving. The centre mark is what the user
aims with; the candidate mark is what tells them the aim has succeeded before they
commit to it.

The marks SHALL be present only while they can be acted on: they SHALL NOT be
drawn while hand control is off, while the galaxy is not active, or while a reader
holds the gesture surface, and they SHALL stop with the galaxy's rendering when
Iris sleeps.

Recomputing which node is the candidate SHALL be rate-limited rather than done
every frame, on the same grounds the existing title selection is: the search is
proportional to the node count and a candidate that changes at frame rate would
both cost more than it is worth and read as flicker.

The candidate and anchor marks SHALL be distinguishable from the pointed-at
highlight and from the focus indicator, so a user can tell "this is what I would
grab" from "this is what I asked about" and from "this is what I selected".

#### Scenario: The sight follows the hands

- **WHEN** the galaxy is active with hand control on and the user moves their hands across the view
- **THEN** the sight moves with them, so the user aims by moving their hands rather than by first flying the camera

#### Scenario: Spreading the palms goes where the sight is

- **WHEN** the user holds both palms over a region away from the centre of the screen and spreads them
- **THEN** the camera dollies toward that region, not toward whatever sits at the centre of the screen

#### Scenario: The aim keeps up during a two-palm zoom

- **WHEN** the user is dollying with two open palms and moves both hands together onto a different node
- **THEN** the camera re-aims onto that node without the view jumping, and continues dollying toward it

#### Scenario: The node a grab would take is marked

- **WHEN** a node is near the sight and no camera drive is engaged
- **THEN** that node is marked as the candidate, so the user knows what engaging a drive would anchor to

#### Scenario: An engaged drive is visibly engaged

- **WHEN** the user makes a camera-drive pose and the recognizer accepts it
- **THEN** the marks change to say so, so the wait for the pose to be recognized reads as waiting rather than as the gesture having failed

#### Scenario: The live anchor is marked distinctly

- **WHEN** a node is anchored
- **THEN** it is marked more strongly than the candidate, so the user can always tell what the camera is currently turning around

#### Scenario: No marks without hand control

- **WHEN** hand control is off and the galaxy is active
- **THEN** neither the sight nor the candidate mark is drawn

#### Scenario: Marks stop while Iris sleeps

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the render loop
- **THEN** the marks stop being drawn and updated, and return correctly when Iris is awake again

#### Scenario: The candidate is not recomputed every frame

- **WHEN** the sight moves continuously across a dense region
- **THEN** the candidate is re-selected at a rate-limited interval rather than once per rendered frame

#### Scenario: The marks are not confusable with the highlight or the focus

- **WHEN** a node is simultaneously the anchor candidate, pointed at, and focused
- **THEN** the three treatments remain distinguishable from one another
