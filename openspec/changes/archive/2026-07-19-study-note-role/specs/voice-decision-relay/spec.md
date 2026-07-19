## MODIFIED Requirements

### Requirement: SDK-role questions pause the turn and surface to voice

When a live SDK-role session (PO or STUDY) calls `AskUserQuestion`, the session SHALL pause that turn and the app SHALL surface the request to the Gemini voice layer as a structured event containing the question text, any offered options, and which role is asking. These sessions run in `bypassPermissions` mode, so tool-use approvals are auto-allowed and do NOT pause the turn — only `AskUserQuestion` does.

#### Scenario: A live role asks a structured question mid-turn

- **WHEN** the PO or STUDY session calls `AskUserQuestion` during a turn
- **THEN** the SDK `canUseTool` callback fires, the turn is paused, and the app emits a structured question event (question + options + asking role) to the voice layer
- **AND** no new Claude process is spawned to convey the question

#### Scenario: Question is read aloud to the user

- **WHEN** the app emits a role question event
- **THEN** Gemini reads the question and its options aloud so the user can answer by voice

### Requirement: Voice answer resumes the same turn

A voice answer to a pending SDK-role question SHALL resolve the paused `canUseTool` callback with the user's selection so the asking role continues the **same** turn and the **same** context window. The answer SHALL NOT respawn the role or start a new run. Because only one run executes globally at a time, at most one such question is ever pending.

#### Scenario: User answers yes/no by voice

- **WHEN** the user answers a pending role question by voice (e.g. "yes", "option 2", or a named choice)
- **THEN** the app resolves the pending callback with that selection and the asking role resumes the paused turn
- **AND** the resumed turn retains all context from before the pause

#### Scenario: Multiple decisions in one question

- **WHEN** the role's `AskUserQuestion` contains more than one question
- **THEN** the app collects a voice answer for each and resolves the callback once all are answered, preserving voice-friendly batching

### Requirement: PO and STUDY are permitted to ask; DEV is not

The PO and STUDY personas and system prompts SHALL permit and encourage asking the user via `AskUserQuestion` at genuine decision points. The DEV persona and system prompt SHALL continue to forbid mid-run questions and require sensible defaults.

#### Scenario: A live role chooses to ask at a real decision point

- **WHEN** the PO reaches a decision that materially changes scope, or STUDY reaches a genuine filing/verification decision, that is not settled by the task
- **THEN** the role may call `AskUserQuestion` instead of silently assuming a default

#### Scenario: DEV never asks

- **WHEN** a DEV run encounters an ambiguity
- **THEN** the DEV applies a sensible default and records it, and does not pause to ask the user
