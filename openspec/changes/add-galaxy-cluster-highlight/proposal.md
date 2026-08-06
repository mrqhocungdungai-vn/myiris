## Why

**There is no hover highlight at all.** No `onNodeHover` handler exists anywhere
in the galaxy; hovering a node produces only the built-in tooltip. What does make
a cluster stand out is the **focus**: Cmd/Ctrl-click a node
(`VaultGalaxy.tsx:402`) and everything outside its one-hop neighbourhood is dimmed
to near-invisible (`DIM_NODE_ALPHA = 0.08`, `DIM_LINK_ALPHA = 0.05`). That is a
deliberate, sticky *selection* — it changes the shared focus the voice layer and
Claude's runs read — and it is the only thing in the view that answers "what is
this note connected to". Answering that question should not require making a
selection.

**And by hand there is no way to ask the question at all.** The pose partition
(`driveFor`, `galaxy-nav.ts:200`) is: two open palms zoom, `Pointing_Up` dwells,
`Closed_Fist` orbits, everything else drives nothing. `Pointing_Up` at a node
opens it after 300 ms — so the one hand pose that targets a node consumes the
target by opening it. There is nothing between "not looking at it" and "reading
it".

## What Changes

- **A pointed-at node lights up its links.** The links incident to the node
  being pointed at are drawn prominently instead of the faint base blue, and the
  node's one-hop neighbours are drawn at full strength — even when the focus
  declutter has dimmed them, so pointing at a dimmed node reveals what it
  connects to. Transient, and it changes nothing: no selection is made, no
  camera moves, no note opens, and nothing accumulates.
- **The lit links have to actually read as lit.** `linkOpacity` is a graph-wide
  constant that three-forcegraph *multiplies* into each link's own colour alpha
  (`three-forcegraph.mjs:1278`), and the galaxy sets it to `0.5` — so a link
  colour at 95% alpha renders at 47.5% and a highlight cannot exceed half
  opacity no matter what colour it is given. The ceiling is lifted by raising
  `linkOpacity` to 1 and folding the existing dimness into the base colour's own
  alpha, which leaves resting links pixel-identical while letting a lit link
  reach full intensity.
- **Two producers, one meaning.** The mouse hovering a node and the hand
  pointing at one are the same state, rendered the same way. The mouse gets the
  power for the first time; the hand gets a pose for it.
- **`Victory` (two fingers) held near a node reveals its cluster** — the
  hands-free equivalent of a hover, with no hold delay, nothing fired on
  release, and nothing left behind.
- Dwell stays 300 ms and opening stays as fast as it is. The two-open-palms zoom,
  the fist orbit, and the "a pinch means nothing in the galaxy" rule are all
  untouched.

## What this change tried, and withdrew

A first pass made `Victory` **toggle the focus** — a hands-free equivalent of the
Cmd/Ctrl-click selection. `second-brain-gesture-nav` had a recorded decision
against any selection gesture, in two halves: one conditional ("adding a
selection gesture is worth doing when the focus's main consumer is in play",
which `open-note-session` had since satisfied) and one unconditional — *"a
gesture that quietly toggles a selection the user cannot easily see is a way to
change their vault by accident"*. The first pass acted on the first half and
overlooked the second.

Manual testing produced exactly the failure the second half describes. Because
each node dwelled on toggles, moving the hand across the graph with the pose held
selects node after node; because the focus is bounded, older selections drop out
as newer ones arrive, so the visible effect is nodes lighting up one after
another as the hand passes. And because the selection is sticky, releasing the
pose leaves it behind — the view does not return to normal, and the user is left
with a focus they did not intend and did not ask for.

So the selection gesture is withdrawn and the recorded decision stands, now with
field evidence rather than only a prediction behind it. `Victory` keeps the pose
but means *reveal*, not *select*: it is momentary, it accumulates nothing, and
releasing it restores the view. Selecting remains the mouse's job.

A first pass also let the highlight follow a hand in **any** pose, on the
reasoning that a highlight is feedback rather than a drive and so sits outside
the pose partition. In use that reads as the view twitching at a hand rather than
answering a question: a hand resting or drifting near the graph lights one
cluster, then another. The highlight is now produced only by an input that means
to point — the mouse, the inspect pose, or a charging dwell.

## Capabilities

### New Capabilities

<!-- none: two existing capabilities change -->

### Modified Capabilities

- `second-brain-galaxy-view`: gains the pointed-at cluster highlight — what is
  drawn, that it must be unmistakably prominent without brightening the graph at
  rest, that it is transient and accumulates nothing, and that it renders
  identically whichever input produced it. The view owns this because it is what
  the view draws, for every producer.
- `second-brain-gesture-nav`: the pose partition gains `Victory` → inspect, and
  the rule that a hand which drives nothing also shows nothing.

`second-brain-focus` is deliberately **not** modified: with the selection gesture
withdrawn, the mouse remains the focus's only producer, exactly as that
capability already states.

## Impact

- `src/lib/galaxy-nav.ts` — `driveFor` gains an `"inspect"` drive for `Victory`,
  plus a helper exposing the hand making the pose (the caller needs *that*
  hand's point, since `choosePrimary` prefers pointing hands). `focusNeighborhood`
  is reused unchanged for the one-hop highlight set — the same function the
  dimming already uses, so the two can never disagree about what "one hop" means.
- `src/lib/galaxy-nav.test.ts` — the partition's new case, and that no other pose
  gained a meaning.
- `src/components/VaultGalaxy.tsx` — an `onNodeHover` handler, the pointed-at set
  threaded through `makeNodeColor`/`makeLinkColor`, one repaint funnel shared by
  every producer, and the `linkOpacity` ceiling fix with the base/dim alphas
  rebalanced to keep the resting look identical.
- `docs/GESTURES.md` — the galaxy pose table gains `Victory`, and its table still
  documents the pinch bindings that `two-palm-galaxy-zoom` removed; the rows this
  change touches are corrected rather than left contradicting `driveFor`.
- No IPC, main-process, dependency, or CSS change: the highlight is a colour
  accessor, and nothing about the focus's ownership moves.
