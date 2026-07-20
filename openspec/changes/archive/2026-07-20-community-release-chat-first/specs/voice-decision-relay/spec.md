## MODIFIED Requirements

### Requirement: SDK-role questions pause the turn and surface to voice

When the live PO session calls `AskUserQuestion`, the session SHALL pause that turn and the app SHALL surface the request to the Gemini voice layer as a structured event containing the question text and any offered options. The session runs in `bypassPermissions` mode, so tool-use approvals are auto-allowed and do NOT pause the turn — only `AskUserQuestion` does.

#### Scenario: The PO asks a structured question mid-turn

- **WHEN** the PO session calls `AskUserQuestion` during a turn
- **THEN** the SDK `canUseTool` callback fires, the turn is paused, and the app emits a structured question event (question + options) to the voice layer
- **AND** no new Claude process is spawned to convey the question

#### Scenario: Question is read aloud to the user

- **WHEN** the app emits a PO question event
- **THEN** Gemini reads the question and its options aloud so the user can answer by voice

## REMOVED Requirements

### Requirement: PO and STUDY are permitted to ask; DEV is not
**Reason**: The STUDY role is removed; the PO-only requirement "PO is permitted to ask; DEV is not" already in this capability states the surviving behavior, so this generalized duplicate is dropped rather than rewritten.
**Migration**: None — PO asking semantics are unchanged; the relay's role attribution parameter disappears with STUDY.
