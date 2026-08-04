## Purpose

A shared freeform context supplement composer that lets the user add extra research/reference context from both the deck and the Glass HUD, routing that context into Iris's active Gemini session for immediate Claude task creation.

## Requirements

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
On Enter, the app SHALL immediately render the submitted text as a "You" bubble in the conversation transcript, and SHALL deliver the text to the live Gemini voice session as a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` event instructing Gemini to decisively compose a research/reference brief from the current conversation and the supplied text, and to call **the verb that fits it** immediately without asking for confirmation.

It SHALL NOT instruct the voice layer to call a general-purpose task tool, and it SHALL NOT rely on a currently-selected role to route the work: no such selection exists, and depending on one meant the same supplement produced different work depending on a control the user may never have touched.

#### Scenario: Supplement text reaches Claude as research

- **WHEN** the user submits supplementary text while Iris is awake
- **THEN** the text appears in the transcript as a "You" bubble, and Gemini composes a brief from the conversation plus that text and dispatches it without first asking for confirmation

#### Scenario: Routing is chosen, not inherited

- **WHEN** a supplement is dispatched
- **THEN** the verb is selected from what the supplement asks for, with no dependence on any prior selection

### Requirement: Context supplement delivery is not buffered while disconnected
Unlike other `SYSTEM_EVENT_*` announcements, a context supplement SHALL NOT be buffered for redelivery if the Gemini voice session is not connected at submission time — the composer being disabled while asleep is the only mechanism that prevents loss.

#### Scenario: No delivery attempted while disconnected
- **WHEN** a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` would be sent but the Gemini voice session is not connected
- **THEN** the event is not queued for later delivery
