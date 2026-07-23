## ADDED Requirements

### Requirement: Review mode parks a brief before any tokens are spent

The system SHALL expose a single mode flag governing whether a Gemini-authored task brief is dispatched immediately or reviewed first. When the flag is **off** (auto), submitting a task SHALL dispatch it exactly as before — no observable change. When the flag is **on** (review), submitting a task SHALL NOT start any Claude work: the brief SHALL be parked as `{ task, urgency, agent, workstream_id }` with no run and no run id created, and the submit tool SHALL return a distinct `parked_for_review` status so the voice layer narrates a review prompt rather than announcing a started or queued run.

Parking SHALL cost zero Claude tokens: nothing is delivered to a PO session or spawned as a DEV subprocess until the review is approved. The gate SHALL apply uniformly to every role (PO, DEV, and plain).

#### Scenario: Auto mode is unchanged
- **WHEN** review mode is off and a task is submitted
- **THEN** the task is dispatched immediately and the submitter receives the same `started` / `queued` / terminal result it receives today, with no review step

#### Scenario: Review mode parks instead of dispatching
- **WHEN** review mode is on and a task is submitted
- **THEN** no run is created, no PO turn is delivered, no DEV subprocess is spawned, and the submit tool returns `parked_for_review`
- **AND** the parked brief retains the workstream it was submitted under

### Requirement: The mode flag is main-owned, env-defaulted, and persisted

The review-mode flag SHALL be owned in the main process (it gates dispatch at submit time and the voice toggle originates there), initialized from an explicit environment budget `IRIS_PROMPT_REVIEW` with a documented default of on. A single setter SHALL be the sole mutation point for both the voice and UI toggle paths. The renderer SHALL read the current value at mount through an IPC getter and receive a sidecar event whenever it changes. The user's toggle SHALL persist by writing `IRIS_PROMPT_REVIEW` to the user config so the same key is both the startup default and the persisted override; the config writer's allowlist SHALL include this key so the toggle is not silently dropped.

#### Scenario: Default from environment
- **WHEN** the app starts with no prior toggle and `IRIS_PROMPT_REVIEW` unset
- **THEN** review mode is on by default; setting `IRIS_PROMPT_REVIEW=0` starts in auto mode

#### Scenario: Toggle persists across restarts
- **WHEN** the user turns review mode off (by voice or UI) and restarts the app
- **THEN** the app starts in auto mode, because the toggle was persisted to the user config, and the renderer reflects the persisted value at mount

#### Scenario: Both toggle paths funnel through one setter
- **WHEN** the mode is changed either by the voice tool or the UI toggle
- **THEN** the change goes through the single setter, is persisted, and a mode sidecar event updates the renderer

### Requirement: A parked review is resolved over a voice+UI settle-once relay, independent of the execution slot

A parked review SHALL be held as an at-most-one pending item, resolvable by either a voice tool decision or a UI action, whichever settles first; the later channel SHALL be a no-op. Resolving SHALL be one of: **approve** (optionally with edited brief text), or **cancel**. A subsequent task submission SHALL supersede the currently parked review, replacing it.

The pending review SHALL be a distinct object from the pending PO question and SHALL NOT suspend or resume the execution queue's idle bound, because a parked review holds no execution slot — the slot, if held, belongs to an unrelated run whose progress bound must not be paused by an unrelated review.

Approve SHALL dispatch the (possibly edited) brief against the **parked** workstream — never a re-read of the currently active workstream — and SHALL relay the real dispatch outcome (`queued`, `started`, or a synchronous terminal rejection such as the DEV no-open-change gate) back through whichever channel approved it. An empty or whitespace-only edited brief SHALL be rejected rather than dispatched.

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
- **WHEN** a DEV run holds the execution slot and a PO brief is parked for review
- **THEN** the DEV run keeps the slot and its idle watchdog continues to run, unaffected by the parked review

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
