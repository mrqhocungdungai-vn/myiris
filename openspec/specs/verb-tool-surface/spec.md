## Purpose

Defines how Iris reaches the Claude worker: a set of named verbs, each carrying its own parameter schema, capability bounds, and run configuration, all declared in one registry, so a verb is defined in exactly one place.

## Requirements

### Requirement: Claude is reached through named verbs, not one undifferentiated task tool

The voice layer SHALL reach the Claude worker through a set of named functions, each describing one kind of work and each carrying its own parameter schema. It SHALL NOT be offered a single general-purpose task tool covering every kind of work.

The function's schema SHALL carry the shape of what that verb needs. Instructions about how to phrase a request for a particular kind of work SHALL NOT live as prose in the system instruction when a parameter can carry them — prose is advice a model may ignore, and a schema is a contract the calling interface enforces.

The system SHALL NOT require the user to name the kind of work, name a role, or operate a control in the interface in order to reach any verb.

#### Scenario: A request reaches the right verb without being labelled

- **WHEN** the user asks for work in ordinary language, naming no role and no mode
- **THEN** the voice layer selects a verb and the work begins, with no selection step asked of the user

#### Scenario: Shaping instructions live in the schema

- **WHEN** a verb needs a particular kind of input
- **THEN** that requirement is expressed in the verb's parameter schema rather than as prose telling the model how to write a general task string

#### Scenario: No general-purpose task tool remains

- **WHEN** the voice layer's tool declarations are built
- **THEN** no declaration offers undifferentiated "hand any work to Claude" behavior, beyond a deprecated alias retained for compatibility

### Requirement: One registry defines every verb

Each verb's full definition — whether it may pause to ask, whether it is reviewed before dispatch, which conversation it resumes, which model it runs on, which skills and external tool servers it may reach, its ceilings, and its parameters — SHALL live in a single registry.

Every consumer — the voice tool declarations, the review gate, and the run configuration — SHALL derive from that registry. A verb SHALL NOT be defined in more than one place. Two call sites independently constructing the same configuration, with nothing forcing them to agree, is the mechanism that produced a silently-dropped instruction in the runtime configuration; the registry exists so that cannot recur.

Registry resolution SHALL be a pure function of the verb and the project's current state, testable without the application running.

#### Scenario: Adding a verb touches one place

- **WHEN** a new verb is added
- **THEN** it is added to the registry, and the tool declaration, review behavior, and run configuration all follow from it

#### Scenario: Consumers cannot disagree

- **WHEN** a verb's configuration is read by any consumer
- **THEN** all consumers read the same registry record

#### Scenario: Resolution is testable in isolation

- **WHEN** a verb is resolved against a given project state
- **THEN** the resolution is computed without I/O and asserted directly

### Requirement: A verb sees only the capabilities its work needs

Each verb SHALL declare the skills and external tool servers available to the runs it starts. A verb SHALL NOT receive the full set of capabilities the application ships.

This is what makes verbs distinct tools rather than distinct names for one agent: without bounded capability surfaces, every verb would be the same worker under a different label.

#### Scenario: A verb cannot reach an unrelated capability

- **WHEN** a run started by an implementation verb executes
- **THEN** skills belonging to unrelated workflows — requirement-shaping, note-keeping — are unavailable to it

#### Scenario: Capability bounds come from the registry

- **WHEN** a run is configured for a verb
- **THEN** its available skills and tool servers are exactly those the registry declares for that verb

### Requirement: Statefulness is a fixed, enforced property of the verb

A verb SHALL be declared either **stateful** — its runs may pause mid-turn and ask the user by voice — or **stateless** — its runs never pause and never ask. This SHALL be fixed per verb and SHALL NOT be selectable per call, because a run that pauses holds the single execution slot while it waits.

Statefulness SHALL mean only the ability to pause and ask. It SHALL NOT be conflated with conversational continuity: **every** verb, stateful or not, resumes its own prior conversation. Continuity is what makes a follow-up request intelligible; statefulness is what makes a mid-run question possible. They are independent.

A stateless verb's inability to ask SHALL be enforced by the run's configuration, not by instruction alone.

#### Scenario: A stateless verb cannot ask

- **WHEN** a run started by a stateless verb executes
- **THEN** the question tool is unavailable to it, enforced by configuration

#### Scenario: Statelessness does not cost continuity

- **WHEN** a stateless verb is called a second time in the same workstream
- **THEN** it resumes its own prior conversation and can be given a follow-up that refers to earlier work

#### Scenario: Statefulness is not chosen per call

- **WHEN** the voice layer calls any verb
- **THEN** it cannot request that the run be made stateful

### Requirement: The user's own words reach the worker, fenced

Every verb's run SHALL receive the recent verbatim transcript of what the user said, fenced as untrusted input, alongside the parameters the voice layer supplies. The voice layer SHALL NOT be the only channel through which information about the request reaches the worker.

The parameters' role SHALL differ by statefulness, and the difference follows from what each kind of run can do about a thin brief:

- A **stateful** verb SHALL take a thin schema. Its model holds the session context and can pause to ask, so a thin brief is a starting point it repairs. Requiring the voice layer to enumerate details here would be worse, because enumeration is summarization and summarization drops things.
- A **stateless** verb SHALL keep concrete parameters as its instruction, with the transcript as background to check against. A run forbidden to ask cannot recover from a vague brief.

The transcript SHALL be bounded, and its inclusion SHALL NOT grow without limit on a long-resumed conversation.

#### Scenario: A thin spoken request still produces good work

- **WHEN** the user makes a request in loose spoken language and a stateful verb is called with a thin brief
- **THEN** the run receives the verbatim transcript, and pauses to ask when something material is missing

#### Scenario: A one-shot run gets an instruction, not rambling

- **WHEN** a stateless verb is called
- **THEN** its concrete parameters carry the instruction, and the transcript accompanies it as context rather than replacing it

#### Scenario: Spoken input is fenced

- **WHEN** transcript text is included in a run's prompt
- **THEN** it is fenced as untrusted input, regardless of it being the user's own speech

#### Scenario: Transcript inclusion is bounded

- **WHEN** a verb is called repeatedly within one long conversation
- **THEN** the transcript attached to each run stays within its configured bound

### Requirement: Every dispatch records why it happened

Each dispatch SHALL be logged with the verb selected, the resolved configuration, and the project state that produced it, so a request that reached the wrong verb is diagnosable rather than mysterious.

Offering several verbs creates more ways to select wrongly than one general tool did. That trade is accepted deliberately, and it is only acceptable while every selection is inspectable after the fact.

#### Scenario: A wrong selection can be traced

- **WHEN** a request reaches an unexpected verb
- **THEN** the selection, the configuration it resolved to, and the project state at that moment are all recorded

### Requirement: Prompt text describes the verb surface that exists

Text the app sends to the voice layer SHALL NOT assert that a current role, a
current agent, or an active worker exists, and SHALL NOT instruct the model to set
or withhold a parameter for selecting one. Iris chooses the verb per request from
the registry, so there is no such state to inherit and no such parameter to fill.

This extends the registry's authority to the prose surface. The declarations,
the park label, and the `query()` options are already derived from the registry
and asserted by tests; prompt strings are the only verb-describing surface with
neither a typechecker nor a runtime failure when they go stale, which is why they
survived the migration that removed roles.

The prohibition is on **claims**, not on vocabulary. Prose may describe a verb's
role in the pipeline, and internal identifiers may retain historical names; what
is forbidden is telling the model that a selectable current worker exists.

#### Scenario: No prompt instructs the model about an agent parameter

- **WHEN** the prompt and announcement text the app can send to the voice layer is examined
- **THEN** no string instructs the model to set, or to avoid setting, an agent or role parameter — because the verb is the tool being called, not a field within one

#### Scenario: No prompt refers to a currently-active worker

- **WHEN** the same text is examined
- **THEN** no string tells the model that a role or worker is already active for the session, or that a request will be routed to one

#### Scenario: The prohibition is asserted by a test

- **WHEN** the test suite runs
- **THEN** a test fails if any prompt or announcement string reintroduces a current-role or agent-parameter instruction, so a relapse is caught without a human reading the file
