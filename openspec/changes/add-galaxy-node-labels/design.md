## Context

See proposal.md — Why. What matters for the approach:

- The galaxy is a vanilla `3d-force-graph` instance driven imperatively from
  `VaultGalaxy.tsx`. It owns its own render loop; the component has no React
  render pass per frame and deliberately keeps per-frame work out of React state
  (the gesture debug readout writes `textContent` directly for exactly this
  reason).
- **The renderer owns node positions.** The main process serves a position-free
  graph; `x/y/z` live on the node objects in `positionsRef`, mutated in place by
  the force simulation. So the data a label needs is already in the renderer and
  already keyed by node id — no IPC, no new state.
- There is already one rAF loop in the component (the gesture drive), gated on
  `[handControl, running]`, plus a documented rule that it must schedule
  **nothing** while gestures are off or the HUD is asleep: `backgroundThrottling`
  is disabled, so a spinning loop is never throttled for us.
- Existing per-frame discipline to match: `galaxy-nav.ts` reuses a module-level
  scratch `Vector3` rather than allocating per node per frame, and the
  `main-thread-budget` capability holds the orb's render loop to no per-frame
  heap allocation. Labels should not be the thing that breaks that habit.
- Focus declutter already computes the one-hop neighbourhood into
  `relevantIdsRef` (null while nothing is focused) and repaints node/link colours
  from it via `repaintFocus()`.
- `VaultGalaxy.tsx` is 799 lines against a 250–450 line convention. New
  mechanism must not land inside it.

## Goals / Non-Goals

**Goals:**

- Titles legible from navigation alone, with cost bounded independently of vault
  size.
- The label mechanism testable where it can be: the *selection policy* is pure
  and unit-tested; only the WebGL/canvas mechanics are untested.
- Zero new dependencies, one `three` copy, no IPC or main-process surface.

**Non-Goals:**

- No title search / camera fly-to (proposal.md, Out of scope).
- **Not routed through `webgl-quality-mode`.** That capability governs WebGL
  *surfaces* and their effects; titles are the view's readability affordance, not
  an effect. They cost ≤ budget small textures and no post-processing, and the
  light path is specified as "a usable look, not a degraded one" — the same
  reason the galaxy's backdrop and starfield are unconditional on both paths.
  Making titles conditional would make the light path the path where you cannot
  read your own vault.
- No change to link labels, node sizing, node colour policy, or the tooltip.
- No occlusion/overlap resolution between titles (see Risks).

## Decisions

### D1 — Titles are canvas-texture sprites, hand-rolled

Alternatives considered:

- **`three-spritetext`** — the standard companion package for 3d-force-graph
  labels. Rejected: it is a second package carrying its own `three` requirement
  into a repo that runs `scripts/check-three-dedupe.mjs` precisely to guarantee
  one copy, to buy ~40 lines of canvas drawing. The galaxy already hand-rolls
  its starfield out of `three` primitives for the same kind of reason.
- **`CSS2DRenderer` via the `extraRenderers` config option** — real DOM text,
  crisp at any distance, styleable from `hud.css`. Rejected on two counts: it
  puts note titles back into an HTML surface, which is the exact shape the
  "Untrusted note content is contained" requirement exists to avoid, and it
  costs one DOM node per label with layout/compositing on every camera move.
- **Chosen: `THREE.Sprite` with a `CanvasTexture`.** Text drawn with
  `fillText` is inert by construction — there is no parser to attack. It lives
  inside the same scene as the nodes, so it inherits the pause behaviour, the
  backdrop, and the camera for free.

Texture details that are load-bearing: `minFilter = LinearFilter` and
`generateMipmaps = false` (a non-power-of-two canvas with default mipmapping
either warns or samples wrong), `depthWrite = false` with `depthTest = true` so a
title is occluded by geometry in front of it but never punches a hole in it, and
the sprite positioned at the node's position plus a small `+Y` offset so it sits
above the node instead of z-fighting with the sphere.

### D2 — A fixed sprite pool, not one label per node

`nodeThreeObject` (+ `nodeThreeObjectExtend`) is the library's own hook and it is
the wrong tool here: it is invoked for **every** node when the graph is digested,
so a 3000-note vault means 3000 canvases and 3000 textures allocated up front —
for at most a couple of dozen ever visible — and every `graphData()` call
re-digests. That directly contradicts the spec's bounded-cost requirement.

Instead: a pool of `LABEL_BUDGET` sprites in one `THREE.Group` added to
`fg.scene()`, created once at mount and disposed at unmount. Each frame the pool
is handed the current selection (≤ budget) and:

- assigns selection[i] to sprite[i], repainting the canvas **only when the id at
  that slot changed**;
- sets sprite[i] position from the node's live `x/y/z`;
- hides the tail slots (`visible = false`) when the selection is shorter.

Consequences worth stating: the pool is untouched by graph updates (it holds no
node references beyond the current frame's assignment, so a removed note simply
stops being selected), and the number of textures is a constant of the code, not
a function of the vault.

Fixed canvas per slot (no per-title resize, so no texture churn): draw the text
into the top-left of a fixed 512×96 canvas, then crop the texture to the measured
region with `texture.repeat`/`texture.offset` and set the sprite's scale to the
measured aspect. Short and long titles therefore render at the *same* text
height, which naive "centre it in a fixed quad" scaling gets wrong.

Title elision (spec: "elided rather than drawn as a banner") is measured, not
character-counted: draw progressively shorter prefixes + `…` until
`measureText` fits the canvas width.

### D3 — Split: pure selection in `src/lib/galaxy-labels.ts`, mechanics in `src/lib/galaxy-label-sprites.ts`

`selectLabels(nodes, cameraPos, { maxDistance, budget, eligible })` → the ≤budget
nearest eligible nodes within `maxDistance`, nearest first. Pure, `three`-only
(like `galaxy-nav.ts`), unit-tested: threshold boundary, budget truncation,
nearest-first ordering, ghost inclusion, `eligible = null` meaning "no filtering"
(the same convention `focusNeighborhood`'s empty set already uses), and nodes
with no position yet skipped.

The sprite pool goes in its own module and is **not** unit-tested, for a reason
worth writing down rather than leaving as an omission: it needs a 2D canvas
context, and `src/**/*.test.ts` runs in vitest's `node` environment
(`vitest.config.mjs`), where `document` does not exist. Same reason
`addStarfield` has no test. Its correctness is covered by the manual pass in
tasks.md.

Distance compares use squared distances (`distanceToSquared`) — no `sqrt` per
node per selection pass, and the ordering is identical.

### D4 — A second rAF loop, gated on `running` only

The existing gesture loop is gated on `[handControl, running]`; labels must work
with hand control off (mouse-only navigation is a supported path — Cmd-click
focus exists for exactly that). Folding labels into that loop would tie them to
gestures; adding a `handControl`-independent branch to it would make one loop
serve two lifetimes.

So: a separate `useEffect` on `[running]` owning its own rAF. It honours the same
rule as the gesture loop — schedules nothing while the HUD is asleep, which is
also what the spec's "titles stop while the galaxy is asleep" scenario requires,
and it comes out of `running` for free rather than needing its own signal.

Rejected alternatives: `onEngineTick` (stops firing when the simulation cools
down — after which the camera still moves, so labels would freeze at the last
settled camera), and a controls `change` listener (the gesture drive writes the
camera through `cameraPosition()` rather than through the controls, so
change-driven updates would miss every gesture-driven move).

Deliberately **not** suspended while the note reader is open, unlike the gesture
loop. The gesture loop must suspend because it would otherwise drive the camera
under a reader; the label loop only writes sprite transforms, and keeping it
running means no stale-position pop when the reader closes.

### D5 — Selection throttled, positions every frame

Selection is O(nodes) per pass plus an ordering step; positions must be exact
every frame or titles visibly lag their nodes while the layout settles.

So the loop does two things at two rates: re-select every `SELECT_INTERVAL_MS`
(100ms — a reveal is a threshold crossing during navigation, and 10Hz is
imperceptible for that), and re-position the ≤budget assigned slots every frame.
The pure selector allocates its result array; at 10Hz that is negligible, and the
per-frame path (the one the `main-thread-budget` habit is about) allocates
nothing.

### D6 — Titles grow as you approach (`sizeAttenuation: true`)

The alternative — constant screen-space size — keeps distant titles crisp but
flattens the very cue this design is built on. With attenuation, a title becomes
more prominent as the camera closes on it, reinforcing "you are near this",
and the distance cull removes titles before they shrink into noise. Constant-size
text would also make the near/far distinction invisible, so a title at the cull
boundary would look exactly as important as the node under the camera.

### D7 — Focus eligibility reads the *same* set the dimming reads

The label loop passes `relevantIdsRef.current` straight through as `eligible`.
Not a second computation of the neighbourhood: `repaintFocus()` is already the
single place that set is derived, and two derivations would eventually disagree
about which nodes are dimmed versus named — the class of bug the existing
`repaintFocus()` comment already calls out.

### D8 — Ghost nodes are named

A ghost is a real thing on the map (an unresolved `[[wikilink]]`), and its name is
the only way to know *which* link is dangling. Its title is drawn in the same
faded grey the node uses, so "named" does not read as "openable" — the existing
colour keeps carrying that. Cheap, and it makes the ghost node feature actually
diagnosable.

### D9 — Tuning constants, and how they were picked

All in `VaultGalaxy.tsx` beside `ZOOM_MIN_RADIUS`/`ZOOM_MAX_RADIUS`, since that
is where the galaxy's other tuning lives:

- `LABEL_MAX_DISTANCE = 180` — the force layout's default link distance is ~30
  units, so ~180 is a few link-hops: the neighbourhood you are flying through,
  not the whole graph. Note this composes with `zoomToFit`-on-first-settle to
  give a useful property for free: a small vault frames close enough that its
  titles are visible immediately, while a large vault frames far out and opens
  clean, with no vault-size branch in the code.
- `LABEL_BUDGET = 24` — readable at a glance; also the texture count ceiling.
- `LABEL_WORLD_HEIGHT = 5`, `LABEL_Y_OFFSET = 6` — text a bit above a
  default-sized node (radius ~4).

These are starting points to be confirmed in the manual pass, not derived
constants; tasks.md carries the check.

### D10 — Distance is measured from the orbit target, not the camera's eye position

The manual pass surfaced a real defect in the first cut: `selectLabels` was
called with `fg.camera().position` (the literal eye position). With
mouse-only navigation, `TrackballControls`' scroll-wheel zoom does not move
the camera toward whatever is on screen — it dollies the eye toward
`controls.target` (the fixed orbit center, set by `zoomToFit` to the vault's
centroid and otherwise unchanged by rotate/zoom). For a node **directly along
the eye→target axis**, distance to the eye shrinks to nearly zero as the user
zooms in; for a node at the **same structural distance from the target but
off that axis** ("beside" the one that lit up), eye-to-node distance is
`sqrt(radius² + d²)` — larger by construction, and it does not shrink to `d`
until `radius` is nearly zero. The visible symptom was exactly this: only
whatever sat on the camera's exact line of sight (reading as "the center of
the screen") ever crossed the threshold, and rotating or zooming further
never brought an off-axis neighbor into range, because the eye position's
distance to it has a floor of roughly `d` regardless of how much closer the
eye gets to the target.

Fix: `selectLabels`'s distance origin is `controls.target` (the point the
camera orbits around — read via the same `TrackballControlsLike` shape the
gesture loop already uses to restore `.enabled`/`.target`), not
`camera.position`. This is rotation-invariant: a node's distance from the
*target* does not depend on which angle the camera happens to be viewing it
from, so nodes structurally equidistant from wherever the user has
zoomed/oriented reveal together, matching what "zoomed in on a region" means
to the person driving the camera rather than to the raw eye coordinate. The
existing requirements this must keep true: viewed from far out (`target` far
from every node) nothing is revealed, and a vault's far side (never panned
toward) stays unlabeled — both still hold, because they only depend on
`target`'s distance to a node, never on the camera's orbit angle around it.

`selectLabels` itself needed no change — it already took a plain `{x,y,z}`
point with no assumption about what produced it. Only the call site in
`VaultGalaxy.tsx`'s label loop changed, and the parameter name in
`galaxy-labels.ts` was widened from `cameraPos` to `originPos` so the module
does not silently imply "camera eye" to the next reader.

## Risks / Trade-offs

- **Titles overlap in a dense cluster.** No de-overlap pass — the budget and the
  distance cull are the only mitigations, and nearest-first at least means the
  ones that survive are the ones nearest the camera. Obsidian's graph has the
  same behaviour. Deferred rather than hidden: a de-overlap or fade-by-density
  pass is a follow-on if the manual pass shows it is intolerable.
- **Bloom bleeds on bright text** (high-fidelity path only; `UnrealBloomPass`
  threshold is 0.15) → keep the label colour a soft blue-white rather than pure
  white, and verify on the high-fidelity path specifically, not just the default
  light one.
- **A second rAF loop is a second thing that can spin.** → Gated on `running`
  exactly like the render it serves, and it does strictly less work than the
  gesture loop it sits beside (no projection, no hit-testing, no repaint).
- **Wrong constants read as a broken feature** (titles always on, or never
  visible) → they are named constants in one place, with the reasoning above
  recorded, and the manual pass explicitly checks both ends of the range on a
  real vault.
- **A crash in the label loop.** The gesture loop wraps its body in try/catch
  because a rAF throw escapes React's error boundary and would otherwise repeat
  every frame → the label loop follows the same shape, but it hides its own
  labels and stops instead of force-closing the galaxy: labels failing is not a
  reason to tear down the view they annotate.
