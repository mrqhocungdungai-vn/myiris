# workstream-switcher

## ADDED Requirements

### Requirement: SessionSwitcher UI bound to workstream IPC
The renderer SHALL replace the workstream `<select>` dropdown with the upstream `SessionSwitcher` component UI (list, create, and switch entries), rebound to the existing workstream IPC surface (`sessions:get`, `sessions:select`, `sessions:new`, `sessions:choose-cwd`) and per-role `agent_sessions` data model. No Hermes session IPC (`hermes:sessions`, `hermes:create-session`, `hermes:history`) SHALL be introduced.

#### Scenario: Listing and switching workstreams
- **WHEN** the user opens the session switcher
- **THEN** all workstreams are listed with their name and project folder (cwd)
- **AND** selecting one switches the active workstream exactly as the old dropdown did (including closing any resident PO session for the workstream being left, per existing main-process behavior)

#### Scenario: Creating a workstream
- **WHEN** the user activates the switcher's new-session action
- **THEN** a new workstream is created via the existing `sessions:new` flow, identical in behavior to the old New button

#### Scenario: Per-role session identity visible
- **WHEN** a workstream has stored PO and/or DEV Claude session ids
- **THEN** the switcher (or its active-row detail) surfaces that identity consistent with the existing `.claude-session-line` (`who ▸ id`) presentation

### Requirement: Project folder selection remains reachable
The project-folder attach flow (`sessions:choose-cwd`) SHALL remain reachable from the new UI with unchanged behavior, including its existing session-reset semantics when the folder changes.

#### Scenario: Choosing a folder from the new UI
- **WHEN** the user picks a different project folder
- **THEN** the workstream's cwd updates and sessions reset exactly as they do today
