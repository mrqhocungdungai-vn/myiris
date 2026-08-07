## Why

The galaxy is the most striking surface in the app and the least navigable. A
user who wants to reach one particular note cannot: the fist-orbit and two-palm
zoom look like flight controls but neither can take the camera *to* a note, and
half the vault is permanently occluded behind the other half.

The cause is not tuning. `centerRef` in `VaultGalaxy.tsx` carries two
responsibilities at once — the graph's centroid *and* the point the camera turns
around — and every camera write uses it. So orbiting always circles the middle of
the ball, and zooming always dollies at the middle of the ball, which is the
densest, least informative place in the view. Worse, it is actively destructive:
`restoreControlsIfNeeded` copies the centroid over `controls.target`, so a fist
orbit silently discards whatever the user had panned or framed with the mouse.
The `second-brain-gesture-nav` scenario "Gesture orbit resumes from where the
mouse left the camera" is therefore only half true today — the camera's position
carries over, its aim does not.

Fixing the anchor makes free-look useful. It does not make *finding* a note easy,
and no amount of camera work will, because the task is being handed to the wrong
instrument. Three constraints govern hand-gesture interaction, and the galaxy
currently violates all three:

1. **The hand chooses coarsely; the system does the fine work.** The galaxy asks
   the hand to fly a 3D camera continuously.
2. **Never require precise aiming.** A note's dot is roughly 4 px in a
   self-occluding sphere; webcam hand tracking jitters ±10–20 px. This is a
   physical limit, not a parameter.
3. **No interaction may require holding the hand up for more than a few
   seconds.** Flying to a note takes 10–20 s of held pose — the arm fatigues and
   the user gives up before arriving.

So this change also adds the instrument that actually fits the hand: a **step
rail** of large, ordinary DOM buttons naming the current note's one-hop
neighbours. The app already has a universal point-and-dwell that clicks any
button after 300 ms (`src/App.tsx`), so pointing at a rail entry and holding
flies the camera there and re-populates the rail with *that* note's neighbours —
hand-over-hand traversal along the graph. The target grows from 4 px to roughly
200×44 px, each step is one short beat rather than a sustained drive, and the
system animates a well-framed flight so the user can never get lost or occluded.
The galaxy stays the point of the view: the rail is the steering wheel, the
galaxy is the windscreen.

## What Changes

**The orbit anchor becomes a first-class, movable thing.**

- `centerRef`'s two jobs are split: the graph centroid stays as it is, and a
  separate **anchor** names the point the camera orbits and dollies around —
  either the centroid (the default, so a freshly-opened galaxy is unchanged) or a
  specific node.
- The anchor is re-resolved to **the node nearest screen centre** when a fist
  orbit or a two-palm zoom engages, so each grab regrips on whatever the user is
  looking at. If no node is near enough, the current anchor is kept.
- Opening a note anchors to it, so closing the reader leaves the camera orbiting
  that note's neighbourhood rather than the middle of the vault.
- Scrolling the mouse wheel while hovering a node anchors to that node, so the
  mouse zooms into the dot under the pointer.
- **BREAKING (behavioural):** a mouse pan is no longer overwritten. The gesture
  layer stops copying the centroid over `controls.target`.
- Zooming far enough out releases the anchor back to the centroid, so closing the
  hands is the way back to the overview.
- Engaging a drive never moves the camera: position is held and only the spherical
  coordinates are re-derived around the new anchor. A change of aim is eased, not
  snapped.

**The user can see what they are about to grab.** A centre reticle while hand
control is on, a faint ring on the node a grab would anchor to, and a stronger
ring on the live anchor. Without these, a moving anchor is harder to use than a
fixed one.

**A dropped hand releases the camera.** A hand that falls into the bottom third
of the frame disengages every camera drive, so lowering a tired arm cannot drive
the view.

**The step rail.** While the galaxy is active, a rail of large buttons names the
current note's one-hop neighbours (title, tag colour, link count). Activating one
— by mouse click or by the existing pointing dwell — flies the camera to that
note, makes it current, and re-populates the rail. With no current note the rail
offers the vault's most-connected notes as entry points, so the first step never
requires aiming at anything.

**No new gesture is introduced.** The four poses keep their present meanings
(`Pointing_Up` dwell, `Victory` reveal, `Closed_Fist` orbit, two open palms
zoom). The rail rides the universal dwell that already exists.

Explicitly **not** in this change, each a recorded decision rather than an
oversight:

- *Two fists as a pan drive* — considered and dropped. Panning is only needed to
  bring a node to screen centre by hand, and the rail does that instead. Spending
  a fifth pose to duplicate the rail's job would make the vocabulary worse.
- *Any new pose* — MediaPipe emits about seven usable classes and recognition
  confidence falls as poses resemble each other.
- *Free 6-DOF flight by hand* — the constraint above rules it out.
- *A typed search box, and letting the voice layer populate the rail* — both are
  the natural next step, and both are a larger surface (a text input over a
  fullscreen layer; a new voice tool). Kept separate so the rail can be judged on
  its own.
- *Recency as the rail's entry ordering* — would require adding a modification
  time to `VaultGraphNode`, which is a main-process and wire-shape change. Degree
  is computable from the links already sent, so the entry rail uses degree.
- *A flat 2D layout mode and tag clustering* — separate changes; both alter the
  layout rather than the way it is navigated.

**Why the rail needs no new gesture rule.** The already-archived
`hud-panels-stay-hand-reachable-under-galaxy` change made dwell suppression
positional: HUD chrome painted above an open layer stays hand-reachable, and
`two-hand-gestures` now requires that the set of chrome be declared in one place
so "a chrome island added later SHALL become hand-reachable by virtue of being
chrome, not by a second edit to the gesture rule." The rail is such an island.
Making it hand-reachable is therefore a matter of declaring it chrome — and this
change deliberately does *not* touch the dwell requirement, because doing so is
exactly what that rule forbids.

## Capabilities

### New Capabilities

None. The rail is hands-free navigation of the galaxy, which is what
`second-brain-gesture-nav` already covers; giving it its own capability would
split the galaxy's navigation story across two specs.

### Modified Capabilities

- `second-brain-gesture-nav`: the fist orbit and the node-opening dwell no longer
  turn around the graph's centroid but around a movable anchor re-resolved at each
  engage; a dropped hand releases every camera drive; and the step rail is added
  as a hands-free way to reach a note that does not require aiming at a node.
- `second-brain-galaxy-view`: gains the anchor itself — what it is, what sets it,
  what releases it, and the rule that re-anchoring never moves the camera — plus
  its visual feedback (centre reticle, candidate ring, anchor ring) and the mouse
  behaviours that set it (wheel-over-a-node, and a pan that is no longer
  overwritten). The anchor is defined here rather than in the gesture spec because
  the mouse sets it too.
- `two-hand-gestures`: the two-palm galaxy dolly is clamped around the current
  anchor rather than the graph's centre. The universal point-and-hold requirement
  is deliberately left untouched — see above.

The existing title-proximity requirement in `second-brain-galaxy-view` needs no
delta: it already speaks of distance from "wherever the camera is oriented", which
the anchor satisfies more literally than the centroid did. That the implementation
measures from a different point is not a change in required behaviour.

## Impact

- `src/components/VaultGalaxy.tsx` — the anchor state and its resolution, the
  camera writes, the visual feedback, the wheel and pan handling. Already 1087
  lines against a 250–450 line convention, so the anchor policy and the rail's
  data shaping should land in `src/lib/` rather than growing it further.
- `src/lib/galaxy-nav.ts` — anchor selection (nearest node to a screen point
  reuses the existing projection and front-of-camera guard), the rest-position
  release predicate, and the rail's candidate ordering. `focusNeighborhood()` is
  reused unchanged for the one-hop set.
- A new component for the step rail, plus `hud.css` for its island.
- `src/App.tsx` — the rail must be reachable by the existing universal dwell
  while the galaxy is active.
- Tests: `src/lib/galaxy-nav.test.ts` extends to the new pure policy. The camera
  and rail behaviour is driven from pure functions specifically so it is testable
  without a live WebGL instance.
- No main-process, IPC, or wire-shape change. No new dependency. `zoomToFit`'s
  node filter cannot serve the flight (it aims at the world origin by
  construction), so the flight uses `cameraPosition(pos, lookAt, ms)`.
