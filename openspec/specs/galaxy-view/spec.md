## Purpose

How Iris draws and flies a link-graph as a galaxy: an immersive opaque deep-space backdrop whose glow follows the WebGL quality preference, a pointed-at node's link cluster revealed as a spotlight, node labels drawn in-scene and made legible by camera proximity, and a camera that turns around a movable anchor aimed by a sight that follows the user's hands. It is stated in terms of **nodes, links, labels and a camera** and names nothing about what those nodes represent. Its one data source today is the notes vault — what is drawn, when the layer exists, and everything about notes lives in `second-brain-layer`.

## Requirements

### Requirement: The galaxy renders over an immersive opaque deep-space backdrop

While a galaxy is active, Iris SHALL paint an **opaque** deep-space backdrop (near-black fill, vignette, and a faint drifting starfield) that fully covers the desktop wallpaper, so the view reads as flying through space rather than a graph floating over the transparent desktop. The backdrop SHALL exist only while the galaxy layer is active and SHALL NOT leak into the transparent HUD when the galaxy is off. The rendering SHALL reuse the `three` instance already present in the app rather than introducing a second copy.

Whether the galaxy's nodes carry a glow SHALL follow the WebGL quality preference (see `webgl-quality-mode`). On the high-fidelity path the nodes SHALL be rendered with a bloom pass so they read as stars. On the light path — the default — no bloom pass SHALL be added: the galaxy is the app's most expensive surface, running a full-viewport post-processing pyramid on top of a live force simulation. The opaque backdrop, vignette and starfield SHALL be unconditional and present on both paths, because they are painted inside the scene rather than produced by the post-processing pass; removing the glow SHALL therefore never leave the galaxy on a transparent or bare background.

#### Scenario: The desktop wallpaper does not show through the galaxy

- **WHEN** the galaxy layer is active
- **THEN** the backdrop is opaque and the desktop behind the HUD is not visible through the galaxy

#### Scenario: Nodes glow on the high-fidelity path

- **WHEN** the galaxy is active and the quality preference is on the high-fidelity path
- **THEN** the nodes are rendered with a bloom pass and read as stars, exactly as before the preference existed

#### Scenario: No bloom pass on the light path

- **WHEN** the galaxy is active and the quality preference is on the light path
- **THEN** no bloom pass is added to the galaxy's rendering

#### Scenario: The path is fixed when the galaxy opens

- **WHEN** the quality preference changes while the galaxy is already open
- **THEN** the open galaxy keeps the path it was opened with and its settled node positions are retained, and the new path takes effect the next time the galaxy is opened

#### Scenario: The backdrop survives the light path

- **WHEN** the galaxy is active on the light path
- **THEN** the opaque near-black fill, the vignette and the drifting starfield are all still painted, and the desktop wallpaper is still not visible through the galaxy

#### Scenario: The backdrop is gone when the galaxy is off

- **WHEN** the galaxy layer is disabled
- **THEN** no deep-space backdrop is painted and the HUD is transparent again

#### Scenario: The galaxy stops rendering when the HUD is idle

- **WHEN** the galaxy is active and Iris goes to sleep (the same signal that pauses the reactor orb — sleep only; like the orb, the galaxy keeps rendering while awake even if the OS window is unfocused)
- **THEN** the galaxy's force simulation and render loop pause so it consumes no GPU while idle, and resume without losing node positions when Iris is awake again

#### Scenario: A single three instance is used

- **WHEN** the app's bundled dependencies are inspected
- **THEN** exactly one copy of `three` is resolved (the galaxy renderer shares the `three` already used by the reactor/holo backdrop)

### Requirement: The node being pointed at reveals its link cluster

The galaxy SHALL render a **pointed-at** node distinctly and SHALL light up the links incident to it, so that what a node is connected to is answerable by pointing at it. The pointed-at node together with its one-hop neighbours SHALL be drawn at full strength.

**The lit links SHALL be unmistakably prominent** — the point of the requirement is that a cluster reads at a glance, so the difference between a lit link and a resting one SHALL NOT be a subtle shift in an already-faint line. Any graph-wide opacity or intensity ceiling the renderer applies SHALL be accounted for, so that raising a link's own intensity actually reaches the view rather than being scaled back down by a global factor. Making lit links prominent SHALL NOT brighten the resting links: at rest the graph SHALL look exactly as it did before this requirement existed.

**Everything outside the pointed-at cluster SHALL be dimmed for as long as it is pointed at.** Brightening the cluster is not enough on its own: in a dense galaxy a brighter cluster still sits inside a mesh of other links, so the answer to "what is this node connected to" has to be the only thing lit. The reveal is a spotlight, not an accent.

The dimming SHALL use the same treatment the focus declutter uses, so the galaxy has one visual language for "this is what matters right now" rather than two that have to be told apart.

The one-hop neighbourhood used here SHALL be the same one the focus declutter uses, so the highlight and the dimming can never disagree about what one hop means.

**Pointing SHALL take precedence over the focus's own dimming** rather than adding to it: while something is pointed at, what stays bright is that node's cluster, and when nothing is pointed at it is the focus's. One question is answered at a time, and a second bright island beside the first would answer neither clearly. It follows that pointing at a node the focus has dimmed reveals what that node connects to without the user having to change the focus first, and that releasing restores the focus's dimming exactly as it was.

A **focused** node SHALL remain visibly focused even while the spotlight is elsewhere: losing sight of a selection because the user pointed at something else is a worse loss than the spotlight is worth.

**The highlight SHALL be transient and SHALL change no state.** It SHALL NOT select anything, SHALL NOT alter the focus, SHALL NOT move the camera, and SHALL NOT open anything. Ceasing to point SHALL restore exactly the previous rendering, including whatever dimming a live focus was applying. Nothing SHALL accumulate: at most one node is pointed at at any moment, and moving on leaves nothing behind.

A node SHALL be pointed at only by an input that **means** to point at it, with no difference in what is drawn between them:

- the **mouse hovering** it;
- when hand control is on, the **inspect pose** held near it (see `second-brain-gesture-nav`, "A held two-finger pose reveals a node's link cluster");
- the node a **`Pointing_Up` dwell is charging against**, since that dwell is already deliberate and already gives the node visible feedback.

A hand that is merely present in frame in some other pose SHALL NOT point at anything. When more than one input could apply, the hand SHALL win, so the highlight follows whichever input the user is actually using rather than flickering between them.

A **ghost node** — one the graph's source marks as named but not openable (for the notes vault, an unresolved `[[wikilink]]` target; see `second-brain-layer`) — SHALL NOT be pointed at by any producer. Ghosts are held to the same eligibility deliberately: the hand's target resolution already excludes them because a ghost is not openable, and a highlight that appeared under the mouse but never under the hand would make the same node behave differently depending on the input device.

Repainting for a highlight change SHALL be coalesced so that sweeping a pointer across a dense region cannot force one full-graph repaint per node crossed.

#### Scenario: Pointing at a node lights its links

- **WHEN** the user points at a real node — by mouse hover, or by the inspect pose with hand control on
- **THEN** the links incident to that node are drawn prominently, and that node and its one-hop neighbours are drawn at full strength

#### Scenario: A lit link is obviously lit

- **WHEN** a node's cluster is lit while the rest of the graph is at rest
- **THEN** the difference is immediately visible rather than a faint change to an already-faint line — no graph-wide opacity or intensity ceiling scales the lit links back down

#### Scenario: Resting links look exactly as they did before

- **WHEN** nothing is pointed at
- **THEN** the links are drawn exactly as they were before the highlight existed — making lit links prominent did not brighten the graph at rest

#### Scenario: Ceasing to point restores the view

- **WHEN** the user stops pointing at the node (moves the mouse off it, releases the inspect pose, or moves the hand away)
- **THEN** the links and nodes return to exactly how they were drawn before, including any dimming a live focus was applying

#### Scenario: The highlight selects nothing

- **WHEN** a node's cluster is highlighted by pointing
- **THEN** the focus is unchanged, nothing opens, the camera does not move, and nothing the voice layer or a run reads has changed

#### Scenario: Nothing accumulates across nodes

- **WHEN** the user points at one node after another
- **THEN** exactly one cluster is lit at a time and each previous one returns to normal — no growing set of lit nodes builds up

#### Scenario: The rest of the galaxy dims around the pointed-at cluster

- **WHEN** the user points at a node while nothing is focused
- **THEN** everything outside that node's one-hop cluster is dimmed for as long as it is pointed at, so the cluster is the only lit thing in the view

#### Scenario: Pointing at a dimmed node reveals its cluster

- **WHEN** a focus is active, everything outside its one-hop neighbourhood is dimmed, and the user points at one of those dimmed nodes
- **THEN** that node and its own one-hop neighbours are drawn at full strength while it is pointed at, everything else — including what the focus was keeping bright — is dimmed, and the focus itself is not changed

#### Scenario: Releasing restores the focus's dimming

- **WHEN** the user stops pointing while a focus is still active
- **THEN** the dimming returns to exactly what the focus was applying before

#### Scenario: A selection stays visible under a spotlight elsewhere

- **WHEN** nodes are focused and the user points at an unrelated node
- **THEN** the focused nodes are still visibly focused, even though they are outside the lit cluster

#### Scenario: Every producer draws the same thing

- **WHEN** the same node is pointed at by mouse hover on one occasion and by the inspect pose on another
- **THEN** the rendering is identical in both cases

#### Scenario: The hand's target wins over the mouse

- **WHEN** hand control is on, the hand is pointing at one node, and the mouse pointer happens to rest over a different node
- **THEN** the hand's target is the node whose cluster is highlighted

#### Scenario: A ghost node is not pointed at

- **WHEN** the user hovers or points at a faded ghost node
- **THEN** no cluster highlight is drawn for it

#### Scenario: Sweeping across a dense region does not repaint per node

- **WHEN** the pointer moves rapidly across many nodes in a dense cluster
- **THEN** highlight repaints are coalesced rather than one full-graph repaint being performed for every node crossed

### Requirement: Node labels are always drawn, legible by camera proximity

The galaxy SHALL render every eligible node's label as text in the scene beside its node, at all times — labels are not toggled on or off by camera distance. Legibility instead comes from the sprite's own perspective scaling (`sizeAttenuation`): a label far from wherever the camera is oriented shrinks on screen exactly as its node's dot already does, reading as visual noise near a small dot rather than as competing legible text, while a label the camera is close to grows large and readable. Viewed from far out — including the whole-graph framing a fresh galaxy opens with — labels SHALL therefore be too small to read and the view SHALL still read as an unlabelled field of dots in practice, without any label having actually stopped rendering; moving the camera in toward a region SHALL grow that region's labels into legibility.

Labels SHALL be readable from navigation alone — no pointer, hover, click, or gesture. This is the point of the requirement: the hover tooltip names one node and only while a pointer rests on it, and under hand control there is no pointer at all, so without in-scene labels a node can be identified only by opening it. The hover tooltip SHALL remain unchanged; this adds an affordance and removes none.

A label SHALL reach the view as **drawn text** rather than through any surface that interprets markup, so a label whose text contains markup is inert by construction rather than by escaping. This holds for a label from any source (the containment obligation this discharges for note titles is stated in `second-brain-layer`, "Untrusted note content is contained").

The number of label sprites SHALL be bounded by a pool sized once, when the galaxy opens, to the graph's own node count — every node gets a label — capped at a defensive ceiling so a pathologically large graph cannot allocate an unbounded number of textures. Only a graph whose node count exceeds that ceiling SHALL have any labels omitted, and only the farthest-from-camera nodes past the ceiling, nearest-first; a graph within the ceiling SHALL have every node labelled, at every zoom level, without any node's label ever being withheld for being "too far."

When the pool's ceiling IS exceeded, which nodes are labelled SHALL NOT depend on which angle the camera happens to be viewing from: two nodes equally near wherever the camera is oriented SHALL be treated as equally eligible, regardless of which one the camera's exact line of sight passes through — a node "beside" another must not be truncated ahead of it purely because it sits off that line.

A shown label SHALL track its node's position while the force layout settles and while the graph updates, so a label is never left floating away from the node it names.

A label too long to draw legibly SHALL be elided rather than drawn as a banner across the view, so one long name cannot obscure the nodes and labels around it.

A label SHALL NOT be shown for a node the focus declutter has dimmed — a node outside the focused nodes' one-hop neighbourhood (see `second-brain-focus`) — so labels do not re-clutter what the dimming just cleared.

Labels SHALL stop being drawn and updated whenever the galaxy's rendering is paused (the same sleep signal that pauses the force simulation and render loop), and SHALL resume with it, so labels never cost anything while Iris is idle.

#### Scenario: A galaxy viewed from far out reads as unlabelled

- **WHEN** the galaxy is open at a camera distance that frames the whole graph
- **THEN** every label is still technically drawn, but each is shrunk by perspective to the point of being illegible next to its node's dot, so the view reads as an unlabelled field of nodes over the deep-space backdrop

#### Scenario: Moving in toward a region grows its labels into legibility

- **WHEN** the camera moves close enough to a group of nodes for perspective scaling to make their labels large enough to read
- **THEN** those nodes' labels read clearly, so the user can tell which nodes they are without hovering, clicking, or opening any of them

#### Scenario: A node in a different cluster is labelled too, not just the one the camera is near

- **WHEN** the graph has multiple clusters and the camera (moved by rotate and scroll-zoom alone, no panning) is currently oriented toward only one of them
- **THEN** nodes in the other clusters still carry labels (shrunk by distance if far, but present) rather than staying permanently unlabelled because the camera has never been oriented toward them

#### Scenario: A node beside another is not truncated ahead of it just for being off-axis

- **WHEN** the graph exceeds the pool's ceiling and two nodes sit at roughly the same distance from wherever the camera is oriented, one of them along the camera's exact line of sight and one beside it
- **THEN** both are equally eligible to be labelled — the one directly ahead is not favoured over the one beside it, and rotating the camera further does not change which of the two gets truncated

#### Scenario: A graph under the ceiling has every node labelled

- **WHEN** the graph's node count is at or under the pool's defensive ceiling
- **THEN** every node's label is drawn (subject to focus declutter and the sleep pause), regardless of how far any of them are from the camera

#### Scenario: A graph over the ceiling truncates the farthest nodes first

- **WHEN** the graph's node count exceeds the pool's defensive ceiling
- **THEN** the ceiling's worth of nearest-to-camera nodes are labelled and the remainder are not, so the on-screen label count never exceeds the ceiling regardless of graph size

#### Scenario: A label follows its node while the layout settles

- **WHEN** a node whose label is shown is still moving (the force layout is settling, or a graph update reheated it)
- **THEN** its label moves with it and stays beside the node it names

#### Scenario: A very long label is elided

- **WHEN** a node whose name is far longer than the view can draw legibly carries a label
- **THEN** its label is drawn elided rather than as a full-width banner, and the nodes and labels around it stay visible

#### Scenario: A dimmed node is not named

- **WHEN** a focus is active and a node outside the focus's one-hop neighbourhood would otherwise carry a label
- **THEN** no label is drawn for that node, matching the near-invisible dimming already applied to it

#### Scenario: A ghost node is named like any other node

- **WHEN** a ghost node (one the source marks as named but not openable) carries a label
- **THEN** its name is drawn like any other node's, so the dangling reference is identifiable — while its faded rendering continues to mark it as not openable

#### Scenario: A label containing markup is drawn as text

- **WHEN** a node's name contains markup such as `<img src=x onerror=…>` and it carries a label in the scene
- **THEN** the characters are drawn literally as text, nothing is parsed as markup, and no script runs

#### Scenario: Labels stop while the galaxy is asleep

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the force simulation and render loop
- **THEN** labels stop being drawn and updated for as long as the galaxy is paused, and reappear correctly positioned when Iris is awake again

#### Scenario: The hover tooltip still works

- **WHEN** the user hovers a node with the pointer
- **THEN** the existing tooltip still shows that node's name, independent of the in-scene label's current on-screen size

### Requirement: The camera turns and dollies around a movable anchor

The galaxy SHALL have a single **anchor** — the point the camera turns around and
dollies toward — and every camera drive, by hand or by mouse, SHALL use that one
anchor. It SHALL be the graph's centroid, one specific node, or a specific point
in space.

**A camera drive SHALL turn around whatever the sight is on, always.** When a node
is near the sight the anchor SHALL be that node, so dollying in arrives at a node.
When no node is near enough it SHALL be the point under the sight itself, at the
depth the camera is already working at — **not** the anchor left over from before.
An anchor that survives a grab aimed somewhere else is a pivot the user is not
pointing at and cannot see; most visibly it is the node they last opened, which
then follows them around invisibly. The mark on screen and the point the camera
turns around are the same thing, with no exception to remember.

A freshly-opened galaxy SHALL be anchored on the centroid, so the view a galaxy
opens with is unchanged by this requirement existing.

The anchor SHALL move to a node when:

- a camera drive engages and a node is near the **sight** — the mark showing where
  the user's hands are aimed (see below, and `second-brain-gesture-nav`, "A closed
  two open palms fly the galaxy camera to a note") — so the node they are pointing at becomes the
  thing they turn around;
- a node is opened, whether by click or by dwell — so closing the reader leaves the
  camera around that node's neighbourhood rather than the middle of the graph.
  This SHALL NOT survive the next camera drive: the drive re-resolves from the
  sight, so an opened node is where the camera is *left*, never a pivot that
  outlives the user aiming somewhere else;
- the user reaches a node through the step rail (see `second-brain-gesture-nav`);
- the mouse wheel is used while the pointer rests on a node — scrolling zooms into
  the dot under the pointer.

The anchor SHALL return to the centroid when the camera is dollied far enough out
that the whole graph is being framed, so backing away is the way back to the
overview and no separate control is needed to escape a node.

**Re-anchoring SHALL NOT move the camera.** The camera's position SHALL be held
exactly where it is and only its relationship to the new anchor recomputed, so
engaging a drive can never teleport the view. Where re-anchoring changes what the
camera is aimed at, that change of aim SHALL be eased rather than applied as a
jump: the anchor is chosen from what is *near* the centre of the screen, so it is
routinely a little off-centre, and a jump would read as the view flinching each
time the user grabs it.

**A camera the user positioned SHALL NOT be silently discarded.** Panning or
framing the view with the mouse SHALL set the anchor rather than be overwritten by
it. Previously a hand drive reset the camera's aim to the graph's centroid on
engage and again on release, so a fist thrown after the user had framed a region
by mouse threw that framing away; that SHALL NOT happen.

Nothing about the anchor SHALL change what is selected. Moving the anchor is a
navigation act: it SHALL NOT alter the focus (see `second-brain-focus`), SHALL NOT
open anything, and SHALL NOT change what the voice layer or a run reads.

#### Scenario: A fresh galaxy is anchored on the whole graph

- **WHEN** the user opens the galaxy
- **THEN** the camera frames the whole graph and turns around its centroid, exactly as it did before the anchor existed

#### Scenario: Zooming reaches the node, not the middle of the ball

- **WHEN** a node is anchored and the user dollies the camera in as far as it will go
- **THEN** the camera arrives at that node, rather than at the centre of the graph

#### Scenario: Opening a node anchors the camera on it

- **WHEN** the user opens a node and then closes the reader
- **THEN** the camera turns around that node's position, so its neighbourhood is what the next camera drive explores

#### Scenario: Scrolling over a node zooms into it

- **WHEN** the pointer rests on a node and the user scrolls the mouse wheel
- **THEN** the camera moves toward that node

#### Scenario: Re-anchoring does not teleport the camera

- **WHEN** the anchor moves from one point to another
- **THEN** the camera stays exactly where it is and only what it turns around changes — nothing jumps to a new position

#### Scenario: A change of aim is eased, not snapped

- **WHEN** re-anchoring aims the camera at a node that was near but not exactly at the centre of the screen
- **THEN** the aim moves onto it smoothly rather than snapping in a single frame

#### Scenario: A mouse-framed view survives a hand drive

- **WHEN** the user frames a region of the galaxy with the mouse and then engages a hand camera drive
- **THEN** the camera stays exactly where the mouse left it and the drive does not reset its aim to the graph's centroid, on engage or on release. The pivot moves to whatever the user's sight is on, because that is what engaging a drive means — but nothing is discarded silently and nothing reverts to the middle of the graph.

#### Scenario: The last-opened node does not become an invisible pivot

- **WHEN** the user opens a node, closes the reader, and then engages a camera drive with the sight over empty space
- **THEN** the camera turns around the point under the sight, not around the node they opened

#### Scenario: Backing out returns to the whole graph

- **WHEN** a node is anchored and the user dollies the camera out far enough to frame the whole graph
- **THEN** the anchor returns to the centroid, so the view frames the graph as a whole again and further retargeting is suspended until the camera comes back in

#### Scenario: The anchor selects nothing

- **WHEN** the anchor moves to a node by any route
- **THEN** the focus is unchanged, nothing opens, and nothing the voice layer or a run reads has changed

### Requirement: The camera is aimed by a sight that follows the hands

While hand control is enabled and the galaxy is active, Iris SHALL show a **sight**
— a mark of where the camera drives are aimed — and that sight SHALL follow the
user's hands rather than being fixed to the centre of the screen.

**A sight fixed at the centre of the screen cannot be aimed.** The only way to put
something under it is to fly the camera until that thing is in the middle, which is
the hardest part of navigating the galaxy demanded *before* the easy part is
allowed to begin. Zooming then moves toward whatever happened to be at the centre,
which from the user's side is arbitrary — the gesture has no relationship to the
region they were looking at. Reading the sight off the hands inverts it: the user
puts their hands over the region and acts, in one motion, with no camera work
first.

**The sight SHALL follow a SINGLE hand, and SHALL NOT exist while two palms are
up.** Aiming and zooming are carried by different numbers of hands rather than by
the same pair: the sight was previously the midpoint between two open palms, on
the reasoning that a symmetric spread leaves that midpoint still — true of the
geometry and false of hands, so every zoom was also a slight re-aim. While two
palms are up there SHALL be no aim point, and the sight mark SHALL be hidden,
since a mark shown then would claim the zoom is going somewhere it is not.

#### Scenario: The sight follows the hands rather than the centre of the screen

- **WHEN** hand control is on, the galaxy is active, and the user moves their hands across the frame
- **THEN** the sight moves with them, and a camera drive engaged there aims at what the sight is over — not at whatever sits at the centre of the screen

#### Scenario: The sight disappears while two palms zoom

- **WHEN** the user raises a second open palm to zoom
- **THEN** the sight mark is hidden and the hands' movement no longer changes what the camera is aimed at

#### Scenario: No hand in frame means nothing is being aimed at

- **WHEN** hand control is on and the galaxy is active but no hand is in frame
- **THEN** no sight is shown and no new target is chosen — the node already locked is kept

### Requirement: What a grab will take hold of is visible before the grab

While hand control is enabled and the galaxy is active, Iris SHALL show which node
a camera drive would anchor to if engaged now, and — while a drive is engaged —
that a drive is engaged at all. While a node is anchored, that node SHALL be marked
distinctly from the candidate.

This is not decoration. An anchor that moves is *harder* to use than a fixed one
unless the user can predict where it will land: without the marks, engaging a
drive is a guess about which node the system picked, and a guess that lands wrong
is indistinguishable from the camera misbehaving. The centre mark is what the user
aims with; the candidate mark is what tells them the aim has succeeded before they
commit to it.

The marks SHALL be present only while they can be acted on: they SHALL NOT be
drawn while hand control is off, while the galaxy is not active, or while a reader
holds the gesture surface, and they SHALL stop with the galaxy's rendering when
Iris sleeps.

Recomputing which node is the candidate SHALL be rate-limited rather than done
every frame, on the same grounds the existing label selection is: the search is
proportional to the node count and a candidate that changes at frame rate would
both cost more than it is worth and read as flicker.

The candidate and anchor marks SHALL be distinguishable from the pointed-at
highlight and from the focus indicator, so a user can tell "this is what I would
grab" from "this is what I asked about" and from "this is what I selected".

#### Scenario: The sight follows the hands

- **WHEN** the galaxy is active with hand control on and the user moves their hands across the view
- **THEN** the sight moves with them, so the user aims by moving their hands rather than by first flying the camera

#### Scenario: Spreading the palms goes where the sight is

- **WHEN** the user holds both palms over a region away from the centre of the screen and spreads them
- **THEN** the camera dollies toward that region, not toward whatever sits at the centre of the screen

#### Scenario: The aim keeps up during a two-palm zoom

- **WHEN** the user is dollying with two open palms and moves both hands together onto a different node
- **THEN** the camera re-aims onto that node without the view jumping, and continues dollying toward it

#### Scenario: The node a grab would take is marked

- **WHEN** a node is near the sight and no camera drive is engaged
- **THEN** that node is marked as the candidate, so the user knows what engaging a drive would anchor to

#### Scenario: An engaged drive is visibly engaged

- **WHEN** the user makes a camera-drive pose and the recognizer accepts it
- **THEN** the marks change to say so, so the wait for the pose to be recognized reads as waiting rather than as the gesture having failed

#### Scenario: The live anchor is marked distinctly

- **WHEN** a node is anchored
- **THEN** it is marked more strongly than the candidate, so the user can always tell what the camera is currently turning around

#### Scenario: No marks without hand control

- **WHEN** hand control is off and the galaxy is active
- **THEN** neither the sight nor the candidate mark is drawn

#### Scenario: Marks stop while Iris sleeps

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the render loop
- **THEN** the marks stop being drawn and updated, and return correctly when Iris is awake again

#### Scenario: The candidate is not recomputed every frame

- **WHEN** the sight moves continuously across a dense region
- **THEN** the candidate is re-selected at a rate-limited interval rather than once per rendered frame

#### Scenario: The marks are not confusable with the highlight or the focus

- **WHEN** a node is simultaneously the anchor candidate, pointed at, and focused
- **THEN** the three treatments remain distinguishable from one another
