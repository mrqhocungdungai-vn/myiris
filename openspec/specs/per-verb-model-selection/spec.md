## Purpose

Lets each verb run on an independently chosen Claude model, selectable per workstream via UI or voice, resolved fresh at run start with no automatic fallback, and traceable per run. The absence of a fallback is deliberate: silently substituting a different model would change both what the user is billed for and how the run behaves, with nothing in the record saying it happened.

## Requirements

### Requirement: Model choice is stored per verb per workstream
The model a run executes on SHALL be a property of the **verb**, stored per verb per workstream. Verbs differ in what they are for — settling requirements, reviewing, implementing, recording notes — and the reason to change a model is always about the kind of work, never about how the run is structured.

A workstream stored before verbs existed SHALL be migrated forward: a stored choice for the conversational worker applies to the conversational verbs, and a stored choice for the autonomous worker applies to the autonomous ones. No stored choice SHALL be discarded.

#### Scenario: A verb runs on its own model

- **WHEN** a verb is dispatched
- **THEN** the run executes on the model stored for that verb in that workstream, or that verb's default if none is stored

#### Scenario: A prior choice survives the upgrade

- **WHEN** a workstream stored before this change is loaded
- **THEN** its stored model choices are carried onto the corresponding verbs rather than reset

### Requirement: Model resolution order
For each verb, the effective model SHALL resolve in this order: the workstream's stored entry for that verb, then the environment default for that verb's persona group, then the verb's own declared default. The selectable model list SHALL be a curated constant of four models: Opus 5 (`claude-opus-5`), Sonnet 5 (`claude-sonnet-5`), Opus 4.8 (`claude-opus-4-8`), and Haiku 4.5 (`claude-haiku-4-5-20251001`), each with a display label.

The environment default SHALL be expressed per **persona group** rather than per verb, because a user setting a model in the environment is expressing how strong the thinking work should be, which is exactly that split. The previously documented role-named variables SHALL continue to be accepted as aliases, so an existing configuration is not silently reinterpreted.

#### Scenario: Fresh workstream uses each verb's declared default

- **WHEN** a verb runs in a workstream with no stored entry for it and no environment default set
- **THEN** it runs on the model its registry record declares, which differs between verbs according to what the work is worth

#### Scenario: Env default overrides the declared default only

- **WHEN** an environment default is set for a persona group and the workstream also has a stored entry for a verb in that group
- **THEN** the stored entry wins, because a choice made for this workstream outranks a machine-wide default

#### Scenario: A previously documented variable still applies

- **WHEN** the environment carries one of the role-named model variables and no current-named one
- **THEN** it is honoured for the corresponding persona group rather than ignored

### Requirement: Every run receives its model at run start
**Every** verb's runs SHALL pass the resolved model to the run. The model SHALL be resolved when the run actually starts executing, not when it is submitted, so a model change made while a request waits in the run queue applies to that request.

There is no longer a run shape that executes on whatever the runtime happens to default to: the previous carve-out for an unrolled "plain" run disappeared with that run kind, and a model no one chose is a model no one can account for afterwards.

#### Scenario: A queued request picks up a model change

- **WHEN** a request is queued behind a running one and the user changes that verb's model before the queued request starts
- **THEN** the queued request starts on the newly chosen model

#### Scenario: No run executes on an unstated model

- **WHEN** any verb's run starts
- **THEN** a resolved model accompanies it, and that model is what the run records

### Requirement: A model change applies without losing the live session
Changing the model for a verb whose runs share a live session SHALL be applied to that session in place, without closing or resuming it, so the conversation's context is preserved.

Because such verbs share one session, a model change SHALL apply to **all** verbs sharing it. The system SHALL state this when the change is made, rather than appearing to change one verb's model while silently changing another's. This coupling is a declared consequence of sharing a conversation, not a defect to work around.

#### Scenario: A live conversation changes model without losing context

- **WHEN** the model is changed for a verb whose live session is resident
- **THEN** the session continues with its context intact on the new model

#### Scenario: The coupling is stated

- **WHEN** the model is changed for one verb that shares a live session with another
- **THEN** the change applies to both and the system says so

### Requirement: Unavailable model fails loudly
When a selected model cannot be used (no subscription access, retired ID, hard availability error), the run SHALL fail through the existing error path — surfaced in the Work Stream and announced by voice like any other failed run. The app SHALL NOT configure automatic model fallback (`--fallback-model` / `fallbackModel`) or otherwise silently substitute a different model.

#### Scenario: Model rejected by the backend

- **WHEN** a stateless run starts with a model the account cannot use
- **THEN** the run ends in the existing failure state with the error visible in the Work Stream, and no run is retried on a different model automatically

### Requirement: The model a run executed on is shown on its own card
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
