## Purpose

Listen-only mode is Iris's meeting mode. Engaging it makes her completely silent and widens what she hears to include the audio the machine is playing, so the remote participants of a call, a video, or anything else audible reach her as well as the room does — and everything she hears is retained to her own vault area for the length of the engagement. It exists for the one situation a microphone alone cannot cover, and the two halves are inseparable: system-audio capture picks up this app's own output, so a mode where Iris is silent is the only mode where that capture is clean. The mode is reached and left without ever reconnecting or reconfiguring the voice session, which is what distinguishes it from the retired listening mode it replaces.

## MODIFIED Requirements

### Requirement: Listen-only mode suppresses Gemini audio output without reconnecting

Listen-only mode SHALL silence Gemini's voice output independently of the microphone. While the mode is engaged, the app SHALL immediately stop every currently-playing audio source when the mode is entered (reusing the existing barge-in/flush stop) AND SHALL suppress all subsequently-arriving Gemini audio chunks — dropping them without scheduling playback, without driving the output level meter, and without advancing the playback timeline — until the mode is disengaged. When the mode is disengaged, only chunks that arrive after that point SHALL play, on a normal timeline.

Entering or leaving the mode SHALL NOT disconnect, reconnect, or reconfigure the Gemini Live session, SHALL NOT change the requested response modality, SHALL NOT change the session's tool set, SHALL NOT change the session's activity-detection configuration, and SHALL NOT change the microphone's mute state. The session's audio response modality SHALL remain in force throughout.

This constraint is load-bearing and SHALL NOT be traded away for control over the model's turn-taking. A per-mode session profile reached by reconnecting was built, used, and retired in this app precisely because the seam it puts in the conversation costs more than the interjections it prevents.

Entering the mode SHALL change one thing about what Iris receives: the mode adds system audio to the input stream, as specified in "Engaging the mode adds system audio to what Iris hears". That is a change to the renderer's capture graph, not to the session, and it is the substance of the mode.

#### Scenario: Engaging the mode cuts audio already playing

- **WHEN** the user engages listen-only mode while Iris is speaking
- **THEN** all currently-playing audio sources stop immediately
- **AND** the Gemini session, its response modality, its tool set, its activity-detection configuration and the microphone mute state are all unchanged

#### Scenario: Engaged mode drops incoming audio silently

- **WHEN** new Gemini audio chunks arrive while listen-only mode is engaged
- **THEN** they are not scheduled for playback and produce no sound
- **AND** the output level meter is not fed and the playback timeline is not advanced

#### Scenario: No reconnect on either transition

- **WHEN** the user engages listen-only mode and later disengages it
- **THEN** the Gemini Live session is neither disconnected nor reconnected at either transition
- **AND** no session configuration is rebuilt

#### Scenario: Disengaging resumes only new audio

- **WHEN** the user disengages listen-only mode
- **THEN** Gemini audio chunks that arrive afterward play normally
- **AND** no audio that arrived while the mode was engaged is played back

#### Scenario: The mode is independent of the microphone mute

- **WHEN** the user toggles listen-only mode
- **THEN** the microphone mute state is unchanged
- **AND** toggling the microphone mute leaves the listen-only mode state unchanged

### Requirement: Listen-only mode is ephemeral per session

Listen-only mode SHALL reset to disengaged whenever the session ends by explicit user stop. Toggling the mode SHALL be a no-op while the session is asleep (not running), so a wake always starts with Iris audible. The mode SHALL NOT be persisted to configuration; a fresh app launch always starts with Iris audible.

The mode SHALL NOT be disengaged by any transport-level event. A server-initiated teardown, a reconnect, or the exhaustion of reconnect attempts SHALL leave the mode engaged, because disengaging restores Iris's voice — and a network failure is not a reason to make Iris audible in a room where the user engaged the mode so she would not be.

Everything the mode owns SHALL be released when the session ends: the system-audio capture SHALL be stopped and its retention flushed, so no capture outlives the session that justified it.

#### Scenario: An explicit stop clears the mode

- **WHEN** the user stops the session while listen-only mode is engaged
- **THEN** the mode is reset to disengaged
- **AND** the next wake starts with Iris audible

#### Scenario: Exhausted reconnects leave Iris silent

- **WHEN** the session's reconnect attempts are exhausted while listen-only mode is engaged
- **THEN** the mode remains engaged and Iris remains silent
- **AND** no reply is spoken aloud when the session is later re-established

#### Scenario: A session ending stops the system-audio capture

- **WHEN** the session ends while listen-only mode is engaged with system audio being captured
- **THEN** the capture is stopped and its retention flushed rather than dropped

#### Scenario: Toggling while asleep does nothing

- **WHEN** the user triggers a listen-only toggle (control, tray, or hotkey) while the session is asleep
- **THEN** the state does not change and the next wake starts with Iris audible

#### Scenario: The mode is never persisted

- **WHEN** the app is relaunched after the mode had been engaged
- **THEN** Iris starts audible, since the state was never written to configuration

### Requirement: The HUD reveals its transcript while the mode is engaged

Because listen-only mode exists to let Iris take in a conversation the user is having with other people, the surface that displays what Iris is hearing SHALL be visible without further user action. In HUD mode the transcript panel is collapsed by default; engaging listen-only mode SHALL open it, and disengaging the mode SHALL restore whatever open/closed state the user had before the mode was engaged. The user SHALL remain able to collapse or open the panel by hand while the mode is engaged, and a manual change SHALL be respected rather than immediately re-forced.

The deck's transcript is always visible and SHALL require no change.

#### Scenario: Engaging the mode opens the HUD transcript

- **WHEN** the user engages listen-only mode in HUD mode while the transcript panel is collapsed
- **THEN** the transcript panel opens, so what Iris is hearing is readable without further action

#### Scenario: Disengaging restores the prior panel state

- **WHEN** the user disengages listen-only mode in HUD mode
- **THEN** the transcript panel returns to the open/closed state it had before the mode was engaged

#### Scenario: A manual collapse while engaged is respected

- **WHEN** the user collapses the HUD transcript panel by hand while listen-only mode is engaged
- **THEN** it stays collapsed rather than being reopened by the mode

#### Scenario: The deck is unchanged

- **WHEN** listen-only mode is engaged in deck mode
- **THEN** the deck's transcript panel is visible as it always is, with no change in behavior

## ADDED Requirements

### Requirement: Engaging the mode adds system audio to what Iris hears

While listen-only mode is engaged, the app SHALL capture the audio the machine is playing and SHALL deliver it to the voice layer mixed with the microphone into the single realtime stream the session already carries. The capture SHALL request audio only; no screen or window video SHALL be requested or received. While the mode is disengaged, no system-audio capture SHALL exist and Iris SHALL hear the microphone only — this is the default on every launch.

The two sources SHALL be summed with the system audio at a configurable gain, defaulting below unity so that loud playback does not bury the user's voice, and the summed signal SHALL be given enough headroom that two simultaneously loud sources do not distort. The mixed input SHALL be reduced to a single channel in a way that preserves both channels of a stereo source rather than discarding one.

Because the microphone's mute is a property of the microphone and not of the mode, muting the microphone while the mode is engaged SHALL leave system audio flowing: Iris still hears the meeting.

#### Scenario: Engaging the mode starts system-audio capture

- **WHEN** the user engages listen-only mode
- **THEN** system audio is captured and mixed into the stream the session sends
- **AND** the microphone continues to be captured and mixed alongside it

#### Scenario: The capture takes no video

- **WHEN** system-audio capture is acquired
- **THEN** the resulting stream carries audio only, and no screen or window video is requested or received

#### Scenario: The mode disengaged means microphone only

- **WHEN** listen-only mode is disengaged
- **THEN** no system-audio capture exists and Iris hears the microphone only

#### Scenario: A muted microphone still hears the room's speakers

- **WHEN** the user mutes the microphone while listen-only mode is engaged
- **THEN** the user's own voice stops reaching Iris
- **AND** system audio continues to reach Iris unchanged

#### Scenario: Loud playback does not bury the user

- **WHEN** system audio is playing loudly and the user speaks
- **THEN** the user's voice is mixed against system audio at the configured lower gain
- **AND** the summed signal has headroom rather than being driven into distortion

#### Scenario: A stereo source keeps both channels

- **WHEN** the captured system audio carries two channels
- **THEN** both channels contribute to the single-channel stream that is sent
- **AND** neither channel is discarded

#### Scenario: The gain is configurable without code changes

- **WHEN** the operator sets the system-audio gain environment variable
- **THEN** that value is used for the mix, and the documented default applies when it is unset

### Requirement: Iris is silent for the whole time the mode is engaged

While listen-only mode is engaged, Iris SHALL produce no reply the user can perceive — not as sound, and not as text. Any reply the model produces SHALL be discarded: it SHALL NOT appear in the transcript, SHALL NOT drive any speaking indication, and SHALL NOT be retained to the vault.

Discarding at the client SHALL be what guarantees this. The app SHALL additionally ask the model, in-band on the session and without reconfiguring it, to stay silent until told otherwise — but that request SHALL be treated as a cost reduction, not as the mechanism: it lives in the conversation and can therefore be evicted by context-window compression during a long engagement, and the guarantee SHALL NOT depend on it holding.

Because the session's activity detection is deliberately left untouched, the model SHALL continue to be asked for replies as speakers pause, and those replies SHALL continue to be discarded. This is accepted: it is what keeps the transcription flowing, and it is the price of not reconfiguring the session.

What Iris hears while the mode is engaged SHALL remain part of the conversation, so that once the mode is disengaged the user can ask about it. Disengaging SHALL NOT itself produce a reply — Iris SHALL say nothing until the user next addresses her.

#### Scenario: Discarding holds when the instruction does not

- **WHEN** the model replies while listen-only mode is engaged, whether or not it received or retained the in-band request
- **THEN** the reply is discarded and the user perceives nothing

#### Scenario: No reply reaches the user while engaged

- **WHEN** the model produces a reply turn while listen-only mode is engaged
- **THEN** it produces no sound, does not appear in the transcript, and is not retained
- **AND** no speaking indication is shown

#### Scenario: Disengaging restores replies without volunteering one

- **WHEN** the user disengages listen-only mode
- **THEN** Iris says nothing until the user next addresses her
- **AND** replies work normally from that point

#### Scenario: What was heard is available afterwards

- **WHEN** the user disengages listen-only mode and asks about what was said while it was engaged
- **THEN** Iris answers from that conversation context

### Requirement: Iris acts on nothing she hears while the mode is engaged

While listen-only mode is engaged, the app SHALL refuse every tool call the model produces. No verb SHALL be dispatched, no note SHALL be written, no interface SHALL be controlled, and no run SHALL be started or queued, whatever the model asks for.

This is not a refinement of the silence requirement, it is a separate and stronger one. Silence governs what the user perceives; this governs what the machine DOES. A mode that only silenced replies while still executing tool calls would be the most dangerous configuration the app has: the user has deliberately stopped listening, is not watching the screen, and Iris is acting on audio nobody addressed to her.

The mode is what makes this necessary. It widens what Iris hears from the user's own room to whatever the machine plays — a video, a call, an advertisement, a recording of someone else's meeting. Such audio routinely contains sentences shaped exactly like instructions, including instructions addressed to an assistant, and none of them are the user asking for anything. Acting on one spends the user's money on work they did not request, and can write to their repository.

The refusal SHALL be total rather than selective. While the mode is engaged the user is not addressing Iris at all — the mode's contract is that she takes things in now and answers afterwards — so there is no request she could legitimately be carrying out, and no set of tools that is safe to leave reachable.

The app SHALL report each refusal, and SHALL answer the refusal back to the session so the model is not left waiting on a response that never arrives. As with enforced silence, the refusal SHALL be what guarantees this: the model MAY additionally be asked in-band to call nothing, but that request is a cost reduction and the guarantee SHALL NOT depend on it.

#### Scenario: Audio that sounds like an instruction is not obeyed

- **WHEN** something Iris hears while the mode is engaged — a video, a call, a recording — leads the model to call a tool
- **THEN** the call is refused and nothing runs
- **AND** no money is spent and nothing is written

#### Scenario: The refusal covers every tool

- **WHEN** the model calls any tool at all while the mode is engaged
- **THEN** it is refused, whether or not that tool starts a run, writes, or only reads

#### Scenario: A refusal is visible and does not stall the session

- **WHEN** a tool call is refused
- **THEN** the refusal is reported to the user
- **AND** the model receives a response, so the session continues normally

#### Scenario: Tools work normally outside the mode

- **WHEN** listen-only mode is not engaged
- **THEN** tool calls are dispatched exactly as they were before this change

### Requirement: What Iris overhears is not presented as the user's own words

While listen-only mode is engaged, transcribed input SHALL NOT be attributed to the user. It SHALL be presented as something Iris heard, distinct on screen from both the user's own speech and from Iris's own lines, wherever a transcript is displayed.

Before the mode existed this attribution was correct: Iris heard only the microphone, so everything she heard was the user speaking. Adding system audio makes it a false statement — a line may be the user, another person in the room, a remote participant on a call, or a video — and the two sources SHALL NOT be presented as separable, because they are not: they are summed into one stream before anything leaves the machine, which is what keeps the transport and the chunk format unchanged.

The app SHALL NOT attempt to guess which source a line came from, or who spoke it. Presenting a guess as attribution would be worse than presenting none, because the user would have no way to tell a correct attribution from a wrong one.

Any interface affordance that means "the user just spoke" SHALL NOT fire for overheard input.

The same holds past the screen. Overheard speech SHALL NOT be retained into the recent-conversation memory that feeds a run's context, which every consumer presents to Claude as what the user said recently — carrying it there would repeat the false attribution one layer deeper, where the user cannot see it, and that memory outlives the mode. Fencing it as untrusted is not sufficient: a fence mitigates content that genuinely IS the user's, and is not a licence to mislabel content that is not. Nothing is lost by leaving it out, because the mode's own retention holds all of it.

#### Scenario: Overheard speech is not shown as the user's

- **WHEN** a line is transcribed while listen-only mode is engaged
- **THEN** it is shown as something Iris heard, not as the user's own words
- **AND** it is distinguishable from Iris's own lines too

#### Scenario: The two displays agree

- **WHEN** the same transcript is shown in the deck and in the HUD
- **THEN** both attribute each line identically

#### Scenario: Ordinary conversation is unchanged

- **WHEN** listen-only mode is not engaged
- **THEN** the user's speech is attributed to the user exactly as before

#### Scenario: Overheard speech does not reach a run as the user's words

- **WHEN** a run is started after listen-only mode has been engaged and then disengaged
- **THEN** the recent-conversation context it receives contains none of what was overheard
- **AND** what was overheard is still available in the mode's own retained record

#### Scenario: No cue claims the user spoke

- **WHEN** overheard input is transcribed while the mode is engaged
- **THEN** no affordance that signifies the user's own speech is triggered by it

### Requirement: A capture that delivers no audio is detected and reported

The app SHALL verify that the system-audio capture is actually delivering audio, and SHALL NOT treat a successfully-acquired stream as proof that it works. A capture that delivers only silence SHALL be treated as failed, on the same terms as one that ends.

This exists because the observed failure is not an error: the request succeeds, a live track is produced, and every sample is zero. A check that only inspects whether acquisition succeeded reports a working capture while Iris hears nothing for the length of a meeting.

When the capture fails — by delivering silence, by ending, or by failing to acquire after the mode is engaged — the mode SHALL remain engaged, Iris SHALL stay silent, and the microphone SHALL continue to reach Iris; only the system-audio source SHALL be dropped. The app SHALL indicate the degraded state for as long as it lasts, and SHALL record the failure. Disengaging is the user's decision, never a consequence of the capture failing.

#### Scenario: A silent capture is treated as failure

- **WHEN** the system-audio capture is acquired but delivers only silence
- **THEN** it is treated as a failed capture and the degraded state is indicated
- **AND** the mode remains engaged and Iris remains silent

#### Scenario: A dead capture leaves Iris silent

- **WHEN** the system-audio capture ends while listen-only mode is engaged
- **THEN** the mode remains engaged, Iris remains silent, and the microphone continues to reach Iris

#### Scenario: The degraded state is visible for as long as it lasts

- **WHEN** the mode is engaged but system audio is not being captured
- **THEN** the interface indicates the degraded state continuously, not as a dismissible one-off
- **AND** the failure is recorded

#### Scenario: A capture that cannot be acquired does not engage the mode

- **WHEN** system-audio capture cannot be acquired at all as the user engages the mode
- **THEN** the user is told, and Iris's audio output is unaffected

### Requirement: The mode retains what Iris hears to its own vault area

While listen-only mode is engaged, the app SHALL retain the conversation text Iris receives into a dedicated area of the vault, separate from the area the ambient-capture preference writes to. This retention SHALL be governed by the mode alone and SHALL NOT depend on the ambient-capture preference in either direction.

Retention SHALL be driven by the transcription of what Iris hears, and SHALL NOT be bounded by how much recent conversation Iris holds in memory for other purposes. That memory is deliberately small and periodically pruned; a busy meeting can produce more speech between two flushes than it holds, and anything pruned in between would be lost permanently.

The retained record SHALL be distinguishable from the other kinds of spooled vault content, so that whatever reads it later can treat a meeting transcript on its own terms rather than as a deliberate capture or a run outcome.

Each engagement of the mode SHALL produce its own record rather than appending into a shared period file, so that one meeting can be identified, read, or deleted without touching another.

Engaging the mode is the consent point for this retention. The first time the user engages the mode, the app SHALL state that the mode retains what is said in the room and what the machine plays, that this may include other people, and where it is written.

Retention SHALL be flushed progressively rather than only at the end, SHALL write each utterance at most once however many flushes occur, and SHALL report a failed write rather than raising it.

#### Scenario: Engaging the mode starts retention

- **WHEN** listen-only mode is engaged
- **THEN** what Iris hears is retained to the mode's own vault area
- **AND** this happens whether or not the ambient-capture preference is enabled

#### Scenario: A busy meeting is retained in full

- **WHEN** more speech occurs between two flushes than Iris holds in recent-conversation memory
- **THEN** all of it is retained, none of it lost to that memory being pruned

#### Scenario: The record is identifiable as a meeting transcript

- **WHEN** something reads the vault's spooled content
- **THEN** a meeting record is distinguishable from a deliberate capture and from a run-outcome record

#### Scenario: Each engagement is its own record

- **WHEN** the user engages and disengages the mode twice in one day
- **THEN** each engagement produced its own record, identifiable and deletable on its own

#### Scenario: Disengaging stops retention

- **WHEN** the user disengages listen-only mode
- **THEN** retention to that area stops at that point and what accumulated is flushed

#### Scenario: The consent point states what is retained

- **WHEN** the user engages listen-only mode for the first time
- **THEN** they are told it retains speech in the room and audio the machine plays, that this may include other people, and where it is written

#### Scenario: Retention does not disturb the conversation

- **WHEN** a retention write fails, for example because the disk is full
- **THEN** the failure is reported and the conversation continues normally

#### Scenario: Repeated flushes do not duplicate

- **WHEN** several flushes occur over one engagement of the mode
- **THEN** each utterance appears in the retained record exactly once

### Requirement: The user is advised to wear headphones

When the user engages listen-only mode while audio output is going to speakers rather than headphones, the app SHALL advise wearing headphones, because speaker output re-enters the microphone and reaches Iris a second time, degraded and out of step with the captured copy.

The app SHALL NOT attempt to cancel, duck, or otherwise process away that second copy. The advice SHALL NOT block engaging the mode.

#### Scenario: Speaker output prompts the advice

- **WHEN** the user engages listen-only mode with audio going to speakers
- **THEN** the app advises wearing headphones and engages the mode anyway

#### Scenario: Headphone output is not nagged

- **WHEN** the user engages listen-only mode with audio going to headphones
- **THEN** no such advice is shown

### Requirement: System audio can be disabled entirely

The system-audio half of listen-only mode SHALL be disableable by configuration. When disabled, engaging the mode SHALL silence Iris exactly as it did before this change: no capture is opened, no retention area is written, and no advisory is shown.

This exists so that the pre-change behaviour remains reachable, and so a user who never needs Iris to hear their machine never triggers a system recording indicator.

#### Scenario: Disabled means silence only

- **WHEN** the escape hatch is set and the user engages listen-only mode
- **THEN** Iris falls silent and hears the microphone only
- **AND** no capture is opened, no session reconfiguration occurs, and nothing is retained to the mode's vault area

#### Scenario: The default is enabled

- **WHEN** the escape hatch is unset
- **THEN** listen-only mode captures system audio on the terms specified above

## REMOVED Requirements

### Requirement: A silent reply is presented as silent, not as speech

**Reason**: The mode no longer produces replies at all. This requirement specified how to present a reply that arrives as text without sound — a state that no longer exists now that the model is configured not to generate and any stray reply is discarded.

**Migration**: The visual vocabulary it defined is not lost. The cool accent it reserved, at full energy and distinct from the listening state, is reassigned to the engaged-and-listening state — see the `orb-expressions` delta in this change.
