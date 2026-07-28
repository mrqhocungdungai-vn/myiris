## MODIFIED Requirements

### Requirement: State-change announcements survive a disconnected voice session
When the app needs to tell Iris about a workspace/session/role state change (active pipeline role selected — PO or DEV — or workspace/project-folder changed), it SHALL attempt immediate delivery to the live Gemini voice session, and if no voice session is currently connected, it SHALL buffer the announcement for redelivery once the voice session reconnects, rather than dropping it. The buffer SHALL be bounded to a fixed number of the most-recent announcements; if more announcements are buffered than the bound allows while the session is offline, the oldest SHALL be discarded in favour of the most recent, so a prolonged disconnection cannot grow the buffer without limit.

A voice session that is connected but in listening mode SHALL be treated as not currently deliverable: the announcement SHALL be buffered rather than sent. Injecting it would either interrupt the user's monologue — the one thing listening mode exists to prevent — or be discarded by the server and lost. For the same reason, the app SHALL NOT flush buffered announcements when it connects into a listening-mode session or reconnects across a listening-mode chunk rotation; the buffer SHALL be delivered on the first connect that is not in listening mode.

#### Scenario: Role selection announced while voice session is connected
- **WHEN** the user switches the active pipeline role (PO or DEV) while the Gemini voice session is connected and not in listening mode
- **THEN** the app immediately sends the role-selection announcement to the voice session

#### Scenario: Announcement raised while listening mode is engaged
- **WHEN** an announcement is generated while the voice session is connected but listening mode is engaged
- **THEN** the app buffers the announcement instead of sending it
- **AND** the user's monologue is not interrupted

#### Scenario: Buffered announcements are not flushed by a listening-mode connect
- **WHEN** the app connects into a listening-mode session, or reconnects across a listening-mode chunk rotation, while announcements are buffered
- **THEN** the buffered announcements remain buffered rather than being delivered into the listening session

#### Scenario: Buffered announcements are delivered once listening mode ends
- **WHEN** listening mode ends and the session returns to ordinary conversation with announcements still buffered
- **THEN** the buffered announcements are delivered in the order they were generated

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
- **THEN** they are delivered to the voice session in the order they were generated on the first reconnect that is not into a listening-mode session
