## MODIFIED Requirements

### Requirement: A closed fist orbits the galaxy camera

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta. Zooming the camera is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Victory` targets a node **selection** dwell (no camera motion — see "A held two-finger pose selects a node"), `Closed_Fist` orbits, two open palms zoom, and **any other pose — a single open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

**Highlighting is feedback, not a drive, and is therefore outside this partition.** The node the hand is nearest SHALL be given the pointed-at highlight (see `second-brain-galaxy-view`, "The node being pointed at reveals its link cluster") whatever pose the hand is in, provided no camera drive is engaged — a hand that drives nothing may still show the user what it is pointing at. This does not weaken the partition: a resting hand still *acts* on nothing, since a highlight selects nothing, opens nothing, and moves nothing. Suppressing it during an orbit or a zoom is deliberate: while a camera drive is engaged the hand's position means "camera", not "target".

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

#### Scenario: A resting hand still shows what it points at

- **WHEN** the galaxy is active with hand control on, no camera drive is engaged, and the user's hand is near a node in a pose that drives nothing
- **THEN** that node's cluster is highlighted, and nothing is selected, opened, or moved

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

### Requirement: Focus is reachable without hands

Selecting the focus SHALL be fully available by mouse, and clearing it SHALL be available by mouse and hands-free alike, independent of the hand-control preference. With hand control off, the galaxy and its focus SHALL be usable exactly as they are with it on, and no gesture machinery SHALL run — the existing rule that the gesture layer schedules no per-frame work while hand control is off SHALL continue to hold.

Selection is now **also** reachable by gesture (see "A held two-finger pose selects a node"), but SHALL NEVER be reachable *only* by gesture: every route to a focus SHALL remain available to a user who has hand control off, so the feature is never gated on a camera.

This reverses, on its own stated terms, the earlier recorded decision that there was deliberately no gesture that selected a node. That decision was conditional: the focus existed to give a deictic voice request something to resolve against, the second brain's voice surface was then capture and curation with no tool that opened or pointed at a note, and the decision said adding a selection gesture was worth doing once that consumer was in play. It now is — a resident note-working session opens a note, reads it back verbatim, edits it by conversation, and targets structural edits at the open note (see `open-note-session`). The decision's other half — that a gesture must not quietly toggle a selection the user cannot easily see — SHALL continue to hold, and is what makes the selection gesture a **held** dwell with visible feedback rather than a tap.

Clearing SHALL remain reachable without a mouse, because the clear-focus control lives in the HUD control island, which stays dwell-activatable even while a fullscreen layer is active. A user who selected notes by mouse and then put the mouse down SHALL still be able to release that selection.

#### Scenario: Mouse selection works with hand control off

- **WHEN** hand control is off and the user selects nodes with the mouse
- **THEN** those nodes are focused, the focus indicator names them, and a deictic voice request resolves against them

#### Scenario: Mouse selection works with hand control on

- **WHEN** hand control is on and the user selects nodes with the mouse
- **THEN** those nodes are focused exactly as they are with hand control off — enabling the camera neither adds nor removes a way to select

#### Scenario: No route to the focus requires hands

- **WHEN** hand control is off
- **THEN** selecting and clearing the focus are both still fully available by mouse — the gesture route is additive

#### Scenario: No per-frame work when hand control is off

- **WHEN** hand control is off and the galaxy is active with notes focused
- **THEN** no gesture loop is scheduled

#### Scenario: Clearing works by mouse

- **WHEN** notes are focused and the user activates the clear-focus control with the mouse
- **THEN** the focus is emptied

#### Scenario: Clearing works hands-free

- **WHEN** notes are focused, hand control is on, and the user dwells over the clear-focus control in the HUD control island
- **THEN** the focus is emptied

## ADDED Requirements

### Requirement: A held two-finger pose selects a node

When hand control is enabled and the galaxy is active with no reader open, holding a hand showing `Victory` over a note-node for the HUD's standard dwell duration (300 ms) SHALL toggle that node's membership in the focus — the same result as a Cmd/Ctrl-click on it. The pose SHALL be **held**, not tapped: a selection the user did not intend is worse than one that took a moment, and the focus is read by the voice layer and by Claude's runs.

The gesture SHALL feed **the one authoritative focus** (see `second-brain-focus`), through the same call the mouse's modifier-click makes. It SHALL NOT maintain any second notion of what is selected.

The target SHALL be resolved exactly as the opening dwell resolves it — nearest node to the hand point within the pixel threshold, excluding nodes behind the camera and ghost nodes — so the node that gets selected is the node that was highlighted.

After a selection fires, the same target SHALL NOT fire again until the hand has left it (moved off the node or stopped showing the pose) and re-acquired it. Without this a held pose over one node would toggle it on and off repeatedly, which for a *toggle* is worse than for an open: the user cannot tell from a held pose what state they have ended in.

The selection dwell and the opening dwell SHALL be independent: charging one SHALL NOT charge or cancel-and-restart the other's progress against a different node, and changing pose from one to the other SHALL abandon the abandoned pose's charge rather than transferring it. A selection SHALL NOT move the camera, and SHALL NOT open a note.

Because the pose is resolved per hand rather than from whichever hand is currently primary, a `Victory` hand SHALL be able to select while another hand is present in frame in some other pose.

#### Scenario: Holding two fingers over a node selects it

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the user holds a `Victory` hand over an unselected real note-node for 300 ms
- **THEN** that node becomes focused — identical to Cmd/Ctrl-clicking it — the focus indicator names it, and no note opens

#### Scenario: Holding two fingers over a selected node deselects it

- **WHEN** the user holds a `Victory` hand for 300 ms over a node that is already focused
- **THEN** that node is released from the focus

#### Scenario: A selection does not repeat while the pose is held

- **WHEN** a node has just been selected by the pose and the hand keeps showing it over the same node
- **THEN** the node does not toggle again — the hand must leave the node (or stop showing the pose) and re-acquire it

#### Scenario: Selecting does not open

- **WHEN** the selection pose fires over a node
- **THEN** no note reader opens and the camera does not move

#### Scenario: A ghost node cannot be selected by gesture

- **WHEN** the user holds the selection pose over a faded ghost node
- **THEN** nothing is selected, exactly as a ghost cannot be opened

#### Scenario: The two dwells do not interfere

- **WHEN** the user charges a selection over one node, then changes to the pointing pose over a different node
- **THEN** the selection does not fire, and the opening dwell charges from scratch against the node it is actually over

#### Scenario: The gesture and the mouse produce one focus

- **WHEN** the user selects one note by gesture and another by Cmd/Ctrl-click
- **THEN** both are in the same single focus, and the voice layer and a run's prompt describe both

#### Scenario: The selecting hand need not be the primary hand

- **WHEN** two hands are in frame, one showing `Victory` over a node and the other in some other pose
- **THEN** the `Victory` hand's target is the one that gets selected
