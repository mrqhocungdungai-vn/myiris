## Context

See proposal.md — Why, and "What this change tried, and withdrew" for the two
first-pass decisions manual testing reversed.

The constraints that actually shape the approach:

- **`makeNodeColor` / `makeLinkColor` are the only levers.** `nodeOpacity` and
  `linkOpacity` are graph-wide constants, not per-element accessors, so alpha
  baked into the colour string is how the existing dimming works. The highlight
  has to ride the same mechanism.
- **And that graph-wide constant is a ceiling, not just a default.**
  `three-forcegraph.mjs:1278` computes `opacity = state.linkOpacity *
  colorAlpha(color)`. With `linkOpacity(0.5)` no link can exceed 50% opacity
  however bright its colour.
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

## Goals / Non-Goals

**Goals:**

- One "pointed-at node" concept with several producers, so mouse and hand cannot
  drift apart in what they highlight.
- A lit cluster that is obvious at a glance, with the graph at rest unchanged.
- Reuse: `focusNeighborhood` for the hop set, `nearestNodeAt` for targeting.
- The repaint cost of a hover sweep bounded to once per frame.

**Non-Goals:**

- **No gesture that selects.** Withdrawn after testing (proposal.md); the focus
  keeps the mouse as its only producer and `second-brain-focus` is untouched.
- **No highlight from a hand that drives nothing.** Also withdrawn after testing.
- No highlight on link hover, no multi-hop highlight, no highlight in the reader.
- No change to dwell duration, the zoom/orbit drives, or the pinch rule.
- No *second* declutter mechanism. The spotlight dims the rest of the graph
  (D7), but through the same treatment and the same one-hop set the focus
  declutter already uses — not a parallel one with its own look.

## Decisions

### D1 — Colour only. `linkWidth` is not an option

Making highlighted links thicker is the obvious reach and it is a trap: in
`three-forcegraph`, `var useCylinder = !!linkWidth` — a non-zero width switches
that link from a `Line` primitive to cylinder geometry, and changing the
`linkWidth` accessor **clears `linkDataMapper` entirely**
(`three-forcegraph.mjs:1201`), rebuilding every link object in the graph. Per
hover. `linkColor` changes, by contrast, update materials without rebuilding
objects — the same path the existing focus dimming already takes.

### D1b — Lift the graph-wide opacity ceiling, keep the resting look identical

Because the effective opacity is `linkOpacity × colorAlpha`, the first pass's
highlight at 95% alpha rendered at 47.5% — brighter than the 17.5% base, but
capped below half opacity, which is why it did not read as lit.

The fix moves the dimness from the global constant into the base colour, leaving
every product unchanged except the highlight's own ceiling:

| | before (`linkOpacity 0.5`) | after (`linkOpacity 1`) |
| --- | --- | --- |
| base link | `0.35` alpha → **0.175** | `0.175` alpha → **0.175** |
| focus-dimmed link | `0.05` alpha → **0.025** | `0.025` alpha → **0.025** |
| lit link | `0.95` alpha → **0.475** | `0.98` alpha → **0.98** |

Rejected: raising `linkOpacity` and leaving the base alpha alone — that brightens
every link in the graph, which is a change to the galaxy's whole look rather than
to the highlight.

`0.98` rather than `1.0` deliberately: `three-forcegraph` switches a link's
material to `transparent: false` / `depthWrite: true` at exactly `opacity >= 1`,
so a lit link at 1.0 would flip rendering mode mid-hover. Staying a hair under
keeps every link on the same transparent path.

### D2 — One `pointedAtId`, several producers, hand wins

The hand's target is computed in the gesture loop; the mouse's comes from a new
`onNodeHover`. The effective value is `handTarget ?? mouseHover`.

Rejected: a single ref written by both. With hand control on, the hand writes
`null` on every frame it has no target, which would erase a mouse hover ~60
times a second. `??` makes the precedence explicit instead of a race.

Rejected: separate rendering per producer (e.g. hover = links only, inspect pose
= node + links). The spec says every producer draws the same thing, and one code
path is how that stays true.

### D3 — The highlight comes only from a pose that means to point

`nearestNodeAt` is called when the drive is `dwell` or `inspect`, and not
otherwise. The first pass called it under any non-camera drive, on the reasoning
that a highlight is feedback rather than an action and so sits outside the pose
partition. That reasoning holds in the abstract and failed in use: a hand resting
or drifting near the graph lit one cluster after another, which reads as the view
twitching at the user's hand rather than answering a question.

A charging `Pointing_Up` dwell is included as a producer rather than excluded:
that dwell is already deliberate and already gives its target visible feedback,
so lighting the cluster it is about to open costs nothing and needs no second
concept in the code.

Cost: `nearestNodeAt` is O(n) projection per frame with a module-level scratch
`Vector3` and no allocation, and it now runs on the same frames it always did
(dwell) plus the inspect frames. Suppressed during orbit/zoom, where the hand
point means "camera".

### D4 — `Victory` inspects; it does not select

`driveFor` gains `"inspect"`. Partition order: two open palms → zoom, `Victory` →
inspect, `Pointing_Up` → dwell, `Closed_Fist` → orbit. Zoom stays first because
it is the two-hand rule and must win over whatever either hand looks like
individually.

**The pose is read per hand, not from the primary hand.** `choosePrimary` prefers
pointing hands, so a `Victory` hand competing with any other hand in frame may
lose primacy; the inspect drive therefore finds the hand showing `Victory` in
`hand.hands` and uses **that hand's** point — exactly the pattern
`twoPalmDistance` already uses for the zoom. Reading `hand.gesture` (the
primary's) would target the wrong hand's position, which is the kind of bug that
looks like "the highlight is flaky" rather than like a wrong-hand bug.

No `dwellStep` instance is needed for it. A reveal commits to nothing, so there
is nothing to debounce into a decision and nothing to fire — the pose either has
a target this frame or it does not. That deletes the second dwell state the first
pass carried, along with the interference question between the two machines.

### D5 — No separate colour for the inspect pose

The pointed-at node uses the existing dwell highlight colour whichever producer
found it: it means "this is the node under your pointer", which is true in every
case. A distinct colour per producer would encode which input device is in use,
which is not something the user needs told.

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

### D7 — The reveal is a spotlight: one lit set, pointing takes precedence

Brightening the cluster's links turned out not to be enough — in a dense galaxy
a brighter cluster still sits inside a mesh of everything else, so the thing
being asked about is not the only thing visible. Everything outside the
pointed-at cluster is therefore dimmed while it is pointed at, using the same
`DIM_NODE_ALPHA`/`DIM_LINK_ALPHA` the focus declutter uses.

This **simplifies** the colour accessors rather than complicating them. The
previous shape passed two sets — `relevantIds` (what the focus keeps bright) and
`pointedIds` (what pointing additionally exempts from dimming) — and each accessor
had to reconcile them. They collapse into one `litIds`, "the nodes exempt from
dimming", with the caller deciding what it is:

    litIds = pointedAt ? oneHop(pointedAt) : (focus.size ? oneHop(focus) : null)

Precedence rather than union, deliberately. A union would leave two bright
islands — the focus's and the pointer's — which answers neither question
clearly; the view should answer one at a time. And because `repaintHighlight`
recomputes this from whatever is current on every call, releasing the pointer
restores the focus's dimming by construction rather than by restoring a saved
copy.

Two consequences worth stating:

- `relevantIdsRef` is gone. It existed so the gesture loop could pass the focus
  set into a direct `makeNodeColor` call; with every producer funnelling through
  `repaintHighlight`, the set is a local and there is nothing to keep in sync.
- A **focused** node is still returned before the dimming is considered, so a
  selection stays visible while the spotlight is elsewhere. Losing sight of a
  selection because the user pointed at something else is a worse trade than the
  spotlight is worth.

Reusing the focus's dim constants rather than a gentler transient pair is a
judgement call: one visual language beats two, and the contrast is the point.
The hover case is the one to watch — a pointer sweep re-dims the whole graph on
each new node — so the manual pass checks it, and softening means changing one
constant.

## Risks / Trade-offs

- **`Victory` recognition quality is unmeasured on this model.** MediaPipe's canned
  classifier is reliable for it in general, but this repo has never used the class
  → the manual pass checks it explicitly, including that it is not confused with
  `Pointing_Up` (one finger vs two) which would open a note instead of revealing
  it. The 3-frame stability window means a single misclassified frame cannot flip
  the drive; a misclassification that *sustains* would open a note, which is the
  one destructive-ish outcome in this change and is why the check is explicit.
- **Rebalancing the link alphas touches the galaxy's resting look if the
  arithmetic is wrong** → the table in D1b states every before/after product, and
  the manual pass compares the graph at rest against the previous build.
- **The spotlight fires on every hover, and it is a large visual change** — the
  whole graph dims and undims as the pointer moves between nodes. Bounded to one
  repaint per frame by the rAF coalescing, but the *magnitude* is what to judge
  in the manual pass; if a sweep reads as flashing, a gentler transient dim is one
  constant away.
- **Repaint cost on a large vault**: a hover repaint is O(n) material work. At one
  per frame worst case this is the same order as the existing dwell repaint, but
  on a very large vault a fast sweep will be felt → if the manual pass shows it,
  the follow-on is a per-node material cache rather than more throttling, since
  throttling would make the highlight feel laggy instead of cheap.
