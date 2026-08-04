## MODIFIED Requirements

### Requirement: Live question relay precedence

The live question relay (`voice-decision-relay` spec) SHALL be unaffected by voice UI control: while a question raised by a run is pending, TaskChooser SHALL NOT be shown, and a pending question SHALL always take precedence over an ambiguous open-task request.

#### Scenario: A pending question outranks an ambiguous open request

- **WHEN** a run's question is pending and the user makes an open-task request that matches several cards
- **THEN** no chooser is shown and the pending question is what the user is asked to resolve first

#### Scenario: Unambiguous UI actions still work

- **WHEN** a run's question is pending and the user asks for a UI-only action that names its target unambiguously
- **THEN** that action is performed without disturbing the pending question

## RENAMED Requirements

- FROM: `### Requirement: PO question relay precedence`
- TO: `### Requirement: Live question relay precedence`
