## Context

See proposal.md — Why, for the two defects and the evidence.

Three facts constrain the approach:

- **react-three-fiber 9** offers three `frameloop` modes. `"always"` runs continuously,
  `"never"` renders only when the app calls `advance()` by hand, and `"demand"` renders
  once per `invalidate()` — which r3f already issues automatically when React props
  driving the scene change. The current code uses `"never"`, which is why a paused
  surface is blank rather than still.
- **The pause conditions themselves are specified and correct.** `orb-expressions`
  deliberately gives the deck orb a focus term and the HUD orb none. Nothing here
  should touch *when* a surface pauses.
- **Main already pushes window-level events to the renderer.** `emitToRenderer` +
  a `preload.cjs` subscription is an established pattern (`hud:mode`,
  `iris:wake`/`iris:sleep`), so reporting focus needs no new mechanism, only a new
  channel on the existing one.

## Goals / Non-Goals

**Goals:**

- A paused surface shows a correct still image, whatever order it reached the paused
  state in — including having never drawn.
- The deck's focus signal cannot latch stale.
- Idle GPU cost stays where `main-thread-budget` expects it.

**Non-Goals:**

- Changing which surfaces pause, or on what conditions. The HUD/deck asymmetry stays
  exactly as `orb-expressions` specifies it.
- Making the orb's *animation* run while paused. Paused still means no continuous
  advancement; the orb does not breathe, rotate, or pulse while paused.
- Any visual redesign of the orb.

## Decisions

**`frameloop="demand"` instead of `"never"`.**

`"demand"` is the mode that means what the spec means by "paused": no continuous
advancement, but the surface renders when what it depicts changes. It also fixes the
never-drew case for free — mounting is itself a render trigger, so the surface has an
image from the start.

*Alternative — keep `"never"` and call `advance()` manually on each relevant change.*
Rejected: it reimplements `"demand"` by hand, and every future prop that affects the
scene becomes a new place to remember to call `advance()`. The bug being fixed is
exactly a missed render; a design whose correctness depends on not forgetting one is
the wrong shape.

*Alternative — never pause; let the loop run.* Rejected outright: it violates
`orb-expressions`, `holo-deck-backdrop`, and `main-thread-budget` simultaneously, and
trades a visual bug for a permanent battery cost.

**Watch the paused-mode animation boundary.**

The orb's per-frame work lives in `useFrame`, which does not run under `"demand"`
except on the frames `invalidate()` schedules. Values that animate continuously
(rotation, breathing, ripples) will therefore advance only when a redraw happens.
That is the intended meaning of paused. What must be checked is the opposite failure:
`useFrame` lerps `energyRef` toward the target state, so a single redraw after a
state change lands only one lerp step and would show a part-way colour. The
implementation must ensure a state change results in the orb settling at the new
state rather than freezing mid-transition — either by driving enough redraws to
settle, or by snapping to the target when paused.

**Focus becomes a main-process fact, with the renderer's own listeners kept.**

Main owns the window and knows definitively when it is focused; the renderer's DOM
events are a derived, race-prone view of the same thing. Main emits on the existing
`emitToRenderer` channel; the renderer keeps its `focus`/`blur` listeners as a
same-process fast path, and additionally resynchronises from `document.hasFocus()`
when they attach, which closes the startup race on its own.

*Alternative — only resynchronise on attach, no IPC.* That does fix the observed
startup race, and is a third of the work. Rejected as the sole fix because it leaves
the signal derived from events the renderer can still miss (the window is created
hidden, shown later, and toggles between HUD and deck within one `BrowserWindow`),
and because the same flag gates two surfaces. Given a spec now requires this signal to
be reliable, the authoritative source should be the one that owns the window.

*Alternative — poll `document.hasFocus()`.* Rejected: a poll on the renderer's main
thread is exactly the kind of steady-state work `main-thread-budget` exists to keep
out.

**The pause decision moves to `src/lib/`.**

Per docs/TESTING.md, pure logic belongs in `src/lib/*.ts` with a colocated test; the
`src` vitest project runs in `node` with no DOM. `orbRunning` is currently an inline
expression at `src/App.tsx:1775`, duplicated in spirit at `1733` and contrasted with
`1658` — three sites that together encode the HUD/deck asymmetry the spec cares about,
with nothing testing that they agree. A single exported resolver takes surface
(`deck-orb` | `hud-orb` | `backdrop`), awake, and focused, and returns whether that
surface advances frames. The spec's asymmetry then has one implementation and one test
table.

## Risks / Trade-offs

- **`"demand"` redraws more often than expected, eroding the idle saving** →
  Task group 3 measures idle GPU/CPU before and after rather than assuming. If a prop
  churns per-frame, it will show up there.
- **A paused orb settles mid-transition and shows a wrong colour** → Called out as a
  decision above; it is the specific regression this mode change can introduce, and
  it has its own verification task.
- **Adding an IPC channel widens the main↔renderer surface** → It reuses the existing
  `emitToRenderer` + `preload.cjs` subscription pattern rather than introducing a new
  mechanism, and carries a boolean.
- **The visual half cannot be tested automatically** → The logic half gets a real
  test; the "is there an orb on screen" half is manual, and the tasks say so instead
  of implying coverage that does not exist.
- **Defect 2 is inferred, not observed** → The fix for defect 1 alone should clear the
  reported symptom. If the manual checks show it cleared before the focus work lands,
  that is worth recording rather than assuming both were load-bearing.
