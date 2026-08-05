## Purpose

Deep Space visual system for the Orbital Deck renderer — the upstream stylesheet set and token-driven styling for Claude-specific UI elements.

## Requirements

### Requirement: Deep Space stylesheets adopted verbatim

The renderer SHALL use the upstream Deep Space visual system: `src/styles/tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, and `index.css` copied from the upstream iris repo (excluding `hud.css`, which is out of scope), replacing the previous `App.css` + monolithic `deck.css` aurora/scanlines skin, including the layered `hud-nebula` / `hud-glow` / `hud-vignette` background and deck enter/leave transitions.

#### Scenario: Old skin removed

- **WHEN** the change is complete
- **THEN** `src/App.css` and the flat `src/deck.css` no longer exist, `src/styles/index.css` is the single style entry point, and the deck renders the Deep Space background layers instead of `hud-aurora`/`hud-scanlines`

#### Scenario: Upstream sheets stay diffable

- **WHEN** an adopted upstream stylesheet is compared against its upstream counterpart
- **THEN** it is unmodified (Claude-specific styling lives elsewhere), so future upstream ports diff cleanly

### Requirement: Claude-custom styling isolated on Deep Space tokens

All Claude-specific UI styling (`.pipeline-bar`, verb chips and their model segment, `.model-popover`, the question banner, `.claude-session-line`, chain badges, `.project-bar`) SHALL live in a dedicated `src/styles/claude.css`, expressed against the Deep Space token variables from `tokens.css` so the custom UI reads as part of the new skin.

#### Scenario: Custom elements render correctly on the new skin

- **WHEN** the deck renders with the Deep Space skin
- **THEN** pipeline chips, model popover, the question banner, session line, and project bar are visually legible and positioned as before, with no unstyled or visually broken element

#### Scenario: Tokens drive custom styling

- **WHEN** `claude.css` is inspected
- **THEN** its colors and spacing reference `tokens.css` variables rather than hard-coded values from the old skin wherever a token exists

### Requirement: The Claude stylesheet styles only controls that exist

`src/styles/claude.css` SHALL NOT carry rules for a control the renderer does not
mount. When a control is removed, its styling SHALL be removed with it.

This SHALL be machine-checked rather than remembered. An unmatched CSS rule is
valid CSS: the typecheck, the bundler, the linter, and the test suite all stay
green with it in place, so the only thing that has ever surfaced dead styling here
is a person reading the file. Rules for the Hermes worker survived two renames in
plain sight on exactly that basis.

The check SHALL report a candidate and fail, never delete one. A class may be
assembled dynamically, which a static scan cannot see, and the cost of removing a
live style is a broken interface that no test detects — so a human confirms each
removal. Where a dynamically-built class must be kept, the allowance SHALL be
explicit and SHALL say why.

The check SHALL fail rather than warn, consistent with the rest of this repo's
gate chain, because a warning on a fault with no runtime symptom is a warning
nobody reads.

Scope is the stylesheet Iris owns. The adopted upstream sheets are separately
required to stay unmodified so future ports diff cleanly, and SHALL NOT be swept.

#### Scenario: A removed control's styling is caught

- **WHEN** a component is deleted from the renderer but its rules are left in `claude.css`
- **THEN** the check fails, naming the classes that no longer have a mount site

#### Scenario: A dynamically-built class is not silently deleted

- **WHEN** a class name is assembled at runtime rather than written as a literal
- **THEN** the check reports it as a candidate for a human to confirm, and no rule is removed automatically

#### Scenario: The upstream sheets are left alone

- **WHEN** the check runs
- **THEN** it examines only the Claude-specific stylesheet, leaving the adopted upstream sheets byte-comparable to their upstream counterparts
