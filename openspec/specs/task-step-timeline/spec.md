## Purpose

TBD — visual handoff comets between the orb and Work Stream, and a per-task step timeline built from existing Claude sidecar events.

## Requirements

### Requirement: Visual handoff comets

The UI SHALL render a handoff effect (comet pulse) from the orb to the Work Stream when a Claude task is delegated, and from the Work Stream back to the orb when a task reaches a terminal state, driven purely by observing the tasks array (worker-agnostic), for both PO turns and DEV runs.

#### Scenario: Delegation comet

- **WHEN** a task is submitted to Claude (PO or DEV)
- **THEN** a comet animates from the orb to the Work Stream panel and the card shows its submitted stamp

#### Scenario: Completion comet

- **WHEN** a task reaches a terminal state
- **THEN** a comet animates back to the orb and the completion flash/cue triggers

### Requirement: Per-task step timeline from Claude events

Each Work Stream card SHALL display a collapsible step timeline (tool calls / progress notes with running/done states) built from the existing Claude sidecar event stream (`claude_task_update` payloads from DEV NDJSON parsing and PO SDK message routing). Upstream's Hermes SSE ingestion (`hermes_task_event`) SHALL NOT be ported. If the current payload lacks start/end pairing, the existing `claude_task_update` payload MAY be extended with an additive structured phase field — no new IPC channel or event type.

#### Scenario: DEV run timeline

- **WHEN** a DEV run executes tool calls
- **THEN** the card's timeline shows each step in order, marking the current step as running and prior steps as done, updating in realtime

#### Scenario: PO turn timeline

- **WHEN** a PO turn executes tool calls in the resident SDK session
- **THEN** the same timeline presentation appears on the PO card, with no PO/DEV rendering differences

#### Scenario: Timeline toggle

- **WHEN** the user clicks (or dwell-clicks) the card's steps toggle
- **THEN** the timeline expands or collapses without affecting the run

### Requirement: A completed card shows the run's result, never the activity log

Each Work Stream card SHALL display the run's actual final result as its result text, distinct from the in-progress activity/step stream. When a run completes with an empty result, the card SHALL show an empty or placeholder result — it SHALL NOT fall back to showing the accumulated activity log as though that were the run's answer. Distinguishing an update that carries an empty result from one that carries no result field is required so an empty terminal result replaces, rather than preserves, whatever was shown during the run.

#### Scenario: Empty result does not show the activity log

- **WHEN** a run completes and its final result is empty
- **THEN** the card shows an empty or placeholder result
- **AND** the card does not present the accumulated tool-call activity log as the run's result (and no result overlay opens onto that log)

#### Scenario: A non-empty result is shown

- **WHEN** a run completes with a non-empty result
- **THEN** the card shows that result text as the run's result

#### Scenario: An update carrying no result leaves the shown text intact

- **WHEN** a `claude_task_update` arrives that carries no result field (e.g. a mid-run progress update)
- **THEN** the card's currently shown result text is left unchanged rather than being blanked
