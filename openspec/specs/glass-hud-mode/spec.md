## Purpose

A HUD mode in which the Iris window becomes a transparent, click-through desktop overlay — glass regions pass clicks through to the apps underneath while interactive HUD islands (orb cluster, tasks column, comms panel, camera dock) stay clickable — so the user can keep Iris visible and controllable while working in other applications.

## Requirements

### Requirement: HUD overlay mode with click-through glass
The app SHALL offer a HUD mode in which the window covers the desktop as a transparent overlay: all glass regions are pointer-transparent (clicks reach the apps underneath), while elements marked `.hud-hit` are interactive. The renderer SHALL report pointer presence over interactive elements via `hud:interactive`, and the main process SHALL toggle window click-through accordingly (`setIgnoreMouseEvents` with event forwarding).

#### Scenario: Working through the glass
- **WHEN** HUD mode is active and the pointer is over a glass (non-`.hud-hit`) region
- **THEN** clicks and typing reach the application underneath the overlay

#### Scenario: Interacting with a HUD island
- **WHEN** the pointer moves over a `.hud-hit` element (task card, toggle, orb controls)
- **THEN** the window becomes interactive and the element responds to click and gesture dwell-click normally

### Requirement: HUD layout and deck transitions
HUD mode SHALL present the upstream Glass HUD layout — orb cluster with mute/wake/sleep/exit controls, a collapsible tasks column, a comms panel, the camera dock with hand skeleton and the decorative eye overlays (see the `eye-tracking-hud` capability), a camera-size control beside that dock, and a drawing toggle that shows/hides the excalidraw drawing panel (see the `hud-drawing-canvas` capability) — and mode switches SHALL animate via the `hud:mode` event (deck-leaving / hud-entering transitions). The app SHALL always start in deck mode. The drawing panel SHALL be hidden by default so the enumerated controls above are what a freshly-entered HUD presents.

#### Scenario: Entering the HUD
- **WHEN** the user toggles HUD mode from the deck
- **THEN** the deck animates out, the overlay appears with orb/tasks/comms/camera and the drawing toggle (drawing panel hidden), and `hud:mode` reflects `hud`

#### Scenario: Exiting to deck for management actions
- **WHEN** the user activates the HUD's exit control
- **THEN** the app returns to deck mode where the pipeline bar, model choice, sessions, project folder, and setup remain available (these surfaces do not exist inside the HUD)

#### Scenario: Drawing toggle lives in the hover-revealed orb control cluster
- **WHEN** HUD mode is active and the user reveals the bottom-right orb control cluster (hover / focus)
- **THEN** a drawing toggle icon is present in that `.hud-controls` row alongside the mic/speaker/sleep/hand/exit controls, and activating it reveals the drawing panel while leaving the rest of the HUD layout intact
- **AND** while the cluster is at rest the drawing toggle is hidden like the other controls

#### Scenario: The HUD camera carries the same overlays as the deck's
- **WHEN** HUD mode is active with gesture control on and a face in frame
- **THEN** the HUD's camera dock shows the hand skeleton and the eye overlays, behaving identically to the deck's camera dock

### Requirement: The HUD camera frame has a user-controlled size that is remembered

HUD mode SHALL offer a control that switches its camera frame between two sizes: its standard size and an enlarged size roughly a third larger. The control SHALL be part of the HUD's own furniture, adjacent to the camera dock, and SHALL be marked as an interactive HUD element so it remains clickable while the surrounding glass stays click-through.

Two sizes exist because HUD mode serves two conflicting purposes: it is the surface on screen while livestreaming, where a larger face reads better to an audience, and it is also the working overlay kept up while using other applications, where a large camera consumes room other content needs. Neither size is correct for both, so this SHALL be a control rather than a fixed size.

The standard size SHALL be the default, so a user who never operates the control sees the HUD unchanged. The chosen size SHALL persist across app restarts. A stored value that is absent or unreadable SHALL resolve to the standard size — the failure mode SHALL be reverting to standard, never remaining stuck at the enlarged size with no way back.

Enlarging the camera SHALL NOT change the size of any neighbouring HUD element, and SHALL NOT affect the deck's camera dock, which has no such control.

Changing the size SHALL NOT disturb the camera preview's tracking overlays: they SHALL rescale with the frame and continue tracking throughout, without reinitializing.

#### Scenario: A freshly installed HUD is at the standard size

- **WHEN** HUD mode is entered with no previously stored camera-size choice
- **THEN** the camera dock is at its standard size, and the control offers to enlarge it

#### Scenario: Enlarging for a livestream

- **WHEN** the user activates the camera-size control from the standard size
- **THEN** the camera frame becomes roughly a third larger, showing the user's face correspondingly larger, and the control now offers to return to the standard size

#### Scenario: Shrinking back to reclaim working space

- **WHEN** the camera is enlarged and the user activates the control again
- **THEN** the frame returns to exactly its standard size

#### Scenario: The choice survives a restart

- **WHEN** the user enlarges the camera, quits the app, and reopens it in HUD mode
- **THEN** the camera is still enlarged, without the user setting it again

#### Scenario: An unreadable stored choice reverts to standard

- **WHEN** the stored camera-size choice is missing or cannot be interpreted
- **THEN** HUD mode presents the standard size rather than failing or remaining enlarged

#### Scenario: Neighbouring HUD elements keep their size

- **WHEN** the camera frame is enlarged
- **THEN** the comms panel and every other HUD element are unchanged in size and position, and the deck's camera dock is unaffected

#### Scenario: The control is clickable through the glass

- **WHEN** the pointer moves over the camera-size control while HUD mode is click-through
- **THEN** the window becomes interactive and the control responds, on the same terms as every other interactive HUD element

#### Scenario: Overlays follow the resize

- **WHEN** the camera size changes while a face is being tracked
- **THEN** the camera preview's overlays rescale with the frame and keep tracking without interruption or reinitialization

### Requirement: The HUD camera can stamp the current date and time for recordings

HUD mode SHALL offer a control that shows and hides a live date/time overlay on its camera frame. The control SHALL sit **beside the camera-size control**, in the HUD's own furniture adjacent to the frame rather than on top of the picture — the two are the camera's controls and SHALL be found together. It SHALL be marked as an interactive HUD element so it stays clickable while the surrounding glass remains click-through.

While the overlay is shown, the camera frame SHALL display, **in its top-left corner**, a recording indicator and the current date and time together as one block, with the time updating at least once per second — so that any screen recording or livestream of HUD mode is visibly marked as such and carries the wall-clock time at which it was made, and a later viewer can date the footage.

The displayed value SHALL be zero-padded and of fixed width, so the stamp does not change width or shift position as its digits change. It SHALL use a 24-hour clock, so no viewer has to infer AM or PM.

The stamp SHALL be sized and weighted to be read back **off the recording** — by a viewer watching later, at a smaller window size, after video compression — rather than merely to be readable by the operator sitting at the machine. It SHALL therefore be larger and heavier than the camera frame's existing status overlays, and it SHALL remain legible against a bright background as well as a dark one. Matching the surrounding overlays' size and weight SHALL NOT be treated as the goal: those serve a viewer at arm's length and this one does not.

Its size SHALL follow the camera frame, so it is correct at every size that frame can take without being tuned separately for each.

The overlay SHALL default to hidden, and SHALL NOT persist across app restarts — each launch SHALL start with it hidden.

This control SHALL be part of HUD mode only. The deck's camera dock SHALL NOT gain it.

#### Scenario: Turning the stamp on for a recording

- **WHEN** the user activates the control beside the camera-size control
- **THEN** a recording indicator and the current date and time appear in the camera frame's top-left corner, and the time advances in step with the clock

#### Scenario: The control is where the camera's other control is

- **WHEN** the user looks for the date/time control
- **THEN** it is beside the camera-size control, adjacent to the camera frame, and not somewhere on the picture itself

#### Scenario: The stamp is legible in a recording of the HUD

- **WHEN** HUD mode is screen-recorded with the overlay on
- **THEN** the recorded video shows that it is a recording, and the date and the time of day at which it was captured

#### Scenario: Turning it back off

- **WHEN** the user activates the control again
- **THEN** the date/time overlay disappears from the camera frame and the frame is exactly as it was before

#### Scenario: A fresh launch starts with the stamp off

- **WHEN** the app is restarted, whatever the state of the overlay when it was last quit
- **THEN** HUD mode presents the camera frame with no date/time overlay

#### Scenario: The stamp is readable at both camera sizes without retuning

- **WHEN** the camera frame is switched between its standard and enlarged sizes with the overlay on
- **THEN** the stamp scales with the frame and is legible at both, with no size configured per state

#### Scenario: The stamp does not jitter as it ticks

- **WHEN** the overlay is shown and observed across a minute, including where digit counts change
- **THEN** it stays at a fixed position and width, with no text shifting as the seconds advance

#### Scenario: The control is clickable through the glass

- **WHEN** the pointer moves over the control while HUD mode is click-through
- **THEN** the window becomes interactive and the control responds, on the same terms as every other interactive HUD element

#### Scenario: The deck is unaffected

- **WHEN** the deck's camera dock is shown
- **THEN** it has no date/time overlay and no control for one

### Requirement: The recording indicator SHALL NOT imply the app is capturing video

The control above, and the on-camera overlay it drives, MAY be presented with the visual vocabulary of a recording indicator — a REC or RECORDING label, a red indicator light — because that is what tells an audience the footage they are watching is a recording and is timestamped.

It SHALL NOT, however, present the app as capturing, recording, or storing video. Iris writes no video file and opens no capture beyond the camera preview that gesture control already owns; the recording is performed by whatever external screen-recorder the user is running. Specifically, this control SHALL NOT be accompanied by an elapsed-recording timer, a file-size or duration readout, a saved-file location, or any other affordance that only a real recorder could offer, and its explanatory text SHALL describe it as showing or hiding the on-camera date and time rather than as starting or stopping a recording.

Should a future change give Iris real video capture, it SHALL say so in this specification and revise this control's wording; capture SHALL NOT arrive silently behind an affordance whose stated purpose is a timestamp.

#### Scenario: The control explains itself as a display toggle

- **WHEN** the user inspects the control's explanatory text (tooltip or equivalent)
- **THEN** it describes showing or hiding the date and time on the camera, and does not describe starting or stopping a recording

#### Scenario: No capture-only affordances are shown

- **WHEN** the overlay is on
- **THEN** no elapsed-recording timer, file size, duration, or saved-file location appears anywhere in the HUD

#### Scenario: Turning the stamp on writes nothing

- **WHEN** the user turns the overlay on and leaves it on
- **THEN** the app creates no video file and no recording of the camera, and consumes no storage beyond what it already used

### Requirement: Claude task parity inside the HUD
Task cards rendered in the HUD tasks column SHALL carry the same Claude-specific presentation as the deck Work Stream: verb badge, model, chain badge, live step timeline with toggle, and realtime updates from the existing sidecar events.

#### Scenario: A stateless run followed from the HUD
- **WHEN** a stateless run streams tool events while HUD mode is active
- **THEN** the HUD card shows the same step timeline and completion state the deck card would, without leaving HUD mode
