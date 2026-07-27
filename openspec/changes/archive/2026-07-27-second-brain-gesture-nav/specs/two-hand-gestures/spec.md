## MODIFIED Requirements

### Requirement: Universal point-and-hold click

A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including PO question answer options, step-timeline toggles, chips, and close buttons — EXCEPT elements explicitly marked as dwell-excluded (`[data-no-dwell]`, or any element contained within one), and EXCEPT while a reader overlay or a fullscreen HUD layer (the second-brain galaxy or the drawing panel) owns the gesture surface, since those layers bind the pointing hand to their own semantics. Dwell exclusion SHALL be reserved for destructive or irreversible controls — those whose action loses data or cannot be undone (e.g. removing the saved subscription token, starting a new session, switching the project folder) — so that a merely hovering hand cannot fire them. Excluded controls SHALL remain fully operable by mouse and by voice; only the hands-free dwell path skips them, and the dwell indicator SHALL NOT engage on them. The HUD's own control island (the button row that hosts the layer toggles) SHALL remain dwell-activatable even while a fullscreen layer is active, so any layer the user can open hands-free can also be closed hands-free.

#### Scenario: Dwell-click a button

- **WHEN** the user points at a PO question option button and holds for the dwell duration
- **THEN** that option is selected exactly as a mouse click would

#### Scenario: Dwell-open still works

- **WHEN** the user points at a task card and dwells
- **THEN** the reader opens for that task (existing behavior preserved)

#### Scenario: Dwell over a destructive control does nothing

- **WHEN** the user's hand dwells over a control marked `[data-no-dwell]` (e.g. "Remove token", "New session")
- **THEN** no click is triggered and the dwell indicator does not engage on it
- **AND** the same control is still activatable by a mouse click or by voice

#### Scenario: DOM dwell is suppressed under a fullscreen layer

- **WHEN** the second-brain galaxy or the drawing panel is active
- **THEN** the DOM point-and-hold click does not fire on elements beneath that layer — the layer's own gesture bindings own the pointing hand

#### Scenario: The HUD control island stays dwell-reachable under a fullscreen layer

- **WHEN** a fullscreen HUD layer (the galaxy or the drawing panel) is active and the user dwells over the HUD control island's toggle for that layer
- **THEN** the toggle still activates, so the layer can be closed hands-free without reaching for the mouse or Esc

### Requirement: Two-palm reader resize

When a reader overlay is open — the task run-reader or the vault note reader, which share the same reader core — two simultaneously open palms SHALL scale (and reposition per upstream behavior) the reader; a fist SHALL still close it; open-palm hold-to-scroll SHALL keep working on the reader body. Panel hold-to-scroll SHALL NOT engage while a reader overlay or a fullscreen HUD layer (the galaxy or the drawing panel) is active, since those layers own the gesture surface. The reader's per-frame gesture work SHALL only run while the hand-control preference is enabled.

#### Scenario: Resize with two palms

- **WHEN** the reader is open and both hands show open palms
- **THEN** moving the hands apart/together scales the reader and the action indicator reports the resize mode

#### Scenario: Both readers respond to the same bindings

- **WHEN** the open reader is the vault note reader (rather than the task run-reader)
- **THEN** fist-close, two-palm resize, and open-palm scroll behave identically — the bindings belong to the shared reader core, not to one reader

#### Scenario: Panel scroll is suppressed under a fullscreen layer

- **WHEN** the galaxy or the drawing panel is active
- **THEN** open-palm hold-to-scroll does not scroll the deck panels beneath it

### Requirement: Fist rotates and pinch scales the orb

When hand control is enabled, the reader overlay is closed, and no fullscreen HUD layer (the second-brain galaxy or the drawing panel) is active, the primary hand showing `Closed_Fist` SHALL incrementally rotate the Arc Reactor orb by the hand's movement delta, and either tracked hand's thumb-tip-to-index-tip pinch distance SHALL scale the orb within a clamped range. These bindings SHALL NOT engage while the reader overlay is open, so they never collide with the existing reader-open `Closed_Fist`-closes-reader or two-palm-resize bindings; and they SHALL NOT engage while the galaxy or the drawing panel owns the HUD surface, so a fist meant to orbit the galaxy camera never also rotates the orb underneath it. The gesture action indicator SHALL report the binding that is actually live for the current context, never a binding that the active layer has taken over.

#### Scenario: Fist rotates the orb

- **WHEN** hand control is enabled, the reader is closed, no fullscreen HUD layer is active, and the primary hand shows `Closed_Fist` while moving
- **THEN** the orb's rotation follows the hand's movement delta

#### Scenario: Pinch scales the orb

- **WHEN** hand control is enabled, the reader is closed, no fullscreen HUD layer is active, and a tracked hand's thumb-index pinch distance changes
- **THEN** the orb's scale follows the pinch distance, clamped to a reasonable range

#### Scenario: Reader-open gestures unaffected

- **WHEN** the reader overlay is open
- **THEN** `Closed_Fist` still closes the reader and two open palms still resize it exactly as before, with no orb rotation or scale applied

#### Scenario: Galaxy-active gestures do not touch the orb

- **WHEN** the second-brain galaxy (or the drawing panel) is active
- **THEN** a `Closed_Fist` or pinch drives that layer's own camera/tools and does NOT rotate or scale the orb behind it

#### Scenario: The action indicator names the live binding

- **WHEN** the galaxy is active and the user makes a fist (which orbits the galaxy camera)
- **THEN** the gesture action indicator reports the orbit binding, not "idle" and not "rotate orb"
