## ADDED Requirements

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
