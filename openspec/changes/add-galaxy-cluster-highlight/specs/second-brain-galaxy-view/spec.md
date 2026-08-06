## ADDED Requirements

### Requirement: The node being pointed at reveals its link cluster

The galaxy SHALL render a **pointed-at** node distinctly and SHALL light up the links incident to it, so that what a note is connected to is answerable by pointing at it. The links touching the pointed-at node SHALL be drawn prominently against the faint base link colour, and the pointed-at node together with its one-hop neighbours SHALL be drawn at full strength.

The one-hop neighbourhood used here SHALL be the same one the focus declutter uses, so the highlight and the dimming can never disagree about what one hop means.

Full strength SHALL apply **even while the focus declutter has dimmed those nodes**: pointing at a dimmed node SHALL reveal what it connects to without the user having to change the focus first. The dimming itself SHALL NOT be lifted from the rest of the graph — only the pointed-at node and its immediate neighbours are exempted while they are pointed at.

**The highlight SHALL be transient and SHALL change no state.** It SHALL NOT select anything, SHALL NOT alter the focus, SHALL NOT move the camera, and SHALL NOT open a note. Ceasing to point SHALL restore exactly the previous rendering, including whatever dimming a live focus was applying.

A node SHALL be pointed at by either of two producers, with no difference in what is drawn: the **mouse hovering** it, or — when hand control is on — the **hand targeting** it (the same target resolution the dwell already uses, so the same node the dwell would act on is the node whose cluster is shown). When both could apply, the hand's target SHALL win, so the highlight follows whichever input the user is actually using rather than flickering between them.

A **ghost node** (an unresolved `[[wikilink]]` target) SHALL NOT be pointed at by either producer. The two producers are held to the same eligibility deliberately: the hand's target resolution already excludes ghosts because a ghost is not openable, and a highlight that appeared under the mouse but never under the hand would make the same node behave differently depending on the input device.

Repainting for a highlight change SHALL be coalesced so that sweeping a pointer across a dense region cannot force one full-graph repaint per node crossed.

#### Scenario: Pointing at a node lights its links

- **WHEN** the user points at a real note-node — by mouse hover, or by hand with hand control on
- **THEN** the links incident to that node are drawn prominently, and that node and its one-hop neighbours are drawn at full strength

#### Scenario: Ceasing to point restores the view

- **WHEN** the user stops pointing at the node (moves the mouse off it, or moves the hand away)
- **THEN** the links and nodes return to exactly how they were drawn before, including any dimming a live focus was applying

#### Scenario: The highlight selects nothing

- **WHEN** a node's cluster is highlighted by pointing
- **THEN** the focus is unchanged, no note opens, the camera does not move, and nothing the voice layer or a run reads has changed

#### Scenario: Pointing at a dimmed node reveals its cluster

- **WHEN** a focus is active, everything outside its one-hop neighbourhood is dimmed, and the user points at one of those dimmed nodes
- **THEN** that node and its own one-hop neighbours are drawn at full strength while it is pointed at, the rest of the graph stays dimmed, and the focus is not changed

#### Scenario: Both inputs draw the same thing

- **WHEN** the same node is pointed at by mouse hover on one occasion and by hand target on another
- **THEN** the rendering is identical in both cases

#### Scenario: The hand's target wins over the mouse

- **WHEN** hand control is on, the hand is targeting one node, and the mouse pointer happens to rest over a different node
- **THEN** the hand's target is the node whose cluster is highlighted

#### Scenario: A ghost node is not pointed at

- **WHEN** the user hovers or points at a faded ghost node
- **THEN** no cluster highlight is drawn for it, matching the hand target's existing exclusion of ghosts

#### Scenario: Sweeping across a dense region does not repaint per node

- **WHEN** the pointer moves rapidly across many nodes in a dense cluster
- **THEN** highlight repaints are coalesced rather than one full-graph repaint being performed for every node crossed
