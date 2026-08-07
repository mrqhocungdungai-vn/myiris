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
