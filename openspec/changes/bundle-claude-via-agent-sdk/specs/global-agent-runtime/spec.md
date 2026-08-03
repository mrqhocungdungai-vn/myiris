## MODIFIED Requirements

### Requirement: Agents and capabilities are installed globally

**Narrowed: personas are no longer installed at all; only the skills they depend on are.**

The PO and DEV personas SHALL ship inside the application bundle and SHALL be supplied to the Agent SDK **by value** as agent definitions, so no persona file is written outside the app and no provisioning step can be skipped. A project-local `<cwd>/.claude/agents/iris-<role>.md` SHALL still take precedence, since that is the one place a user is expected to customize a persona.

The capabilities the personas depend on (the OpenSpec workflow skills/commands and the mattpocock skills) SHALL remain available globally under `~/.claude`, because the SDK's skills option takes skill *names* rather than definitions and therefore still requires them on disk. These SHALL continue to be copied only where missing, never overwriting existing tool-managed installs.

The app SHALL remove persona files that an earlier version installed into `~/.claude/agents/` — `iris-po.md`, `iris-dev.md`, and the retired roles — because `~/.claude` remains a settings source and a stale copy could shadow, or drift from, the persona shipped in the current build. It SHALL NOT remove agent files it does not own.

#### Scenario: A role runs with nothing installed under ~/.claude/agents

- **WHEN** a role run starts on a machine whose `~/.claude/agents` is empty
- **THEN** the run proceeds using the bundled persona, with no install step required

#### Scenario: A project-local persona overrides the bundled one

- **WHEN** a role run starts in a `cwd` containing `.claude/agents/iris-<role>.md`
- **THEN** that file's persona is used instead of the bundled one

#### Scenario: Global skills remain cwd-independent

- **WHEN** a role runs in a `cwd` with no project-local skill configuration
- **THEN** its required skills are still available, sourced from `~/.claude`

#### Scenario: Legacy persona copies are cleaned up

- **WHEN** the install action runs on a machine where an earlier Iris installed persona files into `~/.claude/agents`
- **THEN** Iris's own persona files there are removed, and agent files belonging to anything else are left untouched

#### Scenario: A broken bundle fails loudly

- **WHEN** a role run starts and its persona cannot be read from the bundle
- **THEN** the run fails with an error naming the role, rather than silently falling back to plain Claude

## REMOVED Requirements

### Requirement: Personas are sync-installed into ~/.claude/agents by the one-click installer

**Reason**: obsolete. Personas are passed to the SDK by value, so there is nothing to install and nothing to keep in sync. The "Install agents" action and its IPC channel are removed; the run-time gate that failed a run when the persona file was missing is replaced by a bundle-integrity check. The retired-role cleanup this requirement also covered is preserved, restated as the legacy-cleanup migration above.
