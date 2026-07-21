## ADDED Requirements

### Requirement: The execution slot has a bounded lifetime

A run SHALL NOT hold the execution slot indefinitely without producing progress. The system SHALL bound the slot on **idle time** — the interval since the run last produced a progress signal — not on total elapsed runtime, so that a long but healthy run is never terminated for being long.

The bound SHALL be configurable through an explicit environment budget (`IRIS_RUN_IDLE_TIMEOUT_MS`) with a documented default, consistent with the other explicit budgets in the system.

Only the run currently holding the slot SHALL be subject to the bound. A queued run SHALL NOT be timed, since it is not consuming the slot.

#### Scenario: A healthy long run is not terminated

- **WHEN** a run produces progress signals at intervals shorter than the idle bound, for a total runtime far exceeding that bound
- **THEN** the run is never terminated by the bound and keeps the slot until its transport finalizes it normally

#### Scenario: A silent run loses the slot

- **WHEN** the run holding the execution slot produces no progress signal for longer than the idle bound, and is not suspended
- **THEN** the run is finalized with a terminal status, exactly one terminal `claude_task_update` is emitted, the completion announcement fires once, and the slot is released so the next queued run starts

#### Scenario: A queued run is not timed

- **WHEN** a run sits in the queue for longer than the idle bound while another run holds the slot
- **THEN** the queued run is unaffected and starts normally when the slot is released

#### Scenario: The bound is disarmed by normal termination

- **WHEN** a run's transport finalizes it normally before the idle bound elapses
- **THEN** no timeout finalization occurs afterwards, and the run's terminal status is the one its transport reported

### Requirement: A run blocked awaiting a human is not counted as idle

While the active run is legitimately blocked waiting for a human answer, the idle bound SHALL be suspended and SHALL NOT accrue. It SHALL resume when the run is unblocked, regardless of how the block was resolved.

This is required because a PO turn paused on `AskUserQuestion` produces no progress signal for as long as `IRIS_PO_QUESTION_TIMEOUT_MS` allows. Without suspension the bound would terminate precisely those runs that are behaving correctly.

#### Scenario: Turn paused on a question outlives the idle bound

- **WHEN** the active run raises a question to the user and the user takes longer than the idle bound to answer
- **THEN** the run is not terminated, and its idle bound resumes counting only once the question is settled

#### Scenario: Suspension ends however the question settles

- **WHEN** a pending question is settled by any path — a voice answer, a UI answer, its own expiry, or being abandoned by a session reset
- **THEN** the idle bound resumes for the active run

#### Scenario: A run that stays silent after being unblocked still loses the slot

- **WHEN** a question is settled and the run then produces no further progress signal for longer than the idle bound
- **THEN** the bound elapses and the run is finalized, releasing the slot

## MODIFIED Requirements

### Requirement: Stopping a run
Stopping a queued run SHALL remove it from the queue and finalize it as `cancelled` immediately. Stopping the active run SHALL mark it `cancelled` and signal its transport (SIGTERM for a subprocess); the slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping an active run whose transport cannot be signalled (a PO turn has no child process) SHALL leave the run running and report its current status — the existing no-op behavior is preserved intentionally.

A signalled transport that does not terminate SHALL NOT hold the slot indefinitely. After a bounded grace period following the signal, the system SHALL escalate to an unconditional kill, and SHALL finalize the run and release the slot even if the transport never reports termination itself.

#### Scenario: Stop a queued run
- **WHEN** `stop` is called with the id of a run in status `queued`
- **THEN** the run leaves the queue, is finalized as `cancelled`, and a `claude_task_update` with status `cancelled` is emitted

#### Scenario: Stop the active DEV run
- **WHEN** `stop` is called with the id of the active run and that run has a child process
- **THEN** the run is marked `cancelled` and SIGTERM is sent; when the process closes, the run finalizes as `cancelled` and the slot is released

#### Scenario: Stop an active PO turn
- **WHEN** `stop` is called with the id of the active run and that run has no child process (a PO turn)
- **THEN** the call returns the run's current status unchanged and the turn continues to completion

#### Scenario: A signalled process ignores the signal
- **WHEN** `stop` is called on the active run, SIGTERM is sent, and the process has not closed when the grace period elapses
- **THEN** the process is killed unconditionally, the run is finalized as `cancelled` exactly once, and the slot is released
