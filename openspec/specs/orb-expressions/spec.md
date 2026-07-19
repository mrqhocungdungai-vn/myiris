## Purpose

TBD — orb micro-expressions and synthesized interface sound cues for the Orbital Deck UI.

## Requirements

### Requirement: Orb micro-expressions

The ReactorCore orb SHALL render as a 3D WebGL Arc Reactor (glowing core, counter-rotating rings, bloom) while continuing to support upstream's expressive prop surface — separate input/output audio level refs, a `thinking` state, a wake pulse key, and a speech-lock ripple key — and App SHALL drive them: thinking swirl when the user stops talking before the reply arrives, double pulse on wake, ripple when the user's speech locks in, and flashes on task delegate/complete. The orb SHALL additionally accept optional rotation and scale inputs and visually apply them without altering any of the above expressive behaviors.

#### Scenario: Thinking swirl

- **WHEN** the user finishes speaking and Gemini has not yet responded
- **THEN** the orb enters the thinking expression until playback starts

#### Scenario: Wake pulse

- **WHEN** the session wakes
- **THEN** the orb performs the double-pulse animation

#### Scenario: Renders as 3D Arc Reactor

- **WHEN** the orb is mounted in deck mode
- **THEN** it renders via WebGL (not a 2D canvas) as a glowing core with counter-rotating rings and bloom, colored from `tokens.css` per the current `reactorState`

#### Scenario: Rotation and scale applied without breaking expressions

- **WHEN** rotation and/or scale inputs are provided
- **THEN** the orb visually rotates/scales accordingly while thinking swirl, wake pulse, ripple, and task flashes continue to render exactly as before

### Requirement: Orb render loop pauses when inactive

The orb's WebGL render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep or the deck window is unfocused, and SHALL resume automatically on wake or focus, without losing its current expressive state.

#### Scenario: Pauses on sleep

- **WHEN** Iris transitions to the asleep state
- **THEN** the orb's render loop stops advancing frames

#### Scenario: Pauses on unfocus

- **WHEN** the deck window loses OS focus
- **THEN** the orb's render loop stops advancing frames, and resumes advancing when focus returns

### Requirement: Synthesized interface sounds with mute

The renderer SHALL play synthesized Web Audio cues (no audio assets) for wake, sleep, task submitted, task completed, task failed, and approval/attention moments, gated by a persisted mute toggle (default: sounds on).

#### Scenario: Task lifecycle cues

- **WHEN** a Claude task is submitted and later completes
- **THEN** the task-sent cue plays at submission and the task-done (or task-failed) cue plays at completion

#### Scenario: Mute silences everything

- **WHEN** the mute toggle is enabled
- **THEN** no interface cue plays, and the preference persists across app restarts
