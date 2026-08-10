## ADDED Requirements

### Requirement: An answer identifies its question by a stable handle

Each question relayed to the voice layer SHALL carry a stable handle that identifies it within that relay, and an answer SHALL name its question by that handle. The app SHALL match answers to questions on the handle alone.

The app SHALL NOT match an answer to a question by comparing the question's text. Requiring a speech model to retype a sentence character-for-character in order for an answer to be filed is a dependency on the least reliable thing that model does — and it is at its least reliable in exactly the situation the relay is built for, where the question was written in one language and read aloud to the user in another.

An answer MAY additionally carry the question's text, and where it does the app MAY use it to explain a mismatch. It SHALL NOT be what decides which question is being answered.

#### Scenario: An answer is filed by its handle

- **WHEN** the voice layer answers a relayed question
- **THEN** the answer is matched to that question by the handle the relay gave it

#### Scenario: A reworded question text does not misfile the answer

- **WHEN** an answer carries question text that differs from the question as the verb wrote it
- **THEN** the answer is still filed against the question its handle names

#### Scenario: The handle is relayed with the question

- **WHEN** questions are read aloud to the user
- **THEN** each carries its stable handle, alongside its label, options and selection shape

## MODIFIED Requirements

### Requirement: Voice answer resumes the same turn
A voice answer to a pending question SHALL resolve the paused permission callback with the user's selection so the asking run continues the **same** turn and the **same** context window. The answer SHALL NOT restart the run. Because only one run executes globally at a time, at most one such question is ever pending.

An answer that names no pending question SHALL be reported as an error to the voice layer, and the pending question SHALL be left pending rather than settled. Accepting an unmatchable answer and continuing would leave the run to proceed as though nobody had answered — applying a default, or stopping for want of an answer — while the user has in fact answered and been told it was received. A wrong account of what happened to the user's work is worse than a retry.

#### Scenario: User answers yes/no by voice

- **WHEN** the user answers a pending question by voice (e.g. "yes", "option 2", or a named choice)
- **THEN** the app resolves the pending callback with that selection and the asking run resumes the paused turn
- **AND** the resumed turn retains all context from before the pause

#### Scenario: Multiple decisions in one question

- **WHEN** the question carries more than one decision
- **THEN** the app collects a voice answer for each and resolves the callback once all are answered, preserving voice-friendly batching

#### Scenario: An unmatchable answer is refused, not absorbed

- **WHEN** an answer arrives naming a question that is not pending
- **THEN** the app reports the error to the voice layer and the question remains pending
- **AND** no default is applied and the run is not resumed on that answer

#### Scenario: A stateless verb never asks

- **WHEN** a run started by a stateless verb encounters an ambiguity
- **THEN** it applies a sensible default and records it, and does not pause to ask the user — the question tool is not available to it at all
