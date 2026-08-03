## ADDED Requirements

### Requirement: Personas and capabilities ship with the app, not on the machine

The PO and DEV personas SHALL ship inside the application bundle and SHALL be supplied to the Agent SDK **by value** as agent definitions, so no persona file is written outside the app and no provisioning step can be skipped. A project-local `<cwd>/.claude/agents/iris-<role>.md` SHALL still take precedence, since that is the one place a user is expected to customize a persona.

The capabilities the personas depend on — the OpenSpec workflow skills and `/opsx` commands, and the vendored third-party skills — SHALL also ship inside the bundle and reach a run through the SDK's plugin mechanism, so they are available on any machine and in any `cwd` without being installed. Nothing SHALL be copied into the user's `~/.claude` to make a run work.

The app SHALL be able to remove persona files that an earlier version installed into `~/.claude/agents/` — `iris-po.md`, `iris-dev.md`, and the retired roles — on an explicit user action. It SHALL NOT remove agent files it does not own.

#### Scenario: A role runs with nothing installed under ~/.claude/agents

- **WHEN** a role run starts on a machine whose `~/.claude/agents` is empty
- **THEN** the run proceeds using the bundled persona, with no install step required

#### Scenario: A project-local persona overrides the bundled one

- **WHEN** a role run starts in a `cwd` containing `.claude/agents/iris-<role>.md`
- **THEN** that file's persona is used instead of the bundled one

#### Scenario: Capabilities are cwd-independent without being installed

- **WHEN** a role runs in a `cwd` with no project-local skill configuration, on a machine with nothing of Iris's in `~/.claude`
- **THEN** its required skills and commands are still available, sourced from the app bundle

#### Scenario: Legacy persona copies can be cleaned up

- **WHEN** the user runs the cleanup action on a machine where an earlier Iris installed persona files into `~/.claude/agents`
- **THEN** Iris's own persona files there are removed, and agent files belonging to anything else are left untouched

#### Scenario: A broken bundle fails loudly

- **WHEN** a role run starts and its persona cannot be read from the bundle
- **THEN** the run fails with an error naming the role, rather than silently falling back to plain Claude

## REMOVED Requirements

### Requirement: Agents and capabilities are installed globally

**Reason**: replaced by shipping both inside the app. The requirement's premise was that a run could find a persona or a skill only if it had been copied to a global location on the machine. The SDK takes personas by value and skills from a plugin path, so there is nothing to install, no install step to skip, and no reason for the app to write into `~/.claude` at all.
**Migration**: none required. Files an earlier version installed there are inert; the app reports them and removes them on an explicit click.

### Requirement: Personas are sync-installed into ~/.claude/agents by the one-click installer

**Reason**: obsolete. Personas are passed to the SDK by value, so there is nothing to install and nothing to keep in sync. The "Install agents" action and its IPC channel are removed; the run-time gate that failed a run when the persona file was missing is replaced by a bundle-integrity check. The retired-role cleanup this requirement also covered survives as the legacy-cleanup behavior above.
**Migration**: none.
