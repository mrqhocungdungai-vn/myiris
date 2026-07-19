# global-agent-runtime Specification

## Purpose
TBD - globally-installed PO, DEV, and STUDY agent/runtime capabilities so any workstream can use them without per-project capability setup.
## Requirements
### Requirement: Agents and capabilities are installed globally

The PO, DEV, and STUDY agents SHALL be installed under `~/.claude/agents/`, and the capabilities they depend on (the OpenSpec workflow skills/commands and the mattpocock skills, plus the `open-second-brain` capabilities STUDY uses) SHALL be available globally under `~/.claude`, so that every role is available on any workstream `cwd` without per-project plugin configuration.

#### Scenario: Global install makes capabilities cwd-independent

- **WHEN** a role runs in a `cwd` that has no project-local plugin or skill configuration
- **THEN** the agent and its required skills are still available, sourced from `~/.claude`

#### Scenario: Global install is idempotent

- **WHEN** the global install step runs and the agents/skills are already present
- **THEN** it does not duplicate or clobber them, and it does not run silently on every launch

#### Scenario: Study agent installs alongside PO and DEV

- **WHEN** the agent install step runs
- **THEN** `~/.claude/agents/iris-study.md` is installed alongside `iris-po.md` and `iris-dev.md`, so the Study role is selectable on any workstream

### Requirement: cwd holds only project code and its OpenSpec

A workstream `cwd` SHALL be used only for the project's own code and its `openspec/` directory; capability configuration (agents, skills, commands) SHALL NOT be required in the `cwd`.

#### Scenario: Arbitrary project directory works as cwd

- **WHEN** the user points a workstream at an arbitrary project directory
- **THEN** the roles operate there using globally-installed capabilities, and only that project's `openspec/` is created or read locally

