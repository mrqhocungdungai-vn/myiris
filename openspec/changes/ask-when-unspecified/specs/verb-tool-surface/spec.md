## MODIFIED Requirements

### Requirement: Statefulness is a fixed, enforced property of the verb

A verb SHALL be declared either **stateful** — its runs may pause mid-turn and ask the user by voice — or **stateless** — its runs are one-shot and hold no resident session. This SHALL be a declared property of the verb and SHALL NOT be selectable per call, because a run that pauses holds the single execution slot while it waits.

Whether a **stateless** verb's run may ask MAY be declared as a function of the state of the work it was given, on exactly the terms its other capability bounds already are: the registry resolves a verb's configuration against project state, and this SHALL be one more field resolved the same way rather than the one field that ignores it. What SHALL NOT vary is who decides — the value is derived where the run is configured, from state the caller does not supply and cannot set.

The two properties this requirement previously stated as one SHALL be kept apart, because only one of them is a safety property:

- **Not selectable by the caller.** This SHALL hold without exception. The safety concern is the single execution slot, and it is the *caller* — the voice layer, choosing a verb from what it heard — that must never be able to decide a run may block on a human.
- **Constant regardless of the work.** This SHALL NOT be assumed. A verb whose ability to ask is justified by the work already being settled has no such justification when it is not, and a configuration that cannot tell those apart cannot be correct in both.

A stateless verb SHALL NOT be able to ask unless the answer can be delivered to the user and back. Where it cannot — no voice layer is connected, or the one that was has gone away — the question tool SHALL be absent, and a run that reaches the question path anyway SHALL fail with a diagnostic rather than wait. A run SHALL NEVER wait for an answer nobody will give.

Statefulness SHALL mean only the ability to pause and ask. It SHALL NOT be conflated with conversational continuity: **every** verb, stateful or not, resumes its own prior conversation. Continuity is what makes a follow-up request intelligible; statefulness is what makes a mid-run question possible. They are independent.

Whether a verb may ask SHALL be enforced by the run's configuration, not by instruction alone — in both directions. A verb told it may ask but not given the tool, and a verb given the tool but told not to ask, are the same defect: a promise in a prompt with nothing behind it.

#### Scenario: A stateless verb working from a settled task list cannot ask

- **WHEN** a run started by a stateless verb executes against work that is already specified
- **THEN** the question tool is unavailable to it, enforced by configuration

#### Scenario: A stateless verb working without a specification may ask

- **WHEN** a run started by the implementing verb executes with no settled task list to work from
- **THEN** the question tool is available to it, because nothing upstream resolved the ambiguity it may hit

#### Scenario: The same verb resolves both ways

- **WHEN** the implementing verb is configured twice, once with settled work and once without
- **THEN** the two runs differ in whether the question tool is present, and in nothing else that was not already state-dependent

#### Scenario: Statefulness is not chosen per call

- **WHEN** the voice layer calls any verb
- **THEN** it cannot request that the run be made stateful, and it cannot request that the run be allowed to ask

#### Scenario: No listener, no question tool

- **WHEN** a run would otherwise be permitted to ask, but no voice layer is connected to relay the question
- **THEN** the question tool is absent from that run

#### Scenario: Statelessness does not cost continuity

- **WHEN** a stateless verb is called a second time in the same workstream
- **THEN** it resumes its own prior conversation and can be given a follow-up that refers to earlier work

#### Scenario: Capability bounds still come from the registry

- **WHEN** a run is configured for a verb
- **THEN** whether it may ask is read from that verb's declared configuration resolved against project state, not from the wording of the request
