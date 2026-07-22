## Purpose

A mid-turn question/answer loop in which the live PO `AskUserQuestion` requests pause the live session, surface to Gemini voice as a structured event, and are answered by voice to resume the same turn — replacing the end-of-run "Decisions needed" batch relay for cases that truly need a live answer.

## Requirements

### Requirement: SDK-role questions pause the turn and surface to voice

When the live PO session calls `AskUserQuestion`, the session SHALL pause that turn and the app SHALL surface the request to the Gemini voice layer as a structured event containing the question text and any offered options. The session runs in `bypassPermissions` mode, so tool-use approvals are auto-allowed and do NOT pause the turn — only `AskUserQuestion` does.

#### Scenario: The PO asks a structured question mid-turn

- **WHEN** the PO session calls `AskUserQuestion` during a turn
- **THEN** the SDK `canUseTool` callback fires, the turn is paused, and the app emits a structured question event (question + options) to the voice layer
- **AND** no new Claude process is spawned to convey the question

#### Scenario: Question is read aloud to the user

- **WHEN** the app emits a PO question event
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

#### Scenario: DEV never asks

- **WHEN** a DEV run encounters an ambiguity
- **THEN** the DEV applies a sensible default and records it, and does not pause to ask the user

### Requirement: Pending questions have a safe fallback

While a PO question is pending, the app SHALL keep the turn paused awaiting a voice answer, and SHALL provide a deterministic fallback if no answer is obtained (timeout or user abandonment) rather than hanging indefinitely.

#### Scenario: User abandons the decision

- **WHEN** a PO question remains unanswered beyond the configured wait
- **THEN** the app resolves the callback with a safe default (the PO's recommended option) and records that the default was applied

#### Scenario: Session reset with a question pending

- **WHEN** the user resets the session while a PO question is pending
- **THEN** the pending callback is settled and the paused turn is torn down without leaving an orphaned Claude process

### Requirement: PO questions remain answerable in HUD mode

While HUD mode is active, a pending PO question SHALL surface inside the overlay as an interactive (`.hud-hit`) banner offering the same per-question options as the deck banner, answerable by voice, mouse click, or gesture dwell-click. All existing relay semantics (single pending question, first-answer-wins, timeout fallback to the recommended option, settlement on session reset) apply unchanged in HUD mode, and the TaskChooser suppression rule while a question pends holds in HUD mode as well.

#### Scenario: Answering by click while floating

- **WHEN** the PO asks a question while HUD mode is active
- **THEN** the question banner appears as a HUD island, and clicking (or dwell-clicking) an option resolves the paused turn exactly as it would in deck mode

#### Scenario: Voice answer with HUD up

- **WHEN** a PO question is pending in HUD mode and the user answers by voice
- **THEN** the relay resolves via `answer_po_question` unchanged, and the banner dismisses in the overlay

### Requirement: Voice answer resumes the same turn

A voice answer to a pending PO question SHALL resolve the paused `canUseTool` callback with the user's selection so the PO continues the **same** turn and the **same** context window. The answer SHALL NOT respawn the PO or start a new run.

#### Scenario: User answers yes/no by voice

- **WHEN** the user answers a pending PO question by voice (e.g. "yes", "option 2", or a named choice)
- **THEN** the app resolves the pending callback with that selection and the PO resumes the paused turn
- **AND** the resumed turn retains all context from before the pause

#### Scenario: Multiple decisions in one question

- **WHEN** the PO's `AskUserQuestion` contains more than one question
- **THEN** the app collects a voice answer for each and resolves the callback once all are answered, preserving voice-friendly batching

### Requirement: Pending questions have a safe fallback

While a PO question is pending, the app SHALL keep the turn paused awaiting a voice answer, and SHALL provide a deterministic fallback if no answer is obtained (timeout or user abandonment) rather than hanging indefinitely.

#### Scenario: User abandons the decision

- **WHEN** a PO question remains unanswered beyond the configured wait
- **THEN** the app resolves the callback with a safe default (the PO's recommended option) and records that the default was applied

#### Scenario: Session reset with a question pending

- **WHEN** the user resets the session while a PO question is pending
- **THEN** the pending callback is settled and the paused turn is torn down without leaving an orphaned Claude process

### Requirement: PO is permitted to ask; DEV is not

The PO persona and system prompt SHALL permit and encourage asking the user via `AskUserQuestion` at genuine decision points. The DEV persona and system prompt SHALL continue to forbid mid-run questions and require sensible defaults.

#### Scenario: PO chooses to ask at a real decision point

- **WHEN** the PO reaches a decision that materially changes the PRD or scope and is not settled by the brief
- **THEN** the PO may call `AskUserQuestion` instead of silently assuming a default

#### Scenario: DEV never asks

- **WHEN** a DEV run encounters an ambiguity
- **THEN** the DEV applies a sensible default and records it, and does not pause to ask the user

### Requirement: PO questions remain answerable in HUD mode

While HUD mode is active, a pending PO question SHALL surface inside the overlay as an interactive (`.hud-hit`) banner offering the same per-question options as the deck banner, answerable by voice, mouse click, or gesture dwell-click. All existing relay semantics (single pending question, first-answer-wins, timeout fallback to the recommended option, settlement on session reset) apply unchanged in HUD mode, and the TaskChooser suppression rule while a question pends holds in HUD mode as well.

#### Scenario: Answering by click while floating

- **WHEN** the PO asks a question while HUD mode is active
- **THEN** the question banner appears as a HUD island, and clicking (or dwell-clicking) an option resolves the paused turn exactly as it would in deck mode

#### Scenario: Voice answer with HUD up

- **WHEN** a PO question is pending in HUD mode and the user answers by voice
- **THEN** the relay resolves via `answer_po_question` unchanged, and the banner dismisses in the overlay

### Requirement: A session reset denies a pending question rather than answering it

When a pending PO question is settled because the user reset the session (New session, voice new-session, or a project-folder change) — as opposed to a timeout — the app SHALL settle the paused `canUseTool` callback as a **denial**, not as an answer. It SHALL NOT feed the asking role a fabricated or default selection on a deliberate reset, because doing so lets the role continue the torn-down turn and act on a decision the user never made — including writing files into the project folder the user just left. This is distinct from the timeout fallback, which continues to apply the recommended default for a question genuinely left unanswered.

#### Scenario: Reset denies the pending question

- **WHEN** the user resets the session while a PO question is pending
- **THEN** the pending callback is settled as a denial (no answer selection is supplied to the asking role)
- **AND** the paused turn is torn down without leaving an orphaned Claude process

#### Scenario: Reset does not act on a fabricated answer

- **WHEN** a pending question is denied because of a session reset
- **THEN** the asking role does not proceed to act on a default or fabricated selection for that question (e.g. it does not run a tool that writes into the abandoned project folder on the strength of a made-up answer)

#### Scenario: Timeout still applies the default, unchanged

- **WHEN** a PO question remains unanswered beyond the configured wait and no reset occurred
- **THEN** the callback is settled with the recommended default option and that default is recorded, exactly as before — the denial semantics apply only to a deliberate reset
