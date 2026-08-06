## MODIFIED Requirements

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
