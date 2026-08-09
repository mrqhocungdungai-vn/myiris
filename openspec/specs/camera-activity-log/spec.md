# camera-activity-log Specification

## Purpose

The camera preview carries a strip of the app's own recent activity along the
bottom of the frame, so that Iris working is something the user can see rather
than infer from silence.

It is a glance, not a record. The strip shows the newest few entries of the log
the app already produces — it introduces no second account, and nothing is
emitted for its benefit. Its depth is decided by the build mode alone: a
development build shows the workings, a production build shows only what a user
would want to read. The durable, complete account lives in the
`diagnostic-logging` file, which is where an investigation goes.

Nothing in the strip is interactive. It occupies a fixed band that never
resizes, and it yields to the camera's other overlays rather than competing with
them.
## Requirements
### Requirement: The camera preview shows the app's own activity

Wherever the app presents a camera preview, it SHALL show the most recent
entries of the app's own activity log, so that the app working is visible rather
than silent.

The entries SHALL be the ones the app already produces. This capability SHALL
NOT introduce a second account of what the app is doing: no event exists for the
strip's benefit, and an event that reaches the strip SHALL be the same event
every other consumer of that log sees.

The newest entry SHALL be the one nearest the bottom, so the log grows downward.

The strip SHALL render in every surface that shows the camera preview, on the
same terms as that preview's other overlays, and SHALL NOT be specialized per
surface. Its size SHALL follow the frame it is drawn in, so a surface with a
larger camera frame shows correspondingly larger text without separate tuning.

Nothing in the strip SHALL be interactive. It SHALL NOT be clickable,
scrollable, dwellable, or dismissible, and no gesture or pointer behavior SHALL
be defined for it.

Nothing SHALL be written to disk for it, and nothing SHALL survive a restart.

#### Scenario: The camera preview shows recent activity

- **WHEN** the camera preview is showing and the app records activity
- **THEN** the most recent entries appear in the preview, newest nearest the bottom

#### Scenario: Both surfaces show it, sized to their frame

- **WHEN** the camera preview is showing in either surface
- **THEN** each shows the same strip, with its text sized to that surface's frame and no per-surface configuration

#### Scenario: The strip cannot be operated

- **WHEN** the user points, clicks, dwells or gestures at the strip
- **THEN** nothing happens, and no behavior anywhere in the app changes as a result

### Requirement: How much is shown is decided by the build, not by the user

The depth at which the log is shown SHALL be a property of how the application
was built and started: a development run SHALL show routine progress as well as
anything warranting attention, and a production run SHALL show only what
warrants attention.

There SHALL NOT be a user-facing control for this, and it SHALL NOT be stored as
a preference. A depth that can be changed is a preference; a preference invites
persisting it; and a persisted one means a production build can be left
permanently verbose by a change nobody remembers making.

This threshold SHALL affect only what is **drawn**. Entries below it SHALL still
be collected on the same terms as any other, so that the rule remains one about
display and can be changed without changing what the app records.

#### Scenario: A development run shows routine progress

- **WHEN** the app is run in development and records routine progress
- **THEN** those entries appear in the strip

#### Scenario: A production run shows only what warrants attention

- **WHEN** the app is run as built for production and records routine progress
- **THEN** those entries do not appear in the strip, while entries warranting attention still do

#### Scenario: The threshold cannot be changed from the interface

- **WHEN** the user looks for a way to change how much the strip shows
- **THEN** there is none, in any surface, and nothing about the strip is persisted between runs

### Requirement: The strip occupies a fixed band and never resizes

The strip SHALL occupy a band of fixed height at the bottom of the camera frame.
Its height SHALL NOT depend on how many entries there are, nor on how long any
of them is — including when there are none at all.

Each entry SHALL occupy exactly one line. An entry too long for the frame's
width SHALL be truncated rather than wrapped, since wrapping would let one long
entry push another out of the band for a reason the user cannot see.

No element positioned relative to this band SHALL move as entries arrive.

#### Scenario: An arriving entry moves nothing

- **WHEN** a new entry appears in the strip
- **THEN** the band occupies exactly the same area as before, and nothing positioned above it moves

#### Scenario: A long entry does not consume another entry's line

- **WHEN** an entry is longer than the frame is wide
- **THEN** it is truncated to one line, and the same number of entries remains visible

#### Scenario: An empty strip still reserves its band

- **WHEN** there is nothing to show
- **THEN** the band is still reserved, showing the camera image through it, and nothing has moved

### Requirement: The strip yields to the camera's other overlays

The strip SHALL be drawn beneath the camera preview's tracking overlays, so that
where they occupy the same area the overlays are what is seen.

This SHALL be arranged from the strip's side. No requirement of another
capability SHALL be qualified, narrowed, or made conditional to accommodate this
one — in particular, an overlay whose position is a function of what it is
tracking SHALL continue to be placed by that rule alone, including where that
places it over this band.

The camera image SHALL remain visible through the strip, which SHALL NOT be
drawn on an opaque ground.

#### Scenario: An overlay over the band is what is seen

- **WHEN** a tracking overlay is positioned such that it covers part of the band
- **THEN** the overlay is drawn over the strip, and the overlay's own position is unchanged by the strip's presence

#### Scenario: The scene shows through the strip

- **WHEN** the strip is rendered over any part of the camera image
- **THEN** that part of the image remains visible through it

### Requirement: An entry's severity is legible without reading it

An entry SHALL carry a visible indication of its severity, distinguishable at a
glance and without reading the message — the strip is denser than it is readable
and its first job is to show that the app is working, not to be read line by
line.

Severity SHALL be conveyed consistently with the rest of the camera preview's
palette, and the tone reserved for warnings elsewhere in the preview SHALL NOT
be spent on routine entries here.

#### Scenario: Severity reads at a glance

- **WHEN** the strip holds entries of differing severity
- **THEN** which are routine and which warrant attention is apparent without reading the messages

#### Scenario: Routine entries do not wear the warning tone

- **WHEN** the strip holds only routine entries
- **THEN** none of them is drawn in the tone the preview reserves for warnings

