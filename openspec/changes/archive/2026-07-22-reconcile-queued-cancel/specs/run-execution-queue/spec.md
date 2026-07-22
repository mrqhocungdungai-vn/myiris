## MODIFIED Requirements

### Requirement: Stopping a run
Stopping a queued run SHALL remove it from the queue and bring it to the `cancelled` terminal state immediately — emitting exactly one `claude_task_update` with status `cancelled` and marking the run as finalized so it cannot be finalized again — but SHALL NOT route it through the slot-release path: it SHALL NOT release or advance the execution slot and SHALL NOT trigger a completion announcement, because a queued run never held the slot and never started. Stopping the active run SHALL mark it `cancelled` and signal its transport (SIGTERM for a subprocess); the slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping an active run whose transport cannot be signalled (a PO turn has no child process) SHALL leave the run running and report its current status — the existing no-op behavior is preserved intentionally.

A signalled transport that does not terminate SHALL NOT hold the slot indefinitely. After a bounded grace period following the signal, the system SHALL escalate to an unconditional kill, and SHALL finalize the run and release the slot even if the transport never reports termination itself.

#### Scenario: Stop a queued run
- **WHEN** `stop` is called with the id of a run in status `queued`
- **THEN** the run leaves the queue, reaches the `cancelled` terminal state, is marked finalized, and a `claude_task_update` with status `cancelled` is emitted
- **AND** no other run is started and no completion is announced, since the run never held the slot

#### Scenario: Cancelling a queued run does not disturb the active run
- **WHEN** `stop` is called on a queued run while another run holds the execution slot
- **THEN** the active run keeps the slot and continues running, and no second run is started as a side effect of the cancel

#### Scenario: A cancelled queued run cannot be re-finalized
- **WHEN** `finalize` is later called with the id of a run that was cancelled while queued
- **THEN** the call is a no-op — no further event, no announcement, and no queue advance — because the run is already marked finalized

#### Scenario: Stop the active DEV run
- **WHEN** `stop` is called with the id of the active run and that run has a child process
- **THEN** the run is marked `cancelled` and SIGTERM is sent; when the process closes, the run finalizes as `cancelled` and the slot is released

#### Scenario: Stop an active PO turn
- **WHEN** `stop` is called with the id of the active run and that run has no child process (a PO turn)
- **THEN** the call returns the run's current status unchanged and the turn continues to completion

#### Scenario: A signalled process ignores the signal
- **WHEN** `stop` is called on the active run, SIGTERM is sent, and the process has not closed when the grace period elapses
- **THEN** the process is killed unconditionally, the run is finalized as `cancelled` exactly once, and the slot is released
