## ADDED Requirements

### Requirement: Dark surfaces stay out of the 8-bit crush zone

The visual system SHALL keep its dark surfaces above the range where 8-bit sRGB
runs out of resolution, because below it a soft ramp cannot be rendered as a ramp.

The darkest base surface token SHALL sit at or above `#0b111c`. Below the sRGB toe,
luminance is roughly proportional to code value, so one code step at value 7 is a
~14% relative brightness jump and reads as a hard line, while the same step at value
21 is ~5% and does not. Any surface, overlay, scrim, or vignette added later SHALL
respect the same floor rather than reintroducing its own crush region.

No gradient SHALL span a window-scale distance between two stops that are only a few
code values apart. A ramp crossing more pixels than it has code levels available is
not a gradient; it is a set of flat plateaus with hard edges. Such a fill SHALL be
flat instead.

This constraint SHALL be stated in `tokens.css` next to the values it governs, since
nothing in the gate chain can detect a violation — banding is visible only to a
person looking at the running app in its dim states.

#### Scenario: The base palette holds the floor

- **WHEN** the base surface tokens are inspected
- **THEN** the darkest of them is at or above `#0b111c`, and the reasoning is
  recorded in the stylesheet alongside them

#### Scenario: No window-scale near-black ramp

- **WHEN** a fill covering the window or a large region of it is inspected
- **THEN** it is a flat fill rather than a gradient between two near-black stops,
  and no full-window inset shadow ramps the edges toward pure black

#### Scenario: Dim states show no contour lines

- **WHEN** the app is viewed in its dim states, where the accent wash layers are
  themselves dimmed and no longer mask the base surface
- **THEN** large dark areas read as flat, with no plateaus or hard edges across them

## MODIFIED Requirements

### Requirement: Deep Space stylesheets adopted verbatim

The renderer SHALL use the Deep Space visual system: `src/styles/tokens.css`,
`base.css`, `deck.css`, `fx.css`, `overlays.css`, and `index.css` (excluding
`hud.css`, which is out of scope), replacing the previous `App.css` + monolithic
`deck.css` aurora/scanlines skin, including the layered `hud-nebula` / `hud-glow`
background and deck enter/leave transitions.

These sheets were **adopted from the upstream iris repo as a starting point, and are
now Iris's own.** They are no longer required to match upstream byte for byte. That
property was worth stating while it held, but it has not held for some time —
`deck.css`, `overlays.css` and `index.css` carry Iris-specific rules — and a
requirement the code has quietly outgrown protects nothing.

Where an upstream fix is ported into these sheets, the upstream values SHALL be taken
exactly rather than re-derived, so that a later, larger port has less to reconcile.

This requirement continues to name the adopted set, because the dead-rule sweep is
scoped by it: the sweep covers the stylesheet Iris authored (`claude.css`) and not
these.

#### Scenario: Old skin removed

- **WHEN** the change is complete
- **THEN** `src/App.css` and the flat `src/deck.css` no longer exist, `src/styles/index.css` is the single style entry point, and the deck renders the Deep Space background layers instead of `hud-aurora`/`hud-scanlines`

#### Scenario: A ported upstream fix keeps upstream's values

- **WHEN** a fix is taken from upstream into one of these sheets
- **THEN** the concrete values land as upstream wrote them, rather than being
  independently re-chosen to the same intent

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

Scope is the stylesheet Iris authored. The adopted sheets SHALL NOT be swept, because
they are maintained against upstream rather than against this renderer's mount sites.

#### Scenario: A removed control's styling is caught

- **WHEN** a component is deleted from the renderer but its rules are left in `claude.css`
- **THEN** the check fails, naming the classes that no longer have a mount site

#### Scenario: A dynamically-built class is not silently deleted

- **WHEN** a class name is assembled at runtime rather than written as a literal
- **THEN** the check reports it as a candidate for a human to confirm, and no rule is removed automatically

#### Scenario: The upstream sheets are left alone

- **WHEN** the check runs
- **THEN** it examines only `claude.css`, and reports nothing from the adopted sheets
