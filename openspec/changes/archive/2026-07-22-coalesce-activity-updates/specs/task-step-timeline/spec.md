## ADDED Requirements

### Requirement: Activity emission is rate-bounded without starving liveness or clobbering results

A run's free-text activity log MAY be pushed to the renderer as coalesced `claude_task_update` `running` events rather than one event per activity line, so a chatty run does not force a renderer update per line of output. This rate-bounding SHALL preserve three invariants:

- **The step timeline is unaffected.** Per-step phase updates (`tool_start` / `tool_end`) SHALL continue to be emitted as they occur, so the card's step timeline still updates in realtime (see "Each Work Stream card SHALL display a collapsible step timeline … updating in realtime"). Only the free-text activity log is coalesced.
- **The terminal result is never clobbered.** A coalesced activity emit SHALL NOT be delivered after the run's terminal `claude_task_update`. The terminal update carries the run's real result, and a late activity emit would overwrite it with the activity log, violating "A completed card shows the run's result, never the activity log."
- **The idle progress signal is unaffected.** Each activity line SHALL still register as run progress for the execution-slot idle bound (`run-execution-queue` "Slot is bounded by idle time"); coalescing the *renderer emit* SHALL NOT reduce the cadence at which the run proves liveness to the watchdog.

The coalescing SHALL be applied at the source and identically for every consumer, so deck and HUD receive the same stream.

#### Scenario: A burst of activity lines coalesces into fewer renderer updates

- **WHEN** a run produces many activity lines within one coalescing interval
- **THEN** the renderer receives at most one `running` `claude_task_update` for that interval, carrying the latest accumulated activity buffer
- **AND** no activity line is required to produce its own renderer update

#### Scenario: Step timeline stays realtime while activity coalesces

- **WHEN** activity-log emission is being coalesced and a tool call starts or ends
- **THEN** the corresponding `tool_start` / `tool_end` phase update is emitted without waiting for the activity coalescing interval, and the card's step timeline reflects it in realtime

#### Scenario: A pending coalesced activity emit is discarded at terminal

- **WHEN** a run reaches a terminal status while an activity emit is still pending on the trailing edge of the coalescing interval
- **THEN** the pending activity emit is discarded and never delivered after the terminal `claude_task_update`
- **AND** the card shows the run's real result, not the activity log

#### Scenario: Coalescing does not slow the idle progress signal

- **WHEN** a run produces activity lines at intervals shorter than the execution-slot idle bound
- **THEN** each line still registers as run progress and the run is not terminated by the idle watchdog, regardless of how the renderer emits are coalesced
