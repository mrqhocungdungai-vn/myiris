## MODIFIED Requirements

### Requirement: Model choice is stored per role per workstream

Each workstream SHALL persist a chosen Claude model per pipeline role in an `agent_models` object (`{ po?, dev?, study? }`) stored beside `agent_sessions` in `~/.iris/claude-sessions.json`. Only the PO, DEV, and STUDY roles are model-selectable; the plain (role-less) Claude path SHALL keep the CLI default model and offer no model choice. Workstreams without an `agent_models` field (including all pre-existing ones) SHALL remain valid.

#### Scenario: Model persists across app restarts

- **WHEN** the user sets DEV's model to Fable 5 in a workstream and restarts the app
- **THEN** the workstream still reports Fable 5 as DEV's model, while other workstreams are unaffected

#### Scenario: Legacy workstream without agent_models

- **WHEN** a workstream persisted before this change (no `agent_models` field) is loaded
- **THEN** it loads without error and each role's model resolves through the env/default fallback chain

#### Scenario: Study model persists per workstream

- **WHEN** the user sets STUDY's model to Opus 4.8 in a workstream and restarts the app
- **THEN** the workstream still reports Opus 4.8 as STUDY's model, independent of PO's and DEV's choices

### Requirement: Model resolution order

For each role, the effective model SHALL resolve in this order: the workstream's `agent_models` entry, then the environment variable (`IRIS_PO_MODEL` for PO, `IRIS_DEV_MODEL` for DEV, `IRIS_STUDY_MODEL` for STUDY), then the hardcoded default — `claude-fable-5` for PO, `claude-sonnet-5` for DEV, and `claude-sonnet-5` for STUDY. The selectable model list SHALL be a curated constant of four models: Fable 5 (`claude-fable-5`), Sonnet 5 (`claude-sonnet-5`), Opus 4.8 (`claude-opus-4-8`), and Haiku 4.5 (`claude-haiku-4-5-20251001`), each with a display label.

#### Scenario: Fresh workstream uses role defaults

- **WHEN** a PO, DEV, or STUDY task runs in a workstream that has no `agent_models` entry and no `IRIS_PO_MODEL`/`IRIS_DEV_MODEL`/`IRIS_STUDY_MODEL` env vars are set
- **THEN** PO runs on `claude-fable-5`, DEV runs on `claude-sonnet-5`, and STUDY runs on `claude-sonnet-5`

#### Scenario: Env var overrides the hardcoded default only

- **WHEN** `IRIS_DEV_MODEL=claude-haiku-4-5-20251001` is set and the workstream's `agent_models.dev` is `claude-fable-5`
- **THEN** DEV runs on `claude-fable-5` (the workstream choice outranks the env var)

### Requirement: UI model badge and popover on role chips

The PO, DEV, and STUDY chips in the session bar SHALL display the role's effective model as a badge and offer two distinct click zones: clicking the role label selects the role (existing behavior, unchanged), and clicking the model segment opens a popover listing the four curated models — without changing the active role. Selecting a model in the popover SHALL update that role's `agent_models` entry for the active workstream. The plain Claude chip SHALL have no model badge.

#### Scenario: Changing the inactive role's model

- **WHEN** PO is the active role and the user clicks the model segment of the STUDY chip and picks Sonnet 5
- **THEN** STUDY's stored model becomes Sonnet 5, its badge updates, and the active role remains PO

#### Scenario: Role selection behavior is preserved

- **WHEN** the user clicks the role label zone of a chip
- **THEN** the role switches exactly as before this change, with no model popover opening

### Requirement: Voice model switching via Gemini tool

Gemini SHALL be given a `set_agent_model` tool (role + model) that goes through the same handler as the UI path, and its system instruction SHALL mention the capability. A successful change SHALL emit a sidecar event so the renderer updates the chip badge immediately.

#### Scenario: Voice request changes STUDY's model

- **WHEN** the user says to switch STUDY to Opus 4.8 and Gemini calls `set_agent_model`
- **THEN** the workstream's `agent_models.study` becomes `claude-opus-4-8`, a sidecar event updates the STUDY chip badge, and the tool response confirms the change

#### Scenario: Invalid tool arguments are rejected

- **WHEN** Gemini calls `set_agent_model` with a role outside po/dev/study or a model outside the curated list
- **THEN** the tool returns an error message and no state changes
