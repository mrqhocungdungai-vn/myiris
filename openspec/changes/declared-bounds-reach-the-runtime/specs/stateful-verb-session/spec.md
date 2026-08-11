## ADDED Requirements

### Requirement: A shared conversation enforces each turn's verb's tool bounds

Where two verbs share one resident conversation, the tool bounds that apply to
a turn SHALL be those of the verb that made that turn — enforced when a tool is
used, because the session's option set is fixed when the conversation opens and
cannot carry two verbs' different bounds at once.

The enforcement point SHALL be the same permission channel both run shapes
already use for tool decisions, and a turn's bound SHALL NOT persist into the
next turn: a tool withheld on one verb's turn is available again on a sibling
verb's turn in the same conversation, where that sibling declares it.

The limit SHALL be stated, not hidden: enforcing at use refuses a call the
model already composed — it does not remove the tool from the model's listing,
which only a session-level withholding could do and which a shared session
cannot have. The bound SHALL therefore never be described as making a tool
invisible to the conversation.

A turn-level refusal SHALL be ordered before the conversation's other
permission seams, so a withheld question tool is refused rather than relayed,
and a withheld write tool is refused rather than sent for confirmation.

#### Scenario: The bound follows the turn, not the session

- **WHEN** a canvas turn in the shared shaping conversation calls a file-editing tool, and the next voice turn of the same conversation runs the workflow CLI
- **THEN** the canvas turn's call is refused with the verb named, and the voice turn's call proceeds

#### Scenario: A refusal precedes the other seams

- **WHEN** a turn whose verb withholds a tool calls it, and that tool would otherwise be relayed or confirmed by another seam
- **THEN** the call is refused by the turn's bound, and the relay or confirmation is never invoked

#### Scenario: The note conversation's confirm seam is independent of the bound

- **WHEN** a note-editing turn whose verb withholds no tools proposes a destructive write
- **THEN** the write-confirmation seam still applies, unchanged by turn-bound enforcement
