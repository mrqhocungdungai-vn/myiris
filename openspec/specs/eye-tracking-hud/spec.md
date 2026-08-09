## Purpose

Decorative, on-device iris tracking layered into the Camera/Gesture dock — a visual-only "lock-on" HUD that tracks both eyes' live position, purely for atmosphere, with no interaction or app behavior derived from it.
## Requirements
### Requirement: Iris tracking is decorative and shares the existing camera session

Eye/iris position and size SHALL be tracked on-device, from the same camera session the hand-gesture tracking already opened — never a second camera capture request, and no camera frame data SHALL leave the device.

This capability SHALL be purely decorative: eye position and size SHALL drive only where visual elements are drawn. It SHALL NOT drive any gesture, interaction, or other app behavior. It SHALL be enabled and disabled together with the existing gesture-control toggle; there SHALL NOT be a separate switch for it.

A failure to initialize on-device tracking (an unsupported environment, a failed model load) SHALL degrade to "no eye overlays render" — it SHALL NOT surface an error to the user, on the same terms the existing hand-gesture tracking already treats its own load failures.

#### Scenario: Enabling gesture control also enables eye tracking

- **WHEN** the user enables gesture control and a face is in the camera frame
- **THEN** both eyes' positions are tracked, without any additional camera permission prompt beyond the one gesture control already requires

#### Scenario: Gesture control off means no eye tracking

- **WHEN** gesture control is off
- **THEN** no iris tracking runs and no eye-tracking visual elements render

#### Scenario: Tracking survives a UI mode switch

- **WHEN** the user switches between the deck and the glass HUD while gesture control is on
- **THEN** iris tracking continues without re-initializing its on-device model, and no camera permission prompt or tracking gap appears

#### Scenario: A failed model load degrades quietly

- **WHEN** the on-device tracking model fails to initialize
- **THEN** the dock behaves as if no face is present — no eye-tracking visuals render, and no error is shown to the user

### Requirement: The overlays render in every surface that shows the camera preview

Wherever the app presents a camera preview, this capability's overlays SHALL render there — currently both the deck's camera dock and the glass HUD's. Neither surface SHALL show the preview with the overlays absent while the other shows them.

The overlays SHALL NOT be specialized per surface: the same elements, behavior, and eye-to-element assignment apply in each. Their size SHALL follow the frame they are drawn in, so a surface with a larger camera frame SHALL show correspondingly larger overlays without separate tuning.

#### Scenario: Both surfaces show the overlays

- **WHEN** gesture control is on and a face is detected, in either the deck or the glass HUD
- **THEN** that surface's camera preview shows the same ring and readout, behaving identically

#### Scenario: A larger camera frame scales the overlays with it

- **WHEN** one surface's camera frame is larger than the other's
- **THEN** the overlays in it are correspondingly larger, tracking the same eyes in the same way, with no surface-specific configuration required to achieve that

#### Scenario: Resizing a camera frame rescales its overlays live

- **WHEN** a surface's camera frame changes size while a face is being tracked
- **THEN** the overlays rescale with it and keep tracking their eyes throughout, without re-tuning, re-initializing, or losing the face

### Requirement: The two eyes render two distinct, tracked elements — never a mirrored pair

The two eyes SHALL NOT receive the same visual treatment. Rendering the same small ring-style element on both real eyes reads as redundant and does not read clearly at typical webcam scale — so one eye SHALL drive a ring-style "lock-on" HUD element, and the other eye SHALL position a distinct panel-style element beside itself, never overlapping that eye.

The assignment SHALL be: **the ring-style element on the eye appearing on the RIGHT of the displayed frame, and the panel-style element on the eye appearing on its LEFT.** It SHALL be fixed and consistent — it SHALL NOT switch between the two eyes frame-to-frame or between sessions, since an inconsistent assignment would read as flickering/broken rather than as two deliberately different instruments.

That on-screen side is the binding statement of the assignment. Whatever internal identifier the implementation uses for an eye — an anatomical label, a landmark index — SHALL be derived from it and recorded alongside it, never the reverse: the preview is mirrored, so any reasoning that goes from a landmark label to an on-screen side is exactly the step that has already been gotten backwards once.

Both elements SHALL update their position every frame to track their eye's live position as the face moves, with no more than a couple of frames of lag — this remains eye tracking; only the rendering is asymmetric.

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

### Requirement: The ring HUD reads as an oversized, multi-color "lock-on" instrument

The ring-style element SHALL be rendered visibly larger than the tracked iris itself — scaling it 1:1 to the true iris size SHALL NOT be used, since that reads too small to see its motion on a typical webcam frame.

It SHALL be composed of multiple concentric ring elements, and SHALL include a graduated element (a tick dial or equivalent scale) so it reads as an instrument with a measurable face rather than as a set of plain circles.

Its elements SHALL be drawn as strokes with additive glow, without filled areas — a filled ring reads as a solid disc over the eye and loses the instrument-panel character the capability exists to produce.

It SHALL use a warning/alert-toned, multi-color palette distinct from this app's default single-tone accent color elsewhere in the interface, so it reads as a "lock-on" or alert instrument rather than a passive ambient scan.

#### Scenario: The ring is legibly larger than the eye

- **WHEN** the ring HUD is rendered over a tracked eye
- **THEN** its overall size is visibly larger than the iris/eye itself, not a tight 1:1 fit

#### Scenario: The eye stays visible through the ring

- **WHEN** the ring HUD is rendered over a tracked eye
- **THEN** the eye itself remains visible through it — the HUD is composed of strokes, and no part of it fills over the eye as a solid shape

### Requirement: The ring HUD's rotating layers read as several independent dials, not one spinning image

Every element of the ring HUD that rotates SHALL carry a visible asymmetric interruption — an unequal gap, a dash pattern, or an open arc. A continuous, rotationally uniform circle SHALL NOT be relied on to convey motion, because its rotation is not perceptible and it therefore contributes nothing the viewer can see.

Rotating elements that are **adjacent** in the concentric stack SHALL turn in opposite directions. Alternating direction only somewhere in the stack SHALL NOT satisfy this — the counter-rotation is only legible between neighbouring elements the eye can compare directly.

Rotation periods SHALL be pairwise distinct, and SHALL NOT be integer multiples of one another. Harmonically related periods re-synchronize on a fixed cycle, and at each re-synchronization the whole stack momentarily reads as a single rigid spinning image instead of as separate dials.

At least one element of the ring HUD SHALL remain static, as a fixed reference the rotations are read against. If everything moves, the assembly reads as undifferentiated noise rather than as moving parts.

#### Scenario: Adjacent rotating rings counter-rotate

- **WHEN** the ring HUD is actively rendering
- **THEN** each pair of neighbouring rotating elements is observed turning in opposite directions from each other

#### Scenario: Rotations never lock into a single rigid spin

- **WHEN** the ring HUD is observed continuously for an extended period
- **THEN** no moment occurs at which the rotating elements appear to move as one rigid body — each keeps its own independent phase

#### Scenario: Rotation is perceptible on every moving element

- **WHEN** any single rotating element of the ring HUD is observed in isolation
- **THEN** its rotation is visibly apparent from its own shape, not inferable only from the rest of the stack

#### Scenario: A static reference is always present

- **WHEN** the ring HUD is actively rendering
- **THEN** at least one of its elements is stationary relative to the tracked eye

### Requirement: The ring converges onto a newly detected eye rather than appearing at full size

On the transition from no face detected to a face detected, the ring HUD SHALL animate into place — appearing at a noticeably larger scale and easing inward to its tracked size over a brief interval, settling rather than stopping abruptly. It SHALL NOT simply appear at its final size on the first tracked frame, which reads as a sprite being toggled rather than as an instrument acquiring a target.

This animation SHALL be driven by the same per-frame mechanism that positions and scales the ring, not by a declarative style transition on the tracked element — an element whose transform is rewritten every frame cannot also be animated by a transition on that transform, and attempting it yields either no animation or a visible stutter.

The panel and its tether SHALL arrive after the ring's convergence rather than simultaneously with it — the connector extending first and the panel appearing at its end — so the sequence reads as a target being acquired and then reported on.

Loss of the face SHALL NOT require an equivalent dramatized exit; disappearing immediately or fading out are both acceptable.

#### Scenario: The panel arrives after the ring locks

- **WHEN** a face is newly detected
- **THEN** the ring converges first, then the connector extends, then the panel appears — not all three at once

#### Scenario: A newly detected face is acquired, not toggled on

- **WHEN** a face enters the camera frame and is detected for the first time
- **THEN** the ring HUD converges from a larger scale onto the tracked eye over a brief interval, and settles

#### Scenario: Acquisition does not fight per-frame tracking

- **WHEN** the user moves their head during the acquisition animation
- **THEN** the ring both converges and tracks the moving eye at once, with no stutter, snap-back, or frame where it lags the eye

### Requirement: A partial-arc element rotates around the tracked eye's center, never its own bounding box

Any element within this HUD that sweeps only part of a circle (a partial arc, not a full ring) SHALL rotate around the tracked eye's true center point.

Such an element SHALL NOT use a rotation mechanism whose pivot point is derived from that element's own geometry or bounding box — a partial arc's bounding box is not centered on the circle it belongs to, so pivoting around it produces a visible wobble or orbit instead of a clean spin-in-place. This constraint applies to any current or future partial-arc/partial-sweep element added to this HUD, not only the accent sweep it was first identified on.

#### Scenario: A partial-arc element spins without wobbling

- **WHEN** a partial-arc element completes a full rotation cycle
- **THEN** it appears to spin in place around the tracked eye's center, with no visible drift or wobble of its own center point

### Requirement: The panel reads as a projected readout, not as an application card

The panel SHALL NOT be drawn as a closed bordered rectangle. Its frame SHALL be implied — corner brackets and the alignment of its own content — rather than outlined, so it reads as a readout projected over a scene rather than as interface chrome borrowed from another application. Its shape SHALL carry an asymmetry (such as a single chamfered corner) giving it an orientation, rather than being symmetric on all four corners.

Its background SHALL be translucent — the camera image SHALL remain visible through it. An opaque panel occludes the scene instead of overlaying it.

The panel's palette SHALL be informationally-toned (this app's default accent), visibly distinct from the ring HUD's alert-toned palette, with any warning tone reserved for a single accent value. The two elements SHALL NOT merely differ arbitrarily: the division SHALL express that the ring is the alerting instrument and the panel is the reporting one.

Its content SHALL be denser than it is readable at a glance, and SHALL include a graduated meter drawn as discrete segments rather than as a smoothly filled bar.

#### Scenario: The panel has no closed border

- **WHEN** the panel is rendered
- **THEN** its extent is conveyed by corner brackets and content alignment, with no continuous outline drawn around it

#### Scenario: The scene shows through the panel

- **WHEN** the panel is rendered over any part of the camera image
- **THEN** that part of the image remains visible through it

### Requirement: A tether visibly connects the panel to its eye

The panel SHALL be joined to its tracked eye by a visible connector, so it reads as a callout attached to that eye rather than as an element that happens to sit nearby. The connector SHALL originate at the tracked eye and terminate at the panel.

Both of the connector's endpoints SHALL be recomputed every frame, since both the eye end and the panel end move. A connector anchored statically to either end SHALL NOT satisfy this.

#### Scenario: The connector tracks both ends

- **WHEN** the user moves their head while the panel is rendered
- **THEN** the connector stays joined to the tracked eye at one end and to the panel at the other, throughout the movement, with no visible detachment or gap at either end

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

### Requirement: Overlay geometry and text are not distorted by the frame's aspect ratio

Circular elements of this capability SHALL render as circles, and its text SHALL render at its true proportions — neither SHALL be stretched or compressed along either axis by the aspect ratio of the camera frame they are drawn over.

#### Scenario: The ring is circular

- **WHEN** the ring HUD is rendered over a tracked eye
- **THEN** its rings are circular, not elliptical

#### Scenario: The panel's text is undistorted

- **WHEN** the panel is rendered
- **THEN** its text renders at its true aspect — not horizontally stretched or compressed — and remains legible at the panel's size

### Requirement: The on-device model asset is fetched once and cached, never at renderer runtime

The model asset this capability's on-device tracking depends on SHALL be fetched and cached to local disk as part of the existing build/install vendoring step, following the same pattern already used for the hand-gesture tracking model. It SHALL NOT be fetched over the network by the renderer at runtime.

A build that already has the asset cached SHALL skip re-downloading it.

#### Scenario: First build downloads and caches the asset

- **WHEN** the build/install vendoring step runs and the model asset is not yet present on disk
- **THEN** it is downloaded once and cached locally

#### Scenario: Subsequent builds reuse the cached asset

- **WHEN** the build/install vendoring step runs and the model asset is already present on disk
- **THEN** it is not re-downloaded

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

