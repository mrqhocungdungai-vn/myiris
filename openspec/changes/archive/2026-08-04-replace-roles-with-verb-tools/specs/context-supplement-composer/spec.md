## MODIFIED Requirements

### Requirement: Submitting supplement text echoes to the transcript and triggers Claude research

On Enter, the app SHALL immediately render the submitted text as a "You" bubble in the conversation transcript, and SHALL deliver the text to the live Gemini voice session as a `SYSTEM_EVENT_CONTEXT_SUPPLEMENT` event instructing Gemini to decisively compose a research/reference brief from the current conversation and the supplied text, and to call **the verb that fits it** immediately without asking for confirmation.

It SHALL NOT instruct the voice layer to call a general-purpose task tool, and it SHALL NOT rely on a currently-selected role to route the work: no such selection exists, and depending on one meant the same supplement produced different work depending on a control the user may never have touched.

#### Scenario: Supplement text reaches Claude as research

- **WHEN** the user submits supplementary text while Iris is awake
- **THEN** the text appears in the transcript as a "You" bubble, and Gemini composes a brief from the conversation plus that text and dispatches it without first asking for confirmation

#### Scenario: Routing is chosen, not inherited

- **WHEN** a supplement is dispatched
- **THEN** the verb is selected from what the supplement asks for, with no dependence on any prior selection
