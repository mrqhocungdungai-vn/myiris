## ADDED Requirements

### Requirement: A completion is announced aloud only for a run that actually started

The app SHALL speak a task-completion announcement to the voice layer only for a run that reached the execution slot and began running. A run that was finalized without ever starting SHALL NOT produce a spoken "Claude has returned" announcement. This generalizes the rule already applied to a run cancelled while still queued (which never started, so has no result to announce).

#### Scenario: A run that never started is not announced aloud

- **WHEN** a run is finalized without ever having started (for example, a run cancelled while queued, or one rejected at a gate before dispatch)
- **THEN** no spoken completion announcement is sent to the voice layer for it

#### Scenario: A run that started is announced on completion

- **WHEN** a run that started running reaches a terminal status
- **THEN** the completion is delivered to the voice layer (immediately if connected, buffered for reconnect otherwise)

### Requirement: A cancelled run is surfaced but not read aloud as a returned result

When a started run is finalized as `cancelled` — the user stopped it, or tore down the session it was running in — the app SHALL still surface it on the UI (the completion card), but SHALL NOT read it aloud to the user as though Claude had returned with a result. A run that faults or dies unexpectedly (`error`) SHALL still be announced aloud, since a silent failure is exactly the case the user needs told about.

#### Scenario: A user-cancelled run shows on the UI without a spoken result

- **WHEN** a started run is finalized as `cancelled` because the user stopped it or reset its session
- **THEN** the completion card is emitted to the UI
- **AND** the voice layer is not told to announce a returned result for it

#### Scenario: A faulted run is announced aloud

- **WHEN** a started run is finalized as `error`
- **THEN** the completion is announced to the voice layer so the user is told the run failed
