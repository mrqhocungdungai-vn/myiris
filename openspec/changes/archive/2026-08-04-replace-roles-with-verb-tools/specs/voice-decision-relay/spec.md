## MODIFIED Requirements

### Requirement: Voice answer resumes the same turn

A voice answer to a pending question SHALL resolve the paused permission callback with the user's selection so the asking run continues the **same** turn and the **same** context window. The answer SHALL NOT restart the run. Because only one run executes globally at a time, at most one such question is ever pending.

#### Scenario: User answers yes/no by voice

- **WHEN** the user answers a pending question by voice (e.g. "yes", "option 2", or a named choice)
- **THEN** the app resolves the pending callback with that selection and the asking run resumes the paused turn
- **AND** the resumed turn retains all context from before the pause

#### Scenario: Multiple decisions in one question

- **WHEN** the question carries more than one decision
- **THEN** the app collects a voice answer for each and resolves the callback once all are answered, preserving voice-friendly batching

#### Scenario: A stateless verb never asks

- **WHEN** a run started by a stateless verb encounters an ambiguity
- **THEN** it applies a sensible default and records it, and does not pause to ask the user — the question tool is not available to it at all

### Requirement: Live questions remain answerable in HUD mode

While HUD mode is active, a pending question SHALL surface inside the overlay as an interactive (`.hud-hit`) banner offering the same per-question options as the deck banner, answerable by voice, mouse click, or gesture dwell-click. All existing relay semantics (single pending question, first-answer-wins, timeout fallback to the recommended option, settlement on session reset) apply unchanged in HUD mode, and the TaskChooser suppression rule while a question pends holds in HUD mode as well.

The voice tool that resolves the relay is named for what it does — answering the worker's question — rather than for a role that no longer exists. A spec naming a tool the app does not declare is worse than one naming none, because it reads as a contract.

#### Scenario: Answering by click while floating

- **WHEN** a question is raised while HUD mode is active
- **THEN** the question banner appears as a HUD island, and clicking (or dwell-clicking) an option resolves the paused turn exactly as it would in deck mode

#### Scenario: Voice answer with HUD up

- **WHEN** a question is pending in HUD mode and the user answers by voice
- **THEN** the relay resolves via the voice layer's question-answering tool unchanged, and the banner dismisses in the overlay

## RENAMED Requirements

- FROM: `### Requirement: PO questions remain answerable in HUD mode`
- TO: `### Requirement: Live questions remain answerable in HUD mode`
