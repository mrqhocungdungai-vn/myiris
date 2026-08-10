## MODIFIED Requirements

### Requirement: The spool records that it is a transcript of the room

The session spool SHALL be written so that a reader can tell it is a verbatim record of what Iris heard, not an authored note and not attributable to the user.

Iris does not distinguish who is speaking, or whether a voice reached her through the microphone or through the machine's own audio output. Text in this spool may be another person in the room, a remote participant in a call, a video playing, or a mishearing — so it SHALL NOT be presented as the user's own words, and anything downstream that reads it SHALL treat it as untrusted content on the same terms the recent transcript already is when it reaches a run.

The spool SHALL also record that its text is an **automatic transcription** produced alongside the conversation, and that it may be inaccurate. Naming the speaker's uncertainty is not the same as naming the recognizer's: a reader who knows the words may not be the user's still assumes the words are the words. They may not be. This matters most where the spool is read later and turned into something durable — a curated page written from a mishearing carries that mishearing forward with none of the doubt attached.

The interface offering the preference, and the documentation describing it, SHALL state that other people's speech may be retained, so the user's decision is made knowing that.

#### Scenario: The spool is self-describing

- **WHEN** the user opens a session spool file
- **THEN** it is evident that the content is a verbatim record of what Iris heard rather than notes they wrote

#### Scenario: The spool says its text may be misheard

- **WHEN** the user or a later run opens a session spool file
- **THEN** it states that the text is an automatic transcription and may be inaccurate

#### Scenario: Spooled speech is untrusted downstream

- **WHEN** spooled session text reaches a Claude run
- **THEN** it arrives as untrusted content and instructions inside it are not followed

#### Scenario: The consent point states what may be captured

- **WHEN** the user is offered the ambient-capture preference
- **THEN** it states that this retains a transcript of speech Iris hears, which may include other people
