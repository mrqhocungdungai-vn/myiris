# orb-expressions

## ADDED Requirements

### Requirement: Orb micro-expressions
The ReactorCore orb SHALL support upstream's expressive prop surface — separate input/output audio level refs, a `thinking` state, a wake pulse key, and a speech-lock ripple key — and App SHALL drive them: thinking swirl when the user stops talking before the reply arrives, double pulse on wake, ripple when the user's speech locks in, and flashes on task delegate/complete.

#### Scenario: Thinking swirl
- **WHEN** the user finishes speaking and Gemini has not yet responded
- **THEN** the orb enters the thinking expression until playback starts

#### Scenario: Wake pulse
- **WHEN** the session wakes
- **THEN** the orb performs the double-pulse animation

### Requirement: Synthesized interface sounds with mute
The renderer SHALL play synthesized Web Audio cues (no audio assets) for wake, sleep, task submitted, task completed, task failed, and approval/attention moments, gated by a persisted mute toggle (default: sounds on).

#### Scenario: Task lifecycle cues
- **WHEN** a Claude task is submitted and later completes
- **THEN** the task-sent cue plays at submission and the task-done (or task-failed) cue plays at completion

#### Scenario: Mute silences everything
- **WHEN** the mute toggle is enabled
- **THEN** no interface cue plays, and the preference persists across app restarts
