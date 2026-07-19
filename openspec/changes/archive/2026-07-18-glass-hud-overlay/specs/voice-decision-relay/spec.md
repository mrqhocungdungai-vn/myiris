# voice-decision-relay (delta)

## ADDED Requirements

### Requirement: PO questions remain answerable in HUD mode
While HUD mode is active, a pending PO question SHALL surface inside the overlay as an interactive (`.hud-hit`) banner offering the same per-question options as the deck banner, answerable by voice, mouse click, or gesture dwell-click. All existing relay semantics (single pending question, first-answer-wins, timeout fallback to the recommended option, settlement on session reset) apply unchanged in HUD mode, and the TaskChooser suppression rule while a question pends holds in HUD mode as well.

#### Scenario: Answering by click while floating
- **WHEN** the PO asks a question while HUD mode is active
- **THEN** the question banner appears as a HUD island, and clicking (or dwell-clicking) an option resolves the paused turn exactly as it would in deck mode

#### Scenario: Voice answer with HUD up
- **WHEN** a PO question is pending in HUD mode and the user answers by voice
- **THEN** the relay resolves via `answer_po_question` unchanged, and the banner dismisses in the overlay
