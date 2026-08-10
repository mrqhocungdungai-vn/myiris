## MODIFIED Requirements

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

**Where two verbs would overlap, the choice SHALL be a declared parameter of one verb, not a contest between two descriptions.** A routing decision expressed only as prose in two competing descriptions has no error path: the voice layer always selects something, so a wrong selection is indistinguishable from a right one, and a verb whose description loses simply never runs while its configuration goes on being paid for. Such a parameter SHALL be constrained by the schema — an enumeration the API enforces — rather than described in a sentence, and the configuration that differed between the two verbs SHALL resolve from it.

A parameter that selects configuration SHALL travel with the run to execution, including across the review gate, so an approved run executes as the call that was made. Where it is absent, resolution SHALL fall to the cheaper reading, never to the more expensive one.

#### Scenario: Asking for a judgement gets the judging configuration

- **WHEN** the voice layer calls the reading verb with its depth set to judging
- **THEN** the run uses the strongest model and the review skills

#### Scenario: An approved run is the call that was parked

- **WHEN** a judging call is parked for review and then approved
- **THEN** the dispatched run still carries the judging depth

#### Scenario: A missing depth is never the expensive one

- **WHEN** a run reaches execution with no depth recorded
- **THEN** it resolves to the explaining configuration
