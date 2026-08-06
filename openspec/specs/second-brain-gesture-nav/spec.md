# second-brain-gesture-nav Specification

## Purpose
Hands-free navigation of the second-brain galaxy: point-and-dwell opens a node, a held two-finger pose reveals what a node is connected to without opening or selecting it, a closed fist orbits the camera, two open palms zoom it, and the gestures carry into the note reader once a node is open. One authoritative gesture context governs the galaxy and its reader together, so the two can never disagree about which layer owns the pointing hand. It follows the same hand-control opt-in as the rest of the gesture surface, and suspends while Iris is asleep.
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

### Requirement: A closed fist orbits the galaxy camera

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta. Zooming the camera is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Victory` **inspects** a node (no camera motion, and nothing selected or opened — see "A held two-finger pose reveals a node's link cluster"), `Closed_Fist` orbits, two open palms zoom, and **any other pose — a single open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**A hand that drives nothing SHALL also show nothing.** The pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") SHALL be produced only by a pose that means to point at something — the inspect pose, or a charging `Pointing_Up` dwell — and SHALL NOT follow a hand that is merely present in frame. A highlight that tracks any hand in any pose lights a cluster the user did not ask about, then another as the hand drifts, which is noise rather than feedback: it reads as the view reacting to the user's hand rather than answering their question. A camera drive SHALL suppress it too, because while an orbit or a zoom is engaged the hand's position means "camera", not "target".

The camera SHALL always look at the graph's orbit center (an explicit center, not assumed to be the world origin). The orbit drive SHALL be **relative**: the first frame after it (re)engages SHALL seed its reference from the hand point and apply no motion, with subsequent frames applying only the delta from that reference, so engaging a fist never snaps the camera. Seeding SHALL re-derive from the **live** camera, so a gesture drive that begins after the user moved the camera with the mouse continues from where the mouse left it rather than jumping back to where gesture control last was. The camera drive SHALL be smooth and stable (built on the smoothed hand point, with small per-frame deltas). These bindings SHALL engage only while the galaxy is active and no reader is open, so they never collide with the reader's `Closed_Fist`-closes-reader binding or with the deck's fist-rotates-the-orb binding. **Mouse drag/scroll camera control SHALL remain working after every exit from a gesture drive** — not only when a gesture is released, but also when hand control is switched off mid-drive, a reader opens mid-drive, Iris goes to sleep mid-drive, or the hand simply leaves the frame; the gesture drive SHALL NOT be able to leave the built-in camera controls permanently disabled for the rest of the galaxy session.

#### Scenario: Fist orbits the camera

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the primary hand shows `Closed_Fist` while moving
- **THEN** the galaxy camera orbits around the graph following the hand's movement delta

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
- **THEN** the orbit continues from the camera's current position — it does not snap back to where the previous gesture drive ended

#### Scenario: Mouse camera control still works

- **WHEN** the user drags or scrolls on the galaxy with a mouse/trackpad
- **THEN** the built-in camera controls respond as before — the gesture drive does not disable mouse control

#### Scenario: Mouse control survives every exit from a gesture drive

- **WHEN** a gesture camera drive ends by any route — the gesture is released, hand control is switched off mid-drive, a note opens mid-drive, Iris goes to sleep mid-drive, or the hand leaves the frame
- **THEN** mouse drag/zoom still works for the rest of the galaxy session and the camera does not jump when mouse control resumes

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

Gesture bindings SHALL follow one authoritative context precedence so no two bindings act on the same gesture at once: (1) when a reader is open, only the reader's bindings run and the galaxy node-dwell and camera-nav bindings are suppressed; (2) when the galaxy is active with no reader open, the galaxy node-dwell and camera-nav bindings run and the deck's orb/universal-dwell/scroll bindings are suppressed; (3) otherwise the deck behaves as before. That precedence SHALL be derived from one shared, testable resolution of the current context rather than re-stated independently by each new consumer, so a future binding cannot disagree about which layer owns the hand. Two things SHALL survive the suppression in (2): the HUD control island stays dwell-activatable (so the galaxy can be closed hands-free — see `two-hand-gestures`), and the gesture action indicator SHALL report the binding that is actually live in the current context rather than a deck binding the galaxy has taken over. (The lifecycle rule that closing the galaxy dismisses an open note belongs to the galaxy layer itself and is specified in `second-brain-galaxy-view`.)

The indicator SHALL name the live binding from a signal that actually reaches it. A binding reported from a continuously-varying measurement that the hand state deliberately withholds from the UI — so that per-frame tracking never forces a re-render — SHALL NOT be used, because the label would then describe a value from whenever the state last changed for some other reason.

#### Scenario: Reader open suppresses galaxy navigation

- **WHEN** a vault note is open over the galaxy
- **THEN** node-dwell and camera orbit/zoom do not act — only the reader's own bindings respond — so a fist closes the reader rather than orbiting the camera, and two open palms resize the reader rather than dollying the camera

#### Scenario: Galaxy active suppresses deck gestures

- **WHEN** the galaxy is active and no reader is open
- **THEN** the deck's fist-rotates-the-orb, universal point-and-dwell click, and open-palm panel scroll do not fire — the galaxy's own node-dwell and camera nav own the surface

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
