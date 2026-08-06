## Context

See proposal.md — Why. The constraints that actually shape the approach:

- **`makeNodeColor` / `makeLinkColor` are the only levers.** `nodeOpacity` and
  `linkOpacity` are graph-wide constants, not per-element accessors, so alpha
  baked into the colour string is how the existing dimming works. The highlight
  has to ride the same mechanism.
- **Re-assigning a colour accessor is what forces a repaint**, and it is O(n)
  with per-node material dispose/allocate (recorded in `makeNodeColor`'s own
  comment). The existing dwell repaint is debounced by `nearestNodeAt`'s
  dead-band plus `dwellStep`'s pending hold. A mouse hover has no such debounce.
- **`focusNeighborhood(focusIds, links)` already computes one hop**, is pure and
  tested, and returns an empty set for an empty input which callers read as "no
  filtering".
- **The hand's pose vocabulary is already complete.** `TrackedHand.gesture`
  carries MediaPipe's raw category name, and `stabilizeGesture` requires the same
  raw class on 3 consecutive frames above a 0.55 score before publishing it — so
  a new pose arrives pre-debounced with no change to `useHandControl`. `Victory`
  is used nowhere else in the app.
- **`point` is the index fingertip (landmark 8)**, mirrored and remapped. In a
  `Victory` pose the index finger is extended, so targeting works unchanged.
- **`choosePrimary` prefers pointing hands.** A `Victory` hand is not pointing, so
  with two hands in frame the primary may be the *other* hand — reading the pose
  off `HandState.gesture` (the primary's) would silently target the wrong hand.
- `dwellStep` is a pure state machine the caller threads state through, so a
  second instance costs one more ref and no new machinery.

## Goals / Non-Goals

**Goals:**

- One "pointed-at node" concept with two producers, so mouse and hand cannot
  drift apart in what they highlight.
- Reuse: `focusNeighborhood` for the hop set, `dwellStep` for the hold, `nearestNodeAt`
  for targeting, `secondbrain:set-focus` for the toggle. No new IPC, no new state
  owner.
- The repaint cost of a hover sweep bounded to once per frame.

**Non-Goals:**

- No second colour for "charging a selection" versus "charging an open" (see D5).
- No highlight on link hover, no multi-hop highlight, no highlight in the reader.
- No change to dwell duration, the zoom/orbit drives, or the pinch rule.
- No new gesture for *clearing* the focus — the HUD control island's clear
  control is already dwell-reachable and stays the only clear route.

## Decisions

### D1 — Colour only. `linkWidth` is not an option

Making highlighted links thicker is the obvious reach and it is a trap: in
`three-forcegraph`, `var useCylinder = !!linkWidth` — a non-zero width switches
that link from a `Line` primitive to cylinder geometry, and changing the
`linkWidth` accessor **clears `linkDataMapper` entirely**
(`three-forcegraph.mjs:1201`), rebuilding every link object in the graph. Per
hover. `linkColor` changes, by contrast, update materials without rebuilding
objects — the same path the existing focus dimming already takes every time it
repaints.

So the highlight is: incident links jump from the faint base
`rgba(140, 170, 255, 0.35)` to a bright near-opaque warm white, and the pointed-at
node plus its one-hop neighbours are exempted from dimming. Going from 35% to
~95% alpha against an unchanged background is a strong enough pop that width is
not needed.

### D2 — One `pointedAtId`, two producers, hand wins

The hand already has a target: `lastHighlightedRef`, set every frame the dwell
runs. The mouse gets a new `mouseHoverRef`, set by `onNodeHover`. The effective
value is `handTarget ?? mouseHover`.

Rejected: a single ref written by both. With hand control on, the hand writes
`null` on every frame it has no target, which would erase a mouse hover ~60
times a second. `??` makes the precedence explicit instead of a race.

Rejected: separate rendering for the two (e.g. hover = links only, hand target =
node + links). The spec says both draw the same thing, and one code path is how
that stays true.

### D3 — The highlight follows the hand regardless of pose

`nearestNodeAt` is currently called only when `drive === "dwell"`. It becomes
called whenever no camera drive is engaged, so a hand in any pose highlights what
it is near. This is the decision that makes hand inspection possible at all —
otherwise the only node-targeting pose is the one that opens the note 300 ms
later.

Cost: `nearestNodeAt` is O(n) projection per frame, already paid on every dwell
frame today, with a module-level scratch `Vector3` and no allocation. It now runs
on more frames, not more expensively. Suppressed during orbit/zoom because there
the hand point means "camera" — and that also keeps it off the frames where the
camera write is already doing work.

The pose partition is untouched: a highlight acts on nothing, so "a resting hand
drives nothing" remains true as written. The spec delta says this explicitly
rather than leaving a reader to reconcile it.

### D4 — `Victory` selects, via a second `dwellStep` instance

`driveFor` gains `"select"`. Its input type widens from
`Pick<HandState, "pointing" | "fist" | "hands">` to include what it needs to see
the pose per hand. Partition order: two open palms → zoom, `Victory` → select,
`Pointing_Up` → dwell, `Closed_Fist` → orbit — zoom stays first because it is the
two-hand rule and must win over whatever either hand looks like individually.

**The pose is read per hand, not from the primary hand.** `choosePrimary` prefers
pointing hands, so a `Victory` hand competing with any other hand in frame may
lose primacy; the select drive therefore finds the hand showing `Victory` in
`hand.hands` and uses **that hand's** point — exactly the pattern
`twoPalmDistance` already uses for the zoom. Reading `hand.gesture` (the
primary's) would target the wrong hand's position, which is the kind of bug that
looks like "selection is flaky" rather than like a wrong-hand bug.

Two independent `DwellState` refs, one per action. The existing
"must-leave-and-re-acquire" rule in `dwellStep` is what stops a held pose from
toggling on/off repeatedly — and `dwellStep` already resets to
`INITIAL_DWELL_STATE` whenever its candidate is null, so switching pose abandons
the other machine's charge by construction rather than by extra code.

### D5 — No separate "charging a selection" colour

The pointed-at node uses the existing dwell highlight colour for both drives: it
means "this is the node under your hand", which is true either way. A third
colour was considered and rejected — previewing "will be focused" is wrong half
the time, because the gesture is a *toggle* and may be about to deselect. What
tells the user which action is coming is the pose they chose to make; what tells
them which node it will hit is the highlight. Adding a colour that is right 50%
of the time is worse than adding none.

### D6 — Repaints coalesced through one funnel

`repaintFocus()` already exists as the single place the dimming set is derived and
both colour accessors are reassigned. It becomes `repaintHighlight()`, deriving
the *pointed-at* hop set as well, so there is still exactly one place that
computes what is dim and what is bright — the alternative is two derivations that
eventually disagree, which is the defect the existing comment on `repaintFocus`
was written to prevent.

`onNodeHover` does not repaint directly: it stores the id and, if no repaint is
already scheduled, schedules one on `requestAnimationFrame`. One repaint per frame
maximum instead of one per node crossed. The hand path needs no coalescing — it
already repaints at most once per frame, and only on an actual target change.

## Risks / Trade-offs

- **A hand resting near a node makes clusters light up unbidden** → bounded by
  the same `DWELL_THRESHOLD_PX` the dwell uses, so it only fires when the hand is
  genuinely on a node, and it changes nothing when it does. Called out in the
  spec as feedback rather than left as a surprise.
- **`Victory` recognition quality is unmeasured on this model.** MediaPipe's canned
  classifier is reliable for it in general, but this repo has never used the class
  → the manual pass checks it explicitly, including that it is not confused with
  `Pointing_Up` (one finger vs two) which would make selecting open notes instead.
  The 3-frame stability window plus the 300 ms hold means a single misclassified
  frame cannot fire anything.
- **Repaint cost on a large vault**: a hover repaint is O(n) material work. At one
  per frame worst case this is the same order as the existing dwell repaint, but
  on a very large vault a fast sweep will be felt → if the manual pass shows it,
  the follow-on is a per-node material cache rather than more throttling, since
  throttling would make the highlight feel laggy instead of cheap.
- **Two dwell machines is one more piece of per-frame state** → both are the same
  pure function with the same reset-on-null-candidate behaviour, and the unit
  tests cover the interference case the spec names.
