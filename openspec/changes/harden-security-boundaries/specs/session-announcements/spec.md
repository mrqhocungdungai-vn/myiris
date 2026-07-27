## ADDED Requirements

### Requirement: Third-party output is announced as data, never as instructions

An announcement that carries text Iris did not author — a run's result, a tool's output — SHALL present that text inside an explicitly delimited data region, and SHALL state in the surrounding envelope that the region is untrusted content to be summarized, not directions to follow. The instruction lines that tell Iris how to deliver the announcement SHALL precede the data region and SHALL NOT be interleaved with it, so no ambiguity exists about where Iris's own directions end.

This is the boundary that makes delegation safe: a run's output is produced by a worker that reads files, repositories, and the web, so its content is attacker-reachable. Framing it identically to Iris's own system events would let any text a run happens to read issue commands to the voice layer.

#### Scenario: A completion result is fenced as data
- **WHEN** a run completes and its result is announced
- **THEN** the result text appears inside a delimited region marked as untrusted data, after the delivery instructions, not as free text under an instruction heading

#### Scenario: Instructions are not repeated after the data region
- **WHEN** the announcement envelope is built
- **THEN** every line directing Iris's behavior appears before the data region opens

### Requirement: Untrusted output cannot forge a system event

Before third-party text is injected into the voice session, any occurrence of a system-event marker or data-region delimiter inside that text SHALL be neutralised so it cannot terminate the data region or open a new event. A run whose output contains the literal text of an announcement marker SHALL be announced without that marker taking effect.

#### Scenario: A result containing a system-event marker is defanged
- **WHEN** a run returns output containing a literal `SYSTEM_EVENT_` marker
- **THEN** the announcement is delivered with that marker neutralised, and the voice layer treats it as ordinary result text

#### Scenario: A result containing the delimiter cannot escape the data region
- **WHEN** a run returns output containing the data-region delimiter
- **THEN** the occurrence is neutralised and the region still closes only where the envelope closes it

#### Scenario: Ordinary output is unchanged in meaning
- **WHEN** a run returns output with no markers or delimiters
- **THEN** the announced text is semantically the same as before this change
