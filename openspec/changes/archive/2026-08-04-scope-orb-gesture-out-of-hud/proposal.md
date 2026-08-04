## Why

In Glass HUD mode the orb is a small floating puck over the user's desktop, not the
stage — the content the user came for is the chat transcript, the work stream, and
whatever fullscreen layer they opened. Yet the fist-rotate / pinch-scale orb binding
still engages there: `App.tsx`'s orb gesture loop gates on the reader, the drawing
panel and the galaxy, but never on `uiMode`. So a fist made anywhere over the HUD
spins the orb instead of doing nothing, and the pinch distance the user is holding
for some other purpose silently rescales it. The gesture surface belongs to the
content in HUD, and today the orb takes it.

## What Changes

- The orb's fist-rotate / pinch-scale binding no longer engages while the Glass HUD
  overlay is active. It is unchanged on the deck, where the orb is the centre of the
  stage and rotating it is the point.
- No other binding moves. Dwell-click, open-palm hold-to-scroll, the reader's
  fist-close / two-palm-resize, and the galaxy's own camera drives keep their current
  contexts — all three deck loops are already suppressed by the fullscreen layers, and
  the note reader only renders while the galaxy is active, so the orb loop is the sole
  binding that leaks into HUD.
- The gesture action indicator keeps reporting the binding that is actually live, so
  in HUD it no longer names an orb binding that cannot fire.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `two-hand-gestures`: the requirement *"Fist rotates and pinch scales the orb"*
  currently excludes only the reader overlay and the fullscreen HUD layers. It gains
  a UI-mode condition — the binding engages in deck mode only. This also settles the
  language already used in `second-brain-gesture-nav`, which calls it *"the deck's
  fist-rotates-the-orb binding"* while `two-hand-gestures` did not actually scope it
  to the deck.

## Impact

- `src/App.tsx` — the orb gesture rAF loop's `engaged` predicate and its effect
  dependency list; the `handAction` indicator's deck branch.
- `src/lib/gestureContext.ts` — the resolver has no notion of `uiMode`; design.md
  decides whether it grows one or the loop reads `uiMode` directly.
- Tests: a unit-level assertion that the binding is inert in HUD and live on the deck.
- No change to `ReactorCore`'s prop surface — it keeps accepting `rotationRef` /
  `scaleRef` and applying whatever it is handed; only the driver's scope narrows.
