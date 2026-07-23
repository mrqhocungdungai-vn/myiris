## ADDED Requirements

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

### Requirement: The notes capability is gated on the Claude CLI and is not a pipeline prerequisite

The notes capability SHALL be available exactly when the Claude binary resolves — the same presence gate as the PO/DEV pipeline — because it runs on the plain-Claude worker. Its bundled skills SHALL NOT be reported as pipeline prerequisites: a user who has the Claude CLI but has not set up the PO/DEV pipeline SHALL NOT see the LLM-Wiki skills counted among missing required prerequisites. Vault creation (`~/iris-second-brain` and its pre-seeded config) and skill installation into `~/.claude/skills` are independent actions on independent schedules — the vault MAY exist before the skills are ever installed — so Iris SHALL check actual skill installation, not just vault presence, before telling the user it can capture or retrieve a note.

#### Scenario: No Claude means no notes worker

- **WHEN** the Claude CLI does not resolve on the machine
- **THEN** Iris has no notes worker and behaves as the unchanged chat-only companion, without claiming it can save notes

#### Scenario: Claude CLI present but the notes skills are not yet installed

- **WHEN** the user asks Iris to capture or retrieve a note, and `~/iris-second-brain` already exists (or was just created) but the 6 LLM-Wiki skills are not present under `~/.claude/skills`
- **THEN** the plain-Claude worker tells the user the notes capability needs to be installed first (pointing at the SetupPanel's "Install missing" action) rather than attempting an ad-hoc, ungoverned note write in place of the real LLM-Wiki workflow

#### Scenario: Talk-only user is not flagged for a missing prerequisite

- **WHEN** the SetupPanel reports pipeline prerequisite status and the LLM-Wiki skills are not installed
- **THEN** they are not listed as a missing required prerequisite (they are absent from `REQUIRED_SKILLS`), so a Talk-mode user is never told to install them to fix the pipeline

#### Scenario: The notes capability's install state is still visible in the SetupPanel

- **WHEN** the user opens the SetupPanel's Claude section
- **THEN** a dedicated "Second-brain notes (LLM-Wiki skills)" row shows whether the 6 LLM-Wiki skills are installed, separately from — and without affecting — the PO/DEV pipeline's own prerequisite rows; a missing state here also surfaces the "Install missing" action, which installs the notes skills through the same one-click installer as everything else
