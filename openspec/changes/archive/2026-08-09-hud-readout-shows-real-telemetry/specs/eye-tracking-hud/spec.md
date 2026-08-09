## RENAMED Requirements

- FROM: `### Requirement: The panel element is offset beside its eye and clearly placeholder content`
- TO: `### Requirement: The panel element is offset beside its eye and reports the real host`

## MODIFIED Requirements

### Requirement: The panel element is offset beside its eye and reports the real host

The panel-style element SHALL be positioned offset to the side of its eye — it
SHALL NOT be centered on or overlap that eye.

Its content SHALL be derived from real measurements of the machine the app is
running on — processor utilization, graphics utilization, and network
throughput in each direction. The header SHALL declare that provenance. It
SHALL NOT continue to declare the content simulated, and the panel's own naming
SHALL identify what it now reports: the panel reports the host, not the eye it
hangs beside.

Nothing outside this capability's own overlays SHALL read these measurements.
They SHALL NOT reach the voice layer, a run, a tool, or disk. The readout
remains decorative — it is a thing to look at, not a thing to act on.

#### Scenario: The panel never covers its eye

- **WHEN** the panel-style element is rendered
- **THEN** it appears beside its tracked eye, not on top of it, regardless of where on screen that eye currently is

#### Scenario: The panel follows head movement

- **WHEN** the user moves their head
- **THEN** the panel's position updates to stay beside the same eye it was assigned to

#### Scenario: The values are the machine's own

- **WHEN** the panel is rendered and the machine's processor, graphics or network activity changes
- **THEN** the corresponding displayed values change to follow it, and nothing in the panel declares itself simulated

#### Scenario: Nothing downstream reads the readout

- **WHEN** the panel is rendering measurements
- **THEN** no verb, prompt, run, spoken response, or stored file contains or depends on them

### Requirement: The panel stays on its eye's outward side, even when that clips it

Each element SHALL stay within its own eye's half of the frame: the panel SHALL hang **left** of its eye — the outward direction, since its eye is the one appearing on the frame's left — and SHALL NOT be placed on that eye's other side under any condition. The two elements SHALL NOT overlap each other at any head position.

The panel's placement SHALL be a function of its eye's position alone, with no dependence on frame bounds, on its own previous placement, or on any threshold. Placement that changes discontinuously with head pose SHALL NOT be used, whatever it is protecting against: a panel that relocates while the user merely turns their head reads as malfunctioning, and no deadband around such a relocation removes that — it only decides when it happens.

Where this places part of the panel outside the frame, the panel SHALL simply be clipped by the frame's edge. **Losing part of the readout is the accepted cost**, deliberately chosen over both alternatives: moving the panel across its eye puts it where the other eye's ring is, and moving it along with the frame edge detaches it from the eye it is reporting on. The readout is decorative and nothing depends on reading it, so nothing is actually lost by clipping it — and that SHALL remain true. No behavior anywhere SHALL come to require that the panel be legible, since the moment one does, clipping stops being acceptable and this placement rule has to be re-opened.

#### Scenario: The panel never crosses to its eye's other side

- **WHEN** the tracked face moves anywhere within the frame, including hard against either edge
- **THEN** the panel remains on the left of its eye throughout, and never overlaps the ring on the other eye

#### Scenario: An eye near the left edge clips the panel rather than moving it

- **WHEN** the tracked eye approaches the frame's left edge
- **THEN** the panel keeps its fixed offset from that eye and is progressively clipped by the frame edge, still connected by its tether

#### Scenario: A head turn never relocates the panel

- **WHEN** the user turns or moves their head, at any position in the frame, including dwelling near an edge
- **THEN** the panel tracks its eye continuously and is never seen jumping to a different position relative to it

## ADDED Requirements

### Requirement: The panel's values change because the machine changed, without disturbing its layout

The panel's displayed values SHALL update continuously while it is rendered. A wholly static readout SHALL NOT be used — it reads as a captured image overlaid on live video.

That motion SHALL come from the underlying measurements changing, and from nothing else. Synthetic variation SHALL NOT be added to a measured value to make it look alive, and every displayed figure SHALL lie between values that were actually measured.

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

### Requirement: The readout costs less than what it reports

Host measurement SHALL occur at most once per second, and SHALL NOT be performed
per rendered frame.

The cost of measuring SHALL NOT be great enough to visibly move the values being
displayed. A readout whose own overhead is a visible part of its reading is
worse than one that updates slowly, and the failure is invisible: the number is
correct, it is just partly about the panel.

Where a measurement would require elevated privileges to obtain, it SHALL NOT be
obtained. A decorative overlay is not a reason to ask for them.

Where the display needs to change more often than measurements arrive, the
displayed value SHALL be interpolated toward the most recent measurement. The
measurement rate SHALL NOT be raised in order to smooth the display.

Where a measurement is repeatedly unavailable on a given host, the attempt to
take it SHALL be abandoned for the session rather than repeated indefinitely at
the sampling rate.

#### Scenario: Measurement is not tied to the frame rate

- **WHEN** the panel is rendering and its values are visibly changing
- **THEN** measurements are being taken no more than once per second, independent of how often the panel is drawn

#### Scenario: A repeatedly unavailable measurement stops being attempted

- **WHEN** a measurement is unavailable on this host for several consecutive intervals
- **THEN** it is no longer attempted for the remainder of the session, and its row continues to render as absent

#### Scenario: Smoothing is done by interpolation, not by measuring faster

- **WHEN** a displayed value moves between one measurement and the next
- **THEN** it is interpolated toward the latest measurement, and no additional measurement was taken to produce that motion

### Requirement: The panel carries a history of one of its measurements

The panel SHALL include an element showing a span of recent measurements rather
than only the present one, so that the readout carries a time axis. Every
element being an instantaneous scalar leaves nothing in the panel that
distinguishes a live readout from a still image of one.

Each position in that element SHALL correspond to one real measurement, and its
values SHALL NOT be interpolated — a smoothed history is a shape that is no
longer data.

It SHALL be drawn as discrete segments rather than as a continuous trace, on the
same reasoning the panel's meter already follows, and its rendered width SHALL
NOT change with the data it displays.

#### Scenario: The panel shows recent history, not only the present

- **WHEN** the panel is rendered and observed while the machine's load changes
- **THEN** an element of it shows the recent span of that measurement, and the change is visible in it afterwards

#### Scenario: The history does not resize with its data

- **WHEN** the values in the history element change, across their whole range
- **THEN** the element occupies exactly the same width and position throughout

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

#### Scenario: An unremarkable machine shows no warning tone in the readout

- **WHEN** the panel is rendered and no measurement warrants attention
- **THEN** no value in it carries the warning tone

#### Scenario: The warning tone points at what warrants it

- **WHEN** a measurement rises to a level that warrants attention
- **THEN** that measurement's own value carries the warning tone, and the others do not

#### Scenario: A value at the boundary does not flicker

- **WHEN** a measurement hovers at the level that warrants attention
- **THEN** the warning tone does not alternate on and off from one measurement to the next

### Requirement: The ring's graduated element measures something

The ring HUD's graduated element SHALL be driven by a measured value, so that the
"measurable face" it exists to provide is a face that measures. A graduated scale
with no quantity on it is a drawing of an instrument rather than an instrument.

It SHALL remain static — this is the fixed reference the rotating layers are read
against, and driving it SHALL NOT be achieved by animating it. It SHALL remain
composed of strokes, with nothing filled over the eye.

Because the ring is this capability's **alerting** instrument and the panel its
reporting one, the quantity shown on the ring SHALL be one whose rise is the
thing worth alerting on.

#### Scenario: The dial reflects the measured value

- **WHEN** the measurement driving the graduated element rises and falls
- **THEN** the extent of the dial that is marked follows it

#### Scenario: Driving the dial does not make it move

- **WHEN** the graduated element is being driven by a changing measurement
- **THEN** it remains stationary relative to the tracked eye, and continues to serve as the fixed reference the rotating layers are read against

### Requirement: Acquisition resolves into a lock

After the ring has converged onto a newly detected eye, a brief settling beat
SHALL mark that the target is held, distinct from the convergence itself.
Convergence that simply ends leaves the sequence without a resolution, so the
instrument reads as having started rather than as having acquired.

This beat SHALL be driven by the same per-frame mechanism that positions and
scales the ring, for the same reason the convergence is — an element whose
transform is rewritten every frame cannot also be animated by a declarative
transition on it.

It SHALL occur after convergence completes and SHALL NOT delay or alter the
staged arrival of the tether and the panel.

#### Scenario: A newly acquired eye resolves into a lock

- **WHEN** the ring finishes converging onto a newly detected eye
- **THEN** a brief settling beat marks the lock, after which the ring is in its steady tracking state

#### Scenario: The lock beat does not fight tracking

- **WHEN** the user moves their head during the lock beat
- **THEN** the ring tracks the moving eye throughout, with no stutter, snap-back, or frame in which it lags the eye

## REMOVED Requirements

### Requirement: The panel's values change continuously without disturbing its layout

**Reason**: Replaced by "The panel's values change because the machine changed, without disturbing its layout". The requirement was written when the readout was decorative, and its scenario "Values churn while the panel is open" asked that the motion make it **evident the values are illustrative rather than measured** — the precise property this change removes. Keeping the scenario would leave the living spec demanding that a real measurement look fake. The replacement keeps every layout guarantee and adds the constant-width rule that real magnitudes need.
