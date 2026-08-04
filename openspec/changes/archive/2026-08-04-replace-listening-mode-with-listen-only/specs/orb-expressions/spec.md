## MODIFIED Requirements

### Requirement: Orb micro-expressions

The ReactorCore orb SHALL render as a 3D WebGL Arc Reactor (glowing core, counter-rotating rings) while continuing to support upstream's expressive prop surface — separate input/output audio level refs, a `thinking` state, a wake pulse key, and a speech-lock ripple key — and App SHALL drive them: thinking swirl when the user stops talking before the reply arrives, double pulse on wake, ripple when the user's speech locks in, and flashes on task delegate/complete. The orb SHALL additionally accept optional rotation and scale inputs and visually apply them without altering any of the above expressive behaviors.

The per-state palette App drives SHALL include a silent-reply state, for a reply turn that produces text without audio (see `listen-only-mode`), distinct from the audible-speaking state. Its accent SHALL come from the app's cool family and SHALL be separated in hue from the listening state, so the three conditions — hearing the user, replying silently, replying aloud — are distinguishable at a glance; the warm accent SHALL remain reserved for audible speech alone. Its energy SHALL match the audible-speaking state's, since a silent reply is an equally active turn.

How the orb's glow is produced SHALL follow the WebGL quality preference (see `webgl-quality-mode`). On the high-fidelity path the orb SHALL render its glow with a bloom post-processing pass, as it always has. On the light path — the default — it SHALL render with no post-processing pass, at a clamped device pixel ratio, without multisample antialiasing, and with unlit materials, and its glow SHALL instead be drawn by the compositor as a layer behind the orb, keyed to the same per-state color the orb itself uses so the orb and the room around it still read as one object. Either way the orb SHALL be visibly lit and colored from `tokens.css` per the current `reactorState`; it SHALL NOT appear as flat unlit geometry on either path. The expressive repertoire above SHALL be identical on both paths.

#### Scenario: Thinking swirl

- **WHEN** the user finishes speaking and Gemini has not yet responded
- **THEN** the orb enters the thinking expression until playback starts

#### Scenario: Wake pulse

- **WHEN** the session wakes
- **THEN** the orb performs the double-pulse animation

#### Scenario: Renders as 3D Arc Reactor

- **WHEN** the orb is mounted in deck mode
- **THEN** it renders via WebGL (not a 2D canvas) as a glowing core with counter-rotating rings, colored from `tokens.css` per the current `reactorState`

#### Scenario: Silent reply is a distinct state

- **WHEN** the orb is driven with the silent-reply state
- **THEN** it renders a cool accent, distinct in hue from both the listening state and the warm audible-speaking accent
- **AND** its energy matches the audible-speaking state's

#### Scenario: Bloom on the high-fidelity path

- **WHEN** the WebGL quality preference is on the high-fidelity path
- **THEN** the orb's glow is produced by a bloom post-processing pass, exactly as before the preference existed

#### Scenario: Compositor glow on the light path

- **WHEN** the WebGL quality preference is on the light path
- **THEN** the orb renders with no post-processing pass, at a clamped device pixel ratio, without multisample antialiasing and with unlit materials
- **AND** a glow layer behind the orb, colored from the current `reactorState`'s accent, keeps the orb reading as lit

#### Scenario: Expressions are identical on both paths

- **WHEN** the quality preference is changed between paths
- **THEN** the thinking swirl, wake pulse, speech-lock ripple, task flashes and state palette — the silent-reply state included — all behave identically, only the means of drawing the glow differs

#### Scenario: Rotation and scale applied without breaking expressions

- **WHEN** rotation and/or scale inputs are provided
- **THEN** the orb visually rotates/scales accordingly while thinking swirl, wake pulse, ripple, and task flashes continue to render exactly as before
