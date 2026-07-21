## MODIFIED Requirements

### Requirement: Agents and capabilities are installed globally

The PO and DEV agents SHALL be installed under `~/.claude/agents/`, and the capabilities they depend on (the OpenSpec workflow skills/commands and the mattpocock skills) SHALL be available globally under `~/.claude`, so that every role is available on any workstream `cwd` without per-project plugin configuration. The app SHALL provide these through its bundled prerequisite installer (see `pipeline-setup-install`): personas are sync-installed (Iris-owned), third-party skills and `/opsx` commands are copied only where missing, and existing tool-managed installs (e.g. skills.sh symlinks) are never overwritten. The install step SHALL additionally remove a stale `~/.claude/agents/iris-study.md` left behind by earlier versions, so the user's agent list stays truthful after the STUDY role's removal.

#### Scenario: Global install makes capabilities cwd-independent

- **WHEN** a role runs in a `cwd` that has no project-local plugin or skill configuration
- **THEN** the agent and its required skills are still available, sourced from `~/.claude`

#### Scenario: Global install is idempotent

- **WHEN** the global install step runs and the agents/skills are already present
- **THEN** it does not duplicate or clobber them, and it does not run silently on every launch

#### Scenario: Fresh machine is fully provisioned by the bundled installer

- **WHEN** a user on a machine with an empty `~/.claude` runs the one-click install action
- **THEN** the personas, required skills, and `/opsx` commands are all present under `~/.claude` afterwards, with no manual third-party install commands required

#### Scenario: Stale study agent file is cleaned up

- **WHEN** the agent install step runs on a machine where an earlier Iris version installed `~/.claude/agents/iris-study.md`
- **THEN** that file is deleted, and only `iris-po.md` and `iris-dev.md` remain installed by Iris
