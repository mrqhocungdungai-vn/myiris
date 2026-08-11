## ADDED Requirements

### Requirement: Declared tool bounds bind on every run shape

A verb's declared tool withholdings SHALL be enforced on every run shape its
runs use — the one-shot shape and the resident shape alike. A declaration one
shape honors and the other silently drops is a statement with nothing behind
it, and the registry SHALL NOT carry comments claiming enforcement that a run
shape does not provide.

A refused tool call SHALL be answered with a refusal that names the verb and
states the way forward; it SHALL NOT end the run or fail the turn.

#### Scenario: The resident shape enforces the same declaration

- **WHEN** a run of a verb that withholds file-editing tools executes on the resident shape and calls one of them
- **THEN** the call is refused with the verb named, exactly as the one-shot shape would refuse it, and the turn continues

#### Scenario: A refusal is an answer, not a failure

- **WHEN** a withheld tool is called mid-turn
- **THEN** the model receives the refusal and can complete the turn by the means the verb does permit
