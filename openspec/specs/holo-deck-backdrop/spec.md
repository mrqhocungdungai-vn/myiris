## Purpose

The deck's ambient background: a WebGL particle/node network behind the non-HUD deck, giving the interface depth without competing with the orb or the Work Stream for attention. Its render loop is lifecycle-aware and stops when nothing is looking at it, because a continuously running WebGL loop is a permanent main-thread and GPU cost paid for an invisible surface — see `main-thread-budget` for the budget it answers to.

## Requirements

### Requirement: WebGL particle/node network backdrop

The deck (non-HUD) renderer SHALL render a WebGL particle/node network backdrop behind the deck panels **when the WebGL quality preference is on the high-fidelity path** (see `webgl-quality-mode`), layered above the existing Deep Space CSS gradient layers (`hud-nebula`/`hud-glow`/`hud-vignette`) and below all `.deck-panel` content, colored from `tokens.css` CSS variables rather than hardcoded colors, without modifying any upstream-verbatim Deep Space stylesheet.

On the light path — the default — the backdrop SHALL NOT be created at all: no WebGL rendering context is established for it, so it costs nothing rather than rendering cheaply. The deck's background is then the existing Deep Space CSS gradient layers on their own, which SHALL remain a complete and legible background without it. This is the single largest saving the light path makes on the deck, because the backdrop covers the full viewport.

#### Scenario: Backdrop renders behind panels

- **WHEN** the deck is in non-HUD mode and the quality preference is on the high-fidelity path
- **THEN** a drifting, bloom-lit node/particle network is visible behind the panels and does not obscure or reduce the legibility of any panel content

#### Scenario: No backdrop context on the light path

- **WHEN** the deck is in non-HUD mode and the quality preference is on the light path
- **THEN** no WebGL rendering context is created for the backdrop and no backdrop frames are rendered

#### Scenario: The deck still has a background on the light path

- **WHEN** the deck renders on the light path
- **THEN** the Deep Space CSS gradient layers provide the deck's background, and no panel sits on a bare or transparent surface

#### Scenario: Toggling the preference creates or discards the backdrop

- **WHEN** the user changes the quality preference while the deck is showing
- **THEN** the backdrop appears or is torn down immediately, and a torn-down backdrop leaves no live WebGL context behind

#### Scenario: Deep Space files stay untouched

- **WHEN** `tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, and `index.css` are compared against their upstream counterparts
- **THEN** they remain unmodified; the backdrop lives in its own new component and stylesheet

#### Scenario: Backdrop follows the token palette

- **WHEN** the backdrop is rendered
- **THEN** its materials are colored from `tokens.css` variables (e.g. `--cyan`, `--violet`) read at runtime, not hardcoded hex values

### Requirement: Backdrop render loop pauses when inactive

Whenever the backdrop is rendered at all, its render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep or the deck window is unfocused, and SHALL resume automatically on wake or focus. The quality preference SHALL NOT weaken this: the high-fidelity path pauses on exactly the same conditions, and the light path — which does not create the backdrop — has no loop to pause.

#### Scenario: Pauses on sleep

- **WHEN** the backdrop is rendered and Iris transitions to the asleep state
- **THEN** the backdrop's render loop stops advancing frames

#### Scenario: Pauses on unfocus

- **WHEN** the backdrop is rendered and the deck window loses OS focus
- **THEN** the backdrop's render loop stops advancing frames, and resumes advancing when focus returns
