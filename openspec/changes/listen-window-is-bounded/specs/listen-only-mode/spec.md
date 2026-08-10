## ADDED Requirements

### Requirement: The listening window is bounded

Engaging listen-only mode SHALL open a listening window of a bounded length, and the app SHALL disengage the mode when that window closes. Disengaging on expiry SHALL be indistinguishable from the user disengaging: Iris becomes audible again, the in-band note that ends the silence request is sent, and every control surface reflects the new state.

The deadline SHALL be absolute, measured from the moment the mode was engaged, and SHALL NOT be extended by anything Iris hears. A window that renews itself while someone is still speaking is not a window, and the failure it would reproduce — a mode left engaged for hours — is the one this bound exists to prevent.

The window's length SHALL be configurable, SHALL default to five minutes, and SHALL be clamped to a documented ceiling. There SHALL be no setting that makes the window unbounded.

This length is what the mode is for. Iris is not a meeting recorder; the need is to hear a question being asked — in the room or through a call — and then go and answer it. At this length what was heard is still held by the voice session itself, in the audio form it received, so the user asks about it by asking. Nothing has to be written down for that to work.

Because Iris is silent while the mode is engaged, she SHALL NOT announce the approaching deadline by voice. The app SHALL show the time remaining for as long as the window is open, so the user can see the mode about to end rather than discover it by Iris speaking.

#### Scenario: Engaging opens a bounded window

- **WHEN** the user engages listen-only mode
- **THEN** a listening window opens with the configured length
- **AND** the time remaining is shown for as long as the mode is engaged

#### Scenario: Continued speech does not extend the deadline

- **WHEN** Iris hears speech continuously for the whole length of the window
- **THEN** the deadline is unchanged from the one set when the mode was engaged
- **AND** the mode still ends at that deadline

#### Scenario: The deadline disengages the mode

- **WHEN** the listening window reaches its deadline with the mode still engaged
- **THEN** the mode is disengaged, Iris is audible again, and the silence request is ended in-band
- **AND** every control surface reflects the disengaged state

#### Scenario: Disengaging by hand closes the window

- **WHEN** the user disengages the mode before the deadline
- **THEN** the window closes with it
- **AND** no further automatic disengage occurs at the original deadline

#### Scenario: Re-engaging starts a full window

- **WHEN** the user engages the mode again after a window expired
- **THEN** a new window opens with the full configured length

#### Scenario: The window does not outlive the session

- **WHEN** the session ends or Iris is put to sleep while a window is open
- **THEN** the window closes with it, and a later wake does not inherit a running deadline

#### Scenario: The configured length is honoured

- **WHEN** the operator sets the listening-window length
- **THEN** that value bounds the window, the documented default applies when it is unset, and a value beyond the ceiling is clamped to it

## MODIFIED Requirements

### Requirement: What Iris overhears does not enter the conversation

While listen-only mode is engaged, transcribed input SHALL NOT be shown in the conversation surface at all — neither as the user's words nor under any other attribution.

Before the mode existed, showing it there was right: Iris heard only the microphone, so everything she heard was the user talking to her. Both halves of that stopped being true. A line may now be the user, another person in the room, a remote participant, or a video, and the sources SHALL NOT be presented as separable because they are not — they are summed into one stream before anything leaves the machine. And what is overheard is not a conversation between the user and Iris, which is what that surface is for; the conversation is held to a recent window, so filling it with overheard speech would evict the real exchange.

Instead, when the mode ends the app SHALL add ONE entry to that surface, stating how long Iris listened. That entry is the mark the engagement leaves on the conversation: it is what the user refers to when asking Iris about what she heard.

While the mode is engaged the app SHALL ALSO show, near the orb, a live readout of what Iris is hearing at that moment. It SHALL update as she hears, SHALL replace itself rather than accumulate, and SHALL NOT be retained anywhere. When the mode is engaged and nothing has been heard, that SHALL be stated rather than left blank.

This is not a smaller version of the transcript; it answers a different question. Hearing nothing silently is the failure mode to avoid: a capture that has died looks exactly like one that is working until the mode ends, and without this the user discovers it only by asking about something Iris never received. That is far too late, and it is the state this feature was actually found in during testing. A live readout makes hearing — and not hearing — a fact on screen at the moment it is true.

Provenance SHALL be decided when the text ARRIVES, not when it is displayed, and an utterance spanning the transition SHALL be treated as overheard. The two are different moments — an utterance is closed only after transcription falls quiet, so the end of every engagement is processed after the mode has already been left — and deciding at the later one publishes a video's words as the user's.

The same holds past the screen. Overheard speech SHALL NOT be retained into the recent-conversation memory that feeds a run's context, which every consumer presents to Claude as what the user said recently — carrying it there would repeat the false attribution one layer deeper, where the user cannot see it, and that memory outlives the mode. Fencing it as untrusted is not sufficient: a fence mitigates content that genuinely IS the user's, and is not a licence to mislabel content that is not. Nothing is lost by leaving it out, because the voice session still holds what it heard, and that is what the user asks against.

Any interface affordance that means "the user just spoke" SHALL NOT fire for overheard input.

#### Scenario: Overheard speech does not flood the conversation

- **WHEN** Iris hears a long stretch of speech while the mode is engaged
- **THEN** none of it appears in the conversation surface
- **AND** the exchange the user actually had with Iris is still there afterwards

#### Scenario: The user can see that Iris is hearing

- **WHEN** listen-only mode is engaged and Iris is hearing audio
- **THEN** what she is hearing is shown live near the orb, updating as she hears it
- **AND** it is not added to the conversation and is not retained

#### Scenario: A capture that hears nothing says so

- **WHEN** the mode is engaged and nothing has been heard
- **THEN** the interface says so, rather than being indistinguishable from hearing normally

#### Scenario: The live readout does not outlive the mode

- **WHEN** the user disengages the mode
- **THEN** the live readout is cleared rather than left showing the last thing heard

#### Scenario: The engagement leaves one entry behind

- **WHEN** the user disengages the mode after Iris heard something
- **THEN** the conversation surface gains a single entry stating how long she listened

#### Scenario: The tail of an engagement is not attributed to the user

- **WHEN** speech heard just before disengaging is processed just after
- **THEN** it is still treated as overheard

#### Scenario: Overheard speech does not reach a run as the user's words

- **WHEN** a run is started after listen-only mode has been engaged and then disengaged
- **THEN** the recent-conversation context it receives contains none of what was overheard

#### Scenario: The user can still ask about what was overheard

- **WHEN** the user disengages the mode and asks Iris about what she heard
- **THEN** she answers from the voice session's own conversation, with no vault record involved

#### Scenario: Ordinary conversation is unchanged

- **WHEN** listen-only mode is not engaged
- **THEN** the user's speech appears and is attributed to the user exactly as before

#### Scenario: No cue claims the user spoke

- **WHEN** overheard input is transcribed while the mode is engaged
- **THEN** no affordance that signifies the user's own speech is triggered by it

### Requirement: System audio can be disabled entirely

The system-audio half of listen-only mode SHALL be disableable by configuration. When disabled, engaging the mode SHALL silence Iris exactly as it did before that half existed: no capture is opened and no advisory is shown. The listening window SHALL still bound the engagement, because the bound is a property of the mode rather than of the capture.

This exists so that the microphone-only behaviour remains reachable, and so a user who never needs Iris to hear their machine never triggers a system recording indicator.

#### Scenario: Disabled means silence only

- **WHEN** the escape hatch is set and the user engages listen-only mode
- **THEN** Iris falls silent and hears the microphone only
- **AND** no capture is opened and no session reconfiguration occurs

#### Scenario: The bound applies with system audio disabled

- **WHEN** the escape hatch is set and the user engages listen-only mode
- **THEN** the listening window still opens and still disengages the mode at its deadline

#### Scenario: The default is enabled

- **WHEN** the escape hatch is unset
- **THEN** listen-only mode captures system audio on the terms specified above

### Requirement: Listen-only mode is ephemeral per session

Listen-only mode SHALL reset to disengaged whenever the session ends by explicit user stop. Toggling the mode SHALL be a no-op while the session is asleep (not running), so a wake always starts with Iris audible. The mode SHALL NOT be persisted to configuration; a fresh app launch always starts with Iris audible.

Exactly two things SHALL disengage the mode: the user, and the listening window reaching its deadline. Both are decisions about how long Iris should stay silent, taken by someone who knows the room.

Nothing else SHALL. In particular the mode SHALL NOT be disengaged by any transport-level event: a server-initiated teardown, a reconnect, or the exhaustion of reconnect attempts SHALL leave the mode engaged, because disengaging restores Iris's voice — and a network failure is not a reason to make Iris audible in a room where the user engaged the mode so she would not be. A failed or dead system-audio capture SHALL NOT disengage it either.

Everything the mode owns SHALL be released when the session ends: the system-audio capture SHALL be stopped and the listening window closed, so neither outlives the session that justified it.

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
- **THEN** the capture is stopped and the listening window is closed

#### Scenario: Toggling while asleep does nothing

- **WHEN** the user triggers a listen-only toggle (control, tray, or hotkey) while the session is asleep
- **THEN** the state does not change and the next wake starts with Iris audible

#### Scenario: The mode is never persisted

- **WHEN** the app is relaunched after the mode had been engaged
- **THEN** Iris starts audible, since the state was never written to configuration

## REMOVED Requirements

### Requirement: The mode retains what Iris hears to its own vault area

**Reason**: The retention was built out of the Live session's transcription text, which is the least reliable output that session produces — its audio handling is accurate and its transcription frequently is not. So the record meant to outlive the engagement was a lossy copy of speech the session itself already held correctly.

Storing the audio instead and replaying it into the session does not work at the length this requirement assumed. The Live model's input limit is 131,072 tokens and audio costs 32 tokens per second, so roughly 68 minutes is the ceiling for the entire context; the session's own compression settings narrow that to about 54 minutes before eviction begins. An hour of recorded audio is gone before it can be asked about.

Bounding the mode to a few minutes removes the need entirely. What Iris hears in that span stays in the voice session's own conversation, in the audio form it arrived as, which is the form that was accurate all along.

**Migration**: None required. Files already written under `inbox/meetings/` are the user's own and are left in place — nothing in the app deletes them, and they remain readable and identifiable by their own timestamps. Nothing further is written there. To ask about what Iris heard, the user asks the voice session directly, which is what the "Iris is silent for the whole time the mode is engaged" requirement already guarantees is possible.

### Requirement: Iris is told where the record was written

**Reason**: There is no record to name. This requirement existed only to point the voice layer at one particular meeting file so a verb could be handed it, and its stated justification was the case where context-window compression had evicted the beginning of a long engagement. A bounded window is short enough that the whole engagement stays in context, so the case it was built for cannot arise.

**Migration**: None. The conversation surface still gains one entry when the mode ends, stating how long Iris listened, and the user asks about what she heard by asking her.
