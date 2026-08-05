## ADDED Requirements

### Requirement: A closed fist orbits the galaxy camera

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta. Zooming the camera is not a galaxy-specific binding: it is the two-open-palms rule that scales whatever layer owns the gesture surface (see `two-hand-gestures`), and it applies here because the galaxy is such a layer.

The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Closed_Fist` orbits, two open palms zoom, and **any other pose — a single open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**. In particular a pinch SHALL have no meaning in the galaxy: the thumb-index distance SHALL NOT move the camera, select anything, or disturb a charging dwell, however tightly the fingers are closed.

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

#### Scenario: Gesture orbit resumes from where the mouse left the camera

- **WHEN** the user moves the camera with a mouse drag and then engages a fist to orbit
- **THEN** the orbit continues from the camera's current position — it does not snap back to where the previous gesture drive ended

#### Scenario: Mouse camera control still works

- **WHEN** the user drags or scrolls on the galaxy with a mouse/trackpad
- **THEN** the built-in camera controls respond as before — the gesture drive does not disable mouse control

#### Scenario: Mouse control survives every exit from a gesture drive

- **WHEN** a gesture camera drive ends by any route — the gesture is released, hand control is switched off mid-drive, a note opens mid-drive, Iris goes to sleep mid-drive, or the hand leaves the frame
- **THEN** mouse drag/zoom still works for the rest of the galaxy session and the camera does not jump when mouse control resumes

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: A closed fist orbits the galaxy camera and a pinch zooms it

**Reason**: The pinch half of this requirement could not be made to work. Recognizing a pinch required an explicit predicate over the thumb-index distance, but that distance is an absolute image measurement never scaled by hand size, so its engage threshold was comparable to a whole hand length — a genuine fist satisfied it. The fist branch therefore had to be checked first and win, which meant a real pinch, once the recognizer read it as a fist, flipped the camera between orbiting and dollying. The tap-versus-hold discrimination window, its release-streak hysteresis and the resulting state machine all existed to service that pinch and go with it.

Zoom is replaced by the two-open-palms rule in `two-hand-gestures`, which uses poses that cannot be confused with a fist and measures the *relation* between two hands rather than an absolute distance. Orbit is carried forward unchanged by "A closed fist orbits the galaxy camera".

**Migration**: Users zoom the galaxy by holding up two open palms and moving them apart (closer) or together (further away), the same motion that resizes an open note. Selecting a node by a quick pinch is removed with no gesture replacement — see "Focus is reachable without hands" for the recorded reasoning and the mouse and control-island paths that remain.
