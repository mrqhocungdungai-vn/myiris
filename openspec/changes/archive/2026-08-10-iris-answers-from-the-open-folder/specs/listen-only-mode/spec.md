## MODIFIED Requirements

### Requirement: Iris is silent for the whole time the mode is engaged

While listen-only mode is engaged, Iris SHALL produce no reply the user can perceive — not as sound, and not as text. Any reply the model produces SHALL be discarded: it SHALL NOT appear in the transcript, SHALL NOT drive any speaking indication, and SHALL NOT be retained to the vault.

Discarding at the client SHALL be what guarantees this. The app SHALL additionally ask the model, in-band on the session and without reconfiguring it, to stay silent until told otherwise — but that request SHALL be treated as a cost reduction, not as the mechanism: it lives in the conversation and can therefore be evicted by context-window compression during a long engagement, and the guarantee SHALL NOT depend on it holding.

Because the session's activity detection is deliberately left untouched, the model SHALL continue to be asked for replies as speakers pause, and those replies SHALL continue to be discarded. This is accepted: it is what keeps the transcription flowing, and it is the price of not reconfiguring the session.

What Iris hears while the mode is engaged SHALL remain part of the conversation, so that once the mode is disengaged the user can ask about it.

Disengaging SHALL produce at most ONE short line, and only when a prepared answer was found for what was just heard (see the `prepared-answers` capability). In every other case — nothing prepared was found, or nothing was heard at all — Iris SHALL say nothing until the user next addresses her. This is the single exception to the mode ending in silence, and it exists because the user turns the mode off in order to answer a question: knowing an answer is ready is the one fact that is worth a sentence at that moment. Reading the answer out is a separate act and SHALL still wait for the user.

#### Scenario: Discarding holds when the instruction does not

- **WHEN** the model replies while listen-only mode is engaged, whether or not it received or retained the in-band request
- **THEN** the reply is discarded and the user perceives nothing

#### Scenario: No reply reaches the user while engaged

- **WHEN** the model produces a reply turn while listen-only mode is engaged
- **THEN** it produces no sound, does not appear in the transcript, and is not retained
- **AND** no speaking indication is shown

#### Scenario: Disengaging with a prepared answer says one line

- **WHEN** the user disengages listen-only mode and a prepared answer is found for what was heard
- **THEN** Iris says one short line stating that she has one
- **AND** she does not read it out or say anything further until the user speaks

#### Scenario: Disengaging with nothing prepared volunteers nothing

- **WHEN** the user disengages listen-only mode and no prepared answer is found
- **THEN** Iris says nothing until the user next addresses her
- **AND** replies work normally from that point

#### Scenario: What was heard is available afterwards

- **WHEN** the user disengages listen-only mode and asks about what was said while it was engaged
- **THEN** Iris answers from that conversation context
