## ADDED Requirements

### Requirement: A fifth gate checks the living spec for drift

The gate chain SHALL include a check over `openspec/specs/` that fails when the
living spec carries retired vocabulary, placeholder text, a requirement contradicted
by its own scenarios, or an empty capability or requirement.

Every other gate in this repo checks code. The living spec is named as the source of
truth and is what the next change is authored from, yet it is the one artifact with
no automated check: a structural validator reported 43 capabilities passing while the
tree described three versions of the system at once, held one requirement duplicated
verbatim across two capabilities, and mandated four controls that no longer existed.
One of those stale requirements shipped a user-facing defect, because a scenario that
contradicted its own requirement read as the contract and was implemented.

**Retired vocabulary SHALL be registered, not inferred.** The check cannot know that a
term stopped naming something, so retiring a concept SHALL include registering its
name in the check's term list. Each registered term SHALL carry its own matching rule,
because a single global rule cannot be right for all of them: `PO` matches
case-sensitively with word boundaries, since `IRIS_PO_QUESTION_TIMEOUT_MS` and
`SYSTEM_EVENT_PO_QUESTION` are identifiers the code actually reads and a spec citing
them is correct; the noun `role` matches case-insensitively, because a
case-sensitive-only criterion is exactly what let 72 lowercase occurrences survive a
sweep that reported zero.

**Placeholder text SHALL fail.** A `Purpose` reading `TBD`, or a note to a future reader
such as "update after archive", is the source of truth declaring that it is not one.

**Checks SHALL be lexical or structural, never semantic.** The gate SHALL NOT attempt to
decide whether a requirement is true — no checker can, and one that tried would be
wrong often enough to be ignored. Verifying truth remains a human reading the code.

**The check SHALL NOT examine `openspec/changes/archive/`.** The archive is history and
must retain its retired vocabulary; it is the only record of where a rule used to
live, and a gate that rewrote it would destroy that record.

**An exemption SHALL be explicit and SHALL state its reason**, so a legitimate occurrence
is a decision visible in the diff rather than a silent adjustment to a pattern.

The gate SHALL fail closed and SHALL NOT offer a warn-only mode, consistent with the
rest of the chain: a warning on a fault with no runtime symptom is a warning nobody
reads. It SHALL remain independently runnable and SHALL NOT be folded into the
typecheck gate, for the same reason `lint` and `scan:secrets` are kept out of it.

#### Scenario: Retired vocabulary fails the gate

- **WHEN** a capability spec uses a term registered as retired
- **THEN** the gate fails, naming the file, the line, and the term

#### Scenario: An identifier containing a retired term still passes

- **WHEN** a spec cites `IRIS_PO_QUESTION_TIMEOUT_MS` or `SYSTEM_EVENT_PO_QUESTION`
- **THEN** the gate passes, because those are names the code reads and the spec is correct to use them

#### Scenario: A placeholder Purpose fails the gate

- **WHEN** a capability's `Purpose` is `TBD`, or contains a note directed at a future reader
- **THEN** the gate fails

#### Scenario: A requirement contradicted by its own scenario fails the gate

- **WHEN** a requirement forbids something and one of its own scenarios asserts that same thing as expected behavior
- **THEN** the gate fails, naming both the requirement and the scenario

#### Scenario: The archive is not examined

- **WHEN** the gate runs on a repository whose `openspec/changes/archive/` is full of retired vocabulary
- **THEN** the gate passes, having examined only the living spec

#### Scenario: The gate fails closed

- **WHEN** the check cannot complete
- **THEN** it exits non-zero rather than reporting success or skipping

#### Scenario: An exemption carries a reason

- **WHEN** an occurrence is deliberately allowed
- **THEN** the allowance is recorded explicitly with a stated reason, and the gate passes only for that occurrence
