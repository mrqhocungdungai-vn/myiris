## MODIFIED Requirements

### Requirement: A single authoritative gesture context governs the galaxy and its reader

Gesture bindings SHALL follow one authoritative context precedence so no two bindings act on the same gesture at once: (1) when a reader is open, only the reader's bindings run and the galaxy node-dwell and camera-nav bindings are suppressed; (2) when the galaxy is active with no reader open, the galaxy node-dwell and camera-nav bindings run and the deck's orb/universal-dwell/scroll bindings are suppressed; (3) otherwise the deck behaves as before. That precedence SHALL be derived from one shared, testable resolution of the current context rather than re-stated independently by each new consumer, so a future binding cannot disagree about which layer owns the hand. Two things SHALL survive the suppression in (2): the HUD chrome the galaxy is painted beneath stays hand-operable (see below and `two-hand-gestures`), and the gesture action indicator SHALL report the binding that is actually live in the current context rather than a deck binding the galaxy has taken over. (The lifecycle rule that closing the galaxy dismisses an open note belongs to the galaxy layer itself and is specified in `second-brain-galaxy-view`.)

**The precedence has two modes, and which applies is already visible on screen.** A reader is a *focus*: it paints a full-screen backdrop, takes every gesture, and holds them until it is closed — that is level (1), and it is unchanged. The galaxy is not a focus: it paints no backdrop and coexists with the HUD chrome above it, so level (2) is **positional rather than modal**.

**The galaxy owns the hand only where the galaxy is the top layer.** The galaxy is rendered *beneath* the Glass HUD's chrome — the tasks column, the comms column, the review/question stack, and the orb island — which stays visible and mouse-clickable over it. Over that chrome the HUD's own bindings run; over the galaxy itself the galaxy's do. Suppressing the deck bindings wherever the galaxy is merely *active* leaves controls the user can see and click but cannot touch by hand, which is what this precedence exists to prevent rather than to cause.

**Closing a focus SHALL return the hand to the shared mode with nothing to re-acquire.** Dismissing a note SHALL restore, in the same frame, both the galaxy's own bindings and the HUD chrome's — no re-toggle of hand control, no re-entering the galaxy, and no camera jump from a drive that was live when the reader opened.

**Pointing drives yield to HUD chrome; camera drives do not.** The galaxy's pointing drives — the node-opening dwell and the two-finger inspect reveal — SHALL resolve no node while the pointing hand is over HUD chrome, so a finger aimed at a task card never also charges a dwell on whatever node happens to project behind that card, and no cluster lights up under a hand that is pointing at the HUD. The camera drives — fist orbit and two-palm zoom — SHALL NOT yield: they act on the whole view rather than on a thing under the finger, and stalling an orbit because the hand drifted across a panel would make the camera feel broken.

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
