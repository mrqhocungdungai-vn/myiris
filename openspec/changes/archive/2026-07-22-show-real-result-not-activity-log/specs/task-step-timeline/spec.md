## ADDED Requirements

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
