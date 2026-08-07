## Purpose

How the interface conveys Iris's state without words: orb micro-expressions that make the current activity readable at a glance, and synthesized — never sampled — interface sound cues the user can mute. Like the backdrop, the orb's render loop pauses when nothing is animating it, so an idle app costs nothing to display.

## Requirements

### Requirement: Orb micro-expressions

The ReactorCore orb SHALL render as a 3D WebGL Arc Reactor (glowing core, counter-rotating rings) while continuing to support upstream's expressive prop surface — separate input/output audio level refs, a `thinking` state, a wake pulse key, and a speech-lock ripple key — and App SHALL drive them: thinking swirl when the user stops talking before the reply arrives, double pulse on wake, ripple when the user's speech locks in, and flashes on task delegate/complete. The orb SHALL additionally accept optional rotation and scale inputs and visually apply them without altering any of the above expressive behaviors.

The per-state palette App drives SHALL include a listening-mode state, for the whole time listen-only mode is engaged (see `listen-only-mode`), distinct from the audible-speaking state. Its accent SHALL come from the app's cool family and SHALL be separated in hue from the ordinary listening state, so the three conditions — hearing the user, taking in a conversation silently, replying aloud — are distinguishable at a glance; the warm accent SHALL remain reserved for audible speech alone. Its energy SHALL match the audible-speaking state's, since Iris is equally engaged. Unlike the per-turn states around it, this state SHALL persist for as long as the mode is engaged rather than clearing at the end of a turn.

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

#### Scenario: Listening mode is a distinct state

- **WHEN** the orb is driven with the listening-mode state
- **THEN** it renders a cool accent, distinct in hue from both the ordinary listening state and the warm audible-speaking accent
- **AND** its energy matches the audible-speaking state's

#### Scenario: The listening-mode state lasts as long as the mode

- **WHEN** listen-only mode is engaged and remains engaged across many turns
- **THEN** the orb holds the listening-mode state throughout, rather than clearing it at any turn boundary

#### Scenario: Bloom on the high-fidelity path

- **WHEN** the WebGL quality preference is on the high-fidelity path
- **THEN** the orb's glow is produced by a bloom post-processing pass, exactly as before the preference existed

#### Scenario: Compositor glow on the light path

- **WHEN** the WebGL quality preference is on the light path
- **THEN** the orb renders with no post-processing pass, at a clamped device pixel ratio, without multisample antialiasing and with unlit materials
- **AND** a glow layer behind the orb, colored from the current `reactorState`'s accent, keeps the orb reading as lit

#### Scenario: Expressions are identical on both paths

- **WHEN** the quality preference is changed between paths
- **THEN** the thinking swirl, wake pulse, speech-lock ripple, task flashes and state palette — the listening-mode state included — all behave identically, only the means of drawing the glow differs

#### Scenario: Rotation and scale applied without breaking expressions

- **WHEN** rotation and/or scale inputs are provided
- **THEN** the orb visually rotates/scales accordingly while thinking swirl, wake pulse, ripple, and task flashes continue to render exactly as before

### Requirement: Orb render loop pauses when inactive

The orb's WebGL render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep, and SHALL resume automatically on wake, without losing its current expressive state. In deck mode the loop SHALL additionally pause when the deck window loses OS focus and resume when focus returns. In HUD mode — the always-on-top overlay the user keeps visible while working in other applications — the overlay orb SHALL pause only when Iris is asleep and SHALL keep rendering while awake even when the OS window is unfocused, because the HUD orb is the ambient liveness indicator and pausing it on blur would defeat the overlay's purpose.

**Pausing SHALL stop frame advancement, never rendering itself.** A paused orb SHALL
remain visible and SHALL depict its current expressive state — it is a still orb, not
an absent one. This holds however the orb entered the paused state, including when it
was paused before it had ever drawn: a surface that has never rendered SHALL still
present a correct image while paused, rather than an empty canvas.

Consequently, while paused the orb SHALL redraw when the state it depicts changes, so
that a user looking at a paused orb is never shown a stale or blank one. Redrawing on
change is not frame advancement and SHALL NOT be read as a violation of the pausing
rules above.

The deck's pause condition depends on whether the window holds OS focus, so that
signal SHALL be observed reliably rather than inferred once: it SHALL be correct from
the first render onward, and SHALL NOT be able to latch at a stale value because a
focus transition happened at a moment when nothing was listening.

#### Scenario: Pauses on sleep

- **WHEN** Iris transitions to the asleep state (in deck mode or HUD mode)
- **THEN** the orb's render loop stops advancing frames

#### Scenario: Pauses on unfocus in deck mode

- **WHEN** the deck window loses OS focus
- **THEN** the orb's render loop stops advancing frames, and resumes advancing when focus returns

#### Scenario: HUD orb keeps rendering while awake and unfocused

- **WHEN** HUD mode is active, Iris is awake, and the OS window is unfocused (the user is working in another app)
- **THEN** the overlay orb's render loop keeps advancing frames
- **AND** it stops advancing only when Iris goes asleep, resuming on wake

#### Scenario: A paused orb is still an orb

- **WHEN** the orb is paused for any reason — asleep, or the deck window unfocused
- **THEN** the orb is drawn on screen in its current expressive state, and the user
  never sees the orb's decorations animating over an empty space where the orb
  should be

#### Scenario: Paused before it ever drew

- **WHEN** the orb reaches its paused condition without having rendered a single
  frame — as on a fresh start, or when waking while the deck window is unfocused
- **THEN** it still presents a correct image rather than an empty canvas

#### Scenario: Focus is known correctly from the start

- **WHEN** the deck window becomes focused at any point, including before the
  renderer has finished setting up its focus observation
- **THEN** the deck's surfaces treat the window as focused, and do not remain paused
  for the rest of the session on the basis of a focus transition that was missed

### Requirement: Synthesized interface sounds with mute

The renderer SHALL play synthesized Web Audio cues (no audio assets) for wake, sleep, task submitted, task completed, task failed, and approval/attention moments, gated by a persisted mute toggle (default: sounds on).

#### Scenario: Task lifecycle cues

- **WHEN** a Claude task is submitted and later completes
- **THEN** the task-sent cue plays at submission and the task-done (or task-failed) cue plays at completion

#### Scenario: Mute silences everything

- **WHEN** the mute toggle is enabled
- **THEN** no interface cue plays, and the preference persists across app restarts
