## ADDED Requirements

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
