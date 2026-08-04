## Purpose

Bundles the third-party skills and commands the verbs invoke as repo-vendored snapshots and ships them inside the app as a Claude Code plugin, reaching a run through the Agent SDK's `plugins` option. There is no install step and nothing to provision: a fresh machine needs only a Claude credential, and the app never writes into the user's own `~/.claude`.
## Requirements
### Requirement: Setup and workflow guide is documented bilingually

The repo SHALL contain a voice-first pipeline guide in English (`docs/PIPELINE_GUIDE.md`) and Vietnamese (`docs/PIPELINE_GUIDE.vi.md`), cross-linked, sharing one section structure: what the pipeline is, setup steps ending at a saved Claude credential, a walkthrough of what to say at each stage (the shaping verb grills → "propose" → an implementing verb works the tasks → archive) that explains `/opsx:propose`/`/opsx:apply` are run by the agents rather than typed by the user, an appendix on using the agents directly in Claude Code, and troubleshooting mapped to the SetupPanel check rows. The README pipeline section SHALL link to the guide instead of duplicating it.

#### Scenario: A new user reaches a working pipeline from the guide alone

- **WHEN** a community user follows the guide's setup section on a machine that has never had Claude Code or the `openspec` CLI installed
- **THEN** the guide states that both ship inside Iris, covers the one step that remains — obtaining and saving a Claude credential — and ends with the SetupPanel rows reading bundled and the credential row satisfied

#### Scenario: Voice walkthrough teaches speaking, not typing

- **WHEN** the user reads the walkthrough section
- **THEN** each pipeline stage is described as what to say to Iris and what to expect back, and the `/opsx` commands are explained as the agents' internal mechanism

### Requirement: Third-party skills and commands ship as a bundled plugin

The vendored third-party skills and `/opsx` commands SHALL ship inside the app as a **Claude Code plugin** (`resources/iris-plugin/`, with `.claude-plugin/plugin.json`, `skills/`, and `commands/`), and SHALL reach a run through the Agent SDK's `plugins` option rather than by being copied anywhere.

Everything the plugin provides is namespaced by the plugin name (`iris:grilling`, `/iris:opsx:apply`). The verb prompts SHALL reference those namespaced names, since that is what the runtime exposes.

Attribution for the vendored sources SHALL be retained alongside the plugin.

#### Scenario: Skills are available with nothing installed on the machine

- **WHEN** a run starts on a machine whose `~/.claude` contains no Iris skills or commands
- **THEN** every skill the verbs invoke is available to the run, sourced from the app bundle

#### Scenario: A damaged bundle is reported as such

- **WHEN** the plugin directory is missing or incomplete
- **THEN** the setup panel reports it as a damaged bundle to reinstall, and does not offer an install command that could not fix it

### Requirement: Iris installs nothing into the user's Claude Code, and offers to remove what older versions did

The app SHALL NOT write to the user's `~/.claude` — not skills, not commands, not agent personas, and not the session transcripts a run produces. It SHALL NOT read from it either: `settingSources` SHALL exclude the `user` scope, so a run neither depends on nor is perturbed by the user's own Claude Code configuration. The `project` scope SHALL remain enabled, so a run still picks up the settings of the repository it is working in.

`settingSources` alone SHALL NOT be relied on for this. Session transcripts, the always-read global `.claude.json`, and auto-memory are read and written regardless of it, and all resolve under `CLAUDE_CONFIG_DIR`. Every run SHALL therefore also run with `CLAUDE_CONFIG_DIR` pointed at storage the app owns, and with auto-memory disabled. That directory SHALL be stable across runs, since a resumed session has to find the transcript an earlier run wrote.

A consequence of the pinned directory is that the host Claude Code's own login is no longer reachable. This is intended: a credential SHALL come from the environment, which is what the availability gate already requires. Authenticating from the host's credential store would make the app depend on the user's Claude Code install and would hide, on a developer machine, the failure a machine without one would hit.

For machines that ran an earlier Iris, the app SHALL be able to report exactly which files it previously wrote into `~/.claude`, and SHALL offer to remove them. Removal SHALL be an explicit user action, never automatic, and SHALL delete only paths Iris itself installed — anything else in that directory is the user's and is left untouched.

#### Scenario: A run leaves the user's Claude Code untouched

- **WHEN** any run executes
- **THEN** no file under `~/.claude` is created, modified, or deleted, and nothing under it is loaded into the run

#### Scenario: A run's transcript goes to the app's own storage

- **WHEN** a run executes and its session transcript is written
- **THEN** the transcript is written under the app's own state directory, and the user's `~/.claude/projects/` is unchanged

#### Scenario: A resumed session finds its transcript

- **WHEN** a run resumes a session recorded by an earlier run
- **THEN** the transcript is found in the app's state directory and the conversation continues

#### Scenario: A resume id that no longer resolves is dropped

- **WHEN** a run resumes a session id whose transcript no longer exists
- **THEN** the stored id is discarded so the next run in that workstream starts a fresh session, whether the runtime reported the failure as a result or raised it

#### Scenario: Leftovers from an older version are reported

- **WHEN** the setup panel opens on a machine where an earlier Iris installed skills, commands, or personas into `~/.claude`
- **THEN** it reports how many such files exist and where, without modifying any of them

#### Scenario: Removal is scoped to what Iris installed

- **WHEN** the user chooses to remove those leftovers
- **THEN** exactly the paths Iris previously wrote are deleted, and unrelated agents, skills, and commands in the same directories remain

#### Scenario: Transcripts that cannot be attributed to Iris are left alone

- **WHEN** cleanup runs on a machine where earlier Iris versions wrote transcripts into `~/.claude/projects/`
- **THEN** only the directory for the app's own scratch workspace is removed, and directories keyed by the user's real project paths remain — those hold the user's own Claude Code sessions for the same projects and cannot be told apart

#### Scenario: A fresh machine has nothing to clean up

- **WHEN** the setup panel opens on a machine that never ran an older Iris
- **THEN** no cleanup is offered

