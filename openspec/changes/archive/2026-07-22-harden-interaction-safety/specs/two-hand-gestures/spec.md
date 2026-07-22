## MODIFIED Requirements

### Requirement: Universal point-and-hold click

A pointing primary hand dwelling ~300 ms over any interactive element (`button`, `a`, `[data-task-id]`, `[role="button"]`) SHALL trigger a click on it, including PO question answer options, step-timeline toggles, chips, and close buttons — EXCEPT elements explicitly marked as dwell-excluded (`[data-no-dwell]`, or any element contained within one). Dwell exclusion SHALL be reserved for destructive or irreversible controls — those whose action loses data or cannot be undone (e.g. removing the saved subscription token, starting a new session, switching the project folder) — so that a merely hovering hand cannot fire them. Excluded controls SHALL remain fully operable by mouse and by voice; only the hands-free dwell path skips them, and the dwell indicator SHALL NOT engage on them.

#### Scenario: Dwell-click a button

- **WHEN** the user points at a PO question option button and holds for the dwell duration
- **THEN** that option is selected exactly as a mouse click would

#### Scenario: Dwell-open still works

- **WHEN** the user points at a task card and dwells
- **THEN** the reader opens for that task (existing behavior preserved)

#### Scenario: Dwell over a destructive control does nothing

- **WHEN** the user's hand dwells over a control marked `[data-no-dwell]` (e.g. "Remove token", "New session")
- **THEN** no click is triggered and the dwell indicator does not engage on it
- **AND** the same control is still activatable by a mouse click or by voice
