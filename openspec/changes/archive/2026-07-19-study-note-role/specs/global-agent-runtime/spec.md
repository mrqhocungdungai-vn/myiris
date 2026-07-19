## MODIFIED Requirements

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
