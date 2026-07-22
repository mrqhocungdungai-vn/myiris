## MODIFIED Requirements

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
