## Purpose

State-change announcements (role selection, workspace change, PO question, task completion) tell the Gemini voice layer about app-side changes so Iris can speak about them. Voice sessions can be disconnected at the moment a change happens (e.g. mid-reconnect), so announcements need a shared delivery mechanism that buffers for redelivery instead of silently dropping them.

## Requirements

### Requirement: State-change announcements survive a disconnected voice session
When the app needs to tell Iris about a workspace/session/role state change (active pipeline role selected — PO, DEV, or STUDY — or workspace/project-folder changed), it SHALL attempt immediate delivery to the live Gemini voice session, and if no voice session is currently connected, it SHALL buffer the announcement for redelivery once the voice session reconnects, rather than dropping it.

#### Scenario: Role selection announced while voice session is connected
- **WHEN** the user switches the active pipeline role (PO, DEV, or STUDY) while the Gemini voice session is connected
- **THEN** the app immediately sends the role-selection announcement to the voice session

#### Scenario: Study role selection opens the study framing
- **WHEN** the user switches the active role to STUDY
- **THEN** the role-selection announcement instructs Iris to invite the user to open a source, synthesize it by voice, then ask to save a note or to verify — and, for a returning Study session, to offer a brief where-were-we

#### Scenario: Workspace change announced while voice session is disconnected
- **WHEN** the user changes the active project folder or session while the Gemini voice session is disconnected (e.g. mid-reconnect)
- **THEN** the app buffers the workspace-change announcement
- **AND** delivers it to the voice session once it reconnects, instead of silently discarding it

#### Scenario: Role selection announced while voice session is disconnected
- **WHEN** the user switches the active pipeline role while the Gemini voice session is disconnected
- **THEN** the app buffers the role-selection announcement
- **AND** delivers it to the voice session once it reconnects, instead of silently discarding it

### Requirement: Announcement delivery mechanism is shared across announcement kinds
The app SHALL route every voice-layer state-change announcement (role selection, workspace change, PO question, task completion) through one shared delivery mechanism that decides between immediate delivery and buffer-for-reconnect, so that all announcement kinds have consistent, predictable behavior when the voice session is offline.

#### Scenario: Buffered announcements are delivered in order on reconnect
- **WHEN** multiple announcements are buffered while the voice session is disconnected
- **THEN** they are delivered to the voice session in the order they were generated once it reconnects
