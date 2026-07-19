# run-execution-queue

## Purpose
Names the execution behavior the delegation model already relies on: the one-at-a-time Claude execution slot shared by PO turns, DEV runs, and plain Claude tasks, its queueing/cancellation lifecycle, and the `claude_task_update` event stream it produces.

## Requirements

### Requirement: Single execution slot
The system SHALL allow at most one Claude run (PO turn, DEV run, or plain task) to be mid-execution at any time, system-wide. A task submitted while the slot is free SHALL start immediately; a task submitted while the slot is held SHALL be queued FIFO.

#### Scenario: Submit while idle
- **WHEN** a task is submitted and no run holds the execution slot
- **THEN** the run acquires the slot and starts immediately, and the submitter receives `status: "started"` with the `run_id`

#### Scenario: Submit while busy
- **WHEN** a task is submitted while another run holds the execution slot
- **THEN** the run is appended to the queue, the submitter receives `status: "queued"` with its 1-based queue position, and a `claude_task_update` with status `queued` and that position is emitted

### Requirement: Dequeue skips cancelled runs
When the slot is released, the system SHALL start the oldest queued run that is still in status `queued`, discarding queue entries whose runs were cancelled (or are otherwise no longer eligible) without starting them.

#### Scenario: Next eligible run starts on release
- **WHEN** the active run finalizes and the queue holds a run in status `queued`
- **THEN** that run acquires the slot and starts

#### Scenario: Cancelled queued run is skipped
- **WHEN** the active run finalizes and the oldest queue entry refers to a run that was cancelled while waiting
- **THEN** that entry is discarded and the next run still in status `queued` (if any) starts instead

### Requirement: A run finalizes exactly once
Every run SHALL reach exactly one terminal status (`completed`, `failed`, `error`, or `cancelled`), even when the underlying transport reports failure through multiple callbacks (e.g. a spawn failure firing both `error` and `close`). Finalization SHALL emit exactly one terminal `claude_task_update`, trigger exactly one completion announcement, and release the execution slot.

#### Scenario: Double finalization is a no-op
- **WHEN** a run's transport reports termination twice (spawn `error` followed by `close`)
- **THEN** only the first report finalizes the run; the second produces no event, no announcement, and no queue advance

#### Scenario: Finalization releases the slot
- **WHEN** a run finalizes with any terminal status
- **THEN** the execution slot is released and the dequeue rule (above) runs

### Requirement: One declared status vocabulary
Run lifecycle status SHALL come from a single declared vocabulary, split into stored statuses (`queued`, `running`, `completed`, `failed`, `error`, `cancelled` — persisted on the run record) and emitted-only lifecycle markers (`starting`, `started` — appearing only on `claude_task_update` events). No other status strings SHALL appear on run records or task-update events, and the set of terminal statuses SHALL be defined in exactly one place.

#### Scenario: Lifecycle emissions use the vocabulary
- **WHEN** a run moves through submit → start → activity → finalize
- **THEN** the emitted `claude_task_update` statuses are drawn only from the declared vocabulary (`queued`/`starting` at submit, `started` at transport start, `running` for activity, one terminal status at finalization)

### Requirement: Single task-update projection
The `claude_task_update` event payload SHALL be produced by one projection from the run record, so every emission carries the same field set (`run_id`, `task`, `agent`, `model`, `claude_session_id`, plus status-specific extras such as queue `position` or `urgency`) rather than hand-built per call site.

#### Scenario: Consistent fields across lifecycle
- **WHEN** `claude_task_update` events for one run are compared across its lifecycle (queued, started, running, terminal)
- **THEN** the shared fields are populated identically from the run record at each point in time, with omissions only where a value does not exist yet (e.g. `claude_session_id` before the transport reports one)

### Requirement: Stopping a run
Stopping a queued run SHALL remove it from the queue and finalize it as `cancelled` immediately. Stopping the active run SHALL mark it `cancelled` and signal its transport (SIGTERM for a subprocess); the slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping an active run whose transport cannot be signalled (a PO turn has no child process) SHALL leave the run running and report its current status — the existing no-op behavior is preserved intentionally.

#### Scenario: Stop a queued run
- **WHEN** `stop` is called with the id of a run in status `queued`
- **THEN** the run leaves the queue, is finalized as `cancelled`, and a `claude_task_update` with status `cancelled` is emitted

#### Scenario: Stop the active DEV run
- **WHEN** `stop` is called with the id of the active run and that run has a child process
- **THEN** the run is marked `cancelled` and SIGTERM is sent; when the process closes, the run finalizes as `cancelled` and the slot is released

#### Scenario: Stop an active PO turn
- **WHEN** `stop` is called with the id of the active run and that run has no child process (a PO turn)
- **THEN** the call returns the run's current status unchanged and the turn continues to completion
