## MODIFIED Requirements

### Requirement: Stopping a run
Stopping a queued run SHALL remove it from the queue and bring it to the `cancelled` terminal state immediately — emitting exactly one `claude_task_update` with status `cancelled` and marking the run as finalized so it cannot be finalized again — but SHALL NOT route it through the slot-release path: it SHALL NOT release or advance the execution slot and SHALL NOT trigger a completion announcement, because a queued run never held the slot and never started. Stopping the active run SHALL mark it `cancelled` and signal its transport (SIGTERM for a subprocess); the slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping the active run whose transport has no child process (a PO turn) SHALL likewise mark it `cancelled` and cancel the in-progress turn through a transport-agnostic cancel hook, bringing the run to the `cancelled` terminal state and releasing the slot through the normal finalize path — never leaving the turn running to completion. The resident PO session SHALL survive the cancellation, or be torn down in a way that preserves continuity via its stored session id so a subsequent turn continues the same conversation; only the cancelled turn's in-flight work is discarded.

A signalled transport that does not terminate SHALL NOT hold the slot indefinitely. After a bounded grace period following the signal, the system SHALL escalate to an unconditional kill, and SHALL finalize the run and release the slot even if the transport never reports termination itself. For a PO turn (no subprocess), the idle-time bound remains the backstop if a cancelled turn fails to settle.

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
- **THEN** the run is marked `cancelled`, the in-progress turn is cancelled through the cancel hook, the run finalizes as `cancelled` exactly once, and the slot is released
- **AND** the turn does not continue to completion, while the resident PO session remains available (or resumable via its stored session id) for the next turn

#### Scenario: A signalled process ignores the signal
- **WHEN** `stop` is called on the active run, SIGTERM is sent, and the process has not closed when the grace period elapses
- **THEN** the process is killed unconditionally, the run is finalized as `cancelled` exactly once, and the slot is released
