## MODIFIED Requirements

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

In both cases the scale SHALL follow the **distance between the two hands** and SHALL be **relative**: the frame the pose engages SHALL seed a reference from the live state and apply no motion, and later frames SHALL apply only the ratio of the current distance to that reference — so engaging never snaps, and a drive that begins after the user has scaled something by mouse continues from where the mouse left it. Spreading the hands apart SHALL scale **up** — a larger reader, or a camera brought closer to the graph — so the same motion means the same thing whichever layer holds it. Camera dolly SHALL be clamped so the camera neither passes through the graph's center nor flies away from it.

Losing the pose — a hand leaving the frame, or either hand ceasing to read as an open palm — SHALL release the reference rather than freeze it. Re-engaging SHALL seed a new reference from the live state, so a momentary tracking dropout pauses the scaling instead of jumping it.

A fist SHALL still close an open reader, and open-palm hold-to-scroll SHALL keep working on the reader body. Panel hold-to-scroll SHALL follow the same two modes as the dwell, from the same rule: while **either** reader is open it SHALL NOT engage on any panel, because the reader holds the hand exclusively until it is closed; while a coexisting layer (the galaxy or the drawing panel) is open it SHALL NOT engage over that layer's own surface but SHALL keep working over HUD chrome, so the tasks and comms columns stay scrollable by hand for as long as the layer is open.

**A two-palm scale SHALL never also scroll a panel.** Whenever two open palms are up, panel hold-to-scroll SHALL be suppressed everywhere, so a palm that happens to pass over a column while the user is zooming the galaxy or resizing a reader scrolls nothing.

The per-frame gesture work for all of this SHALL only run while the hand-control preference is enabled.

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

#### Scenario: Panel scroll is suppressed over the layer's own surface

- **WHEN** the galaxy or the drawing panel is active and a single open palm is held over the layer itself
- **THEN** open-palm hold-to-scroll scrolls nothing

#### Scenario: The task column stays scrollable under an active layer

- **WHEN** the galaxy (or the drawing panel) is active and a single open palm is held high or low over the HUD's task or comms column
- **THEN** that column scrolls, exactly as it would with no layer active

#### Scenario: A zoom does not scroll a column it passes over

- **WHEN** the user zooms the galaxy with two open palms and one of those palms drifts over the task column
- **THEN** the column does not scroll — only the camera moves
