## Purpose

A mid-turn question/answer loop in which a stateful run's `AskUserQuestion` requests pause the live session, surface to Gemini voice as a structured event, and are answered by voice to resume the same turn — replacing the end-of-run "Decisions needed" batch relay for cases that truly need a live answer.

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

### Requirement: Pending questions have a safe fallback
While a PO question is pending, the app SHALL keep the turn paused awaiting a voice answer, and SHALL provide a deterministic fallback if no answer is obtained (timeout or user abandonment) rather than hanging indefinitely.

#### Scenario: User abandons the decision

- **WHEN** a PO question remains unanswered beyond the configured wait
- **THEN** the app resolves the callback with a safe default (the PO's recommended option) and records that the default was applied

#### Scenario: Session reset with a question pending

- **WHEN** the user resets the session while a PO question is pending
- **THEN** the pending callback is settled and the paused turn is torn down without leaving an orphaned Claude process

### Requirement: Live questions remain answerable in HUD mode
While HUD mode is active, a pending question SHALL surface inside the overlay as an interactive (`.hud-hit`) banner offering the same per-question options as the deck banner, answerable by voice, mouse click, or gesture dwell-click. All existing relay semantics (single pending question, first-answer-wins, timeout fallback to the recommended option, settlement on session reset) apply unchanged in HUD mode, and the TaskChooser suppression rule while a question pends holds in HUD mode as well.

The voice tool that resolves the relay is named for what it does — answering the worker's question — rather than for a role that no longer exists. A spec naming a tool the app does not declare is worse than one naming none, because it reads as a contract.

#### Scenario: Answering by click while floating

- **WHEN** a question is raised while HUD mode is active
- **THEN** the question banner appears as a HUD island, and clicking (or dwell-clicking) an option resolves the paused turn exactly as it would in deck mode

#### Scenario: Voice answer with HUD up

- **WHEN** a question is pending in HUD mode and the user answers by voice
- **THEN** the relay resolves via the voice layer's question-answering tool unchanged, and the banner dismisses in the overlay

### Requirement: PO is permitted to ask; DEV is not
PO SHALL be permitted to pause mid-turn and ask the user a question through the voice relay. DEV SHALL NOT.

DEV's inability to ask SHALL be enforced by the configuration of the run — the question tool SHALL be unavailable to it — and not by prompt instruction alone. A headless run SHALL additionally carry a handler for the question path that fails the run with a diagnostic, so that a headless run can never reach a state where it waits for an answer nobody is listening for.

The prompts SHALL continue to state the asymmetry, since the model needs to know it in order to plan; the prompt is the explanation, and the configuration is the guarantee.

#### Scenario: PO pauses and is answered

- **WHEN** PO reaches a decision that materially shapes the change
- **THEN** it pauses, the question reaches the user by voice, and the same turn resumes with the answer

#### Scenario: DEV cannot ask

- **WHEN** a DEV run executes
- **THEN** the question tool is not available to it

#### Scenario: A headless question attempt fails loudly

- **WHEN** a headless run reaches the question path despite the restriction
- **THEN** the run fails with a diagnostic naming the violation, rather than waiting indefinitely

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

### Requirement: A question survives the relay without losing its shape
A question raised by a role SHALL reach the user with everything that changes how it is answered: its short label, its options with their descriptions, and whether more than one option may be chosen.

A question that permits multiple selections SHALL be answerable with multiple selections — by voice, from the interface, and on the timeout fallback path. Iris SHALL NOT silently reduce a multiple-selection question to a single choice, which answers a different question than the one the role asked.

#### Scenario: A multiple-selection question is answered with multiple options

- **WHEN** a role asks a question that permits selecting more than one option
- **THEN** the user can choose several, and every chosen option reaches the role

#### Scenario: The timeout default respects the question's shape

- **WHEN** a multiple-selection question times out and the safe default is applied
- **THEN** the default is expressed in the shape the question asked for, not reduced to one option

#### Scenario: The question's label is relayed

- **WHEN** a question is read aloud
- **THEN** its short label is available to Iris as context for how to introduce it

### Requirement: End-of-run decisions travel as structured data
Decisions a role defers to the end of a run SHALL be produced as structured data validated against a declared schema, rather than parsed out of prose. Each decision SHALL carry its question, its options with descriptions, and the role's recommendation.

Iris SHALL prefer structured decisions when a run produces them. It SHALL retain the prose fallback for runs that do not — a session resumed from before the schema existed cannot produce one, and a run that completed its real work SHALL NOT be failed for being unable to format a summary.

A run terminated because it could not produce valid structured output after the runtime's retries SHALL be reported as its own outcome, not as a generic failure.

#### Scenario: Structured decisions are used when present

- **WHEN** a run produces structured decisions
- **THEN** Iris reads them from the structured result rather than parsing the prose output

#### Scenario: A run without structured decisions still relays them

- **WHEN** a run produces decisions only in prose
- **THEN** Iris relays them through the existing prose path

#### Scenario: A structured-output failure is named

- **WHEN** a run terminates because valid structured output could not be produced
- **THEN** the outcome names that cause rather than reporting a generic failure
