## ADDED Requirements

### Requirement: Structural edits between existing notes are direct writes

Linking two existing notes to each other, removing such a link, and changing a note's tags SHALL be direct file writes on the same terms as capture: no Claude run, no tokens, no execution slot, and available without a Claude credential. A link SHALL be written in **both** directions, so connecting two notes produces a link the graph can traverse from either end rather than a one-way reference the other note has no record of.

These operations carry no judgement. Which two notes to connect is the user's decision, and inserting a `[[wikilink]]` into two files is a text transform — routing it through a worker would give an instant, deterministic edit a run's latency, cost, and credential requirement, exactly as capture suffered before it became a write.

Work that **does** carry judgement — merging two notes, splitting one, summarizing a set, deciding what a set is missing — SHALL remain worker work through the existing notes verb. That verb already takes a parameter naming what to concentrate on; it SHALL NOT be duplicated by a second verb for the same kind of work.

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

#### Scenario: No second notes verb is introduced

- **WHEN** the verb registry is inspected
- **THEN** curation over a focused set is served by the existing notes verb rather than by an additional verb declared for it

### Requirement: A structural edit targets a note by identity, never by a supplied path

An operation that edits the vault SHALL name its target by the note identity the vault graph already assigns, and Iris SHALL resolve that identity to a file itself. It SHALL NOT accept a filesystem path from the renderer or from a model, and it SHALL re-assert — after resolving symlinks — that the file is inside the vault before writing, on exactly the terms reading a note already requires.

The read side of the vault is already guarded this way because note content may originate from the web. A write is the stronger capability of the two, so it SHALL NOT be guarded more weakly than the read it mirrors.

The operations Iris will perform SHALL be an enumerated set. A general "apply this content to this note" primitive would make every future caller — including a model — able to write arbitrary bytes anywhere the vault reaches, which is not a bound that can be audited.

#### Scenario: A supplied path is refused

- **WHEN** an edit request names a filesystem path rather than a note identity
- **THEN** no file is written

#### Scenario: A note symlinked outside the vault is not writable

- **WHEN** an edit targets a note whose file, after following symlinks, resolves outside the vault directory
- **THEN** the write is refused and the file is not modified

#### Scenario: An unknown identity is reported, not guessed

- **WHEN** an edit targets a note identity the graph does not know, or a ghost node with no backing file
- **THEN** the operation reports that the target was not found and writes nothing

#### Scenario: Only enumerated operations exist

- **WHEN** the vault write surface is inspected
- **THEN** it exposes a fixed set of named structural operations and no general arbitrary-content write
