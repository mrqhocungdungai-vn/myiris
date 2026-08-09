## MODIFIED Requirements

### Requirement: The live session's lifecycle is user-controlled

A live session SHALL persist until an explicit lifecycle event ends it: the user resetting or switching the conversation, a different conversation taking the shared session, the workstream or working directory changing, the credential changing, the conversation reaching its own spend ceiling, or the app quitting. **The passage of time SHALL NOT end residency**, and neither SHALL the closing of a surface that the conversation is about.

A conversation MAY be opened in anticipation of use — warmed when the surface it serves is opened — provided the same gates that govern any session opening are satisfied, and provided the review gate is asked at that moment rather than deferred or skipped.

#### Scenario: Residency survives quiet

- **WHEN** a live session sits idle for an extended period
- **THEN** it is still the same session when the user speaks again

#### Scenario: Residency survives the surface closing

- **WHEN** the surface the conversation is about is closed and later reopened
- **THEN** the same conversation continues, with its context intact

#### Scenario: A warmed conversation is a real one

- **WHEN** a conversation is opened in anticipation of use
- **THEN** it is subject to the same gates, review, and lifecycle rules as one opened by an utterance
