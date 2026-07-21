## ADDED Requirements

### Requirement: One-click install of missing pipeline prerequisites

The SetupPanel SHALL offer an "Install missing" action beside the prerequisite check rows whenever any of the agents, bundled skills, or `/opsx` commands are missing. Activating it SHALL run the pipeline prerequisite installer (see `pipeline-setup-install`: personas sync-installed, third-party skills/commands copied only where missing), then automatically re-run the checks so the rows reflect the new state in place. The per-row copyable manual commands SHALL remain available as a fallback, and the PipelineBar's existing "Install agents" action SHALL keep working unchanged (both paths call the same agents install).

#### Scenario: One click turns the rows green

- **WHEN** the agents and skills rows show missing and the user clicks "Install missing"
- **THEN** the installer runs, the checks re-run automatically, and the previously missing rows report present without reopening the panel

#### Scenario: Install reports what it did

- **WHEN** the install action completes
- **THEN** the panel surfaces the result (installed vs already-present vs errors) rather than silently flipping state

#### Scenario: Manual path still works

- **WHEN** a user prefers their own tooling and runs the copyable commands instead
- **THEN** re-check reflects their install identically, and the "Install missing" button disappears once nothing is missing
