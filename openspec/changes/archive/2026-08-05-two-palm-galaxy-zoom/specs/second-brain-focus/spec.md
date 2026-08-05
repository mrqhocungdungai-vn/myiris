## MODIFIED Requirements

### Requirement: One authoritative focus is shared by the hand, the voice, and the runs

Iris SHALL maintain a single authoritative **focus** — the set of vault notes the user currently has selected — owned by the main process. The renderer SHALL produce it; the voice layer and Claude's runs SHALL consume it. There SHALL NOT be a second, separately-maintained notion of what is selected.

The renderer's means of producing it is currently the mouse alone. No gesture selects a note (see `second-brain-gesture-nav`, "Focus is reachable without hands", for why that is a decision rather than a gap). This is a statement about the producer, not about the focus: the ownership, the resolution rules, the bound and the lifecycle below are unchanged by how a selection is made, and a gesture producer added later SHALL feed this same focus rather than introduce a second one.

The focus SHALL be stored as note **identities only**, and resolved to titles and tags at the moment of use against the live vault graph. It SHALL NOT store a snapshot of note metadata: a title captured at selection time goes stale the moment the note is renamed or deleted, and a selection that names a note which no longer exists SHALL resolve to nothing rather than to a phantom.

The focus SHALL survive the galaxy layer remounting, and SHALL be readable whether or not the galaxy is currently mounted, so a mutation or a run that lands slightly after a re-render still acts on what the user selected.

#### Scenario: One focus, many readers

- **WHEN** the user selects two notes and both the voice layer's context and a run's prompt are then built
- **THEN** both describe the same two notes, resolved from the same single focus

#### Scenario: A renamed note resolves to its current title

- **WHEN** a selected note is renamed on disk and the focus is then read
- **THEN** it resolves to the note's current title, not the title it had when selected

#### Scenario: A deleted note drops out of the focus

- **WHEN** a selected note is deleted from the vault and the focus is then read
- **THEN** that note is absent from the resolved focus, and the remaining selections are unaffected

#### Scenario: The focus survives a remount

- **WHEN** the galaxy layer remounts (for example after a re-render) while notes are selected
- **THEN** the selection is still in effect and is not silently emptied

#### Scenario: Selection is produced by the mouse

- **WHEN** the user selects notes in the galaxy
- **THEN** the selection is made with the mouse, and the resulting focus is the same single focus every consumer reads
