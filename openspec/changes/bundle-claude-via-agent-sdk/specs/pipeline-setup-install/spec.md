## MODIFIED Requirements

### Requirement: Required third-party skills ship as bundled snapshots

The vendored third-party skills and `/opsx` commands SHALL ship inside the app as a **Claude Code plugin** (`resources/iris-plugin/`, with `.claude-plugin/plugin.json`, `skills/`, and `commands/`), and SHALL reach a run through the Agent SDK's `plugins` option rather than by being copied anywhere.

Everything the plugin provides is namespaced by the plugin name (`iris:grilling`, `/iris:opsx:apply`). The persona prompts SHALL reference those namespaced names, since that is what the runtime exposes.

Attribution for the vendored sources SHALL be retained alongside the plugin.

#### Scenario: Skills are available with nothing installed on the machine

- **WHEN** a role run starts on a machine whose `~/.claude` contains no Iris skills or commands
- **THEN** every skill the personas invoke is available to the run, sourced from the app bundle

#### Scenario: A damaged bundle is reported as such

- **WHEN** the plugin directory is missing or incomplete
- **THEN** the setup panel reports it as a damaged bundle to reinstall, and does not offer an install command that could not fix it

### Requirement: One-click installer with two write policies

**Replaced by: Iris installs nothing into the user's Claude Code, and offers to remove what older versions did.**

The app SHALL NOT write to the user's `~/.claude` — not skills, not commands, not agent personas. It SHALL NOT read from it either: `settingSources` SHALL exclude the `user` scope, so a run neither depends on nor is perturbed by the user's own Claude Code configuration. The `project` scope SHALL remain enabled, so a run still picks up the settings of the repository it is working in.

For machines that ran an earlier Iris, the app SHALL be able to report exactly which files it previously wrote into `~/.claude`, and SHALL offer to remove them. Removal SHALL be an explicit user action, never automatic, and SHALL delete only paths Iris itself installed — anything else in that directory is the user's and is left untouched.

#### Scenario: A run leaves the user's Claude Code untouched

- **WHEN** any role run executes
- **THEN** no file under `~/.claude` is created, modified, or deleted, and nothing under it is loaded into the run

#### Scenario: Leftovers from an older version are reported

- **WHEN** the setup panel opens on a machine where an earlier Iris installed skills, commands, or personas into `~/.claude`
- **THEN** it reports how many such files exist and where, without modifying any of them

#### Scenario: Removal is scoped to what Iris installed

- **WHEN** the user chooses to remove those leftovers
- **THEN** exactly the paths Iris previously wrote are deleted, and unrelated agents, skills, and commands in the same directories remain

#### Scenario: A fresh machine has nothing to clean up

- **WHEN** the setup panel opens on a machine that never ran an older Iris
- **THEN** no cleanup is offered
