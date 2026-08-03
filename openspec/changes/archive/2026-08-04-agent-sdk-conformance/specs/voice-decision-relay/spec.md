## ADDED Requirements

### Requirement: A question survives the relay without losing its shape

A question raised by a role SHALL reach the user with everything that changes how it is answered: its short label, its options with their descriptions, and whether more than one option may be chosen.

A question that permits multiple selections SHALL be answerable with multiple selections — by voice, from the interface, and on the timeout fallback path. Iris SHALL NOT silently reduce a multiple-selection question to a single choice, which answers a different question than the one the role asked.

#### Scenario: A multiple-selection question is answered with multiple options

- **WHEN** a role asks a question that permits selecting more than one option
- **THEN** the user can choose several, and every chosen option reaches the role

#### Scenario: The timeout default respects the question's shape

- **WHEN** a multiple-selection question times out and the safe default is applied
- **THEN** the default is expressed in the shape the question asked for, not reduced to one option

#### Scenario: The question's label is relayed

- **WHEN** a question is read aloud
- **THEN** its short label is available to Iris as context for how to introduce it

### Requirement: End-of-run decisions travel as structured data

Decisions a role defers to the end of a run SHALL be produced as structured data validated against a declared schema, rather than parsed out of prose. Each decision SHALL carry its question, its options with descriptions, and the role's recommendation.

Iris SHALL prefer structured decisions when a run produces them. It SHALL retain the prose fallback for runs that do not — a session resumed from before the schema existed cannot produce one, and a run that completed its real work SHALL NOT be failed for being unable to format a summary.

A run terminated because it could not produce valid structured output after the runtime's retries SHALL be reported as its own outcome, not as a generic failure.

#### Scenario: Structured decisions are used when present

- **WHEN** a run produces structured decisions
- **THEN** Iris reads them from the structured result rather than parsing the prose output

#### Scenario: A run without structured decisions still relays them

- **WHEN** a run produces decisions only in prose
- **THEN** Iris relays them through the existing prose path

#### Scenario: A structured-output failure is named

- **WHEN** a run terminates because valid structured output could not be produced
- **THEN** the outcome names that cause rather than reporting a generic failure

## MODIFIED Requirements

### Requirement: PO is permitted to ask; DEV is not

PO SHALL be permitted to pause mid-turn and ask the user a question through the voice relay. DEV SHALL NOT.

DEV's inability to ask SHALL be enforced by the configuration of the run — the question tool SHALL be unavailable to it — and not by prompt instruction alone. A headless run SHALL additionally carry a handler for the question path that fails the run with a diagnostic, so that a headless run can never reach a state where it waits for an answer nobody is listening for.

The prompts SHALL continue to state the asymmetry, since the model needs to know it in order to plan; the prompt is the explanation, and the configuration is the guarantee.

#### Scenario: PO pauses and is answered

- **WHEN** PO reaches a decision that materially shapes the change
- **THEN** it pauses, the question reaches the user by voice, and the same turn resumes with the answer

#### Scenario: DEV cannot ask

- **WHEN** a DEV run executes
- **THEN** the question tool is not available to it

#### Scenario: A headless question attempt fails loudly

- **WHEN** a headless run reaches the question path despite the restriction
- **THEN** the run fails with a diagnostic naming the violation, rather than waiting indefinitely
