## Purpose

Hands as an input device for the deck: two hands tracked independently with per-hand stabilization, a universal point-and-hold click that works on any interactive element, two-palm resize for the reader, and per-hand reticles so the user can see what the system believes their hands are doing. Gesture control is an opt-in persisted preference and its camera is user-selectable — it is never switched on for someone who did not ask for it, and destructive controls are deliberately excluded from the dwell path.
## Requirements
### Requirement: Two hands tracked with per-hand stabilization

The gesture engine SHALL track up to two hands simultaneously (`numHands: 2`), stabilize gesture classification per hand (per-hand candidate/stable maps), expose a `TrackedHand[]` state (id, smoothed point, mirrored landmarks, gesture flags), and select a primary hand (preferring the pointing hand, with anti-flicker continuity). The MediaPipe package version and WASM URL version SHALL remain equal (0.10.35).

**Every** tracked hand's point SHALL be smoothed, not only the primary hand's. A binding that reads two hands at once measures the *relation* between them, and an unsmoothed second hand injects that hand's full frame-to-frame tracking noise into the result — noise that a single-hand binding never sees, because it only ever reads the smoothed primary. Smoothing SHALL be per hand, so one hand's motion never damps another's.

A hand's smoothing history SHALL be discarded when that hand leaves the frame, on the same terms as its stabilized gesture. A hand that reappears SHALL seed afresh from its current position rather than easing in from where it was last seen, so a hand leaving and returning produces no motion the user did not make.

#### Scenario: Both hands visible

- **WHEN** two hands are in the camera frame
- **THEN** the state lists two tracked hands with independent gesture classification, and one is designated primary

#### Scenario: The secondary hand's point is smoothed too

- **WHEN** two hands are tracked and neither is designated primary in turn
- **THEN** both hands' published points are smoothed — the non-primary hand does not carry raw tracking coordinates

#### Scenario: A hand that left and came back does not ease in

- **WHEN** a tracked hand leaves the camera frame and later reappears somewhere else
- **THEN** its published point starts at its current position rather than travelling from its last-seen position

#### Scenario: Pin preserved

- **WHEN** dependencies are inspected
- **THEN** `@mediapipe/tasks-vision` and the WASM_URL version are both 0.10.35

### Requirement: Gesture control is an opt-in, persisted preference

Gesture (hand/camera) control SHALL be an opt-in preference that is persisted across sessions, defaulting to **off**. The gesture engine SHALL acquire the camera and load its MediaPipe assets only while the preference is enabled; launching or connecting Iris SHALL NOT turn on the webcam or load those assets by default. Toggling the preference SHALL persist the new value (like the sound and camera-device preferences), so enabling it once carries to the next session, and disabling it releases the camera.

#### Scenario: Camera stays off at launch by default

- **WHEN** Iris connects and the user has never enabled gesture control
- **THEN** the webcam is not acquired and MediaPipe assets are not loaded — the camera LED stays off

#### Scenario: The preference persists across sessions

- **WHEN** the user enables gesture control and later relaunches Iris
- **THEN** gesture control is enabled again on the next session without re-toggling, and disabling it likewise persists as off

### Requirement: Device-selectable camera acquisition

The gesture engine's camera acquisition SHALL accept a selected video input device identifier (a `deviceId`, or a `"System Default"` sentinel) and use it to constrain `getUserMedia`: the System Default sentinel SHALL preserve the unconstrained `facingMode: "user"` behavior, while an explicit `deviceId` SHALL be requested via an exact `deviceId` constraint with no `facingMode` constraint applied. A change to the selected device SHALL be treated as a reason to re-acquire the camera stream — tearing down the previous stream, recognizer, and tracking loop before acquiring the new one — including while gesture control is already enabled and running.

If the selected device cannot be opened (not present among current devices, or `getUserMedia` rejects), the engine SHALL surface that failure through its existing error-reporting path and SHALL NOT silently retry with a different device or with the system default; gesture control remains unavailable until the failure is resolved (e.g. the user starts the missing device or selects a different one). When a subsequent acquire succeeds — or when gesture control is disabled — the engine SHALL clear the previously reported error, so a transient failure does not remain displayed after it has been resolved.

#### Scenario: System Default preserves prior behavior

- **WHEN** the selected device is System Default (or no selection has ever been made)
- **THEN** the camera is acquired exactly as before this change, with no `deviceId` constraint

#### Scenario: Explicit device selected

- **WHEN** a specific `deviceId` is selected
- **THEN** `getUserMedia` is called with that `deviceId` as an exact constraint and no `facingMode` constraint

#### Scenario: Device changes while gesture control is running

- **WHEN** gesture control is active and the selected device changes
- **THEN** the previous stream, recognizer, and tracking loop are torn down and a new stream is acquired from the newly selected device, without requiring the user to toggle gesture control off and on

#### Scenario: Selected device unavailable

- **WHEN** the selected device cannot be opened (missing or rejected by `getUserMedia`)
- **THEN** the failure is reported through the existing hand-control error path and gesture control does not silently start using a different camera

#### Scenario: Error clears when a re-acquire succeeds

- **WHEN** a camera failure has been reported and a later acquire succeeds (the user fixed the device or selected a different one), or gesture control is disabled
- **THEN** the previously reported error is cleared and no longer displayed

### Requirement: Universal point-and-hold click

A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including question answer options, step-timeline toggles, chips, and close buttons — EXCEPT elements explicitly marked as dwell-excluded (`[data-no-dwell]`, or any element contained within one), and EXCEPT while a reader overlay owns the gesture surface or while the hand is over a HUD layer (the second-brain galaxy or the drawing panel) that binds the pointing hand to its own semantics. Dwell exclusion SHALL be reserved for destructive or irreversible controls — those whose action loses data or cannot be undone (e.g. removing the saved subscription token, starting a new session, switching the project folder) — so that a merely hovering hand cannot fire them. Excluded controls SHALL remain fully operable by mouse and by voice; only the hands-free dwell path skips them, and the dwell indicator SHALL NOT engage on them.

**Gesture ownership SHALL follow one rule with two consequences: hand reach SHALL follow mouse reach.** Any control that is visible and clickable with the mouse at a given moment SHALL be reachable by dwell at that moment, and any surface the mouse cannot reach SHALL be closed to the hand too. A control SHALL never be visible and mouse-clickable yet untouchable by hand.

That rule yields the two modes the HUD actually has, without either needing to be declared separately:

- **Coexisting layers share the hand by position.** The Glass HUD paints its chrome — the tasks column, the comms column, the review/question stack, and the orb island with its controls and focus chip — *above* an open galaxy or drawing panel, where that chrome stays visible and mouse-clickable. Over that chrome the dwell SHALL keep working exactly as it does with no layer open; only elements belonging to the layer itself SHALL be suppressed. In particular this keeps the HUD's control island dwell-activatable, so any layer the user can open hands-free can also be closed hands-free.
- **An open reader holds the hand exclusively.** A reader overlay — the task run-reader or the vault note reader — paints a full-screen backdrop over the whole HUD, so no chrome behind it is mouse-reachable; the dwell SHALL therefore be suppressed everywhere while a reader is open, and the reader's own bindings SHALL be the only ones that act. Closing the reader SHALL return the hand to the shared mode above, with no toggle and no re-acquisition step.

This SHALL hold for **both** readers alike. A reader that suppresses the dwell only because some other layer happens to be open at the same time is not satisfying this requirement — the suppression SHALL be conditioned on a reader being open.

The set of HUD chrome SHALL be declared in one place that the stacking and the gesture rule both derive from, rather than each naming the islands independently — a chrome island added later SHALL become hand-reachable by virtue of being chrome, not by a second edit to the gesture rule.

#### Scenario: Dwell-click a button

- **WHEN** the user points at a question option button and holds for the dwell duration
- **THEN** that option is selected exactly as a mouse click would

#### Scenario: Dwell-open still works

- **WHEN** the user points at a task card and dwells
- **THEN** the reader opens for that task (existing behavior preserved)

#### Scenario: Dwell over a destructive control does nothing

- **WHEN** the user's hand dwells over a control marked `[data-no-dwell]` (e.g. "Remove token", "New session")
- **THEN** no click is triggered and the dwell indicator does not engage on it
- **AND** the same control is still activatable by a mouse click or by voice

#### Scenario: DOM dwell is suppressed over the layer's own surface

- **WHEN** the second-brain galaxy or the drawing panel is active and the hand points at a spot the layer occupies
- **THEN** the DOM point-and-hold click does not fire there — the layer's own gesture bindings own the pointing hand

#### Scenario: A task card stays dwell-openable under an active layer

- **WHEN** the galaxy (or the drawing panel) is active and the user dwells over a task card in the HUD's work stream
- **THEN** that task's reader opens, exactly as it would with no layer active

#### Scenario: The HUD control island stays dwell-reachable under a layer

- **WHEN** a HUD layer (the galaxy or the drawing panel) is active and the user dwells over the HUD control island's toggle for that layer
- **THEN** the toggle still activates, so the layer can be closed hands-free without reaching for the mouse or Esc

#### Scenario: Hand reach follows mouse reach

- **WHEN** a HUD layer is active and a piece of HUD chrome — a column toggle, a review banner's button, a chip, the focus-clear control — is visible and clickable with the mouse
- **THEN** the same control is reachable by dwell, with no per-control exception needed

#### Scenario: An open reader takes every gesture

- **WHEN** a task or a vault note is opened, whether or not the galaxy is active behind it
- **THEN** the dwell fires on nothing outside that reader — not on a task card, not on a column toggle, not on the orb island — and only the reader's own bindings respond

#### Scenario: Closing the reader hands the surface back

- **WHEN** the user closes the reader and the galaxy is still active behind it
- **THEN** HUD chrome is dwell-clickable again and the galaxy owns its own surface again, immediately and with no re-toggle

#### Scenario: The note reader holds the hand on its own terms

- **WHEN** a vault note is open over the galaxy — the galaxy being active is now what makes HUD chrome hand-reachable in the first place
- **THEN** the chrome is nonetheless closed to the hand, because the open reader is what decides it; the note reader's exclusivity does not depend on any other layer's suppression

### Requirement: Two open palms scale the layer that owns the gesture surface

Two simultaneously open palms SHALL scale whatever layer currently owns the gesture surface, and SHALL do nothing when no layer does. This is one binding with one meaning — "scale what we are working on" — routed by the same context precedence that governs every other gesture, not a separate binding per layer.

Concretely: with a reader overlay open (the task run-reader or the vault note reader, which share one reader core) two open palms SHALL scale the reader; with the second-brain galaxy active and no reader open they SHALL dolly the galaxy camera; otherwise they SHALL scale nothing. Because a reader outranks the galaxy, opening a note moves the binding to the note and closing it moves the binding back to the galaxy, with no gesture changing meaning in the user's hands.

In both cases the scale SHALL follow the **distance between the two hands** and SHALL be **relative**: the frame the pose engages SHALL seed a reference from the live state and apply no motion, and later frames SHALL apply only the ratio of the current distance to that reference — so engaging never snaps, and a drive that begins after the user has scaled something by mouse continues from where the mouse left it. Spreading the hands apart SHALL scale **up** — a larger reader, or a camera brought closer to the graph — so the same motion means the same thing whichever layer holds it. Camera dolly SHALL be measured toward the galaxy's current **anchor** (see `second-brain-galaxy-view`, "The camera turns and dollies around a movable anchor") rather than toward the graph's centre, so spreading the hands brings the camera to the note the user is looking at instead of into the middle of the graph — which is its densest and least informative region. Neither zoom pose SHALL itself aim: while a camera drive is live there is no aim point, so the distance between the hands supplies magnitude only. This is what keeps an uneven spread from re-targeting the camera. **Two open palms** SHALL zoom along the axis the camera is already looking down, keeping what is at the centre of the view at the centre. **A fist together with an open palm** SHALL instead travel toward the note a single aiming hand last locked (see `second-brain-gesture-nav`), so which zoom is running is visible in the hands rather than dependent on hidden state. The dolly SHALL remain clamped so the camera neither passes through its anchor nor flies away from the graph.

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

### Requirement: Per-hand reticles and hand skeleton

The UI SHALL render one reticle per tracked hand (secondary hand visually distinct) via a `HandReticles` component, and the camera dock SHALL render a 21-landmark hand skeleton for each tracked hand.

#### Scenario: Reticles follow hands

- **WHEN** two hands are tracked
- **THEN** two reticles render at their smoothed screen positions and the camera dock shows both skeletons

### Requirement: Fist rotates and pinch scales the orb

When hand control is enabled, the UI is in deck mode, the reader overlay is closed, and no fullscreen HUD layer (the second-brain galaxy or the drawing panel) is active, the primary hand showing `Closed_Fist` SHALL incrementally rotate the Arc Reactor orb by the hand's movement delta, and either tracked hand's thumb-tip-to-index-tip pinch distance SHALL scale the orb within a clamped range. These bindings SHALL NOT engage while the reader overlay is open, so they never collide with the existing reader-open `Closed_Fist`-closes-reader or two-palm-resize bindings; and they SHALL NOT engage while the galaxy or the drawing panel owns the HUD surface, so a fist meant to orbit the galaxy camera never also rotates the orb underneath it. They SHALL NOT engage while the Glass HUD overlay is active at all — in HUD the orb is a small floating puck over the user's desktop rather than the stage, so the gesture surface belongs to the content the overlay hosts (the transcript, the work stream, and whatever layer is open), and a fist or pinch made anywhere over the HUD SHALL leave the orb untouched even when no fullscreen layer is open. The orb component's rotation and scale inputs SHALL remain part of its prop surface and SHALL keep being applied whenever they are driven — only the deck's driver is scoped, not the orb's ability to rotate or scale. The gesture action indicator SHALL report the binding that is actually live for the current context, never a binding that the active layer or the current UI mode has taken over.

#### Scenario: Fist rotates the orb

- **WHEN** hand control is enabled, the UI is in deck mode, the reader is closed, no fullscreen HUD layer is active, and the primary hand shows `Closed_Fist` while moving
- **THEN** the orb's rotation follows the hand's movement delta

#### Scenario: Pinch scales the orb

- **WHEN** hand control is enabled, the UI is in deck mode, the reader is closed, no fullscreen HUD layer is active, and a tracked hand's thumb-index pinch distance changes
- **THEN** the orb's scale follows the pinch distance, clamped to a reasonable range

#### Scenario: Reader-open gestures unaffected

- **WHEN** the reader overlay is open
- **THEN** `Closed_Fist` still closes the reader and two open palms still resize it exactly as before, with no orb rotation or scale applied

#### Scenario: Galaxy-active gestures do not touch the orb

- **WHEN** the second-brain galaxy (or the drawing panel) is active
- **THEN** a `Closed_Fist` or pinch drives that layer's own camera/tools and does NOT rotate or scale the orb behind it

#### Scenario: The Glass HUD never rotates or scales the orb

- **WHEN** the Glass HUD overlay is active, hand control is enabled, no reader and no fullscreen layer is open, and the user makes a `Closed_Fist` while moving or changes their pinch distance
- **THEN** the HUD orb's rotation and scale are unchanged, and the hand's motion is free to serve the HUD's content bindings instead

#### Scenario: Entering the HUD mid-gesture leaves the orb where it was

- **WHEN** the user is rotating or scaling the orb on the deck and the UI switches to the Glass HUD while the gesture is still held
- **THEN** the binding disengages, the orb stops following the hand, and its rotation and scale hold at their last deck values rather than snapping

#### Scenario: Returning to the deck restores the binding

- **WHEN** the UI leaves the Glass HUD back to deck mode with hand control enabled, the reader closed and no fullscreen layer active
- **THEN** a `Closed_Fist` rotates the orb again, and the first frame after re-engaging seeds its movement reference without applying rotation, so the orb's rotation does not jump — scale, being an absolute mapping of the current pinch distance rather than a delta, resumes tracking the hand's present pinch as it already does after any other disengagement

#### Scenario: The action indicator names the live binding

- **WHEN** the galaxy is active and the user makes a fist (which orbits the galaxy camera)
- **THEN** the gesture action indicator reports the orbit binding, not "idle" and not "rotate orb"

#### Scenario: The action indicator does not name orb rotation in the HUD

- **WHEN** the Glass HUD is active with no reader and no fullscreen layer open, and the user makes a `Closed_Fist`
- **THEN** the gesture action indicator does not report an orb rotate binding, because that binding cannot fire in this context

