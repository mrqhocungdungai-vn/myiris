# run-execution-queue

## Purpose
Names the execution behavior the delegation model already relies on: the one-at-a-time Claude execution slot shared by PO turns, DEV runs, and plain Claude tasks, its queueing/cancellation lifecycle, and the `claude_task_update` event stream it produces.

## Requirements

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
Stopping a queued run SHALL remove it from the queue and bring it to the `cancelled` terminal state immediately — emitting exactly one `claude_task_update` with status `cancelled` and marking the run as finalized so it cannot be finalized again — but SHALL NOT route it through the slot-release path: it SHALL NOT release or advance the execution slot and SHALL NOT trigger a completion announcement, because a queued run never held the slot and never started. Stopping the active run SHALL mark it `cancelled` and signal its transport; for a subprocess transport this SHALL target the run's whole process group (SIGTERM to the group), so descendant tool subprocesses spawned by the run are terminated too and never left orphaned — the queue SHALL delegate the actual group-aware kill to an injected transport-kill hook rather than embedding process-group or platform knowledge itself. The slot SHALL be released through the normal finalize-on-termination path, not by the stop call itself. Stopping the active run whose transport has no child process (a PO turn) SHALL likewise mark it `cancelled` and cancel the in-progress turn through a transport-agnostic cancel hook, bringing the run to the `cancelled` terminal state and releasing the slot through the normal finalize path — never leaving the turn running to completion. The resident PO session SHALL survive the cancellation, or be torn down in a way that preserves continuity via its stored session id so a subsequent turn continues the same conversation; only the cancelled turn's in-flight work is discarded.

A signalled transport that does not terminate SHALL NOT hold the slot indefinitely. After a bounded grace period following the signal, the system SHALL escalate to an unconditional kill of the same process group, and SHALL finalize the run and release the slot even if the transport never reports termination itself. For a PO turn (no subprocess), the idle-time bound remains the backstop if a cancelled turn fails to settle.

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
- **THEN** the run is marked `cancelled` and its process group is sent SIGTERM through the injected kill hook; when the process closes, the run finalizes as `cancelled` and the slot is released
- **AND** no descendant tool subprocess of that run is left running

#### Scenario: Stop an active PO turn
- **WHEN** `stop` is called with the id of the active run and that run has no child process (a PO turn)
- **THEN** the run is marked `cancelled`, the in-progress turn is cancelled through the cancel hook, the run finalizes as `cancelled` exactly once, and the slot is released
- **AND** the turn does not continue to completion, while the resident PO session remains available (or resumable via its stored session id) for the next turn

#### Scenario: A signalled process ignores the signal
- **WHEN** `stop` is called on the active run, SIGTERM is sent to its process group, and the process has not closed when the grace period elapses
- **THEN** the process group is killed unconditionally through the injected kill hook, the run is finalized as `cancelled` exactly once, and the slot is released

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
