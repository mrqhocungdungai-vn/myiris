## MODIFIED Requirements

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

## ADDED Requirements

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
