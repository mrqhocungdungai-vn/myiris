## MODIFIED Requirements

### Requirement: A closed fist orbits the galaxy camera and a pinch zooms it

When hand control is enabled and the galaxy is active with no reader open, a primary hand showing `Closed_Fist` SHALL orbit the galaxy camera around the graph by the hand's movement delta, and an **explicitly detected** thumb-tip-to-index-tip pinch SHALL either toggle a node's focus or dolly the camera, discriminated by how long the pinch is held: a pinch **released quickly** (a tap) SHALL toggle the focus of the node under the hand point, and a pinch **held past that window** SHALL dolly the camera toward/away from the graph within a clamped range. The galaxy drives SHALL be partitioned by hand pose so they never act at once on the same hand: `Pointing_Up` targets a node dwell (no camera motion), `Closed_Fist` orbits, a detected pinch taps-to-focus or holds-to-zoom, and **any other pose — an open palm, an unrecognized gesture, or a hand merely resting in frame — SHALL drive nothing**.

Zoom SHALL NOT be the leftover branch of that partition: the recognizer publishes no pinch class, only a continuous pinch distance, so a pinch SHALL be recognized by an explicit predicate with hysteresis (engage and release thresholds) rather than inferred from "not pointing and not fisting" — otherwise a resting hand, or the two open palms that mean *resize*, would dolly the camera. **Nor SHALL the tap be the leftover branch of the pinch**: a tap SHALL be recognized only by a pinch that both engages and releases inside the hold window, so a pinch that is still charging toward a zoom is never retroactively treated as a tap, and a slow release at the end of a zoom never fires a selection.

A tap SHALL resolve its target the way the node dwell already does — by projecting node positions to screen coordinates and selecting the node nearest the hand point within a pixel threshold, excluding nodes outside the camera's visible depth range — and SHALL NOT use the DOM dwell path, which stays suppressed while the galaxy owns the surface. A tap that resolves to no node SHALL do nothing: it SHALL NOT clear the focus, because an accidental pinch over empty space would otherwise discard a selection the user built deliberately. Clearing the focus SHALL be a distinct, deliberate action in the HUD control island rather than a gesture, so it is reachable hands-free without being reachable by accident. A tap over a **ghost node** (an unresolved `[[wikilink]]` target with no backing file) SHALL do nothing, exactly as it is not dwell-openable — there is no note to act on.

While a pinch is being discriminated — engaged, but not yet past the hold window — the camera SHALL NOT move. Dollying during the window and then firing a tap would move the graph out from under the hand between the user's intent and its effect.

The pinch distance that naturally drifts while pointing SHALL NOT dolly the camera, slide a charging dwell off its target, or fire a tap. The camera SHALL always look at the graph's orbit center (an explicit center, not assumed to be the world origin). Both camera drives SHALL be **relative**: the first frame after a drive (re)engages SHALL seed its reference — the hand point for orbit, the pinch distance and current radius for zoom — and apply no motion, with subsequent frames applying only the delta from that reference, so engaging a pose never snaps the camera. A zoom's reference SHALL be seeded when the hold window elapses, not when the pinch first engaged, so the discrimination window contributes no accumulated delta. Seeding SHALL re-derive from the **live** camera, so a gesture drive that begins after the user moved the camera with the mouse continues from where the mouse left it rather than jumping back to where gesture control last was. The camera drive SHALL be smooth and stable (built on the smoothed hand point, with small per-frame deltas). These bindings SHALL engage only while the galaxy is active and no reader is open, so they never collide with the reader's `Closed_Fist`-closes-reader binding or with the deck's fist-rotates-the-orb binding. **Mouse drag/scroll camera control SHALL remain working after every exit from a gesture drive** — not only when a gesture is released, but also when hand control is switched off mid-drive, a reader opens mid-drive, Iris goes to sleep mid-drive, or the hand simply leaves the frame; the gesture drive SHALL NOT be able to leave the built-in camera controls permanently disabled for the rest of the galaxy session.

#### Scenario: Fist orbits the camera

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the primary hand shows `Closed_Fist` while moving
- **THEN** the galaxy camera orbits around the graph following the hand's movement delta

#### Scenario: A quick pinch over a node focuses it

- **WHEN** hand control is on, the galaxy is active, no reader is open, and the user pinches and releases quickly with the hand point over a real note-node
- **THEN** that node's focus is toggled and the camera does not move

#### Scenario: A held pinch zooms the camera

- **WHEN** the user pinches and holds past the discrimination window
- **THEN** the camera dollies toward/away from the graph, clamped so it neither passes through the center nor flies away, and no node's focus is toggled

#### Scenario: The camera does not move during discrimination

- **WHEN** a pinch has engaged but the hold window has not yet elapsed
- **THEN** the camera has not moved, so the node under the hand point is still the node a tap would select

#### Scenario: Releasing a zoom slowly does not fire a tap

- **WHEN** the user has been zooming with a held pinch and then releases it
- **THEN** no node focus is toggled — the release ends the zoom rather than completing a tap

#### Scenario: A tap over empty space does not clear the focus

- **WHEN** notes are focused and the user taps a pinch where no node is within the pixel threshold
- **THEN** the focus is unchanged and nothing is selected or deselected

#### Scenario: A tap over a ghost node does nothing

- **WHEN** the user taps a pinch over a faded ghost node
- **THEN** no focus is toggled and no file is read

#### Scenario: The focus can be cleared hands-free

- **WHEN** notes are focused, hand control is on, and the user dwells over the clear-focus control in the HUD control island
- **THEN** the focus is emptied — clearing is reachable without a mouse, but not by an accidental pinch

#### Scenario: Pointing to open does not zoom or select

- **WHEN** the user holds `Pointing_Up` over a node to charge a dwell and the thumb-index distance drifts as a side effect of the pose
- **THEN** the camera does not dolly and no focus is toggled — both pinch outcomes engage only in a deliberate pinch pose (not while pointing) — so the dwell target stays under the pointer

#### Scenario: A resting hand does not move the camera

- **WHEN** the galaxy is active with hand control on and the user's hand is simply present in frame in some other pose (open palm, an unrecognized gesture, or two open palms)
- **THEN** the camera does not orbit or dolly, and no focus is toggled — no drive engages unless the hand is fisting or in a recognized pinch

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

### Requirement: Focus is reachable without hands

Selecting and clearing the focus SHALL be fully available by mouse and keyboard, independent of the hand-control preference. With hand control off, the galaxy and its focus SHALL be usable exactly as they are with it on, and no gesture machinery SHALL run — the existing rule that the gesture layer schedules no per-frame work while hand control is off SHALL continue to hold with selection added.

The hand path is additive. A gesture-only selection mechanism would make the focus — and therefore every deictic request that depends on it — unavailable to a user who has not enabled their camera.

#### Scenario: Mouse selection works with hand control off

- **WHEN** hand control is off and the user selects nodes with the mouse
- **THEN** those nodes are focused, the focus indicator names them, and a deictic voice request resolves against them

#### Scenario: No per-frame work when hand control is off

- **WHEN** hand control is off and the galaxy is active with notes focused
- **THEN** no gesture loop is scheduled, including for tap discrimination

#### Scenario: Clearing works by mouse

- **WHEN** notes are focused and the user activates the clear-focus control with the mouse
- **THEN** the focus is emptied
