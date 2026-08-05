## MODIFIED Requirements

### Requirement: Structural edits between existing notes are direct writes

Linking two existing notes to each other, removing such a link, and changing a note's tags SHALL be direct file writes on the same terms as capture: no Claude run, no tokens, no execution slot, and available without a Claude credential. A link SHALL be written in **both** directions, so connecting two notes produces a link the graph can traverse from either end rather than a one-way reference the other note has no record of.

These operations carry no judgement. Which two notes to connect is the user's decision, and inserting a `[[wikilink]]` into two files is a text transform — routing it through a worker would give an instant, deterministic edit a run's latency, cost, and credential requirement, exactly as capture suffered before it became a write.

Work that **does** carry judgement — merging two notes, splitting one, summarizing a set, deciding what a set is missing — SHALL remain worker work. Curation of that kind, over a focused set or over whatever has accumulated, SHALL be served by the existing notes verb; that verb already takes a parameter naming what to concentrate on, and SHALL NOT be duplicated by a second verb for the same kind of work.

What is **not** the same kind of work is a conversation about one note with the user in the loop — reading it back, then removing, adding, and rewriting parts of it across turns. That differs in **lifetime**, not in subject: it requires a resident session, because a follow-up naming a part of the note is only resolvable by whatever identified those parts and still remembers doing so, and a one-shot run re-derives that division on every turn. A verb for it is therefore not a duplicate of the curation verb, and the two SHALL be distinguished by lifetime and by whether the user is in the loop rather than by what they operate on. See `open-note-session`.

#### Scenario: Linking two notes is instant and free

- **WHEN** the user asks Iris to connect two existing notes
- **THEN** a `[[wikilink]]` is written into each note pointing at the other, with no Claude run started and no tokens spent

#### Scenario: A link is traversable from both ends

- **WHEN** two notes have just been linked
- **THEN** the vault graph shows the connection, and each note's own text records the other

#### Scenario: Structural edits work with no Claude credential

- **WHEN** no Claude credential is configured and the user asks to link two notes or retag one
- **THEN** the edit is applied and confirmed

#### Scenario: An already-present link is not duplicated

- **WHEN** the user asks to connect two notes that already link to each other
- **THEN** the notes are not given a second copy of the same link, and the operation reports success rather than an error

#### Scenario: Judgement work still goes to the verb

- **WHEN** the user asks Iris to merge two notes, or what a set of notes is missing
- **THEN** that is handled by the notes verb as a run, not by a direct write

#### Scenario: No second curation verb is introduced

- **WHEN** the verb registry is inspected
- **THEN** curation over a focused set is served by the existing notes verb rather than by an additional verb declared for it

#### Scenario: A resident note-working session is not a duplicate curation verb

- **WHEN** the verb registry is inspected and it declares both a stateless curation verb and a stateful verb for working on one open note
- **THEN** that is not a duplication: the two differ in lifetime and in whether the user is in the loop, and the curation verb remains the only route for weaving accumulated material into pages
