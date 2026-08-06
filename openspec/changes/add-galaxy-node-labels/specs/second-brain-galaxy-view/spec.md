## ADDED Requirements

### Requirement: Note titles are revealed in the galaxy by camera proximity

The galaxy SHALL render each note's title as text in the scene beside its node, revealed by the camera's distance to that node: a title SHALL be shown while the camera is within a proximity threshold of its node and SHALL NOT be shown beyond it. Viewed from far out — including the whole-vault framing a fresh galaxy opens with — the galaxy SHALL therefore carry no titles at all and read as the unlabelled deep-space cloud it does today; moving the camera in toward a region SHALL name the notes in that region.

The reveal SHALL depend on the distance to each node individually, and SHALL NOT be a single global zoom step that names the far side of the graph at the same moment as the cluster in front of the camera — in a 3D view that would put unreadably small overlapping titles across the whole graph, worst exactly where the vault is largest.

Titles SHALL be readable from navigation alone — no pointer, hover, click, or gesture. This is the point of the requirement: the hover tooltip names one node and only while a pointer rests on it, and under hand control there is no pointer at all, so without in-scene titles a node can be identified only by opening it. The hover tooltip SHALL remain unchanged; this adds an affordance and removes none.

The number of titles rendered at once SHALL be bounded by a fixed budget, filled nearest-camera-first, so the cost of titles is independent of how many notes the vault holds. A view whose cost grows with the vault is a view that gets slower the more the app is used.

A shown title SHALL track its node's position while the force layout settles and while the graph updates, so a title is never left floating away from the node it names.

A title too long to draw legibly SHALL be elided rather than drawn as a banner across the view, so one long note name cannot obscure the nodes and titles around it.

A title SHALL NOT be shown for a node the focus declutter has dimmed — a node outside the focused notes' one-hop neighbourhood (see `second-brain-focus`) — so titles do not re-clutter what the dimming just cleared.

Titles SHALL stop being drawn and updated whenever the galaxy's rendering is paused (the same sleep signal that pauses the force simulation and render loop), and SHALL resume with it, so titles never cost anything while Iris is idle.

#### Scenario: A galaxy viewed from far out carries no titles

- **WHEN** the galaxy is open at a camera distance that frames the whole vault
- **THEN** no note titles are drawn, and the view reads as an unlabelled field of nodes over the deep-space backdrop

#### Scenario: Moving in toward a region names the notes in it

- **WHEN** the camera moves close enough to a group of nodes to cross the proximity threshold
- **THEN** those nodes' titles appear as text beside them, so the user can read which notes they are without hovering, clicking, or opening any of them

#### Scenario: Titles disappear again on pulling back

- **WHEN** the camera moves back out past the proximity threshold from nodes whose titles were shown
- **THEN** those titles are no longer drawn and the view returns to unlabelled nodes

#### Scenario: The far side of the graph is not named along with the near side

- **WHEN** the camera is close to one cluster while other clusters remain far away
- **THEN** only the nodes near the camera are named — distance is evaluated per node, so the far clusters stay unlabelled

#### Scenario: A large vault does not draw more titles than the budget

- **WHEN** more nodes are within the proximity threshold than the on-screen title budget allows
- **THEN** at most the budgeted number of titles is drawn, chosen nearest-camera-first, and the count does not grow with the size of the vault

#### Scenario: A title follows its node while the layout settles

- **WHEN** a node whose title is shown is still moving (the force layout is settling, or a graph update reheated it)
- **THEN** its title moves with it and stays beside the node it names

#### Scenario: A very long note title is elided

- **WHEN** a node whose title is far longer than the view can draw legibly is within the proximity threshold
- **THEN** its title is drawn elided rather than as a full-width banner, and the nodes and titles around it stay visible

#### Scenario: A dimmed node is not named

- **WHEN** a focus is active and a node outside the focus's one-hop neighbourhood is within the proximity threshold
- **THEN** no title is drawn for that node, matching the near-invisible dimming already applied to it

#### Scenario: A ghost node is named like any other node

- **WHEN** a ghost node (an unresolved `[[wikilink]]` target with no backing file) is within the proximity threshold
- **THEN** its name is drawn like any other node's, so the dangling link is identifiable — while its faded rendering continues to mark it as not openable

#### Scenario: Titles stop while the galaxy is asleep

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the force simulation and render loop
- **THEN** titles stop being drawn and updated for as long as the galaxy is paused, and reappear correctly positioned when Iris is awake again

#### Scenario: The hover tooltip still works

- **WHEN** the user hovers a node with the pointer
- **THEN** the existing tooltip still shows that node's title, whether or not the node is currently close enough to carry an in-scene title

## MODIFIED Requirements

### Requirement: Untrusted note content is contained

Because notes may originate from the web (`wiki-ingest`), the galaxy SHALL treat note content as untrusted in the privileged renderer. Note titles/labels SHALL NOT be injected as HTML into the graph's tooltip (no script execution from a crafted title); a title rendered in the scene SHALL reach the view as drawn text rather than through any surface that interprets markup, so a crafted title is inert there by construction and not merely by escaping; note markdown SHALL be rendered with raw HTML escaped (no `rehype-raw`/`dangerouslySetInnerHTML`); an in-note hyperlink SHALL NOT be able to navigate the app window away from the app (external links are denied or opened out-of-app); and `secondbrain:read-note` SHALL refuse to read any path that, after symlink resolution, falls outside the vault directory.

#### Scenario: A crafted note title does not execute script

- **WHEN** a note's title/filename contains HTML like `<img src=x onerror=…>` and its node label is shown
- **THEN** the markup is escaped/inert and no script runs in the renderer

#### Scenario: A crafted note title is inert as an in-scene title

- **WHEN** a note whose title contains HTML like `<img src=x onerror=…>` is close enough to the camera to be named in the scene
- **THEN** the title's characters are drawn literally as text, nothing is parsed as markup, and no script runs

#### Scenario: An in-note link cannot replace the app

- **WHEN** the user activates an `https://` link inside an opened note
- **THEN** the app window is not navigated to the remote page (the link is denied or opened outside the app)

#### Scenario: A symlinked note escaping the vault is not readable

- **WHEN** a node resolves (after following symlinks) to a path outside `~/iris-second-brain` (e.g. a note symlinked to `~/.ssh/id_rsa`)
- **THEN** `secondbrain:read-note` refuses the read and returns no file contents
