## Purpose

Listen-only mode is how Iris takes something in that was not said to her. Engaging it makes her completely silent and widens what she hears to include the audio the machine is playing, so a remote participant on a call, a video, or anything else audible reaches her as well as the room does. It exists for the one situation a microphone alone cannot cover — someone else asking the user a question — and the two halves are inseparable: system-audio capture picks up this app's own output, so a mode where Iris is silent is the only mode where that capture is clean.

Nothing is retained. The engagement is bounded to a few minutes, and at that length what Iris heard is still held by the voice session itself, in the audio form it received — which is the form that was accurate all along. So the user asks about it by asking, and no record has to exist for that to work.

The mode is reached and left without ever reconnecting or reconfiguring the voice session, which is what distinguishes it from the retired listening mode it replaces.
## Requirements

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

### Requirement: The main process owns the listen-only mode state

The main process SHALL hold the authoritative listen-only mode state. Every control surface SHALL route its toggle through the main process, and the renderer SHALL receive the resulting state rather than deciding it. The renderer SHALL remain the component that executes audio suppression, but SHALL NOT be the source of truth for whether the mode is engaged.

This exists because main-process behavior depends on the mode — main decides which output state to report for a reply turn — and main-side behavior SHALL NOT depend on state reported to it by the renderer.

#### Scenario: Every surface resolves to the same authoritative state

- **WHEN** the mode is toggled from the renderer control, the tray item, or the global hotkey
- **THEN** the main process records the new state and the renderer reflects it
- **AND** all surfaces agree on the current state

#### Scenario: Main-side behavior reads main's own state

- **WHEN** the main process decides how to report an outgoing reply turn
- **THEN** it consults its own listen-only mode state, not a value reported by the renderer

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

### Requirement: Listen-only mode is reachable from three control surfaces

Listen-only mode SHALL be toggleable three ways with identical effect: (1) a renderer control shown beside the microphone-mute button in both the deck and the HUD, rendered as a headphone icon that carries a struck-through variant for the disengaged state, matching how the microphone control distinguishes its own two states; (2) a single tray (menu-bar) item whose label reflects the current state and which SHALL be disabled while the session is asleep; and (3) a global hotkey configurable via `IRIS_LISTEN_HOTKEY` (default `Alt+L`). The global hotkey SHALL be unregistered on quit.

There SHALL be exactly one such control per surface — one button in the cluster, one tray item, one hotkey. No separate speaker-mute control SHALL remain alongside it.

#### Scenario: Toggle from the renderer control

- **WHEN** the user clicks the headphone control in the deck or the HUD
- **THEN** listen-only mode toggles and the button reflects the new state

#### Scenario: Hotkey toggle from another app

- **WHEN** the user presses the configured listen hotkey while a different application has focus
- **THEN** listen-only mode toggles

#### Scenario: Tray item reflects and toggles state

- **WHEN** the user opens the tray menu while the session is running
- **THEN** one item reads according to the current state, and selecting it toggles listen-only mode

#### Scenario: Tray item is disabled while asleep

- **WHEN** the user opens the tray menu while the session is asleep
- **THEN** the listen-only item is disabled and cannot be triggered

#### Scenario: The control cluster has no redundant twin

- **WHEN** the user looks at the control cluster in either the deck or the HUD
- **THEN** it offers a microphone control and a headphone control, and no additional speaker-mute or listening-mode control

#### Scenario: Hotkey registration failure degrades gracefully

- **WHEN** the configured listen hotkey cannot be registered (conflict)
- **THEN** a log event records the failure, the app continues normally, and the mode remains reachable via the renderer control and tray item

### Requirement: The HUD reveals its transcript while the mode is engaged

The conversation surface SHALL be visible without further user action for as long as the mode is engaged. It no longer carries what Iris is hearing — that goes to the mode's record instead, see "What Iris overhears does not enter the conversation" — but it is where the mode reports itself: the degraded state if the capture fails, a refused instruction if something overheard tries to make Iris act, and the record's location when the mode ends. Those are the things the user must not have to go looking for, and the last one is what they refer to afterwards. In HUD mode the transcript panel is collapsed by default; engaging listen-only mode SHALL open it, and disengaging the mode SHALL restore whatever open/closed state the user had before the mode was engaged. The user SHALL remain able to collapse or open the panel by hand while the mode is engaged, and a manual change SHALL be respected rather than immediately re-forced.

The deck's transcript is always visible and SHALL require no change.

#### Scenario: Engaging the mode opens the HUD transcript

- **WHEN** the user engages listen-only mode in HUD mode while the transcript panel is collapsed
- **THEN** the transcript panel opens, so what the mode reports about itself is readable without further action

#### Scenario: Disengaging restores the prior panel state

- **WHEN** the user disengages listen-only mode in HUD mode
- **THEN** the transcript panel returns to the open/closed state it had before the mode was engaged

#### Scenario: A manual collapse while engaged is respected

- **WHEN** the user collapses the HUD transcript panel by hand while listen-only mode is engaged
- **THEN** it stays collapsed rather than being reopened by the mode

#### Scenario: The deck is unchanged

- **WHEN** listen-only mode is engaged in deck mode
- **THEN** the deck's transcript panel is visible as it always is, with no change in behavior

### Requirement: Interface sound cues are independent of listen-only mode

The renderer's synthesized interface cues (wake, sleep, task submitted, task completed, task failed, approval/attention) SHALL remain governed solely by their own persisted mute preference. Listen-only mode SHALL NOT silence them, SHALL NOT alter that preference, and SHALL NOT be altered by it. Listen-only mode governs Gemini's voice output only.

This keeps an ephemeral, per-session mode from writing to or shadowing a persisted preference, which would leave the restore-on-exit behavior ambiguous.

#### Scenario: Cues still play while the mode is engaged

- **WHEN** a task completes while listen-only mode is engaged and the interface-sound preference is unmuted
- **THEN** the task-done cue plays

#### Scenario: The mode does not touch the persisted preference

- **WHEN** the user engages and then disengages listen-only mode
- **THEN** the persisted interface-sound preference is unchanged

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
