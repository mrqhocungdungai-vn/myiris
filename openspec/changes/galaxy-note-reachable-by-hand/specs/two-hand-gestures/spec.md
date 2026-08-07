## MODIFIED Requirements

### Requirement: Two open palms scale the layer that owns the gesture surface

Two simultaneously open palms SHALL scale whatever layer currently owns the gesture surface, and SHALL do nothing when no layer does. This is one binding with one meaning — "scale what we are working on" — routed by the same context precedence that governs every other gesture, not a separate binding per layer.

Concretely: with a reader overlay open (the task run-reader or the vault note reader, which share one reader core) two open palms SHALL scale the reader; with the second-brain galaxy active and no reader open they SHALL dolly the galaxy camera; otherwise they SHALL scale nothing. Because a reader outranks the galaxy, opening a note moves the binding to the note and closing it moves the binding back to the galaxy, with no gesture changing meaning in the user's hands.

In both cases the scale SHALL follow the **distance between the two hands** and SHALL be **relative**: the frame the pose engages SHALL seed a reference from the live state and apply no motion, and later frames SHALL apply only the ratio of the current distance to that reference — so engaging never snaps, and a drive that begins after the user has scaled something by mouse continues from where the mouse left it. Spreading the hands apart SHALL scale **up** — a larger reader, or a camera brought closer to the graph — so the same motion means the same thing whichever layer holds it. Camera dolly SHALL be measured toward the galaxy's current **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") rather than toward the graph's centre, so spreading the hands brings the camera to the note the user is looking at instead of into the middle of the graph — which is its densest and least informative region. The anchor it dollies toward SHALL be whatever a SINGLE aiming hand last locked (see `second-brain-gesture-nav`), and the two-palm pose SHALL NOT itself aim: while both palms are up there is no aim point, so the distance between them supplies magnitude only. This is what keeps an uneven spread from re-targeting the camera. With no note locked the dolly SHALL run along the axis the camera is already looking down, keeping what is at the centre of the view at the centre. The dolly SHALL remain clamped so the camera neither passes through its anchor nor flies away from the graph.

Losing the pose — a hand leaving the frame, or either hand ceasing to read as an open palm — SHALL release the reference rather than freeze it. Re-engaging SHALL seed a new reference from the live state, so a momentary tracking dropout pauses the scaling instead of jumping it.

A fist SHALL still close an open reader, and open-palm hold-to-scroll SHALL keep working on the reader body. Panel hold-to-scroll SHALL follow the same two modes as the dwell, from the same rule: while **either** reader is open it SHALL NOT engage on any panel, because the reader holds the hand exclusively until it is closed; while a coexisting layer (the galaxy or the drawing panel) is open it SHALL NOT engage over that layer's own surface but SHALL keep working over HUD chrome, so the tasks and comms columns stay scrollable by hand for as long as the layer is open.

**A two-palm scale SHALL never also scroll a panel.** Whenever two open palms are up, panel hold-to-scroll SHALL be suppressed everywhere, so a palm that happens to pass over a column while the user is zooming the galaxy or resizing a reader scrolls nothing.

The per-frame gesture work for all of this SHALL only run while the hand-control preference is enabled.

#### Scenario: Resize a reader with two palms

- **WHEN** a reader is open and both hands show open palms
- **THEN** moving the hands apart/together scales the reader and the action indicator reports the resize binding

#### Scenario: Zoom the galaxy with two palms

- **WHEN** the second-brain galaxy is active with no reader open and both hands show open palms
- **THEN** moving the hands apart/together dollies the galaxy camera toward/away from its current anchor, clamped so it neither passes through that anchor nor flies away from the graph, and the action indicator reports the zoom binding

#### Scenario: Zooming in arrives at a note, not at the middle of the graph

- **WHEN** a node is the galaxy's anchor and the user spreads their palms to dolly all the way in
- **THEN** the camera arrives at that note rather than at the centre of the graph

#### Scenario: Engaging the zoom takes hold of what the hands are over

- **WHEN** a node is near the sight — the midpoint between the two palms — and the user raises two open palms
- **THEN** that node becomes the anchor the dolly moves toward, and it is kept when the second palm comes up

#### Scenario: The zoom keeps aiming while it is held

- **WHEN** the user is already dollying with two open palms and moves both hands onto a different region of the graph
- **THEN** the dolly re-aims onto whatever is under the sight there, continuing from the camera's current position rather than jumping

#### Scenario: Spreading the hands always means bigger

- **WHEN** the user spreads their hands apart, first over the galaxy and then over an open note
- **THEN** the camera moves closer in the first case and the reader grows in the second — the motion means the same thing in both

#### Scenario: Opening a note moves the binding to the note

- **WHEN** the galaxy is active, the user opens a note, and then shows two open palms
- **THEN** the note is resized and the galaxy camera does not move; closing the note returns the binding to the camera

#### Scenario: Engaging the pose does not snap

- **WHEN** the user brings both palms into view already held far apart, over a galaxy the camera has been moved around by mouse
- **THEN** the first frame applies no motion and seeds its reference from the camera's current position — later frames move only by the change from that reference

#### Scenario: A dropout pauses rather than jumps

- **WHEN** one hand briefly leaves the frame mid-scale and returns
- **THEN** the scaling pauses and resumes from the layer's current scale — it does not jump to where the interrupted gesture would have reached

#### Scenario: Two palms with no layer active do nothing

- **WHEN** neither a reader nor the galaxy is active and the user shows two open palms
- **THEN** nothing is scaled

#### Scenario: Both readers respond to the same bindings

- **WHEN** the open reader is the vault note reader (rather than the task run-reader)
- **THEN** fist-close, two-palm scale, and open-palm scroll behave identically — the bindings belong to the shared reader core, not to one reader

#### Scenario: Panel scroll is suppressed over the layer's own surface

- **WHEN** the galaxy or the drawing panel is active and a single open palm is held over the layer itself
- **THEN** open-palm hold-to-scroll scrolls nothing

#### Scenario: The task column stays scrollable under an active layer

- **WHEN** the galaxy (or the drawing panel) is active and a single open palm is held high or low over the HUD's task or comms column
- **THEN** that column scrolls, exactly as it would with no layer active

#### Scenario: A zoom does not scroll a column it passes over

- **WHEN** the user zooms the galaxy with two open palms and one of those palms drifts over the task column
- **THEN** the column does not scroll — only the camera moves
