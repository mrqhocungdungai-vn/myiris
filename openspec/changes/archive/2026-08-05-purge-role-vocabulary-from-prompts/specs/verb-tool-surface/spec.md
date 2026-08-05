## ADDED Requirements

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
