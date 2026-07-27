## ADDED Requirements

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

### Requirement: A closed fist orbits the galaxy camera and a pinch zooms it

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta, and an **explicitly detected** thumb-tip-to-index-tip pinch SHALL dolly the camera toward/away from the graph within a clamped range. The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Closed_Fist` orbits, a detected pinch zooms, and **any other pose — an open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. Zoom SHALL NOT be the leftover branch of that partition: the recognizer publishes no pinch class, only a continuous pinch distance, so a pinch SHALL be recognized by an explicit predicate with hysteresis (engage and release thresholds) rather than inferred from "not pointing and not fisting" — otherwise a resting hand, or the two open palms that mean *resize*, would dolly the camera. The pinch distance that naturally drifts while pointing SHALL NOT dolly the camera and slide a charging dwell off its target. The camera SHALL always look at the graph's orbit center (an explicit center, not assumed to be the world origin). Both camera drives SHALL be **relative**: the first frame after a drive (re)engages SHALL seed its reference — the hand point for orbit, the pinch distance and current radius for zoom — and apply no motion, with subsequent frames applying only the delta from that reference, so engaging a pose never snaps the camera. Seeding SHALL re-derive from the **live** camera, so a gesture drive that begins after the user moved the camera with the mouse continues from where the mouse left it rather than jumping back to where gesture control last was. The camera drive SHALL be smooth and stable (built on the smoothed hand point, with small per-frame deltas). These bindings SHALL engage only while the galaxy is active and no reader is open, so they never collide with the reader's `Closed_Fist`-closes-reader binding or with the deck's fist-rotates-the-orb binding. **Mouse drag/scroll camera control SHALL remain working after every exit from a gesture drive** — not only when a gesture is released, but also when hand control is switched off mid-drive, a reader opens mid-drive, Iris goes to sleep mid-drive, or the hand simply leaves the frame; the gesture drive SHALL NOT be able to leave the built-in camera controls permanently disabled for the rest of the galaxy session.

#### Scenario: Fist orbits the camera

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the primary hand shows `Closed_Fist` while moving
- **THEN** the galaxy camera orbits around the graph following the hand's movement delta

#### Scenario: Pinch zooms the camera

- **WHEN** hand control is on, the galaxy is active, no reader is open, and a tracked hand's thumb-index pinch distance changes
- **THEN** the camera dollies toward/away from the graph, clamped so it neither passes through the center nor flies away

#### Scenario: Pointing to open does not zoom the camera

- **WHEN** the user holds `Pointing_Up` over a node to charge a dwell and the thumb-index distance drifts as a side effect of the pose
- **THEN** the camera does not dolly — zoom engages only in a deliberate pinch pose (not while pointing) — so the dwell target stays under the pointer

#### Scenario: A resting hand does not move the camera

- **WHEN** the galaxy is active with hand control on and the user's hand is simply present in frame in some other pose (open palm, an unrecognized gesture, or two open palms)
- **THEN** the camera does not orbit or dolly — no drive engages unless the hand is fisting or in a recognized pinch

#### Scenario: Gesture orbit resumes from where the mouse left the camera

- **WHEN** the user moves the camera with a mouse drag and then engages a fist to orbit
- **THEN** the orbit continues from the camera's current position — it does not snap back to where the previous gesture drive ended

#### Scenario: Mouse camera control still works

- **WHEN** the user drags or scrolls on the galaxy with a mouse/trackpad
- **THEN** the built-in camera controls respond as before — the gesture drive does not disable mouse control

#### Scenario: Mouse control survives every exit from a gesture drive

- **WHEN** a gesture camera drive ends by any route — the gesture is released, hand control is switched off mid-drive, a note opens mid-drive, Iris goes to sleep mid-drive, or the hand leaves the frame
- **THEN** mouse drag/zoom still works for the rest of the galaxy session and the camera does not jump when mouse control resumes

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

#### Scenario: Reader open suppresses galaxy navigation

- **WHEN** a vault note is open over the galaxy
- **THEN** node-dwell and camera orbit/zoom do not act — only the reader's own bindings respond — so a fist closes the reader rather than orbiting the camera

#### Scenario: Galaxy active suppresses deck gestures

- **WHEN** the galaxy is active and no reader is open
- **THEN** the deck's fist-rotates-the-orb, universal point-and-dwell click, and open-palm panel scroll do not fire — the galaxy's own node-dwell and camera nav own the surface

#### Scenario: The galaxy can be closed hands-free

- **WHEN** the galaxy is active with hand control on and the user dwells over the "show second brain" toggle in the HUD control island
- **THEN** the toggle fires and the galaxy closes — the layer's gesture suppression does not trap the user into reaching for the mouse or Esc

#### Scenario: The action indicator names the galaxy's live binding

- **WHEN** the galaxy is active and the user makes a fist, pinches, or charges a node dwell
- **THEN** the gesture action indicator reports the galaxy binding that is live (orbit / zoom / opening a node), not a deck binding and not "idle"

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
