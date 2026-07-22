## MODIFIED Requirements

### Requirement: Single execution slot
The system SHALL allow at most one Claude run (PO turn, DEV run, or plain task) to be mid-execution at any time, system-wide. A task submitted while the slot is free SHALL start immediately; a task submitted while the slot is held SHALL be queued FIFO. Starting a run SHALL be able to fail synchronously (for example, a run rejected at a start-time gate or a transport that fails to launch); when it does, the submitter SHALL receive the run's terminal status rather than a `started` acknowledgement, so the submitter is never told a run started when it did not.

#### Scenario: Submit while idle
- **WHEN** a task is submitted, no run holds the execution slot, and the run begins running
- **THEN** the run acquires the slot and starts, and the submitter receives `status: "started"` with the `run_id`

#### Scenario: Submit rejected synchronously at start
- **WHEN** a task is submitted while the slot is free but the run is finalized during start (e.g. a DEV run with no open change to implement, an uninstalled agent, or a transport that fails to launch)
- **THEN** the submitter receives the run's terminal status (`failed` or `error`) with the reason, not `status: "started"`

#### Scenario: Submit while busy
- **WHEN** a task is submitted while another run holds the execution slot
- **THEN** the run is appended to the queue, the submitter receives `status: "queued"` with its 1-based queue position, and a `claude_task_update` with status `queued` and that position is emitted
