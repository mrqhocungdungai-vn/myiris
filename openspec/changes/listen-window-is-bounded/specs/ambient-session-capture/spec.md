## MODIFIED Requirements

### Requirement: Only already-retained text is captured, never audio

Ambient capture SHALL write only the conversation **text** Iris already holds in memory for the purpose of giving runs context. It SHALL NOT write, retain, or transmit audio, and it SHALL NOT extend how much conversation Iris keeps in memory. Its own destination SHALL remain the one it has: a local session spool in the vault the user already owns.

The material this feature captures is material Iris already has. Widening what is retained, or adding a second recording path *under this preference*, would turn an opt-in that a user evaluated on one basis into something larger than what they agreed to.

While listen-only mode is engaged, ambient capture SHALL NOT write what Iris hears. It SHALL advance past that span without retaining it, and SHALL resume retaining when the mode is disengaged.

The reason is the consent, not a competing writer. This preference is consent to retain the user's own conversations with Iris. While that mode is engaged what Iris hears widens to include whatever the machine is playing — remote participants on a call, a video, people who never agreed to anything — and that is outside what this preference was given for. So the span belongs to nobody: no other feature retains it either, and it is simply not written down. See the `listen-only-mode` capability.

#### Scenario: No audio is written

- **WHEN** ambient capture is active through a full conversation
- **THEN** the only thing written is text, and no audio file exists anywhere as a result

#### Scenario: Retention bounds are unchanged

- **WHEN** ambient capture is enabled
- **THEN** how much conversation Iris holds in memory is exactly what it was before, and its existing age and count bounds are unchanged

#### Scenario: Nothing leaves the machine

- **WHEN** ambient capture writes a session's text
- **THEN** it is written to the local vault and sent nowhere

#### Scenario: The mode's span is retained by nobody

- **WHEN** ambient capture is enabled and listen-only mode is engaged
- **THEN** the session spool is not written for that span
- **AND** no other area of the vault is written for it either

#### Scenario: Ambient capture resumes after the mode ends

- **WHEN** the user disengages listen-only mode with ambient capture still enabled
- **THEN** ambient capture resumes retaining to the session spool
- **AND** it does not retroactively write the span the mode covered

#### Scenario: The preference does not govern the mode

- **WHEN** the user enables or disables ambient capture while listen-only mode is engaged
- **THEN** the mode's own state is unchanged in either direction

### Requirement: Capture follows the microphone and stops with it

Ambient capture SHALL retain only while Iris is awake and listening. Nothing SHALL be retained while Iris is asleep.

What is not being streamed to the voice layer is not being heard, and a capture that continued past sleep would be recording a room whose occupants have every reason to believe the microphone is off.

Sleep is not the only boundary. While listen-only mode is engaged, what Iris hears widens to include audio the machine is playing, which is outside this preference's consent — so ambient capture SHALL also stop at that boundary and resume when the mode ends. The principle is unchanged: ambient capture retains what Iris hears under *this* preference's consent, and nothing else.

#### Scenario: Sleep stops retention

- **WHEN** ambient capture is enabled and Iris goes to sleep
- **THEN** nothing further is retained, and what had accumulated is flushed rather than dropped

#### Scenario: Waking resumes retention

- **WHEN** Iris is woken with ambient capture still enabled
- **THEN** retention resumes for the new conversation

#### Scenario: Engaging listen-only mode stops this retention too

- **WHEN** ambient capture is enabled and the user engages listen-only mode
- **THEN** ambient capture stops retaining at that point and flushes what had accumulated
- **AND** the span the mode covers is not retained anywhere
