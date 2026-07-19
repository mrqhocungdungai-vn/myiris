# deepspace-skin

## ADDED Requirements

### Requirement: Deep Space stylesheets adopted verbatim
The renderer SHALL use the upstream Deep Space visual system: `src/styles/tokens.css`, `base.css`, `deck.css`, `fx.css`, `overlays.css`, and `index.css` copied from the upstream iris repo (excluding `hud.css`, which is out of scope), replacing the previous `App.css` + monolithic `deck.css` aurora/scanlines skin, including the layered `hud-nebula` / `hud-glow` / `hud-vignette` background and deck enter/leave transitions.

#### Scenario: Old skin removed
- **WHEN** the change is complete
- **THEN** `src/App.css` and the flat `src/deck.css` no longer exist, `src/styles/index.css` is the single style entry point, and the deck renders the Deep Space background layers instead of `hud-aurora`/`hud-scanlines`

#### Scenario: Upstream sheets stay diffable
- **WHEN** an adopted upstream stylesheet is compared against its upstream counterpart
- **THEN** it is unmodified (Claude-specific styling lives elsewhere), so future upstream ports diff cleanly

### Requirement: Claude-custom styling isolated on Deep Space tokens
All Claude-specific UI styling (`.pipeline-bar`, agent chips and their model segment, `.model-popover`, PO question banner, `.claude-session-line`, chain badges, `.project-bar`, agent install button) SHALL live in a dedicated `src/styles/claude.css`, expressed against the Deep Space token variables from `tokens.css` so the custom UI reads as part of the new skin.

#### Scenario: Custom elements render correctly on the new skin
- **WHEN** the deck renders with the Deep Space skin
- **THEN** pipeline chips, model popover, PO question banner, session line, project bar, and install button are visually legible and positioned as before, with no unstyled or visually broken element

#### Scenario: Tokens drive custom styling
- **WHEN** `claude.css` is inspected
- **THEN** its colors and spacing reference `tokens.css` variables rather than hard-coded values from the old skin wherever a token exists
