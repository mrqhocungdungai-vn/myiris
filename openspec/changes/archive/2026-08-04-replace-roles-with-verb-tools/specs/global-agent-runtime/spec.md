## MODIFIED Requirements

### Requirement: One system-prompt policy serves every run

The base system prompt for **every** run SHALL be produced by a single policy module. No run's prompt text SHALL be assembled at a call site, so two runs cannot drift apart by being built in two places.

The policy SHALL compose the prompt from two parts: the clause every run of a given **statefulness** receives — whether it may pause mid-turn and ask the user — and the one-line clause naming the **specific job** of the verb being run, which the verb registry declares. Runs of the same statefulness SHALL therefore differ by exactly their verb clause, and this SHALL be assertable by stripping the clauses and comparing what remains.

The policy SHALL emit the prompt on the field the runtime actually reads. An undeclared field that looks correct at the call site is silently discarded, which is how a resident session came to run with no base prompt at all while one-shot runs got a full one.

#### Scenario: Two runs of the same statefulness differ by one clause

- **WHEN** the instructions for two verbs of the same statefulness are built
- **THEN** removing each one's own verb clause leaves two identical strings

#### Scenario: A stateful run is told it may ask, a stateless one that it may not

- **WHEN** the instructions for a stateful and a stateless verb are built
- **THEN** only the stateful one is told to ask at real decision points, and the stateless one is told the question tool is not available to it

#### Scenario: No prompt is composed without a job

- **WHEN** the policy is called with no verb clause
- **THEN** it fails loudly rather than producing a prompt that names no job

### Requirement: Personas and capabilities ship with the app, not on the machine

The personas SHALL ship inside the app and be handed to the runtime **by value**, never installed into or read from the user's own agent directory. A project-local override SHALL still win, so a persona customized for one project keeps its customization.

There SHALL be one persona per **run shape** — not one per job — named for the property that actually differs at runtime: whether the run may pause and ask. What each verb is *for* SHALL come from its registry clause, and what it may *reach* from its declared skills, so one persona can serve several verbs without describing capabilities some of them lack.

A persona SHALL NOT name a specific skill unless every verb using that persona can reach it, since naming one otherwise instructs a run to invoke something it cannot see.

The app SHALL be able to remove persona files an earlier version installed into the user's agent directory — including those named for the retired roles — on explicit user action only.

#### Scenario: A run fails loudly when its persona cannot be loaded

- **WHEN** a run starts and its persona cannot be read from the bundle
- **THEN** the run fails with an error naming the verb, rather than silently running as something else

#### Scenario: A project-local override wins

- **WHEN** a project supplies its own copy of a persona
- **THEN** that copy is used for runs in that project, and the bundled one elsewhere

## RENAMED Requirements

- FROM: `### Requirement: One system-prompt policy serves every role`
- TO: `### Requirement: One system-prompt policy serves every run`
