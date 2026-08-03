## MODIFIED Requirements

### Requirement: Review mode parks a brief before any tokens are spent

The system SHALL expose a single mode flag governing whether a request is dispatched immediately or reviewed first, with three settings: **never**, **always**, and **verb** (the default).

When the flag is **never**, a request SHALL dispatch immediately — no observable change from today's auto mode. When the flag is **always**, no Claude work SHALL start: the request SHALL be parked with no run and no run id created, and the submit path SHALL return a distinct `parked_for_review` status so the voice layer narrates a review prompt rather than announcing a started or queued run. These two settings SHALL reproduce today's off and on behaviors exactly.

When the flag is **verb**, whether a request is parked SHALL be a **declared property of the verb**, read from the verb registry. It SHALL NOT be derived from the wording of the request, which fails silently in both directions, and it SHALL NOT be derived from a heuristic over cost or context.

The park decision SHALL be made in the main process at dispatch. It SHALL NOT depend on the voice layer honoring an instruction, because instruction-level guarantees have already been shown not to hold in this system.

Parking SHALL cost zero Claude tokens: nothing reaches a resident session or starts a one-shot run until the review is approved.

#### Scenario: Auto mode is unchanged
- **WHEN** the flag is `never` and a request is submitted
- **THEN** it is dispatched immediately and the submitter receives the same `started` / `queued` / terminal result it receives today

#### Scenario: Always mode parks everything
- **WHEN** the flag is `always` and a request is submitted
- **THEN** no run is created, no resident-session turn is delivered, no one-shot run is started, and the submit path returns `parked_for_review`

#### Scenario: The park decision comes from the registry
- **WHEN** the flag is `verb` and a request is submitted
- **THEN** whether it parks is read from that verb's declared property, not computed from the request's text

#### Scenario: The gate does not rely on the voice layer
- **WHEN** the voice layer dispatches a verb declared as reviewed
- **THEN** the main process parks it regardless of what the voice layer intended

### Requirement: A reviewed conversation is approved once, not once per turn

For a verb whose runs pause and ask — a continuing conversation rather than a one-shot job — the review SHALL apply to the call that **opens** the conversation. Subsequent turns steering that same live conversation SHALL dispatch directly.

For a verb whose runs are one-shot and autonomous, the review SHALL apply to **every** call, because each call is a fresh unattended run against the project.

The consent unit is therefore the *conversation* for one kind of verb and the *run* for the other — which is exactly the difference between them. Requiring approval for each turn of a live spoken conversation would send the user to the screen mid-sentence and buy no safety: the conversation is already open and already spending.

Once a conversation ends, opening a new one SHALL require review again.

#### Scenario: Opening a conversation is reviewed
- **WHEN** the first call to a conversational verb is made and no live conversation exists
- **THEN** the request is parked for review

#### Scenario: Steering an open conversation is not re-reviewed
- **WHEN** a further call steers a conversation that is already open and was approved
- **THEN** it dispatches directly, with no second review

#### Scenario: A one-shot verb is reviewed every time
- **WHEN** a verb whose runs are one-shot and autonomous is called, however many times
- **THEN** each call is parked for review

#### Scenario: A new conversation is reviewed again
- **WHEN** a conversation has ended and a new one is opened
- **THEN** that opening call is parked for review

### Requirement: The mode flag is main-owned, env-defaulted, and persisted

The flag SHALL be owned in the main process, initialized from `IRIS_PROMPT_REVIEW` with a documented default of **verb**. The environment budget SHALL accept the three settings by name and SHALL continue to accept its previous boolean values, mapping them to `always` and `never` so an existing configuration is not silently reinterpreted. A single setter SHALL be the sole mutation point for the UI path. The renderer SHALL read the current value at mount through an IPC getter and receive a sidecar event whenever it changes. The setting SHALL persist by writing `IRIS_PROMPT_REVIEW` to the user config, and the config writer's allowlist SHALL include this key.

The flag SHALL NOT be writable by the voice model. No tool declaration exposing review-mode mutation SHALL be offered, and any such call SHALL be refused at execution time. The gate requires a human decision before privileged work is dispatched, so the channel it polices must not be able to disarm it — and this holds all the more now that the same channel also chooses which verb runs.

#### Scenario: Default from environment
- **WHEN** the app starts with no prior setting and `IRIS_PROMPT_REVIEW` unset
- **THEN** review mode is `verb`

#### Scenario: A previous boolean configuration is honoured
- **WHEN** the app starts with `IRIS_PROMPT_REVIEW` set to one of its previous boolean values
- **THEN** it starts in `always` or `never` respectively, reproducing that configuration's existing behavior

#### Scenario: Setting persists across restarts
- **WHEN** the user changes the setting from the UI and restarts
- **THEN** the app starts in the chosen setting and the renderer reflects it at mount

#### Scenario: The UI control funnels through one setter
- **WHEN** the mode is changed from the UI
- **THEN** the change goes through the single setter, is persisted, and a sidecar event updates the renderer

#### Scenario: The model is not offered a review-mode toggle
- **WHEN** the voice layer's tool declarations are built, in any availability state
- **THEN** no declaration for mutating review mode is present

#### Scenario: A forged review-mode call is refused
- **WHEN** the voice layer nonetheless emits a call naming a review-mode mutation tool
- **THEN** the call is refused with an error and the flag is unchanged

#### Scenario: Asking to disable review mode by voice is answered, not executed
- **WHEN** the user asks by voice to turn review mode off
- **THEN** Iris explains the control lives in the UI and does not change the flag
