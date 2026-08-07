## Why

With the second-brain galaxy open in the Glass HUD, the hand can no longer reach
anything but the orb's control island: a pointing hand held over a task card in
the work stream never fires, and an open palm never scrolls the task or comms
column. The panels are still right there — visible, and still clickable with a
mouse — so the user is looking at a control they can see, can click, and cannot
touch. The galaxy has quietly taken the whole hand.

The suppression that causes it was written for a layer that covers the screen.
The galaxy does not: `hud.css` deliberately keeps it at `z-index: 1`, *beneath*
the tasks, comms, review and orb islands at `z-index: 2`, and says so in a
comment — the layer is a backdrop the HUD chrome sits on top of. The gesture
guard never learned that. It suppresses by *which layer is active* rather than
by *what the hand is actually over*, and exempts exactly one island by name
(`.hud-controls`), so every other piece of HUD chrome went dark to the hand
while remaining live to the mouse. The same guard covers the drawing panel,
which is likewise bounded (84vw × 84vh) and likewise sits under the chrome, so
it has the same hole.

**The model this change settles on.** The HUD has two gesture modes, and which
one is in force is not a new setting — it is already visible on screen:

- **Shared, decided by position.** Layers that coexist — the HUD chrome over the
  galaxy or the drawing panel — each keep their own bindings, and the hand
  belongs to whichever one it is over. This is the mode the bug broke.
- **Focused, held exclusively.** Opening a task or a vault note gives that one
  thing every gesture until it is closed, at which point the hand returns to the
  shared mode. This is the mode that already works, and it stays.

The two are told apart by the backdrop, so nothing new has to be declared to
know which applies: a reader paints a full-screen backdrop over everything, so
the mouse cannot reach the chrome behind it — and neither should the hand. The
galaxy and the drawing panel paint no such thing, so the mouse reaches the
chrome above them — and so must the hand. One rule produces both modes: **hand
reach follows mouse reach.**

## What Changes

- The universal point-and-dwell click stops being suppressed by *layer active*
  and starts being decided by *what the hand is over*: HUD chrome — the tasks
  column, the comms column, the review/question stack, and the orb island with
  its controls — stays dwell-clickable while the galaxy or the drawing panel is
  open, because that chrome is painted above the layer and is mouse-clickable
  there. Everything inside the layer itself stays suppressed exactly as today.
- The single-open-palm panel scroll comes back over that same HUD chrome while a
  layer is active, so the task and comms columns can be scrolled by hand again.
  It stays suppressed everywhere else, and stays suppressed entirely while two
  open palms are up, so a two-palm galaxy zoom can never also scroll a column one
  of the palms happens to pass over.
- The galaxy's own pointing drives (node dwell, the two-finger inspect reveal)
  yield over HUD chrome: a finger pointing at a task card must not also charge a
  node dwell on whatever node happens to project behind that card. The camera
  drives (fist orbit, two-palm zoom) do **not** yield — they are whole-surface
  drives, and stalling an orbit because the hand drifted across a panel would be
  a worse bug than the one being fixed.
- HUD chrome gets one shared marker class rather than a hand-maintained list of
  selectors, so the set of "islands above the layer" is declared once and the
  gesture rule and the stacking cannot drift apart the way they just did.
- Hover-to-focus for voice deixis ("this one", "show its steps") comes back with
  the dwell, since it rides the same loop.

- An open reader — the task run-reader or the vault note reader — keeps taking
  **every** gesture until it is closed, and this becomes a stated rule rather
  than a side effect of the blanket suppression being removed. Both gesture
  loops currently test only the task reader; the note reader was covered by
  accident, by the very suppression this change deletes, so both move to the
  reader-open condition the rest of the app already uses.

Not in scope: no new gesture, no change to what any pose means, no change to the
galaxy's own bindings over the galaxy, and no change to how a reader behaves
while it is open. A hand over the layer, or over an open reader, behaves exactly
as it does today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `two-hand-gestures`: the universal point-and-hold click and the panel
  hold-to-scroll are no longer suppressed wholesale by an active HUD layer —
  suppression becomes positional, with HUD chrome carved out as a surface the
  layer does not own.
- `second-brain-gesture-nav`: the context precedence gains its missing companion
  rule — the galaxy owns the hand only where the galaxy is actually the top
  layer, so its pointing drives yield over HUD chrome while its camera drives do
  not.

## Impact

- `src/App.tsx` — the dwell rAF loop (the `.hud-controls`-only exemption) and the
  open-palm scroll loop.
- `src/lib/gestureContext.ts` + `gestureContext.test.ts` — the new shared,
  testable predicate for "HUD chrome owns this point", alongside the existing
  context resolver.
- `src/components/VaultGalaxy.tsx` — the gesture loop's target resolution.
- `src/components/HudShell.tsx` + `src/styles/hud.css` — the shared chrome marker
  class on the four islands, with the z-order comment pointed at it.
- No main-process, IPC, or pipeline surface is touched.
