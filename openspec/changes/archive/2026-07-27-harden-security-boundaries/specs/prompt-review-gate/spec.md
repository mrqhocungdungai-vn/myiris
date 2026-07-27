## MODIFIED Requirements

### Requirement: The mode flag is main-owned, env-defaulted, and persisted

The review-mode flag SHALL be owned in the main process (it gates dispatch at submit time), initialized from an explicit environment budget `IRIS_PROMPT_REVIEW` with a documented default of on. A single setter SHALL be the sole mutation point for the UI toggle path. The renderer SHALL read the current value at mount through an IPC getter and receive a sidecar event whenever it changes. The user's toggle SHALL persist by writing `IRIS_PROMPT_REVIEW` to the user config so the same key is both the startup default and the persisted override; the config writer's allowlist SHALL include this key so the toggle is not silently dropped.

The flag SHALL NOT be writable by the voice model. No tool declaration exposing review-mode mutation SHALL be offered to the Gemini session, and any such call SHALL be refused at execution time as a defensive backstop. The gate exists to require a human decision before privileged work is dispatched, so the channel it polices must not be able to disarm it.

#### Scenario: Default from environment
- **WHEN** the app starts with no prior toggle and `IRIS_PROMPT_REVIEW` unset
- **THEN** review mode is on by default; setting `IRIS_PROMPT_REVIEW=0` starts in auto mode

#### Scenario: Toggle persists across restarts
- **WHEN** the user turns review mode off from the UI and restarts the app
- **THEN** the app starts in auto mode, because the toggle was persisted to the user config, and the renderer reflects the persisted value at mount

#### Scenario: The UI toggle funnels through one setter
- **WHEN** the mode is changed by the UI toggle
- **THEN** the change goes through the single setter, is persisted, and a mode sidecar event updates the renderer

#### Scenario: The model is not offered a review-mode toggle
- **WHEN** the Gemini session's tool declarations are built, in any pipeline-available state
- **THEN** no declaration for mutating review mode is present

#### Scenario: A forged review-mode call is refused
- **WHEN** the voice layer nonetheless emits a call naming a review-mode mutation tool
- **THEN** the call is refused with an error and the flag is unchanged

#### Scenario: Asking to disable review mode by voice is answered, not executed
- **WHEN** the user asks by voice to turn review mode off
- **THEN** Iris explains the toggle lives in the UI and does not change the flag

## ADDED Requirements

### Requirement: Approving a parked brief stays available over voice

Removing the model's ability to change the review-mode flag SHALL NOT remove the model's ability to relay a decision on an already-parked brief. `approve` and `cancel` on a pending review SHALL remain reachable over voice, because the parked brief has already been surfaced to the user for a decision — the risk being closed is silent disarmament of the gate, not the user answering it out loud.

#### Scenario: Voice approve still dispatches
- **WHEN** a brief is parked and the user approves it by voice
- **THEN** the parked brief is dispatched against its parked workstream exactly as before this change

#### Scenario: Voice cancel still discards
- **WHEN** a brief is parked and the user cancels it by voice
- **THEN** the brief is discarded and nothing is sent to Claude
