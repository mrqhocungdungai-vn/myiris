## ADDED Requirements

### Requirement: Grilling gates artifact creation

The PO agent SHALL NOT create any planning artifact until it has been instructed to grill, and SHALL use the `grilling` skill to elicit and stress-test requirements first. Grilling's clarifying questions SHALL surface through the voice relay (`AskUserQuestion`), not raw stdin.

#### Scenario: PO refuses to produce artifacts before grilling

- **WHEN** the PO receives a work intent but has not been told to grill
- **THEN** the PO starts a grilling pass to clarify the request
- **AND** it does not yet create an OpenSpec change or any spec/task file

#### Scenario: Grilling questions reach the voice user

- **WHEN** the grilling pass needs a decision from the user
- **THEN** the question is raised via `AskUserQuestion` and answered by voice before grilling continues

### Requirement: A change exists before DEV runs

The PO SHALL create an OpenSpec change (via the propose flow) once grilling is satisfied, and this change SHALL exist before any DEV work is dispatched for that feature.

#### Scenario: Propose creates the change

- **WHEN** grilling has settled the requirements and the user approves proceeding
- **THEN** the PO runs the OpenSpec propose flow, creating `openspec/changes/<name>/` with its planning artifacts

#### Scenario: DEV is not dispatched without a change

- **WHEN** a DEV task is requested but no OpenSpec change with tasks exists for the feature
- **THEN** the DEV run is not started and the PO is told to propose a change first

### Requirement: DEV runs only on an open change with unchecked tasks

A DEV run SHALL start only when an open OpenSpec change has at least one unchecked task in its `tasks.md`; DEV implements the remaining tasks and, when the change is complete, it is archived to sync the living spec.

#### Scenario: DEV implements remaining tasks

- **WHEN** an open change has unchecked `- [ ]` items in `tasks.md`
- **THEN** the DEV run implements the remaining tasks and checks them off

#### Scenario: Completed change is archived

- **WHEN** every task in a change's `tasks.md` is checked and verification passed
- **THEN** the change is archived and its delta specs are synced into `openspec/specs/`

### Requirement: Task-status query reads OpenSpec

When asked whether tasks remain, the PO SHALL read the open changes' `tasks.md` files and report done/not-done, and MAY brainstorm a new change when none remain.

#### Scenario: PO reports outstanding tasks

- **WHEN** the user asks the PO "are there tasks left?"
- **THEN** the PO reads `openspec/changes/*/tasks.md` and reports which tasks are outstanding or that all are complete

#### Scenario: No tasks remain

- **WHEN** all changes are complete and the user asks what is next
- **THEN** the PO reports completion and may propose or brainstorm a new change

### Requirement: OpenSpec is the single SDD surface

The pipeline SHALL use OpenSpec (`openspec/changes/` → `openspec/specs/`) as the only spec-driven-development surface; the personas SHALL NOT create or read a `.scratch/<slug>/` hand-written SDD. A `cwd` without OpenSpec SHALL be initialized with `openspec init` before proposing.

#### Scenario: New project is initialized

- **WHEN** the PO is about to propose in a `cwd` that has no `openspec/` directory
- **THEN** `openspec init` is run in that `cwd` before the change is created

#### Scenario: No .scratch artifacts are produced

- **WHEN** the PO completes its work for a feature
- **THEN** the deliverables live under `openspec/changes/<name>/` and no `.scratch/<slug>/` analysis/PRD/issue files are written
