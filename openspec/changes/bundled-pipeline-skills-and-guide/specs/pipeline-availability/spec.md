## MODIFIED Requirements

### Requirement: SetupPanel reports pipeline prerequisites with install guidance

The SetupPanel SHALL report, as checks beside the existing Claude CLI and subscription-token rows: the `openspec` CLI (resolved the same way the runtime resolves it), the required global skills under `~/.claude/skills` (`grilling`, `tdd`, `code-review`, `diagnosing-bugs`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change` — exactly the skills the personas invoke), and the installed Iris agent personas under `~/.claude/agents/` (`iris-po.md`, `iris-dev.md`), each as present/missing. All rows SHALL share a re-check action. Missing prerequisites SHALL be resolvable two ways: the one-click bundled install action (see the `pipeline-setup-install` capability) or the copyable manual install commands shown per row. The app SHALL NOT write into `~/.claude` at startup or without explicit user action.

#### Scenario: Missing prerequisites are actionable

- **WHEN** the user opens the SetupPanel on a machine without the `openspec` CLI, the global skills, or the agent personas
- **THEN** each missing item is shown with the one-click install action available and a copyable manual command as fallback, and nothing installs until the user acts

#### Scenario: Re-check reflects a completed install

- **WHEN** the user installs a missing prerequisite (via the button or manually) and triggers re-check
- **THEN** the corresponding row flips to present without restarting the app

#### Scenario: Skills check is presence-based

- **WHEN** the skills directories exist under `~/.claude/skills`
- **THEN** the panel reports them as detected (presence, not semantic validation), and deeper problems still surface through normal PO/DEV run errors

#### Scenario: No phantom requirements

- **WHEN** a machine has every bundled skill, command, and persona installed
- **THEN** every prerequisite row reports present — the required list contains only skills that actually exist and are actually invoked by the personas
