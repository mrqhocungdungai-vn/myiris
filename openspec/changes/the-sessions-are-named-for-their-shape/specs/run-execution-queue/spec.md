# run-execution-queue — delta

## MODIFIED Requirements

### Requirement: A run blocked awaiting a human is not counted as idle

While the active run is legitimately blocked waiting for a human answer, the idle bound SHALL be suspended and SHALL NOT accrue. It SHALL resume when the run is unblocked, regardless of how the block was resolved.

This is required because a stateful turn paused on `AskUserQuestion` produces no progress signal for as long as `IRIS_CLAUDE_QUESTION_TIMEOUT_MS` allows. Without suspension the bound would terminate precisely those runs that are behaving correctly.

#### Scenario: Turn paused on a question outlives the idle bound

- **WHEN** the active run raises a question to the user and the user takes longer than the idle bound to answer
- **THEN** the run is not terminated, and its idle bound resumes counting only once the question is settled

#### Scenario: Suspension ends however the question settles

- **WHEN** a pending question is settled by any path — a voice answer, a UI answer, its own expiry, or being abandoned by a session reset
- **THEN** the idle bound resumes for the active run

#### Scenario: A run that stays silent after being unblocked still loses the slot

- **WHEN** a question is settled and the run then produces no further progress signal for longer than the idle bound
- **THEN** the bound elapses and the run is finalized, releasing the slot
