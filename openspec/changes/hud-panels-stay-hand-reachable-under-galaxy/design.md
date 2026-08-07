## Context

See proposal.md — Why, for the motivation. The state this design has to work
against:

- The dwell loop (`src/App.tsx`, the universal point-and-hold rAF) resolves an
  `actionable` from `document.elementFromPoint`, then drops it whenever
  `drawingActive || secondBrainActive` unless it is inside `.hud-controls`.
- The open-palm scroll loop (same file) is gated off entirely by the same two
  booleans, and its `SCROLLABLES` selector lists only deck classes
  (`.activity-timeline, .comms-scroll, .work-scroll, .history-grid`) — the HUD's
  own scroll containers are `.hud-work` and `.hud-comms`, so HUD panel scroll by
  palm has in fact never worked, layer or no layer.
- `hud.css` puts `.hud-galaxy` at `z-index: 1` and repeats `z-index: 2` on each
  of the four HUD islands (`.hud-review-stack` in `claude.css`, `.hud-right`,
  `.hud-left`, `.hud-orb-cluster`). Nothing names that set collectively, so the
  gesture layer had no way to ask "is this chrome?" and named one island instead.
- `VaultGalaxy`'s gesture loop hit-tests nodes purely by projecting world
  positions to screen coordinates. It has no notion of the DOM at all, so it
  cannot currently tell that the hand is over a task card.
- Vitest's `unit` project runs `src/**/*.test.ts` under `environment: "node"`;
  jsdom is available but must be opted into per file.

## Goals / Non-Goals

**Goals:**

- One declaration of "HUD chrome" that both the stacking and the gesture rules
  read, so the two cannot drift apart again.
- Gesture ownership decided by where the hand is, not by which layer is mounted.
- The galaxy's pointing drives and the HUD's dwell can never both act on one
  hand position.

**Non-Goals:**

- Changing the stacking itself. The galaxy staying beneath the chrome is the
  deliberate design (`hud.css`'s own comment) and this change ratifies it rather
  than revisiting it.
- Making the drawing panel's *internal* controls (the excalidraw toolbar) dwell-
  clickable. They are the layer's own surface and stay suppressed.
- Any new gesture, or any change to what a pose means.

## Decisions

### D0 — Two modes, both derived from "hand reach follows mouse reach"

The HUD does not need a mode switch, a focus stack, or a per-layer capability
table. It needs one question asked per frame — *could the mouse click this right
now?* — because the answer already encodes everything the gesture layer wants to
know:

| What is open | Mouse can reach | So the hand reaches | Mode |
| --- | --- | --- | --- |
| Galaxy / drawing panel | the chrome above it, and the layer | both, by position | shared |
| A reader (task or note) | only the reader — its backdrop covers the rest | only the reader | focused |

Modality is therefore *declared by the backdrop*, not by a boolean the gesture
code has to be told about. A future layer that paints a full-screen backdrop
becomes exclusive for free; one that does not, coexists for free. That is the
property this change is really buying, and it is why the fix is a positional
rule rather than a longer list of exemptions.

*Alternative — an explicit focus stack* (push on open, pop on close, top of
stack owns the hand): rejected as a second source of truth for something the DOM
already states. The stack and the actual stacking could disagree, which is a
restatement of the bug being fixed.

Concretely this change touches only the *shared* mode. The *focused* mode is
already correct and stays as it is — except that it must now be stated
explicitly in both gesture loops (D6), because the blanket suppression that was
covering the note reader by accident is the thing being deleted.

### D1 — A shared `hud-chrome` class, not a selector list in the gesture code

The four islands get one marker class, and `hud.css` moves the `z-index: 2` that
each of them currently repeats onto `.hud-chrome`. The gesture rule then asks
`closest(".hud-chrome")`. Stacking and reachability become two consequences of
one declaration: an island is chrome, therefore it paints above the layer,
therefore the hand can reach it.

*Alternative — extend the exemption to a hand-written selector list*
(`.hud-controls, .hud-right, .hud-left, .hud-review-stack`): rejected. That is
the exact mechanism that produced this bug — a list maintained in the gesture
loop, separately from the stacking that makes those islands reachable, with no
force keeping them in step. A fifth island added later would be invisible to the
hand again and nothing would fail.

*Alternative — delete the guard and let `elementFromPoint` decide by itself.*
Tempting, because DOM hit-testing already respects z-order: over the galaxy
background it returns the galaxy container, which has no actionable ancestor, so
the dwell dies on its own. But it would also hand every excalidraw toolbar button
to the dwell, which is an unspecified surface, and it would make correct behavior
depend on the galaxy container happening to contain no buttons. Relying on that
coincidence is how this bug was written in the first place.

### D2 — The predicate lives in its own module, structural and testable

`src/lib/hudChrome.ts` exports the class constant, `isHudChrome(el)`, and
`hudChromeAtPoint(x, y)` (the latter being `isHudChrome(elementFromPoint(...))`,
for callers that hold a point rather than an element). It is deliberately not
folded into `gestureContext.ts`: that module answers "which context owns the
hand", this one answers "what is under the hand", and the two are consulted
together but changed for different reasons.

Its test opts into jsdom with a `// @vitest-environment jsdom` docblock and
builds a small nested fragment, so it exercises real `closest` ancestor
traversal rather than a fake that would only restate the implementation. The
`unit` project stays node-default for every other file.

### D3 — Pointing drives yield, camera drives do not

In `VaultGalaxy`'s loop the chrome check is applied where `targetPoint` is
resolved — the one place both pointing drives (`dwell`, `inspect`) pass through —
so a hand over chrome yields a null candidate. That is already the value the loop
treats as "nothing under the finger": `dwellStep` resets on it and the highlight
clears, so the yield needs no new state and cannot leave a charge or a lit
cluster behind.

Orbit and zoom are read before that point and are untouched. They are drives on
the whole view rather than on a thing under the finger, and a camera that stalled
whenever the hand crossed a panel would read as a worse fault than the one being
fixed.

The extra `elementFromPoint` runs only on frames where a pointing pose is
actually live, so it costs nothing in the common orbit/idle case.

### D4 — The scroll loop gains the HUD's own scroll containers

`.hud-work` and `.hud-comms` join `SCROLLABLES`. Without this the spec's "the
task and comms columns stay scrollable by hand" is unsatisfiable — the selector
never named them. This is a pre-existing gap being closed rather than a
regression introduced here, and it is in scope because the requirement being
written depends on it.

### D5 — Two open palms suppress panel scroll outright

The scroll loop reads the *primary* hand's `openPalm`, so during a two-palm
galaxy zoom or reader resize it happily scrolls whatever column a palm passes
over. Once chrome scroll is re-enabled under an active layer this becomes
reachable, so the loop gains a check on the tracked-hand count
(`hands.filter(h => h.openPalm).length >= 2` ⇒ scroll nothing). Suppressing it
everywhere rather than only over chrome keeps one rule: two palms mean scale, and
scale only.

### D6 — Reader gating made explicit in both loops

This is the load-bearing half of D0's *focused* mode, and it is easy to miss
because nothing visibly breaks today. Both loops test `expandedTaskId` alone; the
vault note reader (`openNote`) is covered only accidentally, by the blanket
`secondBrainActive` suppression this change removes — and the note reader exists
*only* while the galaxy is active, so deleting that suppression without this
would make an open note the one focus that leaks. Both loops move to the
reader-open condition the rest of the app already uses (`expandedTaskId != null
|| openNote != null`).

`App.tsx` already computes exactly this expression when it passes `readerOpen`
down to the galaxy and `resolveGestureContext`; the loops read that one value
rather than re-spelling it, so the three consumers cannot drift.

## Risks / Trade-offs

- **The `hud-chrome` class becomes load-bearing and is easy to omit on a new
  island** → the CSS `z-index` hangs off the same class, so an island that
  forgets it is visibly wrong (it drops beneath the layer) rather than silently
  hand-unreachable. The failure is loud instead of quiet, which is the whole
  point of D1.
- **One more `elementFromPoint` per frame in the galaxy loop** → bounded to
  frames with a live pointing pose (D3); the dwell loop in `App.tsx` already
  performs one unconditionally, so this is not a new class of per-frame work.
- **Re-enabling chrome dwell under a layer re-enables accidental clicks on
  chrome** → this is the pre-galaxy behavior being restored, and it is already
  governed by `[data-no-dwell]` on the destructive controls; no control loses
  that protection here.
- **Behavior under the drawing panel changes too, though the report was about the
  galaxy** → deliberate. The panel is bounded (84vw × 84vh) and sits under the
  same chrome, so it has the identical hole; leaving it on the old modal rule
  would mean keeping the broken assumption alive next to its replacement.
