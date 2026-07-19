## Purpose

TBD — WebGL particle/node network backdrop for the non-HUD deck, with lifecycle-aware render-loop pausing.

## Requirements

### Requirement: WebGL particle/node network backdrop

The deck (non-HUD) renderer SHALL render a WebGL particle/node network backdrop behind the deck panels, layered above the existing Deep Space CSS gradient layers (`hud-nebula`/`hud-glow`/`hud-vignette`) and below all `.deck-panel` content, colored from `tokens.css` CSS variables rather than hardcoded colors, without modifying any upstream-verbatim Deep Space stylesheet.

#### Scenario: Backdrop renders behind panels

- **WHEN** the deck is in non-HUD mode
- **THEN** a drifting, bloom-lit node/particle network is visible behind the panels and does not obscure or reduce the legibility of any panel content

#### Scenario: Deep Space files stay untouched

- **WHEN** `tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, and `index.css` are compared against their upstream counterparts
- **THEN** they remain unmodified; the backdrop lives in its own new component and stylesheet

#### Scenario: Backdrop follows the token palette

- **WHEN** the backdrop is rendered
- **THEN** its materials are colored from `tokens.css` variables (e.g. `--cyan`, `--violet`) read at runtime, not hardcoded hex values

### Requirement: Backdrop render loop pauses when inactive

The backdrop's render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep or the deck window is unfocused, and SHALL resume automatically on wake or focus.

#### Scenario: Pauses on sleep

- **WHEN** Iris transitions to the asleep state
- **THEN** the backdrop's render loop stops advancing frames

#### Scenario: Pauses on unfocus

- **WHEN** the deck window loses OS focus
- **THEN** the backdrop's render loop stops advancing frames, and resumes advancing when focus returns
