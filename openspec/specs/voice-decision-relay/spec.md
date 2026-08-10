## Purpose

A mid-turn question/answer loop in which a stateful run's `AskUserQuestion` requests pause the live session, surface to Gemini voice as a structured event, and are answered by voice to resume the same turn — replacing the end-of-run "Decisions needed" batch relay for cases that truly need a live answer.
## Requirements
### Requirement: Worker questions pause the turn and surface to voice
When the live stateful session calls `AskUserQuestion`, the session SHALL pause that turn and the app SHALL surface the request to the Gemini voice layer as a structured event containing the question text and any offered options. The session runs in `bypassPermissions` mode, so tool-use approvals are auto-allowed and do NOT pause the turn — only `AskUserQuestion` does.

#### Scenario: The worker asks a structured question mid-turn

- **WHEN** the live session calls `AskUserQuestion` during a turn
- **THEN** the SDK `canUseTool` callback fires, the turn is paused, and the app emits a structured question event (question + options) to the voice layer
- **AND** no new Claude process is spawned to convey the question

#### Scenario: Question is read aloud to the user

- **WHEN** the app emits a question event
- **THEN** Gemini reads the question and its options aloud so the user can answer by voice

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

### Requirement: Pending questions have a safe fallback
While a question is pending, the app SHALL keep the turn paused awaiting a voice answer, and SHALL provide a deterministic fallback if no answer is obtained (timeout or user abandonment) rather than hanging indefinitely.

What the fallback IS SHALL depend on what proceeding would do. Where the asking run's output is something the user reads and decides on before anything happens to their files, the fallback SHALL apply the asking verb's recommended option and record that the default was applied. Where the asking run **writes** — to the project, or to the user's notes — the fallback SHALL NOT supply an answer: the run SHALL be finalized without writing further, reporting what it needed to know.

A single fallback cannot be right for both. Applying a default to an unanswered question on a writing run produces the one outcome worse than an honest guess: the run acts on a decision the user never made, and every downstream account of it — the result, the announcement, the record in the notes — reads as though the user had been consulted. A run that stops and says what it needed costs one round trip; a run that guesses in the user's name costs their trust in every run that came before it.

#### Scenario: An unanswered question on a run that does not write

- **WHEN** a question from a run whose output the user reviews before it takes effect remains unanswered beyond the configured wait
- **THEN** the app resolves the callback with the asking verb's recommended option and records that the default was applied

#### Scenario: An unanswered question on a run that writes

- **WHEN** a question from a run that writes to the project remains unanswered beyond the configured wait
- **THEN** no answer is supplied, the run is finalized without writing further, and what the user is told names the question it could not get answered

#### Scenario: The unanswered outcome is never presented as a decision

- **WHEN** a run ends because its question went unanswered
- **THEN** nothing in its result, its spoken announcement, or its record claims the user chose anything

#### Scenario: Session reset with a question pending

- **WHEN** the user resets the session while a question is pending
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

### Requirement: A stateful verb may ask; a stateless verb cannot
A stateful verb SHALL be permitted to pause mid-turn and ask the user a question through the voice relay. A stateless verb SHALL be permitted to do so **only** where the work it was given is not already specified — where nothing upstream has resolved the ambiguity it may hit — and only where the answer can actually be delivered. In every other case it SHALL NOT.

The asymmetry was never about the run's shape. It was about whether the question had already been answered somewhere else: a run implementing a settled task list is working from answers that were collected before it started, so pausing to re-ask them is redundant. A run given no specification has no such upstream, and refusing it the question tool does not make it stop needing the answer — it makes it invent one and write the result.

Permission SHALL be enforced by the configuration of the run — the question tool present or absent — and not by prompt instruction alone. A run that is not permitted to ask SHALL additionally carry a handler for the question path that fails the run with a diagnostic, so that a run can never reach a state where it waits for an answer nobody is listening for. That handler SHALL remain in place for a run that *is* permitted to ask, because permission is granted when the run starts and the listener can go away while it is still running.

The prompts SHALL continue to state the asymmetry, since the model needs to know it in order to plan; the prompt is the explanation, and the configuration is the guarantee. A run permitted to ask SHALL additionally be told what is worth asking about — a wrong assumption that would have to be undone — and to apply and record a default otherwise. That part is a prompt-level guarantee and SHALL be described as one: the configuration decides whether asking is possible and can decide nothing about whether it is warranted.

#### Scenario: A stateful verb pauses and is answered

- **WHEN** a stateful verb reaches a decision that materially shapes the change
- **THEN** it pauses, the question reaches the user by voice, and the same turn resumes with the answer

#### Scenario: A run working from a settled task list cannot ask

- **WHEN** a stateless run executes against work that is already specified
- **THEN** the question tool is not available to it

#### Scenario: A run with no specification asks and is answered

- **WHEN** the implementing verb runs with no settled task list and reaches an ambiguity a wrong guess would not survive
- **THEN** it pauses, the question reaches the user by voice, and the same run continues with the answer

#### Scenario: A question attempt with no listener fails loudly

- **WHEN** a run reaches the question path while nothing can relay the question — because it was never permitted to ask, or because the voice layer went away after it started
- **THEN** the run fails with a diagnostic naming the violation, rather than waiting indefinitely

### Requirement: A session reset denies a pending question rather than answering it
When a pending question is settled because the user reset the session (New session, voice new-session, or a project-folder change) — as opposed to a timeout — the app SHALL settle the paused `canUseTool` callback as a **denial**, not as an answer. It SHALL NOT feed the asking verb a fabricated or default selection on a deliberate reset, because doing so lets it continue the torn-down turn and act on a decision the user never made — including writing files into the project folder the user just left. This is distinct from the timeout fallback, which continues to apply the recommended default for a question genuinely left unanswered.

#### Scenario: Reset denies the pending question

- **WHEN** the user resets the session while a question is pending
- **THEN** the pending callback is settled as a denial (no answer selection is supplied to the asking verb)
- **AND** the paused turn is torn down without leaving an orphaned Claude process

#### Scenario: Reset does not act on a fabricated answer

- **WHEN** a pending question is denied because of a session reset
- **THEN** the asking verb does not proceed to act on a default or fabricated selection for that question (e.g. it does not run a tool that writes into the abandoned project folder on the strength of a made-up answer)

#### Scenario: Timeout still applies the default, unchanged

- **WHEN** a question remains unanswered beyond the configured wait and no reset occurred
- **THEN** the callback is settled with the recommended default option and that default is recorded, exactly as before — the denial semantics apply only to a deliberate reset

### Requirement: A question survives the relay without losing its shape
A question raised by a verb SHALL reach the user with everything that changes how it is answered: its short label, its options with their descriptions, and whether more than one option may be chosen.

A question that permits multiple selections SHALL be answerable with multiple selections — by voice, from the interface, and on the timeout fallback path. Iris SHALL NOT silently reduce a multiple-selection question to a single choice, which answers a different question than the one the verb asked.

#### Scenario: A multiple-selection question is answered with multiple options

- **WHEN** a verb asks a question that permits selecting more than one option
- **THEN** the user can choose several, and every chosen option reaches the verb

#### Scenario: The timeout default respects the question's shape

- **WHEN** a multiple-selection question times out and the safe default is applied
- **THEN** the default is expressed in the shape the question asked for, not reduced to one option

#### Scenario: The question's label is relayed

- **WHEN** a question is read aloud
- **THEN** its short label is available to Iris as context for how to introduce it

### Requirement: End-of-run decisions travel as structured data
Decisions a verb defers to the end of a run SHALL be produced as structured data validated against a declared schema, rather than parsed out of prose. Each decision SHALL carry its question, its options with descriptions, and the verb's recommendation.

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

### Requirement: A turn's transcript is current when it is composed

The verbatim record SHALL be flushed before a tool call is dispatched, so that the sentence which caused the turn is present in the transcript the turn is composed from. A turn SHALL NOT be composed from a transcript that is missing its own trigger.

This survives the removal of the rule that made that transcript lead. Attaching a transcript that stops one sentence short of the request is worse than attaching none: a run reading it sees the conversation up to the moment of interest and nothing at the moment itself, which reads as though the request was never made. Corroboration that is systematically missing the thing it should corroborate is not corroboration.

Fencing is unchanged, and so is standing: the flushed transcript accompanies the call, it does not outrank it.

#### Scenario: The triggering sentence is in the turn

- **WHEN** the user says something that causes a canvas turn to start
- **THEN** that sentence is present in the transcript material the turn carries

#### Scenario: Being current does not make it the instruction

- **WHEN** the flushed transcript differs from the call's parameters
- **THEN** the turn follows the parameters, with the transcript carried as material that may be mistaken

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

