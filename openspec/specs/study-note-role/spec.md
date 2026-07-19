## Purpose

A dedicated Study role for Iris that acts as a second-brain librarian and fact-checker during learning sessions, while Gemini remains the teaching/orchestration voice layer.

## Requirements

### Requirement: Study is a third selectable pipeline role

The app SHALL register a third pipeline role `study` (label "Study") in the agent roster, selectable per workstream exactly like PO and DEV. Selecting Study sets the workstream's active role to `study`; the plain (role-less) Claude chat path SHALL be unchanged. A Study run SHALL run as the installed `iris-study` agent.

#### Scenario: User switches a workstream into Study mode

- **WHEN** the user selects the Study role for a workstream
- **THEN** the workstream's active role becomes `study`, the selection persists, and subsequent delegated work in that workstream is dispatched to the Study worker

#### Scenario: Plain chat is unaffected by the new role

- **WHEN** a workstream has no pipeline role selected (`null`)
- **THEN** voice chat behaves exactly as before this change, with no Study behavior engaged

### Requirement: Division of labor — Gemini orchestrates, Study is librarian and fact-checker

In Study mode the Gemini voice layer SHALL remain the primary voice: it captures the user's spoken synthesis, acts as note-taking assistant, composes the task, and dispatches it. The Study worker SHALL act ONLY as the second-brain librarian and fact-checker; it SHALL NOT teach, explain, or answer study questions itself, and SHALL NOT write code.

#### Scenario: Study worker declines to teach

- **WHEN** a Study task asks the worker to explain a concept rather than to record or verify a note
- **THEN** the worker does not deliver a lesson; teaching stays on the Gemini voice path

#### Scenario: Study worker never free-codes

- **WHEN** a Study task is dispatched in a workstream with a code project as `cwd`
- **THEN** the worker performs only second-brain / verification operations and does not modify project code

### Requirement: Study runs as a stateful, isolated Agent SDK session

The Study worker SHALL run as a persistent `@anthropic-ai/claude-agent-sdk` session kept alive across turns (single continuous context of the study sitting), implemented in a module (`electron/study-session.mjs`) separate from the PO module. Each SDK-role module SHALL key its resident sessions such that a PO session and a Study session can be simultaneously resident in the same workstream without collision.

#### Scenario: Study session persists across turns

- **WHEN** a second Study task is dispatched in a workstream that already has a live Study session
- **THEN** the task is delivered as a new turn into the existing session, preserving prior context, rather than starting a fresh session

#### Scenario: PO and Study sessions coexist in one workstream

- **WHEN** a workstream has held both a PO turn and a Study turn
- **THEN** each role's resident session is addressed independently and neither overwrites the other's stored session id

### Requirement: Write-note task records synthesized notes into the second brain

On a task whose intent is to record a note, and only when the user has explicitly asked to save, the Study worker SHALL create a note in the `open-second-brain` vault following the plugin's own conventions: it SHALL search the vault first to avoid duplicates and to find notes to link, and the created note SHALL carry a title, a citation of the source, a summary of the user's synthesis, and links to related notes. The worker SHALL report a concise confirmation for Iris to read aloud.

#### Scenario: Explicit save request writes a linked note

- **WHEN** the user finishes synthesizing a source aloud and asks Iris to save the note, and Gemini dispatches a write-note Study task
- **THEN** the worker searches the vault, creates a structured note citing the source and linking related notes, and returns a confirmation of what was saved

#### Scenario: No note is written without an explicit request

- **WHEN** a Study turn occurs but the user has not asked to save anything
- **THEN** the worker does not create a note

### Requirement: Verify task fact-checks a note against source and web

On a task whose intent is to verify, the Study worker SHALL check the note's claims against the original source when a URL or text is provided in the task, and additionally against web sources via `WebSearch`/`WebFetch`, and SHALL report which claims are supported, which are uncertain, and which appear incorrect. When no source is provided and web coverage is insufficient, the worker SHALL report the claims as unverified rather than asserting correctness.

#### Scenario: Claims checked against a provided source and the web

- **WHEN** a verify Study task includes the source URL of a note and asks whether the note is factually correct
- **THEN** the worker checks the note's claims against that source and web sources and reports supported / uncertain / incorrect claims

#### Scenario: Insufficient evidence is reported honestly

- **WHEN** a verify task provides no source and web search yields insufficient coverage for a claim
- **THEN** the worker reports that claim as unverified rather than confirming it

### Requirement: Study is exempt from OpenSpec and works in the workstream cwd

A Study run SHALL NOT trigger OpenSpec project scaffolding (`openspec init`) and SHALL NOT be gated on an open OpenSpec change. It SHALL execute in the workstream `cwd` so it can read the material being studied, while note writes target the second-brain vault resolved by the plugin independently of `cwd`.

#### Scenario: Study run skips scaffold and gate

- **WHEN** a Study task runs in a workstream whose `cwd` has no `openspec/` directory
- **THEN** no `openspec init` is performed, the run is not blocked for lack of an open change, and the task proceeds

#### Scenario: Study reads cwd material but writes to the vault

- **WHEN** a Study task references a file in the workstream `cwd` while recording a note
- **THEN** the worker may read that file for context, and the note is created in the second-brain vault, not in the `cwd`

### Requirement: Study may ask mid-turn and receives its model like PO

The Study worker SHALL be permitted to pause a turn via `AskUserQuestion` and receive a voice answer, and its resolved model SHALL be applied to its live session the same way PO's is (passed at session creation and applied via `setModel()` on an existing live session, without closing or resuming it).

#### Scenario: Study asks a clarifying question by voice

- **WHEN** the Study worker reaches a genuine decision point (e.g. which topic to file a note under) during a turn
- **THEN** it may call `AskUserQuestion`, the turn pauses, and a voice answer resumes the same turn

#### Scenario: Study model change preserves the live session

- **WHEN** the Study model is changed while a Study session is live with prior turns
- **THEN** the change is applied via `setModel()` and the next turn runs on the new model with context preserved

### Requirement: Study session state is stored and cleaned up

The app SHALL store and resume the Study role's Claude session under `agent_sessions.study`, and SHALL close any resident Study session whenever it closes a resident PO session — on workstream switch, workstream selection, `cwd` change, session reset, and app quit — so a Study session is never orphaned.

#### Scenario: Study session resumes across app restarts

- **WHEN** a workstream with a stored `agent_sessions.study` id starts a new Study turn after an app restart
- **THEN** the session resumes from the stored id, preserving prior study context

#### Scenario: Switching workstreams closes the Study session

- **WHEN** the user switches away from a workstream that has a live Study session
- **THEN** the Study session is closed with no orphaned subprocess, mirroring PO session teardown
