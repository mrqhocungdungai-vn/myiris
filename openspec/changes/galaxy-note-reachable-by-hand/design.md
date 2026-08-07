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

- Whether the candidate ring should be suppressed while a drive is engaged (the
  candidate cannot change during a drive, so the ring is redundant then, but removing
  it mid-grab may read as the grab having failed). Answerable from the manual pass;
  changes no spec.
