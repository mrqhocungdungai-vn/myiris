## ADDED Requirements

### Requirement: In a live canvas conversation, the user's own words lead

When a turn is composed for a resident canvas conversation, the user's **verbatim utterance** SHALL be the instruction the turn carries, and the voice layer's reading of it SHALL travel alongside as a reading — labelled as such — rather than in place of it.

The verbatim record SHALL be flushed before a tool call is dispatched, so that the sentence which caused the turn is present in the transcript the turn is composed from. A turn SHALL NOT be composed from a transcript that is missing its own trigger.

Fencing of untrusted text is unchanged: this requirement governs which block leads, not whether input is fenced.

#### Scenario: The triggering sentence is in the turn

- **WHEN** the user says something that causes a canvas turn to start
- **THEN** that sentence is present in the verbatim material the turn carries

#### Scenario: A reading does not replace the words

- **WHEN** the voice layer's reading of an utterance differs from what the user actually said
- **THEN** the turn carries both, with the user's words as the instruction and the reading identified as an interpretation
