## ADDED Requirements

### Requirement: Context supplement composer is available in both deck and HUD
The app SHALL provide a single-line, freeform text composer for supplementary context, docked to the bottom of the "Iris Conversation" panel in the deck and, identically, inside the collapsible Comms island of the Glass HUD, sharing the same component and behavior in both surfaces.

#### Scenario: Composer visible in the deck
- **WHEN** the deck is showing the Iris Conversation panel
- **THEN** a single-line composer input is docked at the bottom of that panel

#### Scenario: Composer visible in the HUD
- **WHEN** the Glass HUD's Comms island is expanded
- **THEN** the same composer input appears at the bottom of the comms bubble list, marked as an interactive `.hud-hit` element

### Requirement: Composer is enabled only while Iris is awake
The composer SHALL be disabled whenever Iris is asleep (no active voice session) and SHALL NOT accept or queue submissions in that state.

#### Scenario: Disabled while asleep
- **WHEN** Iris is asleep
- **THEN** the composer input is disabled and does not accept typed text or submission

#### Scenario: Enabled once awake
- **WHEN** Iris transitions to awake
- **THEN** the composer input becomes enabled and accepts typed text

### Requirement: Submitting supplement text echoes to the transcript and triggers Claude research
On Enter, the app SHALL immediately render the submitted text as a "You" bubble in the conversation transcript, and SHALL deliver the text to the live Gemini voice session as a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` event instructing Gemini to decisively compose a research/reference brief from the current conversation and the supplied text, and call `submit_claude_task` immediately without asking for confirmation, using the session's currently active pipeline role.

#### Scenario: Enter sends and echoes
- **WHEN** the user types text into the composer and presses Enter
- **THEN** the composer clears
- **AND** the submitted text appears as a "You" bubble in the transcript (deck and HUD)

#### Scenario: Gemini reacts decisively
- **WHEN** a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` event is delivered to a connected Gemini voice session
- **THEN** Gemini calls `submit_claude_task` with a brief combining the recent conversation and the supplied text, without first asking the user for confirmation

#### Scenario: Routed to the active role
- **WHEN** a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` is delivered while a pipeline role (PO or DEV) is active for the session
- **THEN** the resulting `submit_claude_task` call omits an explicit `agent` override, so the task is routed to that session's active role exactly as any other request would be

### Requirement: Context supplement delivery is not buffered while disconnected
Unlike other `SYSTEM_EVENT_*` announcements, a context supplement SHALL NOT be buffered for redelivery if the Gemini voice session is not connected at submission time — the composer being disabled while asleep is the only mechanism that prevents loss.

#### Scenario: No delivery attempted while disconnected
- **WHEN** a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` would be sent but the Gemini voice session is not connected
- **THEN** the event is not queued for later delivery
