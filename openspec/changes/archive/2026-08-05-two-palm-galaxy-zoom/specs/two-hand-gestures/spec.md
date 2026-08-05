## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Two open palms scale the layer that owns the gesture surface

Two simultaneously open palms SHALL scale whatever layer currently owns the gesture surface, and SHALL do nothing when no layer does. This is one binding with one meaning — "scale what we are working on" — routed by the same context precedence that governs every other gesture, not a separate binding per layer.

Concretely: with a reader overlay open (the task run-reader or the vault note reader, which share one reader core) two open palms SHALL scale the reader; with the second-brain galaxy active and no reader open they SHALL dolly the galaxy camera; otherwise they SHALL scale nothing. Because a reader outranks the galaxy, opening a note moves the binding to the note and closing it moves the binding back to the galaxy, with no gesture changing meaning in the user's hands.

In both cases the scale SHALL follow the **distance between the two hands** and SHALL be **relative**: the frame the pose engages SHALL seed a reference from the live state and apply no motion, and later frames SHALL apply only the ratio of the current distance to that reference — so engaging never snaps, and a drive that begins after the user has scaled something by mouse continues from where the mouse left it. Spreading the hands apart SHALL scale **up** — a larger reader, or a camera brought closer to the graph — so the same motion means the same thing whichever layer holds it. Camera dolly SHALL be clamped so the camera neither passes through the graph's center nor flies away from it.

Losing the pose — a hand leaving the frame, or either hand ceasing to read as an open palm — SHALL release the reference rather than freeze it. Re-engaging SHALL seed a new reference from the live state, so a momentary tracking dropout pauses the scaling instead of jumping it.

A fist SHALL still close an open reader, and open-palm hold-to-scroll SHALL keep working on the reader body. Panel hold-to-scroll SHALL NOT engage while a reader overlay or a fullscreen HUD layer (the galaxy or the drawing panel) is active, since those layers own the gesture surface. The per-frame gesture work for all of this SHALL only run while the hand-control preference is enabled.

#### Scenario: Resize a reader with two palms

- **WHEN** a reader is open and both hands show open palms
- **THEN** moving the hands apart/together scales the reader and the action indicator reports the resize binding

#### Scenario: Zoom the galaxy with two palms

- **WHEN** the second-brain galaxy is active with no reader open and both hands show open palms
- **THEN** moving the hands apart/together dollies the galaxy camera toward/away from the graph, clamped so it neither passes through the center nor flies away, and the action indicator reports the zoom binding

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

#### Scenario: Panel scroll is suppressed under a fullscreen layer

- **WHEN** the galaxy or the drawing panel is active
- **THEN** open-palm hold-to-scroll does not scroll the deck panels beneath it

## REMOVED Requirements

### Requirement: Two-palm reader resize

**Reason**: Superseded by "Two open palms scale the layer that owns the gesture surface", which states the same binding once as a general rule instead of naming a single layer. Every behavior this requirement guaranteed — reader scaling, fist-closes, open-palm scroll on the reader body, panel-scroll suppression under a fullscreen layer, and the hand-control gate on the per-frame work — is carried forward verbatim by the replacement.

**Migration**: None for users; the reader behaves exactly as before. The replacement adds the galaxy as a second layer the same gesture can own, which is what lets the binding stay meaningful when a note opens over the galaxy.
