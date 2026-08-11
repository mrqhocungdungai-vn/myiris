# renderer-structure — delta

## MODIFIED Requirements

### Requirement: Zero behavior change for Claude-specific UI

All Claude-specific renderer features SHALL survive the restructure with identical behavior: pipeline bar with its verb roster; per-verb model popover; question banner with clickable options; Claude session line and ⛓ chain badges; project-folder bar; CLAUDE telemetry row; and handling of the existing `claude_*` (including `claude_question`) and `agent_*` sidecar events.

#### Scenario: Custom features re-hosted as components

- **WHEN** the refactor is complete
- **THEN** the pipeline bar + model popover, the question banner, and the project bar exist as dedicated components under `src/components/` and are composed by `App.tsx`

#### Scenario: Smoke checklist passes

- **WHEN** the manual smoke checklist runs (wake, submit a task, answer a question by click, change a verb's model, switch/create workstream, choose project folder, open reader and history, dwell-open a card, palm-scroll)
- **THEN** every step behaves exactly as it did before the refactor
