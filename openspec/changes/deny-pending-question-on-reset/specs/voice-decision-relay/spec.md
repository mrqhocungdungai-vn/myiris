## ADDED Requirements

### Requirement: A session reset denies a pending question rather than answering it

When a pending PO question is settled because the user reset the session (New session, voice new-session, or a project-folder change) — as opposed to a timeout — the app SHALL settle the paused `canUseTool` callback as a **denial**, not as an answer. It SHALL NOT feed the asking role a fabricated or default selection on a deliberate reset, because doing so lets the role continue the torn-down turn and act on a decision the user never made — including writing files into the project folder the user just left. This is distinct from the timeout fallback, which continues to apply the recommended default for a question genuinely left unanswered.

#### Scenario: Reset denies the pending question

- **WHEN** the user resets the session while a PO question is pending
- **THEN** the pending callback is settled as a denial (no answer selection is supplied to the asking role)
- **AND** the paused turn is torn down without leaving an orphaned Claude process

#### Scenario: Reset does not act on a fabricated answer

- **WHEN** a pending question is denied because of a session reset
- **THEN** the asking role does not proceed to act on a default or fabricated selection for that question (e.g. it does not run a tool that writes into the abandoned project folder on the strength of a made-up answer)

#### Scenario: Timeout still applies the default, unchanged

- **WHEN** a PO question remains unanswered beyond the configured wait and no reset occurred
- **THEN** the callback is settled with the recommended default option and that default is recorded, exactly as before — the denial semantics apply only to a deliberate reset
