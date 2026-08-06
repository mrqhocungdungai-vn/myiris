## ADDED Requirements

### Requirement: The node being pointed at reveals its link cluster

The galaxy SHALL render a **pointed-at** node distinctly and SHALL light up the links incident to it, so that what a note is connected to is answerable by pointing at it. The pointed-at node together with its one-hop neighbours SHALL be drawn at full strength.

**The lit links SHALL be unmistakably prominent** — the point of the requirement is that a cluster reads at a glance, so the difference between a lit link and a resting one SHALL NOT be a subtle shift in an already-faint line. Any graph-wide opacity or intensity ceiling the renderer applies SHALL be accounted for, so that raising a link's own intensity actually reaches the view rather than being scaled back down by a global factor. Making lit links prominent SHALL NOT brighten the resting links: at rest the graph SHALL look exactly as it did before this requirement existed.

The one-hop neighbourhood used here SHALL be the same one the focus declutter uses, so the highlight and the dimming can never disagree about what one hop means.

Full strength SHALL apply **even while the focus declutter has dimmed those nodes**: pointing at a dimmed node SHALL reveal what it connects to without the user having to change the focus first. The dimming itself SHALL NOT be lifted from the rest of the graph — only the pointed-at node and its immediate neighbours are exempted while they are pointed at.

**The highlight SHALL be transient and SHALL change no state.** It SHALL NOT select anything, SHALL NOT alter the focus, SHALL NOT move the camera, and SHALL NOT open a note. Ceasing to point SHALL restore exactly the previous rendering, including whatever dimming a live focus was applying. Nothing SHALL accumulate: at most one node is pointed at at any moment, and moving on leaves nothing behind.

A node SHALL be pointed at only by an input that **means** to point at it, with no difference in what is drawn between them:

- the **mouse hovering** it;
- when hand control is on, the **inspect pose** held near it (see `second-brain-gesture-nav`, "A held two-finger pose reveals a node's link cluster");
- the node a **`Pointing_Up` dwell is charging against**, since that dwell is already deliberate and already gives the node visible feedback.

A hand that is merely present in frame in some other pose SHALL NOT point at anything. When more than one input could apply, the hand SHALL win, so the highlight follows whichever input the user is actually using rather than flickering between them.

A **ghost node** (an unresolved `[[wikilink]]` target) SHALL NOT be pointed at by any producer. They are held to the same eligibility deliberately: the hand's target resolution already excludes ghosts because a ghost is not openable, and a highlight that appeared under the mouse but never under the hand would make the same node behave differently depending on the input device.

Repainting for a highlight change SHALL be coalesced so that sweeping a pointer across a dense region cannot force one full-graph repaint per node crossed.

#### Scenario: Pointing at a node lights its links

- **WHEN** the user points at a real note-node — by mouse hover, or by the inspect pose with hand control on
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
- **THEN** the focus is unchanged, no note opens, the camera does not move, and nothing the voice layer or a run reads has changed

#### Scenario: Nothing accumulates across nodes

- **WHEN** the user points at one node after another
- **THEN** exactly one cluster is lit at a time and each previous one returns to normal — no growing set of lit nodes builds up

#### Scenario: Pointing at a dimmed node reveals its cluster

- **WHEN** a focus is active, everything outside its one-hop neighbourhood is dimmed, and the user points at one of those dimmed nodes
- **THEN** that node and its own one-hop neighbours are drawn at full strength while it is pointed at, the rest of the graph stays dimmed, and the focus is not changed

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
