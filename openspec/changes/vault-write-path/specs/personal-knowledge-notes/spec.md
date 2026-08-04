## ADDED Requirements

### Requirement: The vault's machine-written spool is not user notes

Iris SHALL write vault content it generates on its own initiative — captures awaiting curation, and the per-run outcome records — into a dedicated spool area of the vault, distinct from curated note pages. That spool area SHALL NOT be treated as a user note by anything that enumerates the vault's notes.

Iris appends to the spool without being asked, once per finished run and once per capture. Anything that counts, renders, or reasons over "the user's notes" must therefore exclude it, or Iris's own bookkeeping accumulates as apparent knowledge — one entry per day of use, forever, growing without bound and without the user ever having written it.

The spool SHALL remain plain markdown inside the vault (not a database and not a hidden location), so the user can read and prune it with any editor, and so the curator reaches it through the same granted directory it already has.

#### Scenario: Spooled records are not counted as user notes

- **WHEN** the vault contains spooled capture and run-outcome files alongside curated pages
- **THEN** anything enumerating the vault's user notes returns only the curated pages, and no spool file is presented as a note

#### Scenario: A curated page is a user note

- **WHEN** the curator turns spooled material into a page in the vault proper
- **THEN** that page is a user note and is enumerated as one

#### Scenario: An existing vault needs no migration

- **WHEN** a vault already contains spool files that were previously being counted as user notes
- **THEN** they simply stop being counted, with no migration step and no data moved or deleted

#### Scenario: The spool is readable and prunable by hand

- **WHEN** the user opens the vault in an editor
- **THEN** the spool is plain markdown they can read, edit, and delete, like any other file in the vault

## MODIFIED Requirements

### Requirement: Personal notes are captured and retrieved in a second-brain vault

Iris SHALL let the user capture and retrieve personal notes in a vault of plain-markdown pages (YAML frontmatter, `[[wikilinks]]`) that accumulate into an interlinked knowledge base. Capture and retrieval SHALL both operate on the same vault, so a note captured in one turn is findable in a later turn.

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

### Requirement: The notes capability follows the pipeline gate and is not a pipeline prerequisite

The parts of this capability that need a worker SHALL follow the pipeline gate; the part that does not SHALL NOT.

**Capture SHALL be available whenever the vault is**, independent of whether a Claude credential is configured or the bundled runtime resolves — it is a local file write, and gating it on a worker it does not use made the second brain nonexistent for a chat-only user. **Retrieval and curation SHALL be available exactly when the pipeline is** — a working bundled runtime plus a configured credential — because they run on the worker. Their skills ship in the app's bundled plugin rather than being installed on the machine, so the only failure mode left there is a damaged bundle, not a missing install.

Its skills SHALL NOT be reported as pipeline prerequisites: a user who has the pipeline available but has not set up second-brain notes SHALL NOT see the LLM-Wiki skills counted among missing required prerequisites. Vault creation (`~/iris-second-brain` and its pre-seeded config) is independent of the skills being present — the vault MAY exist while the bundle is damaged — so Iris SHALL check the skills are actually resolvable, not just that the vault exists, before telling the user it can retrieve from or curate a note.

#### Scenario: Capture works with no Claude credential

- **WHEN** no Claude credential is configured and the user asks Iris to note something down
- **THEN** the note is captured to the vault and confirmed — the chat-only companion can still save to the second brain

#### Scenario: No credential means no retrieval or curation

- **WHEN** the pipeline is unavailable because no Claude credential is configured, and the user asks Iris what their notes say about something
- **THEN** Iris has no notes worker and says so, without claiming it searched the vault and without fabricating an answer

#### Scenario: Pipeline available but the notes skills cannot be resolved

- **WHEN** the user asks Iris to retrieve from or curate their notes, and `~/iris-second-brain` already exists (or was just created) but the LLM-Wiki skills cannot be resolved from the app bundle
- **THEN** the worker tells the user that part of the notes capability is unavailable and the app bundle needs reinstalling, rather than attempting an ad-hoc, ungoverned substitute for the real LLM-Wiki workflow

#### Scenario: A damaged bundle does not disable capture

- **WHEN** the LLM-Wiki skills cannot be resolved from the bundle and the user asks Iris to note something down
- **THEN** the capture still lands in the vault, because capture does not use those skills

#### Scenario: Talk-only user is not flagged for a missing prerequisite

- **WHEN** the SetupPanel reports pipeline prerequisite status and the LLM-Wiki skills are not installed
- **THEN** they are not listed as a missing required prerequisite (they are absent from `REQUIRED_SKILLS`), so a Talk-mode user is never told to install them to fix the pipeline

#### Scenario: The notes capability's install state is still visible in the SetupPanel

- **WHEN** the user opens the SetupPanel's Claude section
- **THEN** a dedicated "Second-brain notes (LLM-Wiki skills)" row reports whether the skills resolve from the bundle, separately from — and without affecting — the pipeline's own rows; a damaged state points at reinstalling the app, since no user command can repair a bundle

### Requirement: The second brain is a verb Iris can call, not prose it must recite

Working with the second brain SHALL be reachable through named functions with their own parameter schemas, one per kind of work: **capture** through a function that writes directly and returns once the write has settled, and **curation and retrieval** through a verb scoped to the note-keeping skills.

Capture's function SHALL NOT be a verb dispatched to the worker. Modelling an instant local write as a run made it inherit a run's latency, cost, credential requirement, and queueing, none of which a file append has.

Neither SHALL be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. A capability that ships its own skills but contributes no callable function is not reachable on its own terms — it depends on the voice layer remembering to describe it correctly.

#### Scenario: Capture has its own function

- **WHEN** the voice layer's tool declarations are built and the vault is available
- **THEN** a declaration exists for capturing a note, with its own parameters, and calling it writes the note rather than starting a run

#### Scenario: Curation has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for curation and retrieval of the second brain, with its own parameters

#### Scenario: The verb is scoped to note-keeping

- **WHEN** a second-brain run executes
- **THEN** it has the note-keeping skills available and does not have skills belonging to unrelated workflows
