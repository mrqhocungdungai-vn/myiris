## MODIFIED Requirements

### Requirement: The split preserves all observable behavior

The reorganization SHALL NOT change any observable behavior. No IPC channel SHALL be added, removed or renamed; `electron/preload.cjs`'s `window.iris` surface SHALL be unchanged; no dependency SHALL be added; and every pinned external identifier (the Gemini Live model and voice, the 16 kHz send / 24 kHz receive sample rates, `sendRealtimeInput`) SHALL move verbatim.

Every existing capability spec SHALL remain true against its current text without edit. A spec that requires rewording to stay true indicates the split changed behavior, and the code SHALL be corrected rather than the spec. This requirement describes the module reorganization only; where a later change retires a capability outright, the retired capability drops out of the checks below rather than making them false.

#### Scenario: IPC surface is unchanged

- **WHEN** the set of channel names registered after the split is compared to the set before
- **THEN** the two sets are identical

#### Scenario: Existing specs remain true

- **WHEN** the capability specs for voice relay, PO live session, run execution queue, listen-only mode, HUD, session announcements and config persistence are checked against the reorganized code
- **THEN** each remains satisfied with no change to its requirement text

#### Scenario: The app behaves identically

- **WHEN** the manual smoke path runs (launch, wake, hold a voice turn, submit a task through the review gate, answer a PO question by voice, cross the PO→DEV gate, switch workstream, choose a project folder, enter and exit HUD mode, enter and exit listen-only mode, mute the microphone, quit)
- **THEN** every step behaves exactly as it did before the split
