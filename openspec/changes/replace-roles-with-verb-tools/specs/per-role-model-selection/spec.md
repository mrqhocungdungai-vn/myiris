## MODIFIED Requirements

### Requirement: Model choice is stored per role per workstream

The model a run executes on SHALL be a property of the **verb**, stored per verb per workstream. Verbs differ in what they are for — settling requirements, reviewing, implementing, recording notes — and the reason to change a model is always about the kind of work, never about how the run is structured.

A workstream stored before verbs existed SHALL be migrated forward: a stored choice for the conversational worker applies to the conversational verbs, and a stored choice for the autonomous worker applies to the autonomous ones. No stored choice SHALL be discarded.

#### Scenario: A verb runs on its own model

- **WHEN** a verb is dispatched
- **THEN** the run executes on the model stored for that verb in that workstream, or that verb's default if none is stored

#### Scenario: A prior choice survives the upgrade

- **WHEN** a workstream stored before this change is loaded
- **THEN** its stored model choices are carried onto the corresponding verbs rather than reset

### Requirement: PO model applies without losing the live session

Changing the model for a verb whose runs share a live session SHALL be applied to that session in place, without closing or resuming it, so the conversation's context is preserved.

Because such verbs share one session, a model change SHALL apply to **all** verbs sharing it. The system SHALL state this when the change is made, rather than appearing to change one verb's model while silently changing another's. This coupling is a declared consequence of sharing a conversation, not a defect to work around.

#### Scenario: A live conversation changes model without losing context

- **WHEN** the model is changed for a verb whose live session is resident
- **THEN** the session continues with its context intact on the new model

#### Scenario: The coupling is stated

- **WHEN** the model is changed for one verb that shares a live session with another
- **THEN** the change applies to both and the system says so

### Requirement: UI model badge and popover on role chips

The interface SHALL show which model a run executed on, on the run's own card. It SHALL NOT surface model selection on a control for choosing a current worker, because no such control exists — the verb is chosen per request.

#### Scenario: A run card shows its model

- **WHEN** a run is displayed
- **THEN** its card shows the verb and the model that executed it

#### Scenario: No worker-selection control carries the model

- **WHEN** the interface is rendered
- **THEN** no persistent worker-selection control is present for the model badge to attach to

### Requirement: Voice model switching via Gemini tool

The voice layer SHALL be able to change a verb's model on explicit request, through the same single choke point the interface uses, so the two cannot diverge. It SHALL NOT change a model on its own initiative.

#### Scenario: A spoken model change takes effect

- **WHEN** the user explicitly asks for a verb to run on a different model
- **THEN** the change is applied through the shared choke point and confirmed

#### Scenario: No unprompted model change

- **WHEN** the voice layer handles any request that is not an explicit model change
- **THEN** no model is changed

### Requirement: Runs are traceable to the model that executed them

Every run SHALL record the verb it ran as and the model it executed on, so a result can be attributed after the fact.

#### Scenario: A finished run names its verb and model

- **WHEN** a run reaches a terminal state
- **THEN** the verb and the model that executed it are recorded with the run
