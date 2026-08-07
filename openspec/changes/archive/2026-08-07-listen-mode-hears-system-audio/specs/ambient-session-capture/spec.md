## MODIFIED Requirements

### Requirement: Only already-retained text is captured, never audio

Ambient capture SHALL write only the conversation **text** Iris already holds in memory for the purpose of giving runs context. It SHALL NOT write, retain, or transmit audio, and it SHALL NOT extend how much conversation Iris keeps in memory. Its own destination SHALL remain the one it has: a local session spool in the vault the user already owns.

The material this feature captures is material Iris already has. Widening what is retained, or adding a second recording path *under this preference*, would turn an opt-in that a user evaluated on one basis into something larger than what they agreed to.

One other feature does write conversation text to the vault: listen-only mode retains to its own separate area, under its own consent, for as long as the user holds that mode engaged. That is deliberately not this preference and SHALL NOT be governed by it — neither enabling nor disabling ambient capture SHALL start or stop it, and it SHALL write to its own area rather than this one, so that a reader can always tell which consent produced which record. See the `listen-only-mode` capability.

#### Scenario: No audio is written

- **WHEN** ambient capture is active through a full conversation
- **THEN** the only thing written is text, and no audio file exists anywhere as a result

#### Scenario: Retention bounds are unchanged

- **WHEN** ambient capture is enabled
- **THEN** how much conversation Iris holds in memory is exactly what it was before, and its existing age and count bounds are unchanged

#### Scenario: Nothing leaves the machine

- **WHEN** ambient capture writes a session's text
- **THEN** it is written to the local vault and sent nowhere

While listen-only mode is engaged, that mode's retention SHALL own what Iris hears, and ambient capture SHALL NOT also write it. Ambient capture SHALL advance past that span without retaining it, and SHALL resume retaining when the mode is disengaged. Writing the same speech to two areas under two different consents would make "delete what was recorded" unanswerable, which is the whole reason the areas are separate.

#### Scenario: The two retentions are independent

- **WHEN** the user disables ambient capture while listen-only mode is engaged
- **THEN** listen-only mode's own retention continues, to its own area, unaffected

#### Scenario: The mode's retention takes precedence over ambient capture

- **WHEN** ambient capture is enabled and listen-only mode is engaged
- **THEN** only the mode's own area is written for that span, and the session spool is not
- **AND** the same speech does not appear in both areas

#### Scenario: Ambient capture resumes after the mode ends

- **WHEN** the user disengages listen-only mode with ambient capture still enabled
- **THEN** ambient capture resumes retaining to the session spool
- **AND** it does not retroactively write the span the mode owned

### Requirement: Capture follows the microphone and stops with it

Ambient capture SHALL retain only while Iris is awake and listening. Nothing SHALL be retained while Iris is asleep.

What is not being streamed to the voice layer is not being heard, and a capture that continued past sleep would be recording a room whose occupants have every reason to believe the microphone is off.

Sleep is no longer the only boundary. While listen-only mode is engaged, what Iris hears widens to include audio the machine is playing, and that span belongs to the mode's own retention rather than to this one — so ambient capture SHALL also stop at that boundary and resume when the mode ends. The principle is unchanged: ambient capture retains what Iris hears under *this* preference's consent, and nothing else.

#### Scenario: Sleep stops retention

- **WHEN** ambient capture is enabled and Iris goes to sleep
- **THEN** nothing further is retained, and what had accumulated is flushed rather than dropped

#### Scenario: Waking resumes retention

- **WHEN** Iris is woken with ambient capture still enabled
- **THEN** retention resumes for the new conversation

#### Scenario: Engaging listen-only mode stops this retention too

- **WHEN** ambient capture is enabled and the user engages listen-only mode
- **THEN** ambient capture stops retaining at that point and flushes what had accumulated
- **AND** the span the mode covers is retained by the mode, not here

### Requirement: The spool records that it is a transcript of the room

The session spool SHALL be written so that a reader can tell it is a verbatim record of what Iris heard, not an authored note and not attributable to the user.

Iris does not distinguish who is speaking, or whether a voice reached her through the microphone or through the machine's own audio output. Text in this spool may be another person in the room, a remote participant in a call, a video playing, or a mishearing — so it SHALL NOT be presented as the user's own words, and anything downstream that reads it SHALL treat it as untrusted content on the same terms the recent transcript already is when it reaches a run.

The interface offering the preference, and the documentation describing it, SHALL state that other people's speech may be retained, so the user's decision is made knowing that.

#### Scenario: The spool is self-describing

- **WHEN** the user opens a session spool file
- **THEN** it is evident that the content is a verbatim record of what Iris heard rather than notes they wrote

#### Scenario: Spooled speech is untrusted downstream

- **WHEN** spooled session text reaches a Claude run
- **THEN** it arrives as untrusted content and instructions inside it are not followed

#### Scenario: The consent point states what may be captured

- **WHEN** the user is offered the ambient-capture preference
- **THEN** it states that this retains a transcript of speech Iris hears, which may include other people
