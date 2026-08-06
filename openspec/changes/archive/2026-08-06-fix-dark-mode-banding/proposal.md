## Why

Large dark areas of the deck show contour lines — wide flat plateaus separated by
hard edges — most visibly in the dim states.

This is not a rendering artifact. It is 8-bit quantization, and the palette is the
cause. `src/styles/tokens.css:9-10` sets `--bg-0: #030509` and `--bg-1: #05070d`,
i.e. sRGB code values 3–13. Two things go wrong that low:

- There is no resolution left. A soft gradient spread across ~900 px has only a
  couple of code levels to cross, so it cannot render as a ramp — it renders as huge
  flat plateaus with 1-level edges between them.
- Below the sRGB toe, luminance is roughly proportional to code value, so **one** code
  step at value 7 is a ~14% relative brightness jump. At value 21 the same step is
  ~5%, under the threshold where a long straight edge reads as a line.

The palette is then handed to window-scale ramps that have no chance of surviving it:

- `src/styles/deck.css:17` — `linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%)`,
  a full window-height gradient between two colours ~2 code values apart.
- `src/styles/base.css:86` — `.hud-vignette`, `box-shadow: inset 0 0 220px rgba(0,0,0,0.72)`,
  a 220 px soft ramp into black around the entire window.

Upstream diagnosed and fixed the same defect in `ASHR12/iris@a4a81d4`, and their note
explains why it surfaces in the dim states specifically: the aurora and glow layers
are dimmed there, which removes the only structure that was masking the near-flat
base ramp underneath.

Doing this now also matters for a reason beyond the pixels: `src/styles/tokens.css`,
`base.css` and `fx.css` are still **byte-identical** to the upstream revision they
were adopted from, so upstream's values can be taken exactly rather than re-derived.
That is not true of `deck.css`, `overlays.css` and `index.css`, which have already
accumulated Iris-specific rules.

## What Changes

- Lift the base palette off near-black, using upstream's exact values so a future
  port stays cheap: `--bg-0` `#030509` → `#0b111c`, `--bg-1` `#05070d` → `#0e1522`,
  `--bg-2` `#0a0f1a` → `#151d2c`.
- Replace the window-height deck gradient with a flat fill. A gradient crossing more
  pixels than it has code levels is not a gradient.
- Remove `.hud-vignette` and its mount — a window-scale soft ramp into pure black,
  which is the same defect in a different form and cannot be rescued by any palette.
- Record the constraint in the spec so it cannot silently regress: a stated floor for
  the darkest surface, and no window-scale ramp between two near-black stops.

Explicitly **not** in scope: the rest of upstream's "Luminous Instrument" redesign
(token scale retuning, removal of nested 1px borders, the flattened `deck.css` and
`overlays.css`). This change fixes the banding and keeps the current look.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deepspace-skin`: its **Deep Space stylesheets adopted verbatim** requirement says
  the adopted sheets are "copied from the upstream iris repo", with a scenario
  asserting each is "unmodified ... so future upstream ports diff cleanly". That has
  been false for a while — `deck.css`, `overlays.css` and `index.css` already carry
  Iris rules (`.supplement-input`, `.confirm-card`, `.note-reader-*`,
  `.t-btn.ambient-live`, `.deck-body.chat-only`) that the same capability says belong
  in `claude.css`. This change modifies the requirement to state the real
  relationship — adopted as a starting point, now Iris-owned — and replaces the
  unenforceable "unmodified" scenario with the durable constraint that actually
  matters: the banding floor.

## Impact

- **Code**: `src/styles/tokens.css` (3 palette values), `src/styles/deck.css:17`
  (gradient → flat fill), `src/styles/base.css` (drop `.hud-vignette`),
  `src/App.tsx:1732` (drop its mount). `src/styles/holo.css` and `deck.css:21`
  reference `.hud-vignette` in `:not()` selector lists and must be updated with it.
- **Verification is visual.** No unit test can assert "no contour lines"; the gates
  will not catch a regression here, which is why the constraint goes in the spec as a
  reviewable rule rather than as a test.
- **Known limitation**: three window-scale radial washes survive this change —
  `.hud-nebula`, `.hud-glow`, and the `radial-gradient(85% 70% ...)` that sits in the
  same `background` shorthand as the deck gradient being flattened
  (`src/styles/deck.css:16`). All three are accent-tinted rather than near-black
  ramps, and they gain code levels once the base beneath them is lifted; upstream's
  analysis is that the base ramp was the culprit while these layers were masking it,
  so this is expected to be sufficient. They are the next candidates if banding
  survives, and get their own change rather than being folded in here.
- **Dependencies**: none.
- **Risk**: low but visible. Every dark surface in the app gets perceptibly lighter.
  This is the intended effect, not a side effect.
