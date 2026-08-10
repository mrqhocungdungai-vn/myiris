## Purpose

The deck's ambient background: a WebGL particle/node network behind the non-HUD deck, giving the interface depth without competing with the orb or the Work Stream for attention. Its render loop is lifecycle-aware and stops when nothing is looking at it, because a continuously running WebGL loop is a permanent main-thread and GPU cost paid for an invisible surface — see `main-thread-budget` for the budget it answers to.

## Requirements

### Requirement: WebGL particle/node network backdrop

The deck (non-HUD) renderer SHALL render a WebGL particle/node network backdrop behind the deck panels **when the WebGL quality preference is on the high-fidelity path** (see `webgl-quality-mode`), layered above the Deep Space CSS gradient layers (`hud-nebula`/`hud-glow`) and below all `.deck-panel` content, colored from `tokens.css` CSS variables rather than hardcoded colors.

The backdrop SHALL live in its own component and its own stylesheet, adding no
rules to the adopted Deep Space sheets. The constraint is ownership, not
byte-equality: `deepspace-skin` states what those sheets are and how a change to
them is handled, and this capability SHALL defer to it rather than asserting a
verbatim-upstream property that capability has retired.

On the light path — the default — the backdrop SHALL NOT be created at all: no WebGL rendering context is established for it, so it costs nothing rather than rendering cheaply. The deck's background is then the Deep Space CSS gradient layers on their own, which SHALL remain a complete and legible background without it. This is the single largest saving the light path makes on the deck, because the backdrop covers the full viewport.

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

### Requirement: Backdrop render loop pauses when inactive

Whenever the backdrop is rendered at all, its render loop SHALL stop consuming GPU (no continuous frame advancement) when Iris is asleep or the deck window is unfocused, and SHALL resume automatically on wake or focus. The quality preference SHALL NOT weaken this: the high-fidelity path pauses on exactly the same conditions, and the light path — which does not create the backdrop — has no loop to pause.

**Pausing SHALL stop frame advancement, never rendering itself.** A paused backdrop
SHALL remain visible, showing its particle network at rest rather than vanishing.
This holds even if it was paused before it had ever drawn a frame, which is reachable
on a fresh start.

While paused the backdrop SHALL redraw when what it depicts changes. Redrawing on
change is not frame advancement and SHALL NOT be read as a violation of the pausing
rules above.

#### Scenario: Pauses on sleep

- **WHEN** the backdrop is rendered and Iris transitions to the asleep state
- **THEN** the backdrop's render loop stops advancing frames

#### Scenario: Pauses on unfocus

- **WHEN** the backdrop is rendered and the deck window loses OS focus
- **THEN** the backdrop's render loop stops advancing frames, and resumes advancing when focus returns

#### Scenario: A paused backdrop is still visible

- **WHEN** the backdrop is mounted and paused for any reason
- **THEN** its particle network is drawn on screen at rest, rather than leaving the
  deck with an empty background
