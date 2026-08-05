## Purpose

Decorative, on-device iris tracking layered into the Camera/Gesture dock — a visual-only "lock-on" HUD that tracks both eyes' live position, purely for atmosphere, with no interaction or app behavior derived from it.

## ADDED Requirements

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

### Requirement: The panel element is offset beside its eye and clearly placeholder content

The panel-style element SHALL be positioned offset to the side of its eye — it SHALL NOT be centered on or overlap that eye.

Its content SHALL be clearly placeholder/illustrative data. It SHALL NOT be presented as derived from any real signal unless and until a future change explicitly wires it to one.

#### Scenario: The panel never covers its eye

- **WHEN** the panel-style element is rendered
- **THEN** it appears beside its tracked eye, not on top of it, regardless of where on screen that eye currently is

#### Scenario: The panel follows head movement

- **WHEN** the user moves their head
- **THEN** the panel's position updates to stay beside the same eye it was assigned to

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

### Requirement: The panel's values change continuously without disturbing its layout

The panel's displayed values SHALL update continuously while it is rendered. A wholly static readout SHALL NOT be used — it reads as a captured image overlaid on live video, and it also makes the placeholder content easier to mistake for a real measurement than changing values do.

Value updates SHALL NOT change the panel's layout: rows SHALL NOT reflow, shift, or change width as values change. A readout whose geometry twitches on each update reads as malfunctioning rather than as live.

#### Scenario: Values churn while the panel is open

- **WHEN** the panel is rendered and observed for several seconds
- **THEN** its values are seen changing, and it is evident from that motion that they are illustrative rather than measured

#### Scenario: Changing values do not move anything

- **WHEN** the panel's values update, including between values of differing digit counts
- **THEN** no row changes position or width, and no text shifts horizontally

### Requirement: The panel stays on its eye's outward side, even when that clips it

Each element SHALL stay within its own eye's half of the frame: the panel SHALL hang **left** of its eye — the outward direction, since its eye is the one appearing on the frame's left — and SHALL NOT be placed on that eye's other side under any condition. The two elements SHALL NOT overlap each other at any head position.

The panel's placement SHALL be a function of its eye's position alone, with no dependence on frame bounds, on its own previous placement, or on any threshold. Placement that changes discontinuously with head pose SHALL NOT be used, whatever it is protecting against: a panel that relocates while the user merely turns their head reads as malfunctioning, and no deadband around such a relocation removes that — it only decides when it happens.

Where this places part of the panel outside the frame, the panel SHALL simply be clipped by the frame's edge. **Losing part of the readout is the accepted cost**, deliberately chosen over both alternatives: moving the panel across its eye puts it where the other eye's ring is, and moving it along with the frame edge detaches it from the eye it is reporting on. Its content is placeholder data, so nothing is actually lost by clipping it.

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
