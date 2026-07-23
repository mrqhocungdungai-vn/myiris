## MODIFIED Requirements

### Requirement: A run finalizes exactly once
Every run SHALL reach exactly one terminal status (`completed`, `failed`, `error`, or `cancelled`), even when the underlying transport reports failure through multiple callbacks (e.g. a spawn failure firing both `error` and `close`). Finalization SHALL emit exactly one terminal `claude_task_update` and trigger exactly one completion announcement.

Finalization SHALL release the execution slot, disarm the idle bound, and advance the queue **only for the run that currently holds the slot**. Finalizing a run that does not hold the slot SHALL still bring that run to its single terminal status and emit its one terminal update, but SHALL NOT release or advance the slot, and SHALL NOT disarm the idle bound of whichever run holds the slot — so a finalize targeting a non-slot-holding run can never steal the active run's slot or cancel its idle watchdog. Because a queued run is brought to `cancelled` without being routed through finalization (see "Stopping a run"), and every finalization in normal operation targets the run holding the slot, this guard changes no observed behavior; it makes the slot-ownership invariant structural rather than dependent on caller discipline.

#### Scenario: Double finalization is a no-op
- **WHEN** a run's transport reports termination twice (spawn `error` followed by `close`)
- **THEN** only the first report finalizes the run; the second produces no event, no announcement, and no queue advance

#### Scenario: Finalization releases the slot
- **WHEN** a run that holds the execution slot finalizes with any terminal status
- **THEN** the execution slot is released, its idle bound is disarmed, and the dequeue rule (above) runs

#### Scenario: Finalizing a run that does not hold the slot leaves the active run untouched
- **WHEN** `finalize` is called with the id of a run that is not the one currently holding the slot (and that run was not already finalized)
- **THEN** that run reaches its single terminal status and emits exactly one terminal update
- **AND** the run holding the slot keeps the slot and its idle bound, and no queued run is started as a side effect
