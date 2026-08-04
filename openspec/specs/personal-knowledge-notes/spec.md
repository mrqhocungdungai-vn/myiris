## Purpose

Lets the user capture and retrieve personal notes by voice through the plain-Claude worker path, using the bundled LLM-Wiki skills to build an interlinked, plain-markdown second-brain vault at a fixed user-level location — independent of the pipeline and of whatever project folder happens to be active.

## Requirements

### Requirement: Personal notes are captured and retrieved in a second-brain vault
When the Claude CLI is present, Iris SHALL let the user capture and retrieve personal notes through the plain-Claude worker path using the bundled LLM-Wiki skills, storing them as plain-markdown pages (YAML frontmatter, `[[wikilinks]]`) that accumulate into an interlinked knowledge base. Capture and retrieval SHALL both operate on the same vault so a note written in one turn is findable in a later turn.

#### Scenario: Capturing a note by voice writes it to the vault

- **WHEN** the user asks Iris to note something down (e.g. "ghi chú lại: …")
- **THEN** the plain-Claude worker uses the LLM-Wiki skills to write a markdown note into the vault, and Iris confirms it was saved only after verifying a matching file exists under `~/iris-second-brain` (not merely because the worker's transcript claims success)

#### Scenario: A note that fails to land in the vault is reported as failed, not confirmed

- **WHEN** the append-system-prompt vault directive is not followed and no new/modified file appears under `~/iris-second-brain` after a capture attempt
- **THEN** Iris does not tell the user the note was saved to their second brain; it reports the capture as failed or unverified

#### Scenario: Retrieving a note returns earlier-captured content

- **WHEN** the user asks Iris to recall or search their notes (e.g. "tìm trong second-brain …")
- **THEN** the worker reads the vault and returns the matching note content with its source page, not a fabricated answer

#### Scenario: The vault is plain markdown the user can open and edit

- **WHEN** the user opens the vault folder in Obsidian (or any editor)
- **THEN** the notes are readable/editable plain-markdown files with no proprietary database or required external service

### Requirement: The notes vault is fixed at the user-level path, independent of the project folder
The notes vault SHALL be a user-owned Obsidian vault at `~/iris-second-brain`. Iris SHALL ensure this directory exists before a notes task runs, and SHALL pin the LLM-Wiki root to it for every plain-Claude run regardless of the workstream's active project folder (`cwd`), so notes never scatter into whatever project happens to be open. Iris SHALL achieve this without editing the vendored skill snapshots.

#### Scenario: Notes land in the vault even when a different project is active

- **WHEN** a workstream's active project folder is some code repository and the user captures a note
- **THEN** the note is written under `~/iris-second-brain`, not under the active project folder

#### Scenario: The vault is created on demand

- **WHEN** the user captures their first note and `~/iris-second-brain` does not yet exist
- **THEN** Iris creates the vault directory and the note is saved successfully

#### Scenario: A first-ever capture does not stall on an unanswerable setup question

- **WHEN** the user captures their very first note and no `wiki-config.md` exists yet under `~/iris-second-brain`
- **THEN** Iris has already pre-seeded `wiki-config.md` and `wiki-schema.md` before the run starts, so the plain-Claude worker's wiki skills find a valid config immediately and proceed to write the note, rather than ending the turn asking the user to run an interactive setup step it has no way to answer in a one-shot run

### Requirement: The notes capability follows the pipeline gate and is not a pipeline prerequisite
The notes capability SHALL be available exactly when the pipeline is — a working bundled runtime plus a configured credential — because it runs on the plain-Claude worker. Its skills ship in the app's bundled plugin rather than being installed on the machine, so the only failure mode left is a damaged bundle, not a missing install.

Its skills SHALL NOT be reported as pipeline prerequisites: a user who has the pipeline available but has not set up second-brain notes SHALL NOT see the LLM-Wiki skills counted among missing required prerequisites. Vault creation (`~/iris-second-brain` and its pre-seeded config) is independent of the skills being present — the vault MAY exist while the bundle is damaged — so Iris SHALL check the skills are actually resolvable, not just that the vault exists, before telling the user it can capture or retrieve a note.

#### Scenario: No credential means no notes worker

- **WHEN** the pipeline is unavailable because no Claude credential is configured
- **THEN** Iris has no notes worker and behaves as the unchanged chat-only companion, without claiming it can save notes

#### Scenario: Pipeline available but the notes skills cannot be resolved

- **WHEN** the user asks Iris to capture or retrieve a note, and `~/iris-second-brain` already exists (or was just created) but the LLM-Wiki skills cannot be resolved from the app bundle
- **THEN** the plain-Claude worker tells the user the notes capability is unavailable and the app bundle needs reinstalling, rather than attempting an ad-hoc, ungoverned note write in place of the real LLM-Wiki workflow

#### Scenario: Talk-only user is not flagged for a missing prerequisite

- **WHEN** the SetupPanel reports pipeline prerequisite status and the LLM-Wiki skills are not installed
- **THEN** they are not listed as a missing required prerequisite (they are absent from `REQUIRED_SKILLS`), so a Talk-mode user is never told to install them to fix the pipeline

#### Scenario: The notes capability's install state is still visible in the SetupPanel

- **WHEN** the user opens the SetupPanel's Claude section
- **THEN** a dedicated "Second-brain notes (LLM-Wiki skills)" row reports whether the skills resolve from the bundle, separately from — and without affecting — the PO/DEV pipeline's own rows; a damaged state points at reinstalling the app, since no user command can repair a bundle

### Requirement: The second brain is a verb Iris can call, not prose it must recite
Capturing to and querying the second brain SHALL be reachable through a named verb with its own parameter schema, scoped to the note-keeping skills.

It SHALL NOT be offered only as prose in the voice layer's system instruction directing it toward a general-purpose task tool. A capability that ships its own skills but contributes no callable function is not reachable on its own terms — it depends on the voice layer remembering to describe it correctly.

#### Scenario: Note work has its own function

- **WHEN** the voice layer's tool declarations are built and the worker is available
- **THEN** a declaration exists for second-brain work, with its own parameters

#### Scenario: The verb is scoped to note-keeping

- **WHEN** a second-brain run executes
- **THEN** it has the note-keeping skills available and does not have skills belonging to unrelated workflows

### Requirement: Every run's outcome is recorded, without costing a run
When a run reaches a terminal state, its outcome SHALL be appended to the second-brain vault: the verb, the request, the result, the cost, the error if any, and the tools it used. **Failures SHALL be recorded on the same terms as successes** — a failed attempt is at least as worth keeping as a successful one.

This capture SHALL be a direct file write. It SHALL NOT start a Claude run, SHALL NOT consume tokens, and SHALL NOT occupy the single execution slot — bookkeeping must never delay the user's next request, and knowledge must never be lost because the queue was busy.

Capture SHALL NOT depend on the voice layer choosing to record something. Accumulated knowledge that requires a model to remember to save it is knowledge that will be lost.

#### Scenario: A successful run is recorded

- **WHEN** a run completes successfully
- **THEN** its verb, request, result, cost, and tools used are appended to the vault

#### Scenario: A failed run is recorded

- **WHEN** a run fails, is cancelled, or terminates on a ceiling
- **THEN** its outcome and error are appended on the same terms as a success

#### Scenario: Capture never blocks the queue

- **WHEN** a run finalizes and its outcome is captured
- **THEN** no additional run is started, no tokens are spent, and the execution slot is not held

#### Scenario: Capture is not conditional on the voice layer

- **WHEN** a run finalizes without the voice layer taking any action
- **THEN** the outcome is still captured

### Requirement: Synthesis is deliberate, and offered rather than imposed
Turning captured records into structured knowledge — distilling and weaving them into the vault — SHALL happen when the second-brain verb is called, not automatically after each run.

Iris SHALL be able to notice that enough has accumulated to be worth synthesizing and offer it. It SHALL NOT run synthesis unprompted.

Raw capture is a log; synthesis is the learning. Separating them means the log is never lost to a busy queue, and the expensive step happens when there is enough material to justify it.

#### Scenario: Synthesis runs when asked

- **WHEN** the second-brain verb is called for synthesis
- **THEN** the accumulated records are read and woven into the vault

#### Scenario: Synthesis is offered, not imposed

- **WHEN** enough records have accumulated to be worth synthesizing
- **THEN** Iris offers to do it and waits, rather than starting it

#### Scenario: No synthesis run follows an ordinary run

- **WHEN** an ordinary run finalizes
- **THEN** no synthesis run is started as a consequence
