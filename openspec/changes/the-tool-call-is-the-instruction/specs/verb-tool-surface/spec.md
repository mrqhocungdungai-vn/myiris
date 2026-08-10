## ADDED Requirements

### Requirement: The voice layer's tool call carries the instruction

What the voice layer passes in a verb's function call SHALL be what the run acts on. No other material attached to that run SHALL be given standing above it, and no run SHALL be instructed to prefer any other block over it.

The voice layer is a speech model that reasons over the audio itself. Its function-call arguments are the output of the component that actually heard the request. Any transcription of that same audio is produced by a separate recognizer, is optional to the session, and fails silently — a mishearing arrives looking exactly like an accurate reading. Giving that output authority over the model's own inverts which of the two can be trusted, and the app SHALL NOT do so.

When a call is too thin to act on, the remedy SHALL be the schema and the tool's description — more room for the voice layer to say what it understood, and clearer guidance on when to say it — never a second channel that competes with the call. A stateful verb MAY also resolve thinness by asking, which is what its statefulness is for.

#### Scenario: The call outranks everything attached to it

- **WHEN** a run's brief is composed
- **THEN** the parameters of the call that started it are presented as the instruction
- **AND** no attached material is described as taking precedence over them

#### Scenario: A transcription that disagrees does not win

- **WHEN** attached transcript text disagrees with the call's parameters
- **THEN** the run follows the parameters
- **AND** the transcript is available to it as material that may be mistaken

#### Scenario: A thin call is fixed at the schema

- **WHEN** the voice layer routinely supplies too little for a verb to act well
- **THEN** the remedy is that verb's parameter schema and tool description
- **AND** no block is promoted above the call to compensate

## MODIFIED Requirements

### Requirement: The user's own words reach the worker, fenced

Every verb's run SHALL receive the recent transcript of what was said near the user's microphone, fenced as untrusted input, alongside the parameters the voice layer supplies. The voice layer SHALL NOT be the only channel through which information about the request reaches the worker.

That transcript SHALL accompany the run as corroboration and SHALL NOT be presented as the instruction. It is an automatic transcription running beside the conversation, not the voice layer's understanding of it, and it can be wrong in ways nothing downstream can detect. Its purpose is to let a run notice a detail the call did not carry — not to override the call when the two differ.

The label the transcript is fenced under SHALL say what it is, including that it is an automatic transcription that may be inaccurate. A label that describes it as the request to act on would contradict the standing it actually has.

The parameters' role SHALL differ by statefulness, and the difference follows from what each kind of run can do about a thin brief:

- A **stateful** verb SHALL take a thin schema. Its model holds the session context and can pause to ask, so a thin brief is a starting point it repairs.
- A **stateless** verb SHALL keep concrete parameters as its instruction, with the transcript as background to check against. A run forbidden to ask cannot recover from a vague brief.

Transcript predating a listening window SHALL NOT be attached as recent context. Speech separated from the request by an engagement of listen-only mode belongs to whatever the user was doing before that interruption, and the retention window that holds it outlasts the listening window that interrupted it — so without this rule a run receives unrelated speech presented as the conversation the request came from.

The transcript SHALL be bounded, and its inclusion SHALL NOT grow without limit on a long-resumed conversation.

#### Scenario: A thin spoken request still produces good work

- **WHEN** the user makes a request in loose spoken language and a stateful verb is called with a thin brief
- **THEN** the run receives the transcript as corroboration, and pauses to ask when something material is missing

#### Scenario: A one-shot run gets an instruction, not rambling

- **WHEN** a stateless verb is called
- **THEN** its concrete parameters carry the instruction, and the transcript accompanies it as context rather than replacing it

#### Scenario: The transcript is labelled as fallible

- **WHEN** transcript text is included in a run's prompt
- **THEN** it is fenced, and identified as an automatic transcription that may be inaccurate
- **AND** it is not identified as the request to act on

#### Scenario: Spoken input is fenced

- **WHEN** transcript text is included in a run's prompt
- **THEN** it is fenced as untrusted input, regardless of it being the user's own speech

#### Scenario: Speech from before a listening window is not attached

- **WHEN** a verb is called after listen-only mode has been engaged and disengaged
- **THEN** the transcript attached carries nothing said before that engagement began

#### Scenario: Transcript inclusion is bounded

- **WHEN** a verb is called repeatedly within one long conversation
- **THEN** the transcript attached to each run stays within its configured bound
