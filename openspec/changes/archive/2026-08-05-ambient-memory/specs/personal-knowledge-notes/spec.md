## MODIFIED Requirements

### Requirement: The vault's machine-written spool is not user notes

Iris SHALL write vault content it generates on its own initiative — captures awaiting curation, the per-run outcome records, and (when ambient session capture is enabled) the retained conversation text — into a dedicated spool area of the vault, distinct from curated note pages. That spool area SHALL NOT be treated as a user note by anything that enumerates the vault's notes.

Iris appends to the spool without being asked, once per finished run, once per capture, and repeatedly through a conversation while ambient capture is on. Anything that counts, renders, or reasons over "the user's notes" must therefore exclude it, or Iris's own bookkeeping accumulates as apparent knowledge — one entry per day of use, forever, growing without bound and without the user ever having written it. Ambient capture makes this sharper rather than adding a new problem: it is the highest-volume writer of the three, and the exclusion is what keeps its volume free of consequence for the graph.

Each kind of spooled content SHALL be distinguishable from the others, so the curator can weave a deliberate capture and a passively-retained conversation on different terms rather than treating a room transcript as if the user had chosen to record it.

The spool SHALL remain plain markdown inside the vault (not a database and not a hidden location), so the user can read and prune it with any editor, and so the curator reaches it through the same granted directory it already has.

#### Scenario: Spooled records are not counted as user notes

- **WHEN** the vault contains spooled capture, run-outcome, and session files alongside curated pages
- **THEN** anything enumerating the vault's user notes returns only the curated pages, and no spool file is presented as a note

#### Scenario: Session volume does not reach the graph

- **WHEN** ambient capture has been running across many long conversations
- **THEN** no node appears for any of it, and the galaxy is unchanged by the volume

#### Scenario: The kinds of spooled content are distinguishable

- **WHEN** the curator reads the spool
- **THEN** it can tell a deliberate capture from a run-outcome record from a passively-retained conversation

#### Scenario: A curated page is a user note

- **WHEN** the curator turns spooled material into a page in the vault proper
- **THEN** that page is a user note and is enumerated as one

#### Scenario: An existing vault needs no migration

- **WHEN** a vault already contains spool files that were previously being counted as user notes
- **THEN** they simply stop being counted, with no migration step and no data moved or deleted

#### Scenario: The spool is readable and prunable by hand

- **WHEN** the user opens the vault in an editor
- **THEN** the spool is plain markdown they can read, edit, and delete, like any other file in the vault

### Requirement: Synthesis is deliberate, and offered rather than imposed

Turning captured records into structured knowledge — distilling and weaving them into the vault — SHALL happen when the second-brain verb is called, not automatically after each run and not automatically because a conversation ended.

Iris SHALL be able to notice that enough has accumulated across **all** of the spool — deliberate captures, run-outcome records, and retained conversation alike — to be worth synthesizing, and offer it. It SHALL NOT run synthesis unprompted.

Raw capture is a log; synthesis is the learning. Separating them means the log is never lost to a busy queue, and the expensive step happens when there is enough material to justify it. Ambient capture raises the stakes of that separation rather than changing it: a conversation ending is exactly the moment an automatic synthesis would feel natural and would be wrong, because it would spend the user's money and rewrite their vault on the strength of them having stopped talking.

#### Scenario: Synthesis runs when asked

- **WHEN** the second-brain verb is called for synthesis
- **THEN** the accumulated records across every kind of spooled content are read and woven into the vault

#### Scenario: Synthesis is offered, not imposed

- **WHEN** enough records have accumulated to be worth synthesizing
- **THEN** Iris offers to do it and waits, rather than starting it

#### Scenario: The offer accounts for retained conversation

- **WHEN** ambient capture has accumulated conversation but few runs have finished
- **THEN** the backlog Iris measures reflects that material, so the offer is made on what is actually waiting

#### Scenario: No synthesis run follows an ordinary run

- **WHEN** an ordinary run finalizes
- **THEN** no synthesis run is started as a consequence

#### Scenario: No synthesis run follows a conversation ending

- **WHEN** a conversation ends with retained material waiting and the user says nothing about their notes
- **THEN** no synthesis run is started
