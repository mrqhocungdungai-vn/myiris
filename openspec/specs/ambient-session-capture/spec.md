## Purpose

The opt-in retention of what was said in a conversation into the notes vault, so the second brain accumulates from what the user already does all day rather than only from deliberate note-taking — with the consent, visibility, and revocation a microphone transcript written to disk requires.
## Requirements
### Requirement: Ambient capture is opt-in, default off, and persisted

Retaining conversation text into the vault SHALL be a preference the user turns on, defaulting to **off**, persisted across sessions on the same terms as the other device preferences. With it off, Iris SHALL retain nothing to disk beyond what it already does, and no part of the mechanism SHALL run.

This is a transcript of what was said near a microphone, written to a file. Enabling it for someone by default — or leaving it on as the safer-seeming default — would make Iris record its user without their having decided to be recorded. There is no version of that which a later setting fixes.

Turning the preference off SHALL take effect immediately, not at the end of the session.

#### Scenario: Nothing is retained by default

- **WHEN** a user who has never enabled ambient capture holds a conversation with Iris
- **THEN** no conversation text is written to the vault, and no session spool file is created

#### Scenario: The preference persists

- **WHEN** the user enables ambient capture and later relaunches Iris
- **THEN** it is still enabled, without re-toggling — and once disabled, it stays disabled the same way

#### Scenario: Disabling stops retention immediately

- **WHEN** ambient capture is active mid-conversation and the user turns it off
- **THEN** retention stops at that point, and nothing said afterwards is written

#### Scenario: The mechanism is inert when off

- **WHEN** the preference is off
- **THEN** no flush is scheduled and no watermark is maintained — the feature costs nothing while unused

### Requirement: Capture is visible while it is active

Whenever ambient capture is retaining conversation, the interface SHALL indicate it, and SHALL offer a way to stop from where the indication appears.

A preference agreed to once is not standing consent for an indefinite, unindicated microphone log. The user must be able to tell, at a glance and at any moment, whether this conversation is being written down — and a person who walks into the room must be able to be told.

#### Scenario: An indicator shows while recording

- **WHEN** ambient capture is enabled and Iris is awake
- **THEN** the interface shows that the conversation is being retained to the vault

#### Scenario: The indicator is absent when nothing is being retained

- **WHEN** ambient capture is disabled, or Iris is asleep
- **THEN** no retention indicator is shown

#### Scenario: Stopping is reachable from the indicator

- **WHEN** the retention indicator is shown
- **THEN** the user can stop retention from there, without hunting through settings

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

### Requirement: The session is flushed as it goes, exactly once per utterance

Retention SHALL be flushed to the spool progressively during the session as well as when the session ends, and SHALL be idempotent with respect to what it has already written: an utterance SHALL be written at most once, however many flushes occur.

A flush only at session end loses the whole conversation to a crash, which is the case where having the record matters most. Progressive flushing without a watermark writes the same utterance on every flush, which produces a spool that grows quadratically and a curated page built from triplicated material.

A flush SHALL NOT be able to disturb the conversation: a failed write SHALL be reported rather than raised, on the same never-throws terms the run-outcome record already holds.

#### Scenario: A crash keeps what was said

- **WHEN** ambient capture is active and the app terminates unexpectedly mid-conversation
- **THEN** what had been said up to the last flush is in the spool

#### Scenario: Repeated flushes do not duplicate

- **WHEN** several flushes occur over one conversation
- **THEN** each utterance appears in the spool exactly once

#### Scenario: A failed flush does not disturb the conversation

- **WHEN** a flush cannot be written (for example the disk is full)
- **THEN** the failure is reported and the conversation continues normally

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

