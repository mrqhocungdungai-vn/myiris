## MODIFIED Requirements

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
