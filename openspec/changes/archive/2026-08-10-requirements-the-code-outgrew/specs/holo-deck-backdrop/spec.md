## MODIFIED Requirements

### Requirement: WebGL particle/node network backdrop

The deck (non-HUD) renderer SHALL render a WebGL particle/node network backdrop
behind the deck panels **when the WebGL quality preference is on the high-fidelity
path** (see `webgl-quality-mode`), layered above the Deep Space CSS gradient layers
(`hud-nebula`/`hud-glow`) and below all `.deck-panel` content, colored from
`tokens.css` CSS variables rather than hardcoded colors.

The backdrop SHALL live in its own component and its own stylesheet, adding no
rules to the adopted Deep Space sheets. The constraint is ownership, not
byte-equality: `deepspace-skin` states what those sheets are and how a change to
them is handled, and this capability SHALL defer to it rather than asserting a
verbatim-upstream property that capability has retired.

On the light path — the default — the backdrop SHALL NOT be created at all: no
WebGL rendering context is established for it, so it costs nothing rather than
rendering cheaply. The deck's background is then the Deep Space CSS gradient layers
on their own, which SHALL remain a complete and legible background without it. This
is the single largest saving the light path makes on the deck, because the backdrop
covers the full viewport.

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

#### Scenario: The backdrop owns its own files

- **WHEN** the backdrop's implementation is inspected
- **THEN** it consists of its own component and its own stylesheet, and the adopted Deep Space sheets carry no backdrop rules

#### Scenario: Backdrop follows the token palette

- **WHEN** the backdrop is rendered
- **THEN** its materials are colored from `tokens.css` variables (e.g. `--cyan`, `--violet`) read at runtime, not hardcoded hex values
