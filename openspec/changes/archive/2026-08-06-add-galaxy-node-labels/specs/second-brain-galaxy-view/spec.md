## ADDED Requirements

### Requirement: Note titles are always drawn in the galaxy, legible by camera proximity

The galaxy SHALL render every eligible note's title as text in the scene beside its node, at all times — titles are not toggled on or off by camera distance. Legibility instead comes from the sprite's own perspective scaling (`sizeAttenuation`): a title far from wherever the camera is oriented shrinks on screen exactly as its node's dot already does, reading as visual noise near a small dot rather than as competing legible text, while a title the camera is close to grows large and readable. Viewed from far out — including the whole-vault framing a fresh galaxy opens with — titles SHALL therefore be too small to read and the view SHALL still read as an unlabelled field of dots in practice, without any title having actually stopped rendering; moving the camera in toward a region SHALL grow that region's titles into legibility.

Titles SHALL be readable from navigation alone — no pointer, hover, click, or gesture. This is the point of the requirement: the hover tooltip names one node and only while a pointer rests on it, and under hand control there is no pointer at all, so without in-scene titles a node can be identified only by opening it. The hover tooltip SHALL remain unchanged; this adds an affordance and removes none.

The number of title sprites SHALL be bounded by a pool sized once, when the galaxy opens, to the vault's own note count — every note gets a title — capped at a defensive ceiling so a pathologically large vault cannot allocate an unbounded number of textures. Only a vault whose note count exceeds that ceiling SHALL have any titles omitted, and only the farthest-from-camera notes past the ceiling, nearest-first; a vault within the ceiling SHALL have every note titled, at every zoom level, without any note's title ever being withheld for being "too far."

When the pool's ceiling IS exceeded, which notes are titled SHALL NOT depend on which angle the camera happens to be viewing from: two notes equally near wherever the camera is oriented SHALL be treated as equally eligible, regardless of which one the camera's exact line of sight passes through — a note "beside" another must not be truncated ahead of it purely because it sits off that line.

A shown title SHALL track its node's position while the force layout settles and while the graph updates, so a title is never left floating away from the node it names.

A title too long to draw legibly SHALL be elided rather than drawn as a banner across the view, so one long note name cannot obscure the nodes and titles around it.

A title SHALL NOT be shown for a node the focus declutter has dimmed — a node outside the focused notes' one-hop neighbourhood (see `second-brain-focus`) — so titles do not re-clutter what the dimming just cleared.

Titles SHALL stop being drawn and updated whenever the galaxy's rendering is paused (the same sleep signal that pauses the force simulation and render loop), and SHALL resume with it, so titles never cost anything while Iris is idle.

#### Scenario: A galaxy viewed from far out reads as unlabelled

- **WHEN** the galaxy is open at a camera distance that frames the whole vault
- **THEN** every title is still technically drawn, but each is shrunk by perspective to the point of being illegible next to its node's dot, so the view reads as an unlabelled field of nodes over the deep-space backdrop

#### Scenario: Moving in toward a region grows its titles into legibility

- **WHEN** the camera moves close enough to a group of nodes for perspective scaling to make their titles large enough to read
- **THEN** those nodes' titles read clearly, so the user can tell which notes they are without hovering, clicking, or opening any of them

#### Scenario: A note in a different cluster is titled too, not just the one the camera is near

- **WHEN** the vault has multiple clusters and the camera (moved by rotate and scroll-zoom alone, no panning) is currently oriented toward only one of them
- **THEN** notes in the other clusters still carry titles (shrunk by distance if far, but present) rather than staying permanently unlabelled because the camera has never been oriented toward them

#### Scenario: A note beside another is not truncated ahead of it just for being off-axis

- **WHEN** the vault exceeds the pool's ceiling and two notes sit at roughly the same distance from wherever the camera is oriented, one of them along the camera's exact line of sight and one beside it
- **THEN** both are equally eligible to be titled — the one directly ahead is not favoured over the one beside it, and rotating the camera further does not change which of the two gets truncated

#### Scenario: A vault under the ceiling has every note titled

- **WHEN** the vault's note count is at or under the pool's defensive ceiling
- **THEN** every note's title is drawn (subject to focus declutter and the sleep pause), regardless of how far any of them are from the camera

#### Scenario: A vault over the ceiling truncates the farthest notes first

- **WHEN** the vault's note count exceeds the pool's defensive ceiling
- **THEN** the ceiling's worth of nearest-to-camera notes are titled and the remainder are not, so the on-screen title count never exceeds the ceiling regardless of vault size

#### Scenario: A title follows its node while the layout settles

- **WHEN** a node whose title is shown is still moving (the force layout is settling, or a graph update reheated it)
- **THEN** its title moves with it and stays beside the node it names

#### Scenario: A very long note title is elided

- **WHEN** a node whose title is far longer than the view can draw legibly carries a title
- **THEN** its title is drawn elided rather than as a full-width banner, and the nodes and titles around it stay visible

#### Scenario: A dimmed node is not named

- **WHEN** a focus is active and a node outside the focus's one-hop neighbourhood would otherwise carry a title
- **THEN** no title is drawn for that node, matching the near-invisible dimming already applied to it

#### Scenario: A ghost node is named like any other node

- **WHEN** a ghost node (an unresolved `[[wikilink]]` target with no backing file) carries a title
- **THEN** its name is drawn like any other node's, so the dangling link is identifiable — while its faded rendering continues to mark it as not openable

#### Scenario: Titles stop while the galaxy is asleep

- **WHEN** the galaxy is active and Iris goes to sleep, pausing the force simulation and render loop
- **THEN** titles stop being drawn and updated for as long as the galaxy is paused, and reappear correctly positioned when Iris is awake again

#### Scenario: The hover tooltip still works

- **WHEN** the user hovers a node with the pointer
- **THEN** the existing tooltip still shows that node's title, independent of the in-scene title's current on-screen size

## MODIFIED Requirements

### Requirement: Untrusted note content is contained

Because notes may originate from the web (`wiki-ingest`), the galaxy SHALL treat note content as untrusted in the privileged renderer. Note titles/labels SHALL NOT be injected as HTML into the graph's tooltip (no script execution from a crafted title); a title rendered in the scene SHALL reach the view as drawn text rather than through any surface that interprets markup, so a crafted title is inert there by construction and not merely by escaping; note markdown SHALL be rendered with raw HTML escaped (no `rehype-raw`/`dangerouslySetInnerHTML`); an in-note hyperlink SHALL NOT be able to navigate the app window away from the app (external links are denied or opened out-of-app); and `secondbrain:read-note` SHALL refuse to read any path that, after symlink resolution, falls outside the vault directory.

#### Scenario: A crafted note title does not execute script

- **WHEN** a note's title/filename contains HTML like `<img src=x onerror=…>` and its node label is shown
- **THEN** the markup is escaped/inert and no script runs in the renderer

#### Scenario: A crafted note title is inert as an in-scene title

- **WHEN** a note whose title contains HTML like `<img src=x onerror=…>` carries a title in the scene
- **THEN** the title's characters are drawn literally as text, nothing is parsed as markup, and no script runs

#### Scenario: An in-note link cannot replace the app

- **WHEN** the user activates an `https://` link inside an opened note
- **THEN** the app window is not navigated to the remote page (the link is denied or opened outside the app)

#### Scenario: A symlinked note escaping the vault is not readable

- **WHEN** a node resolves (after following symlinks) to a path outside `~/iris-second-brain` (e.g. a note symlinked to `~/.ssh/id_rsa`)
- **THEN** `secondbrain:read-note` refuses the read and returns no file contents
