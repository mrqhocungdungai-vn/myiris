## Purpose

A pre-dispatch, slot-independent gate that parks a request for the user to Approve, Edit, or Cancel before any Claude tokens are spent, on the verbs whose registry record declares it — so a wrong or incomplete brief costs nothing to discover. Sits entirely before a verb dispatches into `run-execution-queue`; the queue, the resident session, and the one-shot run mechanism are untouched.

## Requirements

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

### Requirement: A parked review is resolved over a voice+UI settle-once relay, independent of the execution slot
A parked review SHALL be held as an at-most-one pending item, resolvable by either a voice tool decision or a UI action, whichever settles first; the later channel SHALL be a no-op. Resolving SHALL be one of: **approve** (optionally with edited brief text), or **cancel**. A subsequent task submission SHALL supersede the currently parked review, replacing it.

The pending review SHALL be a distinct object from the pending voice question and SHALL NOT suspend or resume the execution queue's idle bound, because a parked review holds no execution slot — the slot, if held, belongs to an unrelated run whose progress bound must not be paused by an unrelated review.

Approve SHALL dispatch the (possibly edited) brief against the **parked** workstream — never a re-read of the currently active workstream — and SHALL relay the real dispatch outcome (`queued`, `started`, or a synchronous terminal rejection such as a verb refusing for lack of an open change) back through whichever channel approved it. An empty or whitespace-only edited brief SHALL be rejected rather than dispatched.

#### Scenario: Approve dispatches the parked brief
- **WHEN** a parked review is approved
- **THEN** the brief is dispatched into the workstream it was parked under and the run proceeds through the normal queue, and the approving channel receives the true dispatch outcome

#### Scenario: Edit then approve
- **WHEN** the user edits the brief text and approves (deck UI)
- **THEN** the edited text is dispatched as the final brief without a round-trip through the voice layer, and an empty edit is refused

#### Scenario: Voice and UI approve simultaneously
- **WHEN** an approve arrives from the voice tool and the UI at nearly the same time
- **THEN** the first settles the review and dispatches once; the second is a no-op — the brief is never dispatched twice

#### Scenario: A new submission supersedes a parked review
- **WHEN** a review is parked and Gemini submits a revised brief (e.g. after a spoken correction)
- **THEN** the previous parked brief is discarded and replaced by the new one, and only the surviving brief can be approved

#### Scenario: Parking does not pause an active run's idle bound
- **WHEN** a stateless run holds the execution slot and a brief is parked for review
- **THEN** the stateless run keeps the slot and its idle watchdog continues to run, unaffected by the parked review

### Requirement: A review is cancelled on timeout and on session reset, never auto-sent
An unanswered review SHALL be cancelled after a configurable timeout `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (documented default) — never auto-approved, because auto-sending an unreviewed brief is exactly the waste the gate prevents. A pending review SHALL also be cancelled whenever the session is reset: a new session, a workstream switch, or a project-folder change. On any cancellation the voice layer SHALL be informed the brief was not sent.

#### Scenario: Timeout cancels without sending
- **WHEN** a parked review is neither approved nor cancelled before the timeout elapses
- **THEN** the review is cancelled, no brief is dispatched, and the voice layer is told the review expired

#### Scenario: Reset cancels a pending review
- **WHEN** the user starts a new session, switches workstream, or changes the project folder while a review is parked
- **THEN** the parked review is cancelled before the context changes, so no brief is ever dispatched into the wrong workstream

### Requirement: The voice layer is kept coherent across parking and resolution
On parking, the voice layer SHALL narrate a short summary of the brief and that the full brief is available on screen, rather than reading the entire brief aloud, and SHALL wait for a decision rather than treating the task as started. Because a parked review has no run id, the voice layer SHALL NOT query run status for it. On resolution by any channel — including a UI-driven approve, cancel, or a timeout — a system event SHALL inform the voice layer of the outcome so its turn state stays coherent.

#### Scenario: Narrate on park, do not read the whole brief
- **WHEN** a brief is parked in review mode
- **THEN** the voice layer speaks a brief summary plus "the full brief is on screen" and awaits approve/cancel, and does not attempt to fetch a run status

#### Scenario: UI resolution reaches the voice layer
- **WHEN** a parked review is approved, cancelled, or times out through a path the voice layer did not initiate
- **THEN** a system event notifies the voice layer of the resolution so it announces the correct outcome

### Requirement: Approving a parked brief stays available over voice
Removing the model's ability to change the review-mode flag SHALL NOT remove the model's ability to relay a decision on an already-parked brief. `approve` and `cancel` on a pending review SHALL remain reachable over voice, because the parked brief has already been surfaced to the user for a decision — the risk being closed is silent disarmament of the gate, not the user answering it out loud.

#### Scenario: Voice approve still dispatches
- **WHEN** a brief is parked and the user approves it by voice
- **THEN** the parked brief is dispatched against its parked workstream exactly as before this change

#### Scenario: Voice cancel still discards
- **WHEN** a brief is parked and the user cancels it by voice
- **THEN** the brief is discarded and nothing is sent to Claude

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
