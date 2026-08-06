## MODIFIED Requirements

### Requirement: A structural edit targets a note by identity, never by a supplied path

An operation that edits the vault SHALL name its target by the note identity the vault graph already assigns, and Iris SHALL resolve that identity to a file itself. It SHALL NOT accept a filesystem path from the renderer or from a model, and it SHALL re-assert — after resolving symlinks — that the file is inside the vault before writing, on exactly the terms reading a note already requires.

The read side of the vault is already guarded this way because note content may originate from the web. A write is the stronger capability of the two, so it SHALL NOT be guarded more weakly than the read it mirrors.

The write surface SHALL be bounded **by caller**, and the two callers SHALL be bounded differently because they are not the same risk:

- **Model-facing writes SHALL remain an enumerated set** of named structural operations, and SHALL NOT include a general "apply this content to this note" primitive. A general primitive on this surface would make every future caller — including a model acting on web-derived content — able to write arbitrary bytes anywhere the vault reaches, which is not a bound that can be audited.
- **A user-authored content write SHALL be permitted**, for the single purpose of letting the vault's owner edit their own note by hand in Iris. It SHALL be reachable only from the note reader's editing surface; it SHALL carry the identical identity resolution, symlink resolution and in-vault containment guard as every other write; and it SHALL NOT be exposed as a tool, a verb, an MCP surface, or through any other route a model can call.

The distinction is the caller, not the shape of the operation. The bytes of a user-authored write are composed by the person who owns the vault, in a field they opened, replacing content they are looking at. The bound that matters — that a model cannot write arbitrary bytes into the vault — is unaffected by that write existing.

#### Scenario: A supplied path is refused

- **WHEN** an edit request names a filesystem path rather than a note identity
- **THEN** no file is written

#### Scenario: A note symlinked outside the vault is not writable

- **WHEN** an edit targets a note whose file, after following symlinks, resolves outside the vault directory
- **THEN** the write is refused and the file is not modified

#### Scenario: An unknown identity is reported, not guessed

- **WHEN** an edit targets a note identity the graph does not know, or a ghost node with no backing file
- **THEN** the operation reports that the target was not found and writes nothing

#### Scenario: The model-facing surface has only enumerated operations

- **WHEN** the write surface reachable by a model — its tools, verbs, and any other model-callable route — is inspected
- **THEN** it exposes a fixed set of named structural operations and no general arbitrary-content write

#### Scenario: A user-authored write is not reachable by a model

- **WHEN** the surfaces available to a model are inspected
- **THEN** the user-authored content write is absent from all of them — it is reachable only from the note reader's editing surface

#### Scenario: A user-authored write is guarded like every other write

- **WHEN** the user saves an edit to a note whose file, after following symlinks, resolves outside the vault, or whose identity the graph does not know
- **THEN** the write is refused on exactly the same terms as a structural edit, and no file is modified
