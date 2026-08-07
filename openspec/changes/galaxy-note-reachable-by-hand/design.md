## Context

See `proposal.md` — Why. The constraints that shape the approach:

- `VaultGalaxy.tsx` is 1087 lines against the repo's 250–450 line convention, so
  nothing here may grow it further than it must. The galaxy's existing pattern is
  already the right one: pure policy in `src/lib/galaxy-nav.ts`, with the component
  as a thin rAF driver over it. This change follows it.
- `3d-force-graph`'s camera API is `cameraPosition(position, lookAt, transitionMs)`.
  Every call **cancels any tween in flight** (`povPosTween.end()` /
  `povTgtTween.end()` in `three-render-objects`), and the gesture loop calls it every
  frame with `transitionMs: 0`. Anything that wants to animate the camera therefore
  cannot simply hand the library a duration and walk away.
- `setLookAt` writes `controls.target` only while the controls are `.enabled`, and
  replaces the `Vector3` outright each time. The gesture loop disables the controls
  while a drive is engaged and copies the centre back in on release. That copy is the
  line that currently destroys a mouse-framed view.
- `HUD_CHROME_CLASS` (`src/lib/hudChrome.ts`) is the single declaration of "an island
  painted above an open layer": it carries both the `z-index` and the dwell
  reachability. Any new island must carry it or it is invisible to the hand.
- The vault graph arrives position-free with `{ id, title, tags, ghost, malformed }`
  per node. There is no modification time, so nothing here can order by recency.

## Goals / Non-Goals

**Goals:**

- One anchor, read by every camera path — hand and mouse alike — so the two can never
  disagree about what the camera turns around.
- All new decision logic pure and unit-testable without a WebGL instance, matching
  how the gesture layer is already built.
- The rail reaches the hand through the existing universal dwell, adding no gesture
  machinery and no galaxy-specific pointing rule.

**Non-Goals:**

- No change to the force layout, the graph wire shape, or the main process.
- No new dependency; no second `three` instance.
- No attempt to make the free camera sufficient for finding a note. The anchor makes
  free-look *coherent*; the rail is what makes finding *easy*. Judged separately.

## Decisions

### D1 — The anchor is a three-variant union in its own pure module

`{ kind: "centroid" } | { kind: "node", id: string } | { kind: "point", position: Vector3 }`,
resolved to a `Vector3` against the live position map at the moment of use, in a new
`src/lib/galaxy-anchor.ts`.

Storing an id rather than a copied position for the node case is the same reasoning
`second-brain-focus` already applies to selections: a position captured at anchor
time is wrong the instant the force layout nudges the node, and a node that is
deleted by a live vault refresh must degrade to "no anchor" rather than to a
phantom point in space. Resolution failure falls back to the centroid.

The third variant is required by the spec, not decorative. `TrackballControls`
implements panning by mutating `this.target` in place
(`three/examples/jsm/controls/TrackballControls.js`, `_panCamera`), so a mouse pan
produces an arbitrary point that is neither the centroid nor any node. Without a
variant that can hold it, "a pan SHALL set the anchor rather than be overwritten by
it" is unrepresentable — and the release path would keep writing a stale anchor over
the user's pan, which is the exact defect this change exists to remove.

*Alternative considered:* keep a single `Vector3` and just write different values
into it. Rejected — it makes "is a node anchored?" unanswerable, which the visual
feedback, the zoom-out release, and the tests all need to ask.

### D2 — Anchor picking reuses `nearestNodeAt`, queried at screen centre

> **Superseded in part by D14.** The reuse of `nearestNodeAt` and the incumbent
> dead-band below both stand and are load-bearing. The *query point* does not: the
> manual pass showed that a sight fixed at screen centre cannot be aimed, so it is
> now read off the hands. Read D14 for what replaced it and why.

`nearestNodeAt` already does exactly the required work: projection, the
front-of-camera NDC guard, a pixel threshold, and an incumbent dead-band. Picking
the anchor is the same query with the screen-centre point substituted for the hand
point.

The incumbent parameter is not incidental here — passing the current anchor as
incumbent gives it a dead-band head start, which is what stops the anchor flapping
between two neighbours while the user orbits through a dense region. That is the
same defect the parameter was originally added for, in a new place.

*Alternative considered:* a raycast through screen centre. Rejected — it answers a
different question (what does the centre ray *hit*), so a node beside the centre
would be ignored while a node the ray happens to graze wins. The spec deliberately
says "near the centre", and `second-brain-galaxy-view`'s title requirement already
records why off-axis notes must be treated as equally eligible.

### D3 — The eased aim is our own lerp, and it eases the *aim only*

The obvious implementation — `cameraPosition(currentPos, newAnchor, 180)` — cannot
work: the gesture loop's next frame calls `cameraPosition(..., 0)`, which ends the
tween immediately (`povPosTween.end()` / `povTgtTween.end()` run unconditionally,
before the duration branch, in `three-render-objects`). So the ease lives in our state
instead, and the loop keeps writing with `transitionMs: 0` as it does today.

**But the eased value must not feed the position.** `writeCameraFromSpherical`
computes `position = anchor + offset(spherical)`. Feeding it a lerping anchor while
the spherical was seeded against the *target* anchor writes the camera to
`oldAnchor + (camPos − targetAnchor)` on the first frame — a lurch of exactly
`oldAnchor − targetAnchor` that then decays. That would violate "re-anchoring SHALL
NOT move the camera" while satisfying the easing requirement, or vice versa; the two
spec scenarios are only jointly satisfiable if the two roles are separated:

- **orbit origin** = the resolved *target* anchor, fixed at engage. The spherical is
  seeded from `camera.position − targetAnchor`, so frame one reproduces the camera's
  exact position and nothing moves.
- **look-at point** = the *displayed* anchor, lerping from the previous anchor to the
  target over ~180 ms.

So the camera holds still and the aim glides onto the node. Both scenarios hold, and
they hold for the same reason rather than being traded off.

This also means the ease works identically on the mouse path, where there is no
per-frame write at all.

### D4 — Re-anchoring is position-preserving by construction

On engage, `new THREE.Spherical().setFromVector3(camera.position.clone().sub(targetAnchor))`
— which is what line 877 already does, with the target anchor substituted for the
centroid. The camera's position is not written at all, so "engaging never teleports"
is a property of the code shape rather than a rule to be remembered. The radius that
falls out is the distance to the anchored node, which is exactly what the zoom law
then wants; `ZOOM_MIN_RADIUS` drops from 15 to ~8 because the floor is now a distance
to a single node rather than to the middle of the ball.

### D4b — Every anchor mutation must also write `controls.target`

`restoreControlsIfNeeded` is currently the only writer of `controls.target`, and it
early-returns while the controls are enabled (`VaultGalaxy.tsx:721`). Controls are
disabled only during a hand drive — so the anchor mutations that happen with no drive
engaged (opening a note, the wheel-over-a-node case) would set the anchor while the
mouse kept orbiting the old point, and the design's "one anchor read by every camera
path" would be false in exactly the paths the mouse uses.

Any anchor mutation therefore syncs the target: when the controls are enabled, write
it directly; when they are disabled, leave it to the existing restore-on-release path,
which is already the only safe moment (`setLookAt` writes `.target` only while enabled
and replaces the `Vector3` outright).

The converse also matters: the release path must not write a *stale* anchor back over
a user's pan. Release copies the anchor only when this engage actually changed it —
which is what keeps "a grab over empty space keeps the current anchor" from silently
undoing a pan.

### D5 — Release-to-centroid is measured against the graph's own extent, and must survive the dolly clamp

The zoom-out release threshold is a multiple of the graph's bounding radius, not an
absolute world distance, so it behaves the same for a twelve-note vault and a
five-hundred-note one. The bounding radius is computed in the same pass as the
centroid, under the same dirty flag.

That interacts with `ZOOM_MAX_RADIUS` (2500): a vault whose bounding radius exceeds
about half that can never dolly out far enough to reach a 2× threshold, so the release
would be unreachable exactly on the large vaults that need it most. The release
therefore also fires when the radius is *at* the clamp — reaching the furthest the
camera can go counts as having backed out — so the rule cannot be defeated by vault
size.

### D6 — The lowered-hand release is a predicate, not a new drive state

`isHandLowered(point, viewportHeight)` — a pure function returning true below the
bottom third — is consulted in `driveFor`'s caller and collapses the drive to `null`.
Routing it through the existing "drive went null" path means every consequence
already specified for a released drive (reference cleared, controls restored, target
highlight cleared) applies with no new code, and the existing tests for that path
cover it.

Hand points are in window pixels, so the comparison is against the window, not the
container rect.

### D7 — The rail's data is derived, memoised per graph, and reuses `focusNeighborhood`

One-hop neighbours come from `focusNeighborhood([centreId], links)` — the same
function the declutter and the highlight use, which is what makes the spec's "cannot
disagree about one hop" true rather than merely intended. It returns the queried id
inside the set, so the rail filters the centre note out of its own list.

Entry-point ordering is node degree, counted once per graph update in the same pass.
Degree needs only the links already on the wire; recency would need a modification
time added to `VaultGraphNode`, which is a main-process and wire-shape change and is
excluded in the proposal for that reason.

### D7b — Entry points are per connected region, and coverage outranks the budget

*Added after the manual pass, which found the hole: with the rail showing only the
current note's neighbours once it had a centre, a cloud of notes that links to
nothing in the main body was unreachable by stepping at all, and there was no route
back to the entry points short of closing the galaxy.*

Ordering the whole vault by degree and taking the top N does not fix it: the top N
by degree can all sit inside the largest cloud, which is exactly the cloud the user
is already in. What the rail needs is **coverage** — a foothold in every region —
and coverage is a different question from connectedness.

So entry points are computed in two passes over the graph's connected components:

1. **Guarantee** — every component contributes its most connected note. This is
   what makes "no region SHALL be without one" true by construction rather than by
   the ordering happening to work out.
2. **Fill** — whatever budget remains goes to the next most connected notes
   overall, so a vault that is one big cloud still offers a useful spread of hubs
   rather than a single entry.

The budget is therefore a floor on the *fill*, never a cap on the *guarantee*: a
vault with more regions than the budget yields more entries than the budget, and the
island scrolls. A cap that dropped a region would silently reintroduce the very
defect this decision exists to remove — and the spec says so, so it cannot be
tuned away later by someone reading only the constant.

A component of one note with no links contributes nothing: it has no neighbours to
step to, so an entry for it would lead to a rail with nothing on it. Reaching such a
note is what the deferred search box is for.

The entry points are shown **alongside** the neighbours rather than instead of them,
so the "where can I go from here" and "where else is there" questions are answered
at once. They do not change as the user steps, which is what makes them a fixed
frame of reference rather than a second thing to keep track of.

### D14 — The sight follows the hands, not the screen

*Added after the manual pass, which rejected the premise the anchor was built on.*

D2 resolved the anchor from the node nearest the CENTRE of the screen. That
premise is wrong, and the report that killed it was exact: with a centre-pinned
sight, "pulling the zoom open just zooms at random". It does, and not because the
zoom is mistuned. A fixed sight can only be aimed by flying the camera until the
target is in the middle — which is the hardest part of navigating the galaxy,
demanded *before* the easy part is allowed to begin. The user has to solve the
problem in order to be allowed to use the tool for solving it.

Reading the sight off the hands inverts that: put your hands over the region, act,
done — one motion, no camera work first. `sightPoint` (in `galaxy-nav.ts`, with the
rest of the hand policy) returns the midpoint between two open palms, else the
primary hand's own point, else the centre of the view when no hand is in frame.
`pickAnchorAtCenter` accordingly generalises to `pickAnchorAt(..., point, ...)`,
with `rectCentre` left as the named fallback rather than the rule.

**The two drives resolve it on different schedules, and the asymmetry has a
reason rather than being a compromise.**

- The **orbit's input is the hand's travel**. A sight read from a moving hand
  during an orbit would re-aim on every frame of the very motion that is meant to
  be turning the camera. So the orbit resolves at engage and holds.
- The **zoom's input is the distance between the hands**, and their midpoint is
  invariant under spreading them. The sight is therefore free to go on aiming for
  the whole drive — which is what the user actually asked for: moving both hands
  onto a different region mid-zoom re-aims the dolly onto it.

A mid-drive anchor change has to hold the camera still on exactly D3's terms, so
`reseedAroundAnchor` re-derives the spherical from the live camera against the new
anchor and re-seeds the zoom's reference from the same frame's hand distance —
the hands have not moved, so the radius must not either. The zoom-out release
(D5) was already doing this by hand; both now share the one function.

*Risk, for the manual pass:* re-seeding the zoom reference discards the spread
accumulated so far, so a sight flapping between two nodes would stall the dolly.
`nearestNodeAt`'s incumbent dead-band is what should prevent it — the same
mechanism, in the same place, that D2 relied on for the same reason.

> **Confirmed by the manual pass, and fixed by D17 below.** The dead-band alone
> was not enough — see D17 for why and what changed.

*What this does not fix.* The report also concluded that hand gestures are the
wrong instrument for FINDING a note at all — that hands suit zoom, open, close and
scroll, and finding wants something else. That judgement is about the step rail
and is not settled here; it is recorded in the Open Questions below rather than
acted on, because removing shipped, specified behaviour is not a call this
decision gets to make on its own.

### D15 — The pivot IS the mark, with no "keep what it was" case

*Added after the second manual pass: "wherever the sight is, that is always shown
and what it turns around — not the note that is open."*

D2 and D14 both kept the current anchor when no node was near the sight. That
looked like a safe fallback and is not: an anchor that survives a grab aimed
somewhere else is a pivot the user is not pointing at and cannot see. Most
visibly it is the note they last opened, which then follows them around
invisibly, so the mark sits in one place and the view turns around another. Every
grab over empty space made the two disagree.

So the fallback is gone. `pickPivotAt` returns a node when one is near enough —
snapping to a note is what makes "dolly all the way in and arrive" work — and
otherwise the **point under the sight**, found by crossing the sight ray with the
plane through the current pivot perpendicular to the view (`sightPivotPoint`).
That gives a pivot right where the mark is, at the distance the camera was already
working at. One sentence, no exception: you turn around the mark.

Opening a note still anchors on it, which is what leaves the camera in that note's
neighbourhood when the reader closes — and is the whole point of the voice-search
route. It simply cannot outlive the next grab any more.

**Where the point pivot is NOT re-derived, and why.** The zoom's live re-aim
(D14) stays node-only. The camera eases its aim onto the pivot, which recentres
it on screen; re-deriving a point pivot from the still-off-centre sight each frame
would then walk it sideways, chasing its own feedback. A node has no such loop —
it is a fixed thing in the world — so re-targeting between notes mid-zoom is
stable. Over empty space the engage-time pivot stands for the drive.

*Trade-off, for the manual pass:* because the aim eases onto the pivot, a grab
with the sight off to one side swings the view by that offset. That is the literal
reading of "turn around the mark", and the mark being visible is what should make
it predictable rather than surprising — but it is a real change in feel and worth
judging directly.

**The mark is a plus, not a ring.** A ring says "somewhere in here", and its own
centre is the one part of it not drawn. Two crossing hairlines name a point, which
is what a pivot is.

### D16 — Finding by name is typed here, and voice is a separate change

Stepping is only as good as the reachability of a starting point, and the manual
pass' conclusion was that link topology cannot supply one: a user looking for a
note is thinking about its subject, not about what it links to. `railSearch`
matches note titles — case- and diacritic-folded, since a vault's titles are prose
and demanding exact accents would make it useless in Vietnamese — and its results
are steppable on exactly the terms every other rail entry is. It needs no IPC: the
renderer already holds the whole graph.

**Voice input for the search is deliberately not built here.** There is no
second-brain tool on the Gemini surface at all today, so it means a new tool
declaration, a main-process handler, and a route from a voice answer into this
component. That is the `verb-tool-surface` / `voice-decision-relay` territory
`CLAUDE.md` routes through its own change, and folding it into a change already in
apply is exactly what that rule exists to prevent. The typed search is the half
that can be built without touching the voice surface, and it is what the mouse and
keyboard path needs regardless.

Consequence, stated rather than left to be discovered: **finding by name is not
hands-free yet.** The universal dwell fires `.click()` on buttons and links, and
clicking a text field does not type into it. The hand can step the *results*; it
cannot produce the query.

### D8 — The flight is a real tween, and a user grab cancels it

A rail step happens with no drive engaged, so the controls are enabled and
`cameraPosition(pos, anchorPos, 600)` both animates and writes `controls.target` —
the one place a library transition is safe, because nothing is writing per-frame.

The destination keeps the camera's current viewing direction and only changes
distance, so a step reads as travelling to a note rather than as being spun to a new
orientation as well.

If the user engages a camera drive while a flight is in progress, the drive wins: its
first frame's `cameraPosition(..., 0)` cancels the tween as a side effect, and the
spherical it seeds from the live camera means it picks up mid-flight without a jump.
This needs no explicit interlock — but it does need a test, because it works by
coincidence of the library's cancel-on-write behaviour rather than by intent.

`zoomToFit`'s node filter cannot serve this. `fitToBbox` hardcodes its aim to the
world origin and sizes the distance from the origin to the filtered bbox, so
filtering down to one distant node makes it zoom *out*. Verified in
`three-render-objects/dist/three-render-objects.mjs`.

### D17 — The zoom's re-aim shares the ring's throttle, not its own

*Added after the manual pass on the sight (8.7): "moving the + causes lag and
is very hard to use" — holding the sight still zoomed cleanly; moving it while
zooming did not.*

D14 said the zoom's re-aim runs every frame, on the grounds that its input —
the distance between the hands — is stable under a moving midpoint in a way
the orbit's input is not. That reasoning is still right about *when* to
re-aim. It said nothing about *how often to re-decide what to re-aim at*, and
the implementation conflated the two: `pickAnchorAt` was called fresh every
frame from inside the zoom branch, independent of and unthrottled against the
candidate ring's own evaluation of the identical question — which the ring
answers on `SELECT_INTERVAL_MS` (100 ms), per D10, specifically so the search
does not run at frame rate.

So while zooming, the pivot could change up to six times more often than the
ring ever showed changing, and D5's mechanism — `reseedAroundAnchor` — fires on
every one of those changes, discarding the hand-spread reference each time.
Sweeping the sight across a moderately dense region during a live pinch
therefore rebased the dolly's zero point far more often than anything on
screen predicted, which reads as exactly what was reported: static aim zooms
fine, moving aim stalls.

The dead-band in `nearestNodeAt` (D2) was the mechanism this design expected to
prevent exactly this, and it does what it was built for — it stops flapping
between two nodes that are both within `thresholdPx` of a nearly-still sight.
It cannot stop a genuinely moving sight from crossing into a new node's
threshold every few frames, because at that point the new node really is the
nearer one; the dead-band was never the right tool for a different problem
that happened to look similar.

**Fix: one evaluation, one cadence, two consumers.** The throttled pick
`useGalaxyCameraDrive.ts` already computes for the ring is now stored whole
(`pivotPickRef`, not just the id the ring reads) and is what the zoom's
per-frame branch reads too — no second `pickAnchorAt` call. The re-aim still
runs every frame in the sense that it still *applies* the current pick every
frame (so a pick that lands mid-zoom is not delayed by an extra beat), but
what it can pick from only changes on the ring's own 100 ms tick. The visible
candidate and the zoom's actual pivot are therefore reading the same value by
construction, which is also what makes the ring an honest preview of the zoom
again — before this fix the two could silently disagree.

*Alternative considered:* widen the dead-band further, or add a minimum dwell
time before a pivot change commits. Rejected — both add a second timing
knob to tune against the ring's existing one instead of removing the
duplicate evaluation that caused the disagreement, and neither explains why
the ring and the zoom were allowed to see different answers to the same
question in the first place.

### D18 — Empty-space pivots follow the sight during a zoom too, throttled and dead-banded

*Added after D17 was tested and the report continued: moving the sight during
a zoom still would not reach the intended area, "anywhere" — not only where
two neighbouring nodes could flap.*

D17 fixed the wrong half of the problem. The unthrottled reaim was real and
worth fixing, but the dominant cause was upstream of it: the live re-aim during
a zoom only ever considered nodes (`pickAnchorAt`). D15 already recorded why —
"over empty space the engage-time pivot stands for the drive" — and that
sentence is the bug once read as a behaviour rather than a design note. It
means that for any target that is not itself a note (the common case — dots
are small, most of the canvas is not one), the pivot is whatever was under the
sight at the moment the two-palm pose was first recognised, for the entire
rest of the drive. Moving the hands afterward changes what the reticle shows
without changing what the camera dollies toward, unless the new position
happens to land on a different node. A user aiming at a gap between notes, or
translating both hands to reposition before the pinch has finished registering,
gets a camera that never follows — which reads exactly as "anywhere, doesn't
zoom smoothly", because for most of the canvas it is not zooming toward
anywhere the hand indicated at all.

**Fix: `pickPivotAt` (which already has the point fallback D15 built) replaces
`pickAnchorAt` in the same throttled evaluation D17 introduced.** This is not
the per-frame point re-derivation D14 explicitly ruled out — that concern was
about recomputing every frame while the camera's own easing perturbs the very
ray the computation depends on, a closed loop with no natural damping. Once
the recomputation is throttled to the ring's 100 ms tick, each step is a
discrete correction against whatever the camera has settled toward since the
last one, structurally the same shape as a node's discrete id-keyed switch —
not a continuous loop chasing itself.

**A point pivot still needs a dead-band a node never did.** A node's identity
is discrete — the same id is the same value, so "did the pivot change" is a
question `anchorsEqual` answers exactly, and `nearestNodeAt`'s incumbent logic
already damps switching between near-tied candidates. `sightPivotPoint`
returns a fresh float triple on every call with no notion of "the same point as
last time" — so with no additional guard, ordinary hand-tracking jitter (±10–
20 px, per the proposal's own numbers) would read as *some* change on nearly
every 100 ms tick, and `reseedAroundAnchor` would reset the zoom's accumulated
spread that often — the throttled sibling of the exact defect D17 fixed at
frame rate. `POINT_PIVOT_DEAD_BAND_PX` (24, `VaultGalaxy.tsx`) requires the
sight to have moved past it, in screen pixels, since the last *committed*
point pivot before a new one is accepted; the last-committed-sight memory is
cleared on leaving a node, so the first point pivot reached after one always
commits rather than being measured against a stale position from before it.

*Why 24, not `DEAD_BAND_PX` (14, the node dead-band) or `ANCHOR_THRESHOLD_PX`
(130, how far a node search reaches):* the node dead-band exists to break
near-ties between two candidates already in range of a threshold search, a
different question from "has the sight moved enough to bother." The anchor
threshold is a search radius, not a movement gate. Between the two, closer to
the node dead-band's scale but a little wider, on the reasoning that a search
radius has to tolerate an intentionally-still hand's jitter fully, while a
movement gate only has to be wider than that jitter, not immune to a
threshold search's own edge noise. Not measured against tracked hand data;
revisit from the next manual pass if it reads as either sticky or twitchy.

*Alternative considered:* keep the point pivot frozen at engage, as D15 left
it, and treat this as intended scope — the rail exists for exactly the
"reach a note that is not near where I'm already looking" case. Rejected as
the sole answer: the report was about zooming toward a REGION, not a note by
name, which the rail cannot help with regardless of how well it works.

### D19 — The zoom's noise problem was in the radius law, not only the pivot; the pivot's remaining bug was the retarget gate, not the feature

*Added after D18 shipped and the report continued, more pointedly: "not
effective — after all these improvement rounds, zooming in/out is now VERY
HARD." Investigated with a multi-agent workflow (four independent lines of
inquiry, a synthesis, and an adversarial stress-test of the synthesis) rather
than a fifth solo guess, given three prior rounds had each failed.*

**Root cause, independently confirmed by three of the four investigations:**
`zoomRadius` (`galaxy-nav.ts`) is a memoryless function of the instantaneous
two-palm distance — every frame it maps `curDist` straight to an absolute
radius via `refRadius * refDist / curDist`, with no per-frame step limit.
Compare `orbitStep`: it only nudges a *persisted* angle by a small fixed
increment (`delta * 0.006`) each frame, so a single noisy frame barely moves
it and that nudge isn't replayed. Zoom's law has no such accumulator, so
whatever tracking noise survives the hand points' own light smoothing
(`SMOOTHING_ALPHA = 0.5`, tuned for low lag, not noise rejection) reaches the
radius with full gain, every frame — and worse, with reciprocal gain that
grows unboundedly as `curDist` approaches the 80px floor. This defect
**predates D17/D18 entirely** and plausibly accounts for the baseline "hard to
use, not smooth anywhere" complaint by itself.

D17/D18 didn't create that defect, but they made it bite far more often: each
turned what used to be a single engage-time reference capture into a
repeating mid-zoom event (`reseedAroundAnchor`, up to ~10/s while the sight
moved), and every one of those events re-pins the reference from that exact
frame's raw, unfiltered `curDist`. A code-tracing pass additionally confirmed
a specific bug in D18's gate: `pickPivotAt` resolving to *any* node within the
generous 130px `ANCHOR_THRESHOLD_PX` — even a brief graze, unrelated to
deliberate movement — unconditionally cleared the point dead-band's memory,
forcing the very next tick to commit regardless of how little the sight had
actually moved. Three rounds of increasingly careful throttle/dead-band
tuning were fixing the frequency and precision of an event whose *payload*
(the radius law) was the real defect — which is why the trend was a
regression rather than a plateau.

**What was proposed vs. what shipped.** The investigation's synthesis, stress-
tested by an adversarial pass, recommended reverting mid-zoom pivot
retargeting entirely — pick the pivot once at engage (as D15 already
specified) and require a release-and-regrab to aim somewhere new — paired
with replacing `zoomRadius` outright with a new bounded-step integrator. The
stress-test's own review flagged the reversion as the risky half: D14
explicitly frames continuous mid-zoom retargeting as something "the user
actually asked for," and the user's own three reports were all about wanting
move-while-zoom to *work*, not about wanting it removed — silently deleting a
feature the user is actively trying to use, across all three complaints, is
not the same thing as fixing it, however cleanly it would sidestep the noise.

So this decision keeps the feature and targets what the tracing actually
found broken:

- **The retarget gate now applies uniformly to nodes and points**, not only
  points. `lastPointPivotSightRef` (D18) becomes `lastPivotSightRef`, and the
  screen-space movement check that used to guard only the point branch now
  guards `pivotPickRef` — what the live zoom actually reads — for either
  kind, closing the node-graze hole by construction: proximity within a
  search radius is no longer sufficient to retarget an already-live drive,
  only genuine sight movement is. The candidate ring's own `candidateIdRef`
  is deliberately left ungated, since it is pure visual feedback and reading
  a stale value there would make the mark lie about what is actually near
  the sight right now.
- **The radius gets the same treatment the look-at point already has.**
  Rather than the proposed new bounded-step integrator (which would have
  replaced the correctly scale-invariant ratio law with a fixed-sensitivity
  linear delta — right for damping noise, wrong for preserving "spread
  doubles the distance, roughly halves the radius" across different absolute
  hand-spread scales, since a fixed pixel-sensitivity produces a different
  fractional effect near a small `refDist` than a large one), the DISPLAYED
  radius eases toward whatever `zoomRadius` computes as the instantaneous
  target, via a new `easeRadius` — the exact shape `easeAnchor` already uses
  for the look-at point, just scalar. `zoomRadius` itself is untouched: it
  remains the correctly-scaled target; only how fast the camera is allowed to
  chase it changes. One noisy frame's target now moves the actual radius by a
  fraction of the gap (`ZOOM_EASE_MS = 120`, the same "time to cover 95%"
  convention as `ANCHOR_EASE_MS`), not by the whole noisy delta.

**Why not the proposed integrator.** Read literally, a fixed-sensitivity
linear step (`radius *= 1 - (curDist - prevDist) * sensitivity`) telescopes,
for small `sensitivity`, to depending on total displacement since engage —
mathematically similar in aggregate to the existing ratio law, but only
because sensitivity would have to be tuned per absolute-distance scale to
reproduce the same multiplicative feel `zoomRadius` already gets for free
from being an actual ratio. Easing the ratio law's *output* keeps that
scale-correctness intact and only adds the one new idea (a settling time),
reusing code this repo already has, already reasoned through, and already
tested (`easeAnchor`), rather than introducing a parallel implementation of
the same "memory" concept with its own constant to mistune.

**Named plainly, per the stress-test's explicit demand:** `ZOOM_EASE_MS`
(120) and `PIVOT_RETARGET_DEAD_BAND_PX` (24, unchanged value, widened scope)
are both unvalidated constants chosen by reasoning about orders of magnitude,
not by measurement against real hand-tracking hardware. Revisit both from the
next manual pass rather than treating this as solved the way D17/D18 were
presented.

*Alternative considered, and why it is recorded here rather than adopted:*
removing mid-zoom retargeting outright, per the investigation's original
synthesis. Rejected as this decision's primary fix, for the reason argued
above — but if a manual pass finds the uniform retarget gate still
insufficient, release-and-regrab is the fallback to reach for next, not a
fourth round of narrower gating.

### D20 — The fist orbit is deleted, and the zoom targets a NOTE, never a point

*Added after the user reframed the problem — the decisive message of the whole
thread: "it's a SPHERE, so you'd need fist-and-rotate, but that makes it
complicated. Remove fist-rotate. Make two-hand zoom as easy as possible for
REACHING A NOTE. The goal is to zoom to the right note so you can dwell to open
it — zooming chaotically is meaningless."*

Four rounds (D17, D18, D19, and the tuning inside them) treated this as a
signal-quality problem. It was a **purpose** problem. The zoom could dolly
toward any point in space, and D15 had made that explicit and deliberate —
"you turn around the mark", even over emptiness. But nobody ever wants to be
closer to the emptiness between notes. The only reason to fly this camera is to
reach a note and dwell on it, and a drive that can end up anywhere is a drive
that is usually somewhere useless. That is what "zooming chaotically is
meaningless" names, and no amount of damping fixes it, because the noise was
never the reason the destination was wrong.

**So the target is always a note** (`pickZoomTarget`, replacing `pickPivotAt`).
Spreading the palms always travels toward one, and arriving frames it at the
centre of the view — which is exactly where the pointing dwell then opens it.
The point-pivot machinery goes with it: `sightPivotPoint`, `pickPivotAt` and
`pickAnchorAt` are deleted, not merely bypassed. The `point` variant stays in
the `GalaxyAnchor` union because a mouse pan still produces one (D1), but
nothing derives one from the sight any more. With it goes the entire class of
instability D14/D17/D18 kept fighting: a point pivot re-derived from a moving
ray while the camera eases onto it chases its own feedback, and a note simply
cannot — it is a fixed thing in the world.

**Depth breaks ties only between notes that OVERLAP on screen.** `nearestNodeAt`
ranks purely by screen distance, which is right for the dwell but wrong here: in
a sphere it happily marks a note on the far side that projects beside the sight
— one the user cannot see, because a nearer note is drawn over it. The naive
fix, "front-most within the capture radius wins", is worse in the other
direction: at overview distance every note is within the radius, so it resolves
to an arbitrary dot on the near face rather than the one aimed at. Depth is
invisible to the user *except* through occlusion, so it may only decide between
things that visually cover each other (`OCCLUSION_PX`). Beyond that, aim wins.

**And the incumbent needs hysteresis in BOTH dimensions.** The screen-distance
bias alone is worthless once two notes overlap, because the tie is then settled
on depth — the one comparison the user cannot see, and so the one that most
needs damping. `ZOOM_INCUMBENT_DEPTH_FACTOR` supplies it. A unit test caught
this: the bias was applied only to the pixel distance and the target still
flipped to a challenger a fraction of a unit nearer.

**The fist is deleted rather than rebound.** Nothing takes its place — that is
the point. The proposal's own law is "the hand chooses coarsely; the system does
the fine work", and one drive that goes *to* a note honours it where two drives
that between them go anywhere did not.

*What this costs, stated plainly:* there is no longer a hands-only way to swing
the camera around the graph at will. Reaching the far side now happens by
travelling — flying to a note both moves the camera and turns its aim onto that
note, so hops accumulate into real angular change, and the camera can pass
inside the cloud where the far hemisphere is simply in front of it. Mouse drag
still orbits freely whenever no drive is engaged, and the rail plus its search
reach anything by name. Whether that is enough in practice is the first thing
the manual pass must answer; if it is not, the smallest addition is to make
arrival approach along the vector from the centroid through the target, which
guarantees the target lands unoccluded — NOT a new rotate gesture.

### D21 — Retargeting must not rewrite the gesture's own mapping, and arrival must frame the note

*Two defects found in the same pass as D20, both of which would have survived it.*

**The reseed was rewriting the spread.** Every retarget calls
`reseedAroundAnchor`, which re-pinned the zoom reference's `dist` to whatever
the hands were at that instant. That holds the camera still — the property it
was written for — but it silently rewrites the gesture's own mapping mid-stroke:
the spread already spent stops counting, so the distance still to travel
collapses and the hands must be re-spread from scratch to go any further. **This
is "I keep spreading and nothing happens"** — and D17/D18 made it worse by
retargeting more often, which is why each round of "fixing" the zoom degraded
it. The fix keeps `dist` FIXED and solves for the `radius` that reproduces the
current distance under it, so hand-spread → travel stays constant for the whole
drive while the camera still holds still across the change.

**Arrival had nothing to arrive at.** `ZOOM_MIN_RADIUS` was 8 — about two node
radii off the dot's surface, where the note fills the viewport as a wall of
colour with its own label clipped and no neighbours in frame. Dwell accuracy
does not improve there either: the dwell threshold measures from the node's
projected centre, so an enormous dot buys nothing, while what actually helps —
no competing node within that threshold — is unaffected. 40 sits just inside
`STEP_FLIGHT_DISTANCE` (60, what a rail step already parks at, for the same
framing reason): the note is unmistakably the subject, its neighbours are still
context.

**One interaction the always-a-note rule breaks, and its guard.** Pinching the
hands shut backs out to the overview and hands the anchor back to the centroid
(D5) — but with the target now always a note, the very next throttled pick would
re-anchor on one and cancel it. Retargeting is therefore suspended once the
camera is past the release threshold, or "close your hands to see everything
again" would silently stop working.

*Unvalidated constants, named as such rather than presented as solved:*
`ZOOM_MIN_RADIUS` (40), `OCCLUSION_PX` (28), `ZOOM_INCUMBENT_BIAS_PX` (30) and
`ZOOM_INCUMBENT_DEPTH_FACTOR` (0.8) were all reasoned about rather than measured
against real hand tracking. `PIVOT_RETARGET_DEAD_BAND_PX` (24) is now *more*
load-bearing than in D19, since a depth-aware picker can flip on an occluder
drifting between camera and target with no hand movement at all.

### D22 — A mark may not hide the name of the thing it marks

*Added after the manual pass confirmed D20/D21 worked — "it locks onto a note
to zoom in/out very accurately, but the white ring is so big it covers the
note's title, so it is very hard to read."*

The marks and the titles were designed against each other without either
noticing. `galaxy-anchor-rings.ts` draws with `depthTest: false` and
`renderOrder: 2` so a mark reads even when the node it marks sits behind the
dense core — correct, and load-bearing for "what would I grab". Labels
(`galaxy-label-sprites.ts`) draw with the default `renderOrder` of 0. So the
rings always painted **after**, and therefore over, the titles.

Geometry made the collision certain rather than incidental: a title sits at
`LABEL_Y_OFFSET` 6 with `LABEL_WORLD_HEIGHT` 5, so it occupies roughly 3.5–8.5
world units above the dot, while a node's own sphere is ~4 units. Any ring wide
enough to stand clear of the dot it marks is wide enough to reach the text.
Sizing alone cannot resolve it — a ring small enough to stay under the title
would be inside the node.

So the **label wins the draw order** (`renderOrder: 3`), which states the rule
directly: a mark exists to say "this is the note", so a mark that hides the
note's name defeats its own purpose. The label keeps `depthTest: true` and the
rings keep `depthWrite: false`, so this changes only which of the two is on top,
not the label's own occlusion behaviour.

Draw order alone was not enough, though. Legible-over-a-bright-ring is still
worse than legible, and D21's `ZOOM_MIN_RADIUS` of 40 is exactly where an
anchored note is inspected most closely — the marks were sized for a camera much
further out, and at arrival read as a white disc around the note rather than a
ring on it. Both the diameters (16/24/34 → 13/17/23) and the stroke weights
(5/9/14 → 5/6/9) come down, and the two brighter rings lose a little alpha. The
marks still differ from each other in weight, which is the whole of how D10 keeps
them distinguishable without spending a colour.

*Unvalidated, like every other constant in this cluster:* these are reasoned
from the label geometry rather than measured, and the next manual pass should
say whether the engaged mark is still unmistakable at the new weight.

### D23 — The lock needs hysteresis in TIME, not more of it in space

*Added after the manual pass confirmed D20-D22: "the note-locking is a bit too
sensitive, so inside the galaxy sphere it often jumps because it keeps changing
notes — e.g. hold 3 seconds to lock a new note, plus an effect for detecting and
starting to lock a new note so it is distinguishable from empty space."*

Every guard built so far is **spatial**: `ZOOM_INCUMBENT_BIAS_PX`,
`ZOOM_INCUMBENT_DEPTH_FACTOR`, `OCCLUSION_PX`, and the
`PIVOT_RETARGET_DEAD_BAND_PX` sight-movement gate from D19. All of them answer
some form of "is the new candidate far enough / near enough / has the hand moved
enough". None can answer the question that actually matters here, because it is
not a question about distance: **a hand deliberately moving to another note and
a hand wobbling between two notes in a dense cloud travel the same pixels.**
Only elapsed time separates them. That is why each spatial guard reduced the
jumping without ending it — they were the wrong instrument, not badly tuned.

`dwellStep` already had the right shape, for the same reason in a different
place, so `zoomLockStep` mirrors it rather than inventing a mechanism. Three
rules, and the asymmetry between the first two is the substance:

- **Acquiring** a target when none is locked is **free**. Nothing is being taken
  away, so a wait would be delay for its own sake.
- **Switching** away from a locked note costs `ZOOM_LOCK_HOLD_MS` of the sight
  staying on the new one. This is the only case the user was complaining about.
- **Losing** the candidate abandons the charge rather than banking it, so
  drifting off a note mid-charge cannot quietly commit to it on the way back.

`PIVOT_RETARGET_DEAD_BAND_PX` is **removed**, not stacked with this. It existed
to stop commits happening on proximity alone, which is precisely what the hold
now prevents — and better, since it asks "did the sight stay" rather than "did
the hand travel". Keeping both would mean a deliberate retarget could be refused
for having moved too little, which is the opposite of the intent.

**The wait has to be visible, or it reads as the feature being broken.** This is
the user's second request and it is not decoration: an invisible 1.5-second
refusal to retarget is indistinguishable from a bug. The acquiring mark is the
same ring drawn at a size that **shrinks from `ACQUIRE_START_WORLD_SIZE` onto
`ANCHOR_WORLD_SIZE`** as the charge completes — a closing reticle. Shrinking
rather than a colour or opacity ramp, because it must answer two questions at
once: *is there a note here at all* (a ring appears, where empty space shows
nothing — exactly the distinction that was asked for) and *how much longer*
(it closes). It is animated by `scale.set()`, so it repaints no canvas and
allocates nothing in the loop, and it shows while a drive is engaged as well as
idle — that is when "the camera is about to switch note" most needs saying.

Two consequences that would otherwise be bugs. **Engaging takes the note the
lock is already on**, not a fresh pick: the ring has been showing that note, and
a second independent pick at engage could differ from the mark by a frame of
hand movement and grab something else. **Backing out to the overview drops the
lock**, so the next note is acquired instantly rather than charging — otherwise
the camera would stay "locked" to a note it is no longer anywhere near.

*On the number:* 1500 ms, where 3000 was suggested. The suggestion was made
against a build with no acquiring mark, where the only way to discover the hold
was to wait it out; with the charge visible, a shorter hold reads as deliberate
rather than sluggish, and it keeps mid-flight retargeting (D20/D21) usable
rather than nominal. It is one constant, named and commented as the knob to
turn, and the manual pass is what settles it.

### D24 — One hand aims, two hands zoom

*Proposed by the user after D23 shipped: "I found you can use one hand to lock
the target — drop the + when using two hands. Once locked it is easy to zoom in
and out; and when two hands zoom with no target, just zoom in and out at the
middle of the screen. That would be easier to use."*

**This is the fix the previous ten decisions were approximating.** From D14
onward the sight was the midpoint between two open palms, justified by a piece
of geometry that is true and irrelevant: a *symmetric* spread leaves the
midpoint still. Hands do not spread symmetrically. So every zoom was also,
slightly, a re-aim — the camera re-targeted on the very motion that was meant
only to change distance. D17 shared the throttle, D18 widened what could be
targeted, D19 damped the radius and gated retargets, D21 stopped the reseed
rewriting the gesture, D23 added a temporal hold. Each removed a symptom of that
one coupling, and none removed the coupling. Splitting the two jobs across
different *numbers of hands* removes it structurally: while two palms are up
there is no aim point at all, so an uneven spread has nothing to re-aim.

The user found it by use rather than by reading the code, and it is worth
recording that an earlier multi-agent review proposed exactly this
("decouple aiming from zooming") and it was **rejected** at the time in favour
of a smaller, in-place fix. That was the wrong call, and the reasoning that made
it wrong is visible in hindsight: the smaller fix was preferred because it did
not require a new mechanism, but the defect was never a missing mechanism — it
was one signal carrying two meanings.

**Aiming needs no pose of its own.** A single hand aims in ANY pose. Aiming
commits to nothing, so it does not need to be distinguished from resting the
way the committing actions do; the poses stay reserved for what commits
(`Pointing_Up` opens a note, `Victory` reveals its links). This also resolves a
collision that a pose-based aim would have created: `Pointing_Up` already opens
a note after 300 ms, well before the 1500 ms lock could commit, so aiming with
the pointing finger specifically would have opened notes instead of choosing
them.

**Ceasing to aim keeps the lock.** `aimPoint` returns null while two palms are
up, and `zoomLockStep` already reads a null candidate as "keep what is locked"
(D23) — so raising the second palm to zoom cannot drop the note just chosen.
That the two decisions compose without a special case is a sign the D23 rule was
stated at the right level.

**An un-targeted zoom moves along the view axis.** With no note locked the pivot
is the point at the centre of the view at the camera's current working distance
(`viewCentrePoint`), which is the plain reading of "just zoom in and out at the
middle of the screen". Anchoring to the centroid instead would drift the view
sideways whenever the centroid sat off-centre — which, after any travel, it
usually does. This is safe to recompute per frame in a way D20's deleted
sight-pivot was not: the camera looks *at* this point, so re-deriving returns
the same point. It is a fixed point of its own feedback rather than one that
walks.

**The sight mark is hidden while zooming**, not parked somewhere. A mark shown
while nothing is being aimed at would claim the zoom is going there.

### D25 — The fist comes back, because now there is something to turn around

*The user's completed model, proposed after D24: "open palm is aim, prefer the
right hand if both are up; Victory lights the neighbouring notes as it already
does; dwell opens the note; a fist turns the camera — and then you can choose or
zoom to the next note. So you can travel and move through the 3D galaxy space:
open hand locks a note, fist turns the angle, two hands zoom to the locked
note."*

D20 deleted the fist orbit at the user's request and that was right **for what
the orbit then was**. It turned around whatever the anchor happened to be — a
point in space, the last-opened note, the centroid — which is drift, not
navigation, and no amount of tuning makes drift useful. What changed is not the
gesture but what sits at its centre: after D20-D24 there is always a
**deliberately locked note**, and turning around a thing you chose is a
different act wearing the same pose. Restoring it now costs nothing that D20
was protecting, and completes the vocabulary:

| open palm | choose where to go |
| fist | choose the angle to see it from |
| two palms | cover the distance |
| `Victory` | see what it connects to |
| `Pointing_Up` | open it |

Five poses, five jobs, no overlap — and between them, actual travel through a
3D space rather than a camera that can only approach.

**Each pose has exactly ONE job, and that is now load-bearing rather than
tidy.** D24 let a single hand aim in *any* pose, which was harmless while a fist
meant nothing. It stops being harmless the moment a fist drives the camera: a
fist that also aimed would re-target on the very movement doing the turning —
the D14 coupling reappearing in a new place, and it would have reintroduced
every symptom D17-D23 spent five decisions removing. So `aimPoint` narrows to
the open palm alone. The rule worth keeping is general: **a pose that drives the
camera may not also aim it.**

**Right-hand preference is derived from the mirroring, not from MediaPipe.**
`useHandControl` remaps with `1 - x`, which is what makes the preview read as a
mirror — so the hand furthest RIGHT on screen is the user's right hand.
MediaPipe does report handedness, but its meaning depends on whether the input
is treated as already mirrored, a convention that cannot be confirmed without
the camera in hand. Screen position is checkable from the code and matches what
the user sees. `preferredHand` also picks which fist drives an orbit, so a hand
resting in the other half of the frame cannot silently take the camera.

*What this does NOT restore:* the orbit's old freedom to turn around empty
space. With nothing locked it turns around the point at the centre of the view
(D24's `viewCentrePoint`), on the same terms the un-targeted zoom does — so the
two camera drives always agree about what they are working around, which is the
property D19 and D21 kept discovering they needed.

### D9 — The rail is chrome, and that is the whole of its reachability

The rail island carries `HUD_CHROME_CLASS` and `hud-hit`. It then inherits both the
`z-index` and the dwell reachability from the rule the archived
`hud-panels-stay-hand-reachable-under-galaxy` change established, and this change
touches the dwell requirement not at all — which is what that rule asks of any island
added later.

Rail entries are plain `<button>`s, so the existing universal dwell finds them
through its `button, a, [data-task-id], [role="button"]` selector with no change. They
are **not** marked `[data-no-dwell]`: a step moves the camera and is trivially
reversible, which is not what that marker is for.

### D10 — Where the visual feedback is drawn, and why the reticle is not chrome

The candidate and anchor rings are scene objects, since they must track node positions
while the layout settles. They reuse the label pool's rate limit
(`SELECT_INTERVAL_MS`) for re-selection while updating their transforms every frame,
exactly as the titles do, and their `apply()` mutates in place rather than allocating
— the gesture loop already allocates per frame (`VaultGalaxy.tsx:758-761`, plus a
`getBoundingClientRect()` at 863) and this must not add to it.

The centre reticle is a DOM element, but it **must not live inside a chrome island**.
`hudChromeAtPoint` (used at `VaultGalaxy.tsx:845`) nulls out the galaxy's pointing
target whenever the hand is over chrome, and `App.tsx:1427` hands chrome to the
universal dwell — so a reticle carrying `HUD_CHROME_CLASS` at screen centre would kill
node dwell and inspect on the most-used node in the view, which is the precise
opposite of its purpose. It is a `pointer-events: none` element outside any chrome
island, following the existing `.hud-galaxy-gesture-debug` precedent.

### D11 — A step must not re-fire under a stationary hand

The universal dwell keys its fire-once guarantee on element identity
(`App.tsx:1440`): a target must be left and re-entered before it can fire again. A
step repopulates the rail, so the button under a still-held finger is a *different*
element — the dwell restarts and fires again 300 ms later, flying the camera through
the graph for as long as the hand stays up.

The fix belongs to the rail, not to the dwell rule — editing the dwell is what D9's
chrome rule forbids. After a step, the rail's entries are rendered `disabled` for a
short interval: `.click()` on a disabled button is a no-op, the dwell's `fired` flag
latches, and re-enabling keeps the same element so no new dwell starts. Entry keys
must be stable per note id so React does not recycle elements between unrelated
notes.

### D12 — Module placement, so `VaultGalaxy.tsx` does not grow

The component is at 1087 lines against a 250–450 convention, and the new work is
realistically +150–250 lines if it all lands there. Three extractions, done as
prerequisites rather than cleanup afterwards:

- `src/lib/galaxy-anchor-rings.ts` — the ring pair, mirroring
  `galaxy-label-sprites.ts`'s shape (`create… → { group, apply(...), dispose }`).
- `src/hooks/useGalaxyCameraDrive.ts` — the gesture rAF loop (currently
  `VaultGalaxy.tsx:713-964`), which is where most of the anchor wiring lands.
- `src/lib/galaxy-rail.ts` — the rail's data derivation, kept separate from
  `galaxy-anchor.ts` because anchor policy and rail ordering change for different
  reasons.

The rail's *step handler* needs `fgRef`, so it stays in `GalaxyCanvas` and the rail
component takes it as a prop. Mounting the rail in `HudShell` beside the other chrome
islands would leave it with no camera to drive.

## Risks / Trade-offs

- **The anchor tracks a node that is still moving** — while the force layout settles or
  a vault refresh reheats it, the camera follows the node and reads as drift. →
  Mitigation: the displayed-anchor lerp (D3) absorbs small motion; if it still shows,
  hold the anchor's position from the frame the layout last stopped rather than
  tracking live. Decide from the manual pass, not up front.
- **A moving anchor is genuinely harder to predict than a fixed one** — this is the
  central bet of the change, and the feedback in D10 is what pays it. → Mitigation: the
  spec makes the marks required rather than optional, so the bet cannot be shipped
  half-taken.
- **`HUD_CHROME_CLASS` is load-bearing and easy to omit** — the archived change already
  recorded this. A rail island without it is invisible to the hand and stacks wrong. →
  Mitigation: the rail's own test asserts the class is present.
- **The flight/drive interaction works by the library's cancel-on-write side effect**
  (D8) — a future refactor of the camera write could break it silently. It survives an
  interrupt for a narrower reason than "the spherical reseeds": `Tween.end()` snaps the
  camera to the flight destination, and `setCameraPos(finalPos)` overwrites it inside
  the same synchronous call, so no frame renders in between. → Mitigation: verify in
  the manual pass (see the test-environment risk below) and record the mechanism in a
  comment at the call site, since it is not evident from the code.
- **There is no DOM test environment, so parts of this cannot be unit-tested.** Both
  `vitest.config.mjs` projects declare `environment: "node"`, and the `unit` project
  includes `src/**/*.test.ts` — which does not even match `.test.tsx`. `jsdom` is a
  devDependency but unconfigured. → Mitigation: keep every new assertion in pure
  modules (the rail's class-name composition is exported and asserted as a string, not
  rendered), and move the two library-behaviour checks — tween cancellation and
  `controls.target` survival — into the manual pass. Adding a jsdom project would be a
  `test-harness` spec delta, which this change deliberately does not carry.
- **The rail adds chrome to an already busy HUD** — the galaxy is meant to be
  immersive, and a permanent panel over it costs some of that. → Trade-off accepted:
  the view is currently immersive and unusable. If it proves too heavy, the rail can
  collapse to its centre note with the neighbours revealed on approach — a later
  refinement that needs none of the specs above to change.
- **Vault size** — the real vault currently holds three notes, two of them plumbing, so
  none of this can be judged at scale from the working copy. → Mitigation: seed a
  200–500 note vault for the manual pass; the `LABEL_BUDGET_CEILING` of 500 and the
  rail's degree ordering only mean something at that size.

## Open Questions

- **Whether the step rail should exist at all.** The manual pass reached a broader
  conclusion than any single defect: that hand gestures are effective for zoom,
  open, close and scroll, and ineffective for *finding* — and that the rail, which
  exists to make finding hands-free, is still not effective after the coverage fix
  (D7b). Three readings, and they lead to materially different work:

  1. The rail's *instrument* is right but its *content* is wrong — it lists notes
     by link topology, and a user looking for a note is thinking about its subject.
     The deferred typed search box, or a voice-populated rail, replaces the content
     without touching the instrument.
  2. The rail is right but *premature* — it needs a vault with a real Map of
     Content, which the test vault does not have and the working copy has even
     less of. It cannot be judged before then.
  3. Finding by hand is a dead end and the rail should go, leaving the hands to
     zoom/open/close/scroll and finding to voice or the keyboard.

  Not resolvable from the implementation. Deliberately left open rather than
  guessed at: removing shipped, specified behaviour is the user's call, and each
  reading points somewhere else.

- ~~Whether the candidate ring should be suppressed while a drive is engaged (the
  candidate cannot change during a drive, so the ring is redundant then, but removing
  it mid-grab may read as the grab having failed). Answerable from the manual pass;
  changes no spec.~~

  **Resolved from the manual pass: suppress it, but only alongside a mark for the
  engaged state itself.** The worry — that removing it mid-grab reads as the grab
  having failed — was real, and it turned out to be the *dominant* problem rather
  than a side effect: with nothing at all marking "the grab caught", the user
  reported the anchor as slow to move. It is not slow. Closing a fist has to clear
  `stabilizeGesture`'s three-consecutive-frame pose gate (`useHandControl.ts`, shared
  by every surface and out of scope here) before anything can happen, and an
  unattributed delay reads as the feature being sluggish.

  So the candidate ring goes — it marks a choice the user can no longer make while a
  drive holds the camera — and a heavier engaged ring plus an enlarged reticle take
  its place. The engaged mark is what makes the recognizer's own latency legible as
  waiting rather than as failure, which is the same argument the candidate ring was
  added under: a mark exists to make the next moment predictable.

  `ANCHOR_THRESHOLD_PX` also widened 90 → 130 in the same pass. At 90 a grab over a
  sparse region found nothing, silently kept the old anchor (correct per spec — "a
  grab over empty space keeps the current anchor") and was indistinguishable from a
  grab that had not registered. The reticle and candidate ring are what let a wider
  radius stay predictable.
