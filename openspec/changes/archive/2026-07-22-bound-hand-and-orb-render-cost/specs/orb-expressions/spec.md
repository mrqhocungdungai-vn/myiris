## MODIFIED Requirements

### Requirement: Orb render loop pauses when inactive

The orb's WebGL render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep, and SHALL resume automatically on wake, without losing its current expressive state. In deck mode the loop SHALL additionally pause when the deck window loses OS focus and resume when focus returns. In HUD mode — the always-on-top overlay the user keeps visible while working in other applications — the overlay orb SHALL pause only when Iris is asleep and SHALL keep rendering while awake even when the OS window is unfocused, because the HUD orb is the ambient liveness indicator and pausing it on blur would defeat the overlay's purpose.

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
