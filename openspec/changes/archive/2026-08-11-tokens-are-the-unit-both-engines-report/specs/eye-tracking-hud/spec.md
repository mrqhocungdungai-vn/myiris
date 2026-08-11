## ADDED Requirements

### Requirement: The panel reports what the app has spent beside what the machine is spending

The readout panel SHALL report, alongside its host measurements, the tokens each
of the app's paid engines has consumed this session — the voice engine and the
build engine, as separate figures.

The two kinds of reading SHALL be visually distinguished, and the panel SHALL
identify which is which. The host rows report the machine; these report the app.
A panel that presented them as one undifferentiated list would invite the reading
that a token count is a utilization.

For each engine, the panel SHALL show both its session total and what the most
recent call added to it. Where an engine distinguishes cached input, that figure
SHALL appear as its own value rather than being added into the engine's headline
figure.

These figures SHALL NOT be gated on the panel's host sampling, SHALL NOT be
reset when that sampling stops, and SHALL NOT fall to absent because host
measurements stopped arriving. They come from a different source, and silence
from that source means nothing has been spent — not that a reading has gone
stale.

When the panel begins rendering, it SHALL show the session's figures as they
already stand, not an apparent fresh start. A panel that began counting when it
opened would report a number that is self-consistent and wrong.

An engine that has reported nothing this session SHALL read as absent. This is
the ordinary state of the build engine when no credential for it is configured,
and it SHALL NOT read as zero.

The panel's other rules apply unchanged: constant width across the whole range of
each figure, including its absent form; no reflow as a figure crosses a
magnitude; and the same rendering in every surface that shows the camera preview.

#### Scenario: Both engines are reported, separately

- **WHEN** the panel is rendered after both engines have been used
- **THEN** it shows each engine's token figures under its own label, and no combined figure across the two

#### Scenario: The panel says which readings are the app's

- **WHEN** the panel is rendered
- **THEN** the token figures are distinguished from the host measurements, and the panel identifies which of the two each part reports

#### Scenario: A conversation moves the voice engine's figure

- **WHEN** the user holds a voice conversation while the panel is rendered
- **THEN** the voice engine's total is seen growing, and the most recent addition changes with it

#### Scenario: A finished run moves the build engine's figure

- **WHEN** a run finishes while the panel is rendered
- **THEN** the build engine's total grows by that run's tokens, and its most recent addition shows that run's own figure

#### Scenario: An engine with no credential reads as absent

- **WHEN** no credential for the build engine is configured, so no run has ever executed
- **THEN** its rows render as absent, and the voice engine's continue to report normally

#### Scenario: A panel opened late shows the session so far

- **WHEN** the user converses for some time with the camera off, then turns it on
- **THEN** the panel's token figures include what was consumed before it appeared

#### Scenario: Host measurement stopping does not blank the token figures

- **WHEN** host measurements stop arriving while the panel is rendered
- **THEN** the host rows fall to absent and the token figures continue to show the session's totals

#### Scenario: A figure crossing a magnitude does not move anything

- **WHEN** a token figure grows past a magnitude boundary, changing its unit
- **THEN** it occupies exactly the same width before and after, and no row shifts

### Requirement: A completed unit of work is announced beside the ring, then resolves

When a unit of delegated work completes, the overlays SHALL announce it beside the
ring's eye, carrying what that unit consumed in tokens, and SHALL then resolve
away on their own.

This SHALL be transient. It SHALL have a bounded lifetime of a few seconds,
SHALL dismiss itself, and SHALL NOT persist, accumulate, or become a second
continuous readout. The panel remains where a running total is read; this element
exists to mark that something happened.

It SHALL be placed on the ring's eye rather than the panel's, because this
capability's two instruments already divide that way: the ring alerts and the
panel reports. A completed unit of work is an event.

It SHALL be positioned **outward** from that eye — the side of the frame that eye
appears on — and SHALL NOT overlap the eye. Where the frame's edge would cut it,
it SHALL be clipped rather than relocated, on the same terms this capability
already applies to the panel: an element that changes side mid-appearance reads as
malfunctioning.

While visible it SHALL track its eye every frame, on the same per-frame mechanism
that positions the ring.

Its arrival, hold and departure SHALL be driven by that same per-frame mechanism,
NOT by a declarative animation on the property that mechanism writes — a
transition on a transform rewritten every frame is cancelled every frame.

Announcing an event SHALL NOT alter any element of the ring. In particular it
SHALL NOT reuse the settling beat that marks a newly acquired eye: that beat
already means the target is held, and one signal SHALL NOT carry two meanings.

**The announced figure SHALL NOT be animated.** It SHALL appear as the amount
that was reported and hold still. Counting it up would display amounts that were
never reported, which this capability forbids of every displayed figure.

At most one announcement SHALL be present at a time. A further unit completing
while one is visible SHALL replace it and restart its lifetime, rather than
queueing behind it — a queued figure would still be on screen after the panel's
total had moved past it.

An announcement SHALL NOT be replayed. Work that completed while the overlays
were not rendering — the camera off, or no face detected — SHALL NOT be announced
when they next appear. Its tokens are already in the panel's totals, and
presenting old work as news is worse than not presenting it.

The announcement SHALL NOT be interactive, on the same terms as every other
element of this capability.

#### Scenario: A finished unit of work is announced beside the ring

- **WHEN** a unit of delegated work completes while the overlays are rendering
- **THEN** an announcement appears beside the ring's eye carrying that unit's token figure
- **AND** it is not placed beside the panel's eye

#### Scenario: The announcement resolves on its own

- **WHEN** an announcement has appeared and a few seconds pass with nothing further completing
- **THEN** it resolves away without any input, leaving the overlays as they were

#### Scenario: It never covers the eye it belongs to

- **WHEN** an announcement is visible, wherever that eye currently is in the frame
- **THEN** it sits outward from that eye and no part of it covers the eye

#### Scenario: It tracks the eye while visible

- **WHEN** the user moves their head while an announcement is visible
- **THEN** it stays beside the same eye throughout, without lag or teleporting

#### Scenario: The ring is unchanged by an announcement

- **WHEN** an announcement appears
- **THEN** no element of the ring changes its behavior, and the beat that marks an acquired eye does not fire

#### Scenario: The figure holds still

- **WHEN** an announcement carrying a token figure appears
- **THEN** that figure is shown as reported, without counting up to it

#### Scenario: A second completion replaces the first

- **WHEN** a further unit of work completes while an announcement is still visible
- **THEN** the announcement shows the newer figure and its lifetime starts again, and the two are not shown together

#### Scenario: Work completed while nothing was rendering is not announced later

- **WHEN** work completes with the camera off, and the camera is later turned on
- **THEN** no announcement appears for it, and the panel's totals include it

#### Scenario: Continuous consumption is not announced

- **WHEN** the voice engine reports usage repeatedly during a conversation
- **THEN** no announcement appears for those reports, and the panel's figure for that engine follows them

## MODIFIED Requirements

### Requirement: The two eyes render two distinct, tracked elements — never a mirrored pair

The two eyes SHALL NOT receive the same visual treatment. Rendering the same small ring-style element on both real eyes reads as redundant and does not read clearly at typical webcam scale — so one eye SHALL drive a ring-style "lock-on" HUD element, and the other eye SHALL position a distinct panel-style element beside itself, never overlapping that eye.

The assignment SHALL be: **the ring-style element on the eye appearing on the RIGHT of the displayed frame, and the panel-style element on the eye appearing on its LEFT.** It SHALL be fixed and consistent — it SHALL NOT switch between the two eyes frame-to-frame or between sessions, since an inconsistent assignment would read as flickering/broken rather than as two deliberately different instruments.

That on-screen side is the binding statement of the assignment. Whatever internal identifier the implementation uses for an eye — an anatomical label, a landmark index — SHALL be derived from it and recorded alongside it, never the reverse: the preview is mirrored, so any reasoning that goes from a landmark label to an on-screen side is exactly the step that has already been gotten backwards once.

Both elements SHALL update their position every frame to track their eye's live position as the face moves, with no more than a couple of frames of lag — this remains eye tracking; only the rendering is asymmetric.

This rule governs the **persistent** element each eye drives. A momentary
announcement rendered beside the ring's eye SHALL NOT be counted as a second
persistent element and SHALL NOT be treated as a panel: it belongs to the ring as
the alerting instrument, it SHALL be transient, and it SHALL NOT drift into a
continuous readout. Each eye SHALL still drive exactly one persistent element, and
that assignment SHALL remain as fixed as this requirement already demands.

#### Scenario: A detected face shows two different elements

- **WHEN** a face is detected
- **THEN** one eye shows the ring-style HUD centered on it, and the other eye shows the panel-style element positioned beside it (not overlapping it), and no eye shows both or neither

#### Scenario: The ring is on the frame's right and the panel on its left

- **WHEN** a face is detected and the overlays render
- **THEN** the ring-style element is over the eye appearing on the right of the displayed frame, and the panel-style element belongs to the eye appearing on its left

#### Scenario: The eye-to-element assignment stays fixed

- **WHEN** the same face is tracked continuously, or the app is reopened later
- **THEN** the same eye consistently drives the ring and the same eye consistently drives the panel

#### Scenario: Head movement is tracked smoothly

- **WHEN** the user moves their head while a face is detected
- **THEN** both the ring and the panel move to keep tracking their respective eye's live position, without visible teleporting or multi-frame lag

#### Scenario: No face means no elements

- **WHEN** no face is present in the camera frame
- **THEN** neither the ring nor the panel renders

#### Scenario: A momentary announcement is not a second panel

- **WHEN** an announcement is visible beside the ring's eye
- **THEN** that eye still drives the ring and no persistent panel-style element appears on it
- **AND** once the announcement resolves, nothing of it remains

### Requirement: The panel's values change because the machine changed, without disturbing its layout

The panel's displayed values SHALL update continuously while it is rendered. A wholly static readout SHALL NOT be used — it reads as a captured image overlaid on live video.

That motion SHALL come from the underlying measurements changing, and from nothing else. Synthetic variation SHALL NOT be added to a measured value to make it look alive, and every displayed figure SHALL lie between values that were actually measured.

Not every figure the panel shows is a measurement of the machine. A figure that is a **count of something the app consumed** SHALL change only when a further amount is reported, SHALL be rendered as reported rather than interpolated toward, and SHALL NOT decrease. Interpolating a cumulative count would draw amounts that were never reached; easing it downward would draw a decrease that cannot occur. Such a figure standing still is therefore correct and SHALL NOT be treated as the static readout this requirement forbids — the panel's motion requirement is satisfied by the values that do change.

The panel's elements SHALL NOT all update on one shared interval. A set of values that all change on the same tick reads as a single timer driving them rather than as several independent instruments, whatever the values themselves are.

Value updates SHALL NOT change the panel's layout: rows SHALL NOT reflow, shift, or change width as values change. A readout whose geometry twitches on each update reads as malfunctioning rather than as live. Real measurements span a far wider range of magnitudes than illustrative ones did, so right-aligning a value is not sufficient on its own — each value SHALL render at a **constant width across its entire range**, including the width of its unit and the width of its absent form.

#### Scenario: Values change because the machine did

- **WHEN** the panel is rendered and observed for several seconds on a machine whose load is changing
- **THEN** its values are seen changing, and the changes correspond to what the machine is doing

#### Scenario: Changing values do not move anything

- **WHEN** the panel's values update, including between values of differing digit counts
- **THEN** no row changes position or width, and no text shifts horizontally

#### Scenario: A value crossing a unit boundary does not move anything

- **WHEN** a displayed rate crosses between units as its magnitude changes, in either direction
- **THEN** the rendered value occupies exactly the same width before and after, and no text shifts horizontally

#### Scenario: The panel's elements do not update in lockstep

- **WHEN** the panel is observed while several of its values are changing
- **THEN** they are not seen changing together on one repeating beat

#### Scenario: A count steps rather than easing

- **WHEN** a token figure grows by a reported amount
- **THEN** it changes directly from the previous figure to the new one, without passing through intermediate values

### Requirement: A measurement that cannot be taken reads as absent, never as zero

Where the host cannot supply a measurement, the panel SHALL render a visibly
absent value for it. It SHALL NOT render zero, SHALL NOT substitute a previously
measured figure as though it were current, and SHALL NOT surface an error to the
user — on the same terms this capability already applies to a failed model load.

This SHALL apply uniformly to every reason a measurement can be missing: a host
with no counter for that quantity, a probe that failed or timed out, a host whose
platform offers no such measurement, and the interval after sampling starts but
before enough has been observed to compute a rate. Zero is a claim about the
machine; absence is the truth, and the two SHALL NOT be conflated.

A displayed value SHALL NOT be interpolated across an interval in which it was
absent — neither by decaying toward zero while absent, nor by easing out of the
value that preceded the gap when measurement resumes.

A measurement that stops arriving SHALL become absent rather than remaining
frozen at its last figure indefinitely. A readout stuck on plausible numbers is
indistinguishable from a very steady machine, which is the failure worth
covering.

That last rule follows from a measurement being a **sample of a present
condition**, and SHALL be applied per source rather than to the panel as a whole.
A figure that is a count of what the app has consumed does not go stale: it
remains exactly as true as when it was reported, and a period with no further
report means nothing further was spent. Such a figure SHALL continue to be
displayed, and SHALL read as absent only where nothing has been reported for it
at all. A reported count of zero is a value and SHALL be rendered as one.

#### Scenario: A host with no counter for a quantity shows it as absent

- **WHEN** the host provides no counter for one of the panel's quantities
- **THEN** that row renders as absent, the other rows continue to report normally, and no error is shown

#### Scenario: The first moments after sampling starts show absence, not zero

- **WHEN** sampling has just started and no rate can yet be computed
- **THEN** the affected rows render as absent rather than as zero

#### Scenario: A failed measurement is not treated as a reading

- **WHEN** a measurement fails or times out
- **THEN** the panel shows that value as absent, no error reaches the user, and no previously measured figure is presented as current

#### Scenario: Measurements that stop arriving fall to absent

- **WHEN** no new measurement arrives for several sampling intervals
- **THEN** the panel's values fall to absent rather than continuing to display the last figures

#### Scenario: A count with no recent report is not stale

- **WHEN** no token has been consumed for several minutes while the panel is rendered
- **THEN** the token figures continue to show the session's totals rather than falling to absent

### Requirement: Sampling runs only while the readout can be seen

No measurement of the host SHALL be taken while gesture control is off.
Sampling SHALL begin when gesture control turns on and SHALL stop when it turns
off, and SHALL stop when the app shuts down.

There SHALL NOT be a separate control for this, on the same terms this capability
already forbids a separate switch for the tracking itself: the readout is part
of the camera overlays, and its measurement follows them.

No measurement SHALL be retained across a stop. When sampling resumes, rates
SHALL be computed from observations made since it resumed — a rate derived from
a baseline taken before the pause describes the whole pause, not the present.

This governs **measurement of the host**, whose cost is why it is gated. It SHALL
NOT be extended to figures the panel shows that are not host measurements. A
count of what the app has consumed is produced from information the app already
received, costs nothing to keep, and SHALL be kept whether or not anything is
displaying it — gating it would under-report every session. Such a figure SHALL
NOT be reset by a stop, and when the panel resumes it SHALL show the current
figures immediately rather than after the next change.

#### Scenario: Gesture control off means nothing is measured

- **WHEN** gesture control is off
- **THEN** no host measurement is taken and no measurement subprocess is started

#### Scenario: Turning gesture control on starts sampling

- **WHEN** the user turns gesture control on
- **THEN** sampling starts, and the first values appear once enough has been observed to compute them

#### Scenario: Shutdown stops sampling

- **WHEN** the app is quit while gesture control is on
- **THEN** sampling stops as part of shutdown, leaving no running measurement work behind

#### Scenario: Resuming does not report the pause

- **WHEN** gesture control is turned off and later back on
- **THEN** the first rates reported after it resumes describe activity since it resumed, not activity spanning the interval it was off

#### Scenario: Turning gesture control off does not reset the token figures

- **WHEN** gesture control is turned off while tokens continue to be consumed, and is later turned back on
- **THEN** the panel's token figures include everything consumed throughout, including while it was off

### Requirement: The panel's warning tone marks a real condition

The panel's single warning tone SHALL be applied on the basis of a measured
condition, and SHALL NOT be applied unconditionally. A tone that is always
present marks nothing, which spends the one accent the palette reserves and
returns nothing for it.

Where no measured condition warrants it, the panel SHALL show no warning tone at
all. Where one does, the tone SHALL identify **which** measurement warrants it,
rather than being applied to the panel as a whole.

The condition SHALL be derived from measured values, not from interpolated ones,
and SHALL be resistant to values hovering at its boundary — both by separating
the level at which it is entered from the level at which it is left, and by a
minimum time before it may change again. A panel whose accent flickers as a value
sits on a threshold reads as malfunctioning.

The condition SHALL be a condition **of the host**. A token figure SHALL NEVER
carry the warning tone, at any magnitude: there is no level at which an amount
consumed is a fault, and marking one would imply a limit the panel does not
enforce. What the app does enforce about spend is a per-run ceiling, applied in
the run's own configuration and reported as that run's terminal status — not as a
tone on a decorative overlay.

#### Scenario: An unremarkable machine shows no warning tone in the readout

- **WHEN** the panel is rendered and no measurement warrants attention
- **THEN** no value in it carries the warning tone

#### Scenario: The warning tone points at what warrants it

- **WHEN** a measurement rises to a level that warrants attention
- **THEN** that measurement's own value carries the warning tone, and the others do not

#### Scenario: A value at the boundary does not flicker

- **WHEN** a measurement hovers at the level that warrants attention
- **THEN** the warning tone does not alternate on and off from one measurement to the next

#### Scenario: A large token figure is not a warning

- **WHEN** an engine's session total grows to any magnitude
- **THEN** no part of the panel carries the warning tone on account of it
