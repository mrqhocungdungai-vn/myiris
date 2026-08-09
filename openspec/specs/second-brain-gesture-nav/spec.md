# second-brain-gesture-nav Specification

## Purpose
Hands-free navigation of the second-brain galaxy, with one job per hand pose: a single open palm **aims**, choosing the note the camera locks onto; point-and-dwell opens a node; a held two-finger pose reveals what a node is connected to without opening or selecting it; a closed fist turns the camera around the locked note; a fist together with an open palm reels the camera in on it; two open palms zoom the middle of the view; and the gestures carry into the note reader once a node is open. One authoritative gesture context governs the galaxy and its reader together, so the two can never disagree about which layer owns the pointing hand. It follows the same hand-control opt-in as the rest of the gesture surface, and suspends while Iris is asleep.
## Requirements
### Requirement: A node is opened hands-free by point-and-dwell

When hand control is enabled and the galaxy is active with no reader open, holding the pointing hand (`Pointing_Up`) over a note-node for the HUD's standard dwell duration (300 ms) SHALL open that note in the note reader — the same result as clicking the node. Because galaxy nodes are WebGL objects (not DOM elements), the target SHALL be resolved by projecting node positions to screen coordinates and selecting the node nearest the hand point within a pixel threshold, NOT by the DOM `elementFromPoint` dwell (which stays suppressed while the galaxy owns the surface). A node that is **behind the camera** SHALL NOT be targetable — projection alone yields in-viewport coordinates for nodes behind the viewer, so the hit-test SHALL exclude any node outside the camera's visible depth range, matching the mouse click's front-facing behavior. A **ghost node** (an unresolved `[[wikilink]]` target with no backing file) SHALL NOT be dwell-openable, exactly as it is not click-openable. After a dwell fires, the same target SHALL NOT fire again until the hand has left it (moved off the node or stopped pointing) and re-acquired it. The targeted node SHALL be given visible feedback (e.g. a highlight) while the dwell is charging.

#### Scenario: Dwell over a node opens its note

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the user holds a pointing hand over a real note-node for 300 ms
- **THEN** that note opens in the note reader — identical to clicking the node — and the target is highlighted while the dwell charges

#### Scenario: Dwell over a ghost node does nothing

- **WHEN** the pointing hand dwells over a faded ghost node (an unresolved `[[wikilink]]` target)
- **THEN** no note reader opens and no file read is attempted

#### Scenario: A node behind the camera is not targeted

- **WHEN** the camera has orbited so that some nodes are behind the viewer, and the hand point happens to fall near where such a node projects into the viewport
- **THEN** that behind-the-camera node is not dwell-targeted or opened — only nodes in front of the camera are eligible

#### Scenario: A dwell must be released before re-firing

- **WHEN** a node has just been opened by dwell and the hand is still over it
- **THEN** it does not immediately open again — the hand must leave the node (or stop pointing) and re-acquire it before another dwell can fire

#### Scenario: Mouse click still opens a node

- **WHEN** hand control is off (or a mouse is used) and the user clicks a real note-node
- **THEN** the note opens exactly as before — the gesture path is additive, not a replacement

### Requirement: A held two-finger pose reveals a node's link cluster

When hand control is enabled and the galaxy is active with no reader open, holding a hand showing `Victory` near a note-node SHALL reveal that node's link cluster (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") for as long as the pose is held over it. This is the hands-free equivalent of hovering with a mouse: it is how the user asks "what is this note connected to" without a pointer.

**The reveal SHALL be momentary and SHALL change nothing.** Releasing the pose, or moving off the node, SHALL restore the view exactly as it was. It SHALL NOT select the node, SHALL NOT alter the focus, SHALL NOT move the camera, and SHALL NOT open a note — so nothing the voice layer or a run reads is different afterwards, and there is nothing for the user to undo.

There SHALL be no accumulation: sweeping the pose across several nodes SHALL show one node's cluster at a time and leave nothing behind. Exactly one node SHALL be revealed at any moment — the one the hand is nearest.

The target SHALL be resolved exactly as the opening dwell resolves it — the nearest node to the hand point within the pixel threshold, excluding nodes behind the camera and ghost nodes — and from the point of **the hand actually making the pose**, not from whichever hand is currently primary, so the pose works while another hand is present in frame in some other pose.

There SHALL be **no** hold delay before the reveal: unlike the opening dwell, nothing is being committed to, so making the user wait would only make the view feel slow. Conversely nothing SHALL fire on release — the pose has no outcome beyond the reveal itself.

#### Scenario: Holding two fingers over a node reveals its cluster

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the user holds a `Victory` hand near a real note-node
- **THEN** that node's links are drawn prominently and its one-hop neighbours at full strength, for as long as the pose stays on it

#### Scenario: Releasing the pose restores the view

- **WHEN** the user stops making the pose, or moves it off the node
- **THEN** the view returns exactly to how it was drawn before — nothing stays lit

#### Scenario: The reveal selects nothing

- **WHEN** the pose has revealed a node's cluster
- **THEN** the focus is unchanged, no note opens, the camera has not moved, and what the voice layer and a run's prompt describe is unchanged

#### Scenario: Sweeping the pose accumulates nothing

- **WHEN** the user moves the pose across several nodes in turn
- **THEN** one cluster is shown at a time, each previous one returns to normal as it is left, and no set of lit or selected nodes builds up

#### Scenario: A ghost node is not revealed

- **WHEN** the user holds the pose over a faded ghost node
- **THEN** no cluster is revealed for it, matching the opening dwell's exclusion of ghosts

#### Scenario: The revealing hand need not be the primary hand

- **WHEN** two hands are in frame, one showing `Victory` near a node and the other in some other pose
- **THEN** the `Victory` hand's nearest node is the one revealed

#### Scenario: The reveal does not disturb a dwell

- **WHEN** the user changes from the pointing pose to the inspect pose, or back
- **THEN** no note opens from the abandoned dwell, and the newly-live pose acts on the node it is actually over

### Requirement: Focus is reachable without hands

Selecting the focus SHALL be fully available by mouse, and clearing it SHALL be available by mouse and hands-free alike, independent of the hand-control preference. With hand control off, the galaxy and its focus SHALL be usable exactly as they are with it on, and no gesture machinery SHALL run — the existing rule that the gesture layer schedules no per-frame work while hand control is off SHALL continue to hold.

**There is deliberately no gesture that selects a node.** Selection is currently reachable only by mouse, and this is a recorded decision rather than a gap. The focus exists to give a deictic voice request ("connect these two") something to resolve against; today the voice surface of the second brain is capture and curation, with no tool that opens or points at a note, so the focus's main consumer is not yet in play. Adding a selection gesture is worth doing when it is — and until then, a gesture that quietly toggles a selection the user cannot easily see is a way to change their vault by accident.

Clearing SHALL remain reachable without a mouse, because the clear-focus control lives in the HUD control island, which stays dwell-activatable even while a fullscreen layer is active. A user who selected notes by mouse and then put the mouse down SHALL still be able to release that selection.

#### Scenario: Mouse selection works with hand control off

- **WHEN** hand control is off and the user selects nodes with the mouse
- **THEN** those nodes are focused, the focus indicator names them, and a deictic voice request resolves against them

#### Scenario: Mouse selection works with hand control on

- **WHEN** hand control is on and the user selects nodes with the mouse
- **THEN** those nodes are focused exactly as they are with hand control off — enabling the camera neither adds nor removes a way to select

#### Scenario: No gesture selects a node

- **WHEN** hand control is on, the galaxy is active, and the user makes any pose over a node other than a dwell
- **THEN** no node's focus is toggled

#### Scenario: No per-frame work when hand control is off

- **WHEN** hand control is off and the galaxy is active with notes focused
- **THEN** no gesture loop is scheduled

#### Scenario: Clearing works by mouse

- **WHEN** notes are focused and the user activates the clear-focus control with the mouse
- **THEN** the focus is emptied

#### Scenario: Clearing works hands-free

- **WHEN** notes are focused, hand control is on, and the user dwells over the clear-focus control in the HUD control island
- **THEN** the focus is emptied

### Requirement: The note reader responds to hand gestures

When hand control is enabled and a vault note is open in the note reader, the reader SHALL respond to the same gesture bindings as the task run-reader: a `Closed_Fist` SHALL close the reader, two open palms SHALL resize it, and a single open palm held above/below the reader body's center SHALL scroll it. The reader's footer hint SHALL communicate the gesture controls when hand control is active. With hand control off, the note reader SHALL behave exactly as change #1 shipped (mouse/keyboard: drag/scroll, X, Esc).

#### Scenario: Fist closes the note reader

- **WHEN** hand control is on, a vault note is open, and the primary hand shows `Closed_Fist`
- **THEN** the note reader closes and the galaxy remains active

#### Scenario: Palms scroll and resize the open note

- **WHEN** hand control is on and a vault note is open
- **THEN** one open palm held high/low scrolls the note body and two open palms resize the reader, exactly as in the task run-reader

#### Scenario: Note reader without hand control is unchanged

- **WHEN** hand control is off and a vault note is open
- **THEN** the reader is controlled only by mouse/keyboard (drag/scroll, X, Esc), exactly as shipped in change #1

### Requirement: A single authoritative gesture context governs the galaxy and its reader

Gesture bindings SHALL follow one authoritative context precedence so no two bindings act on the same gesture at once: (1) when a reader is open, only the reader's bindings run and the galaxy node-dwell and camera-nav bindings are suppressed; (2) when the galaxy is active with no reader open, the galaxy node-dwell and camera-nav bindings run and the deck's orb/universal-dwell/scroll bindings are suppressed; (3) otherwise the deck behaves as before. That precedence SHALL be derived from one shared, testable resolution of the current context rather than re-stated independently by each new consumer, so a future binding cannot disagree about which layer owns the hand. Two things SHALL survive the suppression in (2): the HUD chrome the galaxy is painted beneath stays hand-operable (see below and `two-hand-gestures`), and the gesture action indicator SHALL report the binding that is actually live in the current context rather than a deck binding the galaxy has taken over. (The lifecycle rule that closing the galaxy dismisses an open note belongs to the galaxy layer itself and is specified in `second-brain-galaxy-view`.)

**The precedence has two modes, and which applies is already visible on screen.** A reader is a *focus*: it paints a full-screen backdrop, takes every gesture, and holds them until it is closed — that is level (1), and it is unchanged. The galaxy is not a focus: it paints no backdrop and coexists with the HUD chrome above it, so level (2) is **positional rather than modal**.

**The galaxy owns the hand only where the galaxy is the top layer.** The galaxy is rendered *beneath* the Glass HUD's chrome — the tasks column, the comms column, the review/question stack, and the orb island — which stays visible and mouse-clickable over it. Over that chrome the HUD's own bindings run; over the galaxy itself the galaxy's do. Suppressing the deck bindings wherever the galaxy is merely *active* leaves controls the user can see and click but cannot touch by hand, which is what this precedence exists to prevent rather than to cause.

**Closing a focus SHALL return the hand to the shared mode with nothing to re-acquire.** Dismissing a note SHALL restore, in the same frame, both the galaxy's own bindings and the HUD chrome's — no re-toggle of hand control, no re-entering the galaxy, and no camera jump from a drive that was live when the reader opened.

**Pointing drives yield to HUD chrome; camera drives do not.** The galaxy's pointing drives — the node-opening dwell and the two-finger inspect reveal — SHALL resolve no node while the pointing hand is over HUD chrome, so a finger aimed at a task card never also charges a dwell on whatever node happens to project behind that card, and no cluster lights up under a hand that is pointing at the HUD. The camera drives — the fist turn, the fist-and-palm reel, and the two-palm zoom — SHALL NOT yield: they act on the whole view rather than on a thing under the finger, and stalling one because the hand drifted across a panel would make the camera feel broken.

The indicator SHALL name the live binding from a signal that actually reaches it. A binding reported from a continuously-varying measurement that the hand state deliberately withholds from the UI — so that per-frame tracking never forces a re-render — SHALL NOT be used, because the label would then describe a value from whenever the state last changed for some other reason.

#### Scenario: Reader open suppresses galaxy navigation

- **WHEN** a vault note is open over the galaxy
- **THEN** node-dwell and camera orbit/zoom do not act — only the reader's own bindings respond — so a fist closes the reader rather than orbiting the camera, and two open palms resize the reader rather than dollying the camera

#### Scenario: An open note takes the HUD chrome too

- **WHEN** a vault note is open over the galaxy and the user points at a task card or a control in the orb island
- **THEN** nothing there fires — the focus holds every gesture until it is closed, even the chrome that is hand-reachable whenever no reader is open

#### Scenario: Closing the note returns both surfaces at once

- **WHEN** the user closes the note and the galaxy is still active
- **THEN** the galaxy's node-dwell and camera nav respond again over the galaxy, and the HUD chrome is dwell-clickable again, with no re-toggle and no camera jump

#### Scenario: Galaxy active suppresses deck gestures over the galaxy

- **WHEN** the galaxy is active, no reader is open, and the hand is over the galaxy itself
- **THEN** the deck's fist-rotates-the-orb, universal point-and-dwell click, and open-palm panel scroll do not fire there — the galaxy's own node-dwell and camera nav own that surface

#### Scenario: HUD chrome keeps its own bindings over the galaxy

- **WHEN** the galaxy is active and the pointing hand is over a task card, a column toggle, or a control in the orb island
- **THEN** the HUD's dwell-click acts on it, and no galaxy node is targeted or opened by that same hand position

#### Scenario: A pointing hand over the HUD lights no cluster

- **WHEN** the galaxy is active and the user points at, or holds the inspect pose over, a piece of HUD chrome
- **THEN** no node behind that chrome is highlighted or revealed

#### Scenario: An orbit continues across the HUD chrome

- **WHEN** the user is orbiting the camera with a fist and the hand passes over the task column
- **THEN** the orbit continues uninterrupted — the camera drive is not handed to the HUD

#### Scenario: The galaxy can be closed hands-free

- **WHEN** the galaxy is active with hand control on and the user dwells over the "show second brain" toggle in the HUD control island
- **THEN** the toggle fires and the galaxy closes — the layer's gesture suppression does not trap the user into reaching for the mouse or Esc

#### Scenario: The action indicator names the galaxy's live binding

- **WHEN** the galaxy is active and the user makes a fist, shows two open palms, or charges a node dwell
- **THEN** the gesture action indicator reports the galaxy binding that is live (orbit / zoom / opening a node), not a deck binding and not "idle"

#### Scenario: The indicator is not stale

- **WHEN** the user changes pose over the galaxy and holds the new pose
- **THEN** the indicator names the new binding, rather than continuing to show a binding derived from a measurement taken at some earlier moment

### Requirement: Gesture navigation is gated on the hand-control opt-in and suspended while Iris is asleep

The galaxy gesture bindings (node-dwell, camera nav, and the note reader's gesture response) SHALL be active only when the user's opt-in hand-control preference is enabled. When hand control is off, the galaxy and its note reader SHALL be fully usable by mouse and keyboard exactly as change #1 shipped, no camera is acquired for the galaxy on its own, and the gesture machinery SHALL consume no per-frame work at all (it SHALL NOT run a no-op loop). The gesture drive SHALL also be suspended whenever the galaxy's rendering is paused because Iris is asleep — the same signal that already pauses the force simulation and render loop — so the galaxy consumes no per-frame CPU while asleep and the camera cannot silently drift and snap on wake.

#### Scenario: Gestures are suspended while Iris is asleep

- **WHEN** the galaxy is active with hand control on and Iris goes to sleep (the signal that pauses the galaxy's render loop)
- **THEN** the gesture drive stops doing per-frame work and the camera does not move while asleep — waking Iris resumes gestures with the camera exactly where it was

#### Scenario: Gestures off means mouse-only galaxy

- **WHEN** the hand-control preference is off and the galaxy is active
- **THEN** no gesture bindings engage, no per-frame gesture loop is scheduled, and the galaxy plus its note reader are controlled entirely by mouse/keyboard, as shipped in change #1

#### Scenario: Enabling hand control lights up galaxy gestures

- **WHEN** the user enables hand control while the galaxy is active
- **THEN** node-dwell and camera orbit/zoom become available without relaunching or re-toggling the galaxy

### Requirement: Each hand pose has one job, and together they navigate the galaxy

When hand control is enabled and the galaxy is active with no reader open, two open palms SHALL be the galaxy's **only** camera drive, and spreading or closing them SHALL move the camera toward or away from **a note** — never toward an arbitrary point in space. Zooming is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

**`Closed_Fist` SHALL turn the camera around the locked note**, by the hand's movement delta, and SHALL drive nothing at all while no note is locked (see "A fist drives the camera only around a note the user chose"). Together with the two-palm travel this is what makes the galaxy navigable in three dimensions: an open palm chooses where to go, a fist chooses the angle to see it from, and two palms cover the distance. Turning around a note the user deliberately chose is navigation; turning around whatever the anchor happened to be — which is what an earlier revision did — was drift, and is why the pose was briefly given no job at all.

**A pose that drives the camera SHALL NOT also aim it.** Only the open palm aims. A fist that also aimed would re-target on the very movement that is turning the view, which is the same defect as a two-palm midpoint carrying the aim while the palms part.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: a single `Open_Palm` **aims** (choosing the note to lock, committing nothing), `Pointing_Up` targets a node dwell, `Victory` **inspects** a node (no camera motion, and nothing selected or opened — see "A held two-finger pose reveals a node's link cluster"), `Closed_Fist` alone turns the camera around the locked note, **a fist together with an open palm reels the camera in on the locked note** — both inert while nothing is locked —, two open palms zoom the middle of the view, and **any other pose — an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**.

**Which zoom is running SHALL be carried by the hands, not by hidden state.** A fist holding while the other palm moves SHALL travel toward the locked note; two open palms SHALL zoom along the axis the camera is already looking down. The user SHALL be able to tell which they are getting from their own hands rather than from remembering whether something is locked. This also removes a failure the hidden-state form could not avoid: with two open palms, one hand's pose dropping out for a few frames leaves a single palm in frame, which reads as aiming — and with the hands already spread apart, that could re-lock onto a different note in the middle of a zoom.

**While ANY hand drives the camera, nothing SHALL aim.** The rule that a pose driving the camera may not also aim it extends to the whole frame: a fist in frame means a drive is live, so the open palm beside it is part of that drive rather than an aim. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**A hand that drives nothing SHALL also show nothing.** The pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") SHALL be produced only by a pose that means to point at something — the inspect pose, or a charging `Pointing_Up` dwell — and SHALL NOT follow a hand that is merely present in frame. A highlight that tracks any hand in any pose lights a cluster the user did not ask about, then another as the hand drifts, which is noise rather than feedback: it reads as the view reacting to the user's hand rather than answering their question. A camera drive SHALL suppress it too, because while the camera is being flown the hand's position means "camera", not "target".

The camera SHALL look at the galaxy's **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") — never at an assumed world origin, and no longer at the graph's centroid unconditionally. **The anchor a camera drive takes SHALL always be a note**, resolved as the note nearest the sight (see `second-brain-galaxy-view`, "The camera is aimed by a sight that follows the hands") within a bounded screen distance and excluding nodes behind the camera. Where two candidate notes overlap on screen, the one **nearer the camera** SHALL win, because that is the one drawn over the other and therefore the only one the user can see to aim at; depth SHALL NOT otherwise outrank aim, since a note's distance is invisible to the user except through that overlap. When no note is near enough the current anchor SHALL be kept, so aiming at empty space neither throws the view back to the middle of the vault nor sends it to some distant note the user never aimed at.

**Aiming and zooming SHALL be carried by different numbers of hands.** A SINGLE open palm SHALL aim, and while two open palms are up there SHALL be no aim point at all, so a zoom cannot re-target however unevenly the hands move. Aiming SHALL commit to nothing, and where more than one hand could aim, the one furthest RIGHT on screen SHALL win — the preview is mirrored, so that is the user's right hand. The sight mark SHALL be shown only while the user is actually aiming, and SHALL be hidden while two palms are zooming, since a mark shown then would claim the zoom is going where it is not.

When a note is locked, the drive SHALL travel toward it. When NO note is locked, the **two-palm** drive SHALL move in and out along the axis the camera is already looking down — the point at the centre of the view, at the distance the camera is currently working at — rather than toward the graph's centroid, which after any travel is usually off-centre and would drift the view sideways.

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

### Requirement: The step rail is reachable end to end without a keyboard

When the user asks Iris aloud to find a note and the galaxy is active, the step
rail SHALL offer what she found, on exactly the terms it offers any other entry:
activating one flies the camera to that note and recentres the rail on it.

This requirement is about **where the rail's search words come from**, not about
what the rail is. What the rail offers, how an entry is activated, that matching
folds case and diacritics, and that a note is reachable by name at all are all
settled by "A note is reachable by stepping through its neighbours" in this same
capability, and SHALL NOT be re-decided here — a spoken search inherits every one
of them.

**Finding a note is the one part of galaxy navigation that the hand cannot begin
on its own.** The universal point-and-hold activates buttons and links; it cannot
put words into a text field, so a rail whose search is typed leaves the hand able
to step the results of a search it has no way to start. Asking is what supplies
the words. With it, reaching a named note is: say it, then point and hold —
neither half requiring a keyboard, and neither adding a gesture.

The spoken search SHALL NOT be a second way of doing something the typed field
does differently: it SHALL offer the same notes, in the same order, for the same
words (see `personal-knowledge-notes`).

A spoken search SHALL NOT change what is selected. It SHALL leave the focus
exactly as it was, SHALL NOT open a note by itself, and SHALL NOT change what the
voice layer or a run reads — the same rule stepping already holds to, for the
same reason: navigating is not selecting.

Asking to find a note while the galaxy is **not** active SHALL still be answered.
The rail is where matches are shown when there is a rail; it is not a
precondition for the question being worth asking, and requiring the user to open
the galaxy first would make the shortest route to a note the longest.

**Opening a found note while the galaxy is not active SHALL bring the galaxy up
with it.** The note reader is part of that layer and does not exist outside it,
so there is no reading of "open it" that shows the note alone; and answering a
request that has already named the note by asking the user to open something
else first is the same longest-route failure, one step further along. The
anchoring rule applies unchanged, because by the time the note is open the galaxy
is exactly as active as it would have been had the user opened it themselves.

This SHALL be a consequence of opening a named note and SHALL NOT become a
spoken control for the galaxy layer: Iris SHALL NOT gain a way to be asked to
open or close the galaxy on its own. A request that opens **nothing** — a refused
ghost match, or a search with no matches — SHALL leave the galaxy exactly as it
found it.

#### Scenario: Saying a note's name fills the rail with it

- **WHEN** the galaxy is active and the user asks Iris to find a note by name
- **THEN** the rail offers the matching notes, and pointing at one and holding steps the camera to it

#### Scenario: Finding a note needs no keyboard and no new gesture

- **WHEN** the user reaches a named note by asking for it and then dwelling on the entry
- **THEN** no keyboard was used and no hand pose beyond the existing point-and-hold was involved

#### Scenario: A spoken search selects nothing

- **WHEN** notes are focused and the user asks Iris to find an unrelated note
- **THEN** the focus is unchanged, no note opens, and nothing the voice layer or a run reads has changed

#### Scenario: The question is answered with the galaxy closed

- **WHEN** the galaxy is not active and the user asks Iris to find a note by name
- **THEN** Iris still answers with what she found, rather than requiring the galaxy to be opened first

#### Scenario: Opening a found note leaves the camera on it

- **WHEN** the user asks for a note by name, asks Iris to open it, and then closes the reader
- **THEN** the camera is anchored on that note, exactly as it is for a note opened by click or by dwell

#### Scenario: Opening a found note with the galaxy shut brings the galaxy up

- **WHEN** the galaxy is not active, the user asks for a note by name and then asks Iris to open it
- **THEN** the galaxy becomes active and the note opens in the reader, and closing the reader leaves the camera anchored on that note as for any other open

#### Scenario: A refusal does not open the galaxy

- **WHEN** the galaxy is not active and the user asks to open a match that has no backing file, or asks for a note that matches nothing
- **THEN** Iris says why, and the galaxy is left inactive — nothing was opened, so nothing was brought up to show it in

#### Scenario: The galaxy is not a thing Iris can be asked to open

- **WHEN** the user asks Iris to open or close the galaxy itself, naming no note
- **THEN** she has no such control — activating the layer is a consequence of opening a named note, not an action of its own

### Requirement: A fist drives the camera only around a note the user chose

**A `Closed_Fist` SHALL drive nothing while no note is locked.** Both fist
drives are defined in terms of the locked note — a fist alone turns around it,
and a fist with an open palm beside it reels the camera in on it — so with
nothing locked neither gesture exists, and the pose SHALL be inert rather than
falling back to some other pivot.

Falling back to the point at the centre of the view SHALL NOT be done for a
turn. That fallback is correct for the two-palm zoom, which only moves in and
out along an axis already on screen, and wrong for a turn, which is entirely
about which axis it is: it reads as the app choosing an axis on the user's
behalf, swinging the whole graph around a pivot they never picked and cannot
see.

**Two open palms SHALL remain ungated.** Free zoom is not defined in terms of a
target, so it works with nothing locked, and requiring a lock for it would make
the galaxy unusable before the user has aimed at anything.

#### Scenario: A fist does nothing until a note is chosen

- **WHEN** the galaxy is active with no note locked and the user makes a `Closed_Fist` and moves it
- **THEN** the camera does not turn, and no pivot is chosen on the user's behalf

#### Scenario: A fist and a palm do nothing until a note is chosen

- **WHEN** no note is locked and the user holds a fist while moving the other open palm
- **THEN** the camera neither turns nor travels

#### Scenario: Free zoom works before anything is locked

- **WHEN** no note is locked and the user spreads two open palms
- **THEN** the camera zooms along the axis it is already looking down

#### Scenario: Choosing a note gives the fist its job back

- **WHEN** the user aims an open palm at a note to lock it and then makes a fist and moves it
- **THEN** the camera turns around that note

### Requirement: A held fist is measured where the hand is, not where the fingers are

The distance the reel-in reads SHALL be measured from the fist's **wrist**, not
from its tracked fingertip. Curling into a fist, or tightening one already
closed, travels the fingertip a long way while the hand itself has not moved,
and the zoom law maps that distance straight to an absolute camera radius — so
finger movement would arrive as camera travel. The turn drive already measures a
fist at the wrist for the same reason, and the two SHALL agree.

Open palms SHALL continue to be measured at their fingertips: an open hand has
no curl to leak, and the two-palm zoom is steady as it stands.

#### Scenario: A held fist holds the camera still

- **WHEN** the user holds a fist in place while their fingers tighten, with the other palm not moving
- **THEN** the camera distance does not change

#### Scenario: The reel-in follows the hand that is moving

- **WHEN** the user holds a fist and moves the other open palm away from it
- **THEN** the camera travels toward the locked note by that hand's movement

