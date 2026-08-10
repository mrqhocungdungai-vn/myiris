## MODIFIED Requirements

### Requirement: Personal notes are captured and retrieved in a second-brain vault
Iris SHALL let the user capture and retrieve personal notes in a vault of plain-markdown pages (YAML frontmatter, `[[wikilinks]]`) that accumulate into an interlinked knowledge base. Capture and retrieval SHALL both operate on the same vault, so a note captured in one turn is findable in a later turn.

**A capture SHALL be a note, not a queue entry.** When the user asks for something to be written down, the write SHALL produce a real note in the vault — a plain markdown file with frontmatter, of the same shape as every other note, openable, searchable, and present in the galaxy at once. It SHALL NOT be appended to a spool awaiting a later curation run, and Iris SHALL NOT report it as saved to the user's notes unless a note exists.

The spool is for material the user did NOT ask to keep — ambient session capture and finished-run records — which are raw and worth batching because curating them is expensive. An explicit instruction to write something down IS that decision already made, so deferring it answers a question nobody asked.

A capture given no title SHALL be titled from its first line: a spoken thought is a sentence, not a heading, and in a vault whose filenames are its titles an untitled note cannot be found again. A title SHALL NOT overwrite an existing note — two captures that open the same way are two things the user said. A title SHALL keep every character a filesystem can carry, diacritics included, because the filename is the title the user reads.

**Capture SHALL be a direct file write, not a worker run.** It SHALL NOT start a Claude run, SHALL NOT consume tokens, and SHALL NOT occupy the execution slot — the same terms the run-outcome record already holds. Appending markdown to a file needs no model; routing it through one made the cheapest operation in this capability the slowest, the only one that could fail for reasons unrelated to the filesystem, and the only one that a user without a Claude credential could not perform at all.

Because the write is direct, Iris SHALL confirm a capture only after the write has succeeded, and SHALL report a capture whose write failed as failed rather than saved. This rule previously existed to defend against a worker that reported success without writing; it now holds by construction, and the worker is no longer in the path.

Retrieval — reading the vault to answer a question — and curation — turning spooled captures into linked pages — SHALL remain worker work using the bundled LLM-Wiki skills. Reading and synthesizing across a vault is judgement, which is what those skills are for; a filesystem append is not.

#### Scenario: Capturing a note by voice writes it to the vault immediately

- **WHEN** the user asks Iris to note something down (e.g. "ghi chú lại: …")
- **THEN** the text is written into the vault directly and Iris confirms it, with no Claude run started, no tokens spent, and no execution slot occupied

#### Scenario: A capture whose write fails is reported as failed, not confirmed

- **WHEN** a capture cannot be written (e.g. the vault path is not writable)
- **THEN** Iris does not tell the user it was saved to their second brain; it reports the capture as failed

#### Scenario: Capture does not wait on the run queue

- **WHEN** a long run is already occupying the single execution slot and the user captures a note
- **THEN** the capture lands immediately rather than queueing behind that run

#### Scenario: Retrieving a note returns earlier-captured content

- **WHEN** the user asks Iris to recall or search their notes (e.g. "tìm trong second-brain …")
- **THEN** the worker reads the vault and returns the matching note content with its source page, not a fabricated answer

#### Scenario: The vault is plain markdown the user can open and edit

- **WHEN** the user opens the vault folder in Obsidian (or any editor)
- **THEN** the notes are readable/editable plain-markdown files with no proprietary database or required external service

#### Scenario: Writing a note down produces a note

- **WHEN** the user says to write something into their second brain
- **THEN** a note exists in the vault immediately, and Iris names the title it used

#### Scenario: Two captures opening the same way

- **WHEN** the user captures two different thoughts under the same title
- **THEN** both notes exist, and neither has replaced the other

#### Scenario: A title in the user's own language

- **WHEN** the user gives a title carrying diacritics
- **THEN** the note is filed under that title unchanged
