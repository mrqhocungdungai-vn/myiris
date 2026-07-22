## Purpose

State-change announcements (role selection, workspace change, PO question, task completion) tell the Gemini voice layer about app-side changes so Iris can speak about them. Voice sessions can be disconnected at the moment a change happens (e.g. mid-reconnect), so announcements need a shared delivery mechanism that buffers for redelivery instead of silently dropping them.

## Requirements

### Requirement: State-change announcements survive a disconnected voice session
When the app needs to tell Iris about a workspace/session/role state change (active pipeline role selected — PO or DEV — or workspace/project-folder changed), it SHALL attempt immediate delivery to the live Gemini voice session, and if no voice session is currently connected, it SHALL buffer the announcement for redelivery once the voice session reconnects, rather than dropping it. The buffer SHALL be bounded to a fixed number of the most-recent announcements; if more announcements are buffered than the bound allows while the session is offline, the oldest SHALL be discarded in favour of the most recent, so a prolonged disconnection cannot grow the buffer without limit.

#### Scenario: Role selection announced while voice session is connected
- **WHEN** the user switches the active pipeline role (PO or DEV) while the Gemini voice session is connected
- **THEN** the app immediately sends the role-selection announcement to the voice session

#### Scenario: Workspace change announced while voice session is disconnected
- **WHEN** the user changes the active project folder or session while the Gemini voice session is disconnected (e.g. mid-reconnect)
- **THEN** the app buffers the workspace-change announcement
- **AND** delivers it to the voice session once it reconnects, instead of silently discarding it

#### Scenario: Role selection announced while voice session is disconnected
- **WHEN** the user switches the active pipeline role while the Gemini voice session is disconnected
- **THEN** the app buffers the role-selection announcement
- **AND** delivers it to the voice session once it reconnects, instead of silently discarding it

#### Scenario: Buffer does not grow without bound while offline
- **WHEN** more announcements are generated while the voice session is disconnected than the buffer's fixed bound allows
- **THEN** the buffer retains only the most-recent announcements up to that bound
- **AND** the oldest announcements beyond the bound are discarded rather than accumulating for the life of the process

### Requirement: Announcement delivery mechanism is shared across announcement kinds
The app SHALL route every voice-layer state-change announcement (role selection, workspace change, PO question, task completion) through one shared delivery mechanism that decides between immediate delivery and buffer-for-reconnect, so that all announcement kinds have consistent, predictable behavior when the voice session is offline.

#### Scenario: Buffered announcements are delivered in order on reconnect
- **WHEN** multiple announcements are buffered while the voice session is disconnected
- **THEN** they are delivered to the voice session in the order they were generated once it reconnects

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
