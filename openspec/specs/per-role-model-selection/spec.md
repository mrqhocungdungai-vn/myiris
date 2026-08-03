## Purpose

Lets the PO and DEV pipeline roles each run on an independently chosen Claude model, selectable per workstream via UI or voice, resolved fresh at run start with no automatic fallback, and traceable per run. (TBD: expand with broader rationale if needed.)

## Requirements

### Requirement: Model choice is stored per role per workstream

Each workstream SHALL persist a chosen Claude model per pipeline role in an `agent_models` object (`{ po?, dev? }`) stored beside `agent_sessions` in `~/.iris/claude-sessions.json`. Only the PO and DEV roles are model-selectable; the plain (role-less) Claude path SHALL keep the CLI default model and offer no model choice. Workstreams without an `agent_models` field (including all pre-existing ones) SHALL remain valid, and a legacy `agent_models.study` key SHALL be ignored on load rather than rejected.

#### Scenario: Model persists across app restarts

- **WHEN** the user sets DEV's model to Opus 5 in a workstream and restarts the app
- **THEN** the workstream still reports Opus 5 as DEV's model, while other workstreams are unaffected

#### Scenario: Legacy workstream without agent_models

- **WHEN** a workstream persisted before this change (no `agent_models` field) is loaded
- **THEN** it loads without error and each role's model resolves through the env/default fallback chain

#### Scenario: Legacy study key is ignored

- **WHEN** a workstream persisted with an `agent_models.study` entry is loaded
- **THEN** it loads without error, the key has no effect, and PO/DEV model resolution is unaffected

### Requirement: Model resolution order

For each role, the effective model SHALL resolve in this order: the workstream's `agent_models` entry, then the environment variable (`IRIS_PO_MODEL` for PO, `IRIS_DEV_MODEL` for DEV), then the hardcoded default — `claude-opus-5` for PO and `claude-sonnet-5` for DEV. The selectable model list SHALL be a curated constant of four models: Opus 5 (`claude-opus-5`), Sonnet 5 (`claude-sonnet-5`), Opus 4.8 (`claude-opus-4-8`), and Haiku 4.5 (`claude-haiku-4-5-20251001`), each with a display label.

#### Scenario: Fresh workstream uses role defaults

- **WHEN** a PO or DEV task runs in a workstream that has no `agent_models` entry and no `IRIS_PO_MODEL`/`IRIS_DEV_MODEL` env vars are set
- **THEN** PO runs on `claude-opus-5` and DEV runs on `claude-sonnet-5`

#### Scenario: Env var overrides the hardcoded default only

- **WHEN** `IRIS_DEV_MODEL=claude-haiku-4-5-20251001` is set and the workstream's `agent_models.dev` is `claude-opus-5`
- **THEN** DEV runs on `claude-opus-5` (the workstream choice outranks the env var)

### Requirement: DEV runs receive the model at run start

DEV (and only DEV — not plain Claude) runs SHALL pass the resolved model to the run via the SDK's `model` option. The model SHALL be resolved when the run actually starts executing, not when it is submitted, so a model change made while a task waits in the run queue applies to that task.

#### Scenario: Queued DEV task picks up a model change

- **WHEN** a DEV task is queued behind a running task and the user switches DEV's model from Sonnet 5 to Opus 5 before the queued task starts
- **THEN** the queued task starts with the model set to `claude-opus-5`

#### Scenario: Plain Claude run is unaffected

- **WHEN** a task runs with no pipeline role selected
- **THEN** the spawned command contains no `--model` flag

### Requirement: PO model applies without losing the live session

The PO's resolved model SHALL be passed as the SDK `model` option when its resident session is created. When the PO model changes while a live session exists, the app SHALL apply it via `query.setModel()` on that session so the next turn uses the new model with the session's context fully preserved — the session SHALL NOT be closed, recreated, or resumed to change models.

#### Scenario: Model switch on a live PO session keeps context

- **WHEN** a PO session is live with prior turns and the user switches PO's model
- **THEN** the app calls `setModel()` on the existing session, the next PO turn runs on the new model, and the PO can still reference its earlier conversation

#### Scenario: New PO session created with the chosen model

- **WHEN** the first PO turn of a workstream starts and the workstream has a stored PO model
- **THEN** the SDK session is created with that model in its options

### Requirement: Unavailable model fails loudly

When a selected model cannot be used (no subscription access, retired ID, hard availability error), the run SHALL fail through the existing error path — surfaced in the Work Stream and announced by voice like any other failed run. The app SHALL NOT configure automatic model fallback (`--fallback-model` / `fallbackModel`) or otherwise silently substitute a different model.

#### Scenario: Model rejected by the backend

- **WHEN** a DEV run starts with a model the account cannot use
- **THEN** the run ends in the existing failure state with the error visible in the Work Stream, and no run is retried on a different model automatically

### Requirement: UI model badge and popover on role chips

The PO and DEV chips in the session bar SHALL display the role's effective model as a badge and offer two distinct click zones: clicking the role label selects the role (existing behavior, unchanged), and clicking the model segment opens a popover listing the four curated models — without changing the active role. Selecting a model in the popover SHALL update that role's `agent_models` entry for the active workstream. The plain Claude chip SHALL have no model badge.

#### Scenario: Changing the inactive role's model

- **WHEN** PO is the active role and the user clicks the model segment of the DEV chip and picks Sonnet 5
- **THEN** DEV's stored model becomes Sonnet 5, its badge updates, and the active role remains PO

#### Scenario: Role selection behavior is preserved

- **WHEN** the user clicks the role label zone of a chip
- **THEN** the role switches exactly as before this change, with no model popover opening

### Requirement: Voice model switching via Gemini tool

Gemini SHALL be given a `set_agent_model` tool (role + model) that goes through the same handler as the UI path, and its system instruction SHALL mention the capability. The tool SHALL accept only the PO and DEV roles. A successful change SHALL emit a sidecar event so the renderer updates the chip badge immediately.

#### Scenario: Voice request changes DEV's model

- **WHEN** the user says to switch DEV to Opus 4.8 and Gemini calls `set_agent_model`
- **THEN** the workstream's `agent_models.dev` becomes `claude-opus-4-8`, a sidecar event updates the DEV chip badge, and the tool response confirms the change

#### Scenario: Invalid tool arguments are rejected

- **WHEN** Gemini calls `set_agent_model` with a role outside po/dev or a model outside the curated list
- **THEN** the tool returns an error message and no state changes

### Requirement: Runs are traceable to the model that executed them

Each run record SHALL store the model that was actually resolved when the run started (for role runs), and Work Stream task rows SHALL display that model next to the agent badge. Task rows for plain Claude runs show no model label.

#### Scenario: History distinguishes runs by model

- **WHEN** one DEV run executed on Sonnet 5 and a later one on Opus 5
- **THEN** each task row in the Work Stream shows the model that run actually used, even after the role's current setting changed again
