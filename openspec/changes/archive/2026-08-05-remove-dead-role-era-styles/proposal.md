## Why

`src/styles/claude.css` still styles a control the renderer does not mount.
Measured: of its 52 classes, one — `.agent-install`, the SetupPanel's "install
missing prerequisites" button, dead since Claude Code and OpenSpec moved inside
the app bundle — has zero references anywhere in `src/` outside the stylesheet
itself, and is not constructed dynamically.

(`.hermes` and `.wake-prompt` were initially suspected too — both are genuinely
dead, but on inspection both live in `deck.css`, not `claude.css`: an adopted
upstream sheet this same change's design requires stay byte-comparable to
upstream. That residue is real but out of scope here; see design.md's Non-Goals.)

Dead CSS is not a runtime fault, which is exactly why it accumulates — nothing
fails, so nothing surfaces it. What it costs is read: the next person opening
`claude.css` to find how a control is styled has to determine, per rule, whether
the control still exists. One of 52 answers "no", and the file does not say
which.

This is the residue of the same drift the spec sync just cleared out of
`openspec/specs/`. The specs no longer claim an install button exists; the
stylesheet still dressed one.

## What Changes

- **The one dead rule block (`.agent-install`, base/`:hover`/`:disabled`) is
  deleted** from `src/styles/claude.css`.
- **`deepspace-skin` gains a requirement** that the stylesheet carries no rules for
  controls the renderer does not mount, and that the rule is checked rather than
  remembered. `deepspace-skin` already owns where Claude-specific styling lives;
  this adds that it may only style what is there.
- **A gate-able check backs it**, so the next removed control takes its CSS with
  it. Without a check this change is a one-time tidy that the next deletion
  undoes — `.agent-install` would otherwise have sat unnoticed the same way
  `.hermes`/`.wake-prompt` did in `deck.css`.

## Capabilities

### Modified Capabilities

- **`deepspace-skin`** — one ADDED requirement: no styling for controls that do not
  exist, enforced by a check rather than by inspection.

## Impact

- `src/styles/claude.css` — one rule block removed (`.agent-install`, ~25 lines).
- One dead-class check, wired so it fails rather than warns, scoped to
  `claude.css` only.
- No component, spec-behavior, or IPC change. Nothing the user can see changes:
  by definition this rule never matched an element.
