## Why

On the deck the orb frequently shows only its CSS decorations — `.orb-ring` and
`.orb-radar` spinning — with no 3D orb at all. Reported as happening on a fresh start
and after a sleep/wake, and as **never** happening in HUD mode. It has been present
for a long time.

Two independent defects combine to produce it.

**1. A paused surface is not a frozen surface — it is a blank one.**

`ReactorCore.tsx:343` and `HoloBackdrop.tsx:83` both pause with
`frameloop={running ? "always" : "never"}`. In react-three-fiber, `"never"` does not
freeze the last frame — it means *nothing renders unless `advance()` is called by
hand*. A surface that enters `"never"` before it has drawn anything therefore stays
empty, and the canvas is transparent, so the CSS decorations underneath are all that
remains. Those are CSS animations and keep spinning regardless.

This is what makes both reported situations look identical: while Iris is asleep the
orb is in `"never"`, so on wake there is no retained image to come back to.

**2. The focus flag that gates the deck's surfaces can latch `false` at startup.**

`src/App.tsx:119` seeds it with `useState(() => document.hasFocus())`, evaluated
during the first render, while the `focus`/`blur` listeners are attached later in a
`useEffect` (`src/App.tsx:455-468`). The window is created hidden and shown on
`ready-to-show` (`electron/window.mjs:122`), so the first render commonly runs while
the window is not yet focused — `false` — and the `focus` event that follows lands
before the listener exists. Nothing else writes the flag (`setWindowFocused` appears
only at lines 457 and 460), and a window that never loses focus never fires another
one, so it can stay `false` for the entire session.

Switching to HUD and back does not clear it: **HUD and deck are the same
`BrowserWindow`**, so `exitHud()`'s `mainWindow.focus()` (`electron/window.mjs:167-168`)
is a no-op on an already-focused window and emits no DOM event.

HUD mode is immune to both because its orb is gated on `running={sidecarRunning}`
(`src/App.tsx:1658`) with no focus term, which `orb-expressions` deliberately
requires. The deck passes `sidecarRunning && windowFocused` (`src/App.tsx:1775`), and
the backdrop passes the same expression (`src/App.tsx:1733`).

The living spec already forbids the outcome: `orb-expressions` requires the loop to
"resume automatically on wake, **without losing its current expressive state**". A
blank canvas has lost all of it.

## What Changes

- **A paused WebGL surface still shows a correct, current image.** Pausing stops
  *continuous frame advancement*, not rendering. Both the orb and the deck backdrop
  render on demand when their inputs change while paused, so a paused orb looks like
  an orb rather than like nothing.
- **The window-focus flag becomes reliable rather than best-effort.** It is
  resynchronised when its listeners attach, closing the startup race, and the main
  process — which owns the window and is authoritative about its focus — reports
  focus changes rather than the renderer inferring them from DOM events alone.
- No change to *when* a surface pauses. The deck orb still pauses on blur, the HUD
  orb still does not, and both still pause on sleep — those rules are unchanged and
  are what `orb-expressions` specifies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `orb-expressions`: its **Orb render loop pauses when inactive** requirement says the
  loop resumes "without losing its current expressive state" but never says what a
  paused orb looks like, which left "pause" free to be implemented as "never draw".
  Modified to state that a paused orb remains visible and correct.
- `holo-deck-backdrop`: its **Backdrop render loop pauses when inactive** requirement
  carries the identical gap and the identical implementation, so it gets the same
  treatment rather than being left as a known-identical defect.

## Impact

- **Code**: `src/components/ReactorCore.tsx` (pause mechanism), `src/components/HoloBackdrop.tsx`
  (same), `src/App.tsx` (the `windowFocused` seeding and listeners at lines 119 and
  455-468), and the main process's window focus reporting in `electron/window.mjs` +
  its renderer bridge.
- **Tests**: the pause decision becomes pure logic in `src/lib/` with a colocated
  test, per docs/TESTING.md. Whether a canvas visibly contains an orb is not
  assertable in the `node`-environment `src` project, so that half stays a manual
  check — stated plainly rather than papered over.
- **Dependencies**: none.
- **Risk**: low on GPU cost — on-demand rendering draws a frame per input change, not
  continuously, so the `main-thread-budget` intent is preserved. The measurable risk
  is the opposite of the bug: a surface that redraws more often than intended. Task 3
  checks idle GPU behaviour explicitly.
- **Diagnostic confidence**: defect 1 is established from the code and the r3f
  semantics of `"never"`, and alone accounts for the reported symptom. Defect 2 is a
  real race in the same path and explains why the symptom persists rather than
  clearing on the next focus change, but has not been observed directly at runtime —
  the fix does not depend on which of the two is dominant.
