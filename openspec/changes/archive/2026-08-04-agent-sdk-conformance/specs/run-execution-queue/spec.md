## ADDED Requirements

### Requirement: A run carries what it cost

Every run SHALL record the cost and usage the runtime reports on completion — estimated spend, token usage including cache reads and writes, per-model usage where more than one model was involved, and the number of agentic turns taken. These SHALL be persisted with the run and projected to the interface alongside its result.

The user SHALL be able to ask by voice what a run cost and be answered from recorded data, never from an estimate Iris constructs.

Per-model usage SHALL be the basis for accounting whenever a run used subagents, since a single top-level figure attributes their spend incorrectly.

#### Scenario: A completed run reports its cost

- **WHEN** a run completes
- **THEN** its estimated spend, token usage, and turn count are recorded and shown with its result

#### Scenario: Cost is answerable by voice

- **WHEN** the user asks what a run cost
- **THEN** Iris answers from the recorded figures

#### Scenario: Subagent spend is attributed

- **WHEN** a run that used subagents completes
- **THEN** its accounting is derived from per-model usage rather than a single aggregate

### Requirement: Termination on a ceiling is its own outcome

A run terminated because it reached its turn ceiling or its spend ceiling SHALL be finalized with an outcome distinct from every other failure, naming which ceiling fired, the value it fired at, and how to raise it.

This outcome SHALL NOT be reported through the generic failure message. A user whose run stopped because it was long needs a different response than one whose run broke, and collapsing the two hides which happened.

Iris SHALL emit a warning while a run is still executing when it crosses a configured fraction of its spend ceiling, so a long run is visible before it stops rather than after.

#### Scenario: A ceiling termination is named

- **WHEN** a run terminates because it reached its turn or spend ceiling
- **THEN** the outcome names the ceiling, its configured value, and how to change it

#### Scenario: A ceiling is distinguishable from a failure

- **WHEN** the interface or the voice layer reports a ceiling termination
- **THEN** it is presented differently from a run that failed for any other reason

#### Scenario: A long run is visible before it stops

- **WHEN** an executing run crosses the configured warning fraction of its spend ceiling
- **THEN** the user is warned while the run is still executing

### Requirement: Both roles cancel through one path

Cancellation SHALL work identically for a resident session and a one-shot run, from the caller's point of view. A caller SHALL NOT need to know which lifetime a run has in order to stop it.

Where the runtime provides an interrupt for a turn already in progress, Iris SHALL use it rather than tearing down the transport, and SHALL record which queued work survived the interrupt so the user is not told that something was cancelled when it will still run.

#### Scenario: Cancellation is lifetime-agnostic

- **WHEN** a run is stopped
- **THEN** it is stopped through the same path whether it is a resident session or a one-shot run

#### Scenario: An interrupted turn reports what survived

- **WHEN** a turn in progress is interrupted and queued work survives it
- **THEN** the surviving work is recorded and reported, rather than being described as cancelled

## MODIFIED Requirements

### Requirement: One declared status vocabulary
Run lifecycle status SHALL come from a single declared vocabulary, split into stored statuses (`queued`, `running`, `completed`, `failed`, `error`, `cancelled`, `limited` — persisted on the run record) and emitted-only lifecycle markers (`starting`, `started` — appearing only on `claude_task_update` events). No other status strings SHALL appear on run records or task-update events, and the set of terminal statuses SHALL be defined in exactly one place.

`limited` is the outcome of a run stopped by its turn or spend ceiling. It is a stored, terminal status distinct from `failed` and `error`, because a run that reached a limit and a run that broke call for different responses from the user, and reporting them alike hides which happened.

#### Scenario: Lifecycle emissions use the vocabulary
- **WHEN** a run moves through submit → start → activity → finalize
- **THEN** the emitted `claude_task_update` statuses are drawn only from the declared vocabulary (`queued`/`starting` at submit, `started` at transport start, `running` for activity, one terminal status at finalization)

#### Scenario: A ceiling termination is in the vocabulary, not beside it
- **WHEN** a run terminates because it reached its turn or spend ceiling
- **THEN** its stored status is `limited`, drawn from the same declared vocabulary, and every consumer that treats a run as finished recognises it as terminal without a special case

### Requirement: Single task-update projection
The `claude_task_update` event payload SHALL be produced by one projection from the run record, so every emission carries the same field set (`run_id`, `task`, `agent`, `model`, `claude_session_id`, `usage`, plus status-specific extras such as queue `position` or `urgency`) rather than hand-built per call site.

`usage` carries what the run cost as the runtime reported it, and is absent until the run's result message lands. An emission that carries no figures SHALL NOT overwrite figures already recorded for that run.

#### Scenario: Consistent fields across lifecycle
- **WHEN** `claude_task_update` events for one run are compared across its lifecycle (queued, started, running, terminal)
- **THEN** the shared fields are populated identically from the run record at each point in time, with omissions only where a value does not exist yet (e.g. `claude_session_id` before the transport reports one, or `usage` before the run completes)
