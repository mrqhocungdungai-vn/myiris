## Purpose

Speaker mute lets the user silence Gemini's voice output independently of the microphone — stopping current playback and dropping incoming audio chunks — without affecting the Gemini session or the mic's mute state, reachable from a renderer control, the tray, and a global hotkey.

## Requirements

### Requirement: Speaker mute silences and suppresses Gemini audio output

The renderer SHALL provide a speaker-mute toggle that controls Gemini's audio output independently of the microphone. When speaker mute is engaged, the renderer SHALL immediately stop every currently-playing audio source (reusing the existing barge-in/flush stop) AND SHALL suppress all subsequently-arriving Gemini audio chunks — dropping them without scheduling playback, without driving the output level meter, and without advancing the playback timeline — until speaker mute is disengaged. Engaging speaker mute SHALL NOT stop the Gemini session, SHALL NOT change the microphone's mute state, and SHALL NOT alter what audio Iris receives. When speaker mute is disengaged, only chunks that arrive after that point SHALL play, on a normal timeline.

#### Scenario: Muting cuts audio already playing

- **WHEN** the user engages speaker mute while Iris is speaking
- **THEN** all currently-playing audio sources stop immediately
- **AND** the Gemini session and the microphone state are unchanged

#### Scenario: Muted output drops incoming audio silently

- **WHEN** new Gemini audio chunks arrive while speaker mute is engaged
- **THEN** they are not scheduled for playback and produce no sound
- **AND** the output level meter is not fed and the playback timeline is not advanced

#### Scenario: Unmuting resumes only new audio

- **WHEN** the user disengages speaker mute
- **THEN** Gemini audio chunks that arrive afterward play normally
- **AND** no audio that arrived while muted is played back

#### Scenario: Speaker mute is independent of the microphone

- **WHEN** the user toggles speaker mute
- **THEN** the microphone mute state is unchanged
- **AND** toggling the microphone mute leaves the speaker mute state unchanged

### Requirement: Speaker mute is ephemeral per session

Speaker mute SHALL reset to unmuted whenever the session ends — whether by explicit user stop or by a server-initiated teardown (e.g. reconnect attempts exhausted) — so it resets on the transition to not-running, not only on an explicit stop call. Toggling speaker mute SHALL be a no-op while the session is asleep (not running), so a wake always starts with the speaker unmuted. Speaker mute SHALL NOT be persisted to configuration; a fresh app launch always starts unmuted.

#### Scenario: A session ending clears speaker mute

- **WHEN** the session ends while speaker mute is engaged (user stop or server-initiated teardown)
- **THEN** speaker mute is reset to unmuted
- **AND** the next wake starts with the speaker unmuted

#### Scenario: Toggling while asleep does nothing

- **WHEN** the user triggers a speaker-mute toggle (control, tray, or hotkey) while the session is asleep
- **THEN** the mute state does not change and the next wake starts with the speaker unmuted

#### Scenario: Speaker mute is never persisted

- **WHEN** the app is relaunched after having been muted
- **THEN** the speaker starts unmuted, since the state was never written to configuration

### Requirement: Speaker mute is reachable from three control surfaces

Speaker mute SHALL be toggleable three ways with identical effect: (1) a renderer control shown beside the existing microphone-mute button in both the deck and the HUD, (2) a tray (menu-bar) item whose label reflects the current mute state and which SHALL be disabled while the session is asleep, and (3) a global hotkey configurable via `IRIS_MUTE_HOTKEY` (default `Alt+M`). The main process SHALL emit a toggle event the renderer acts on, and the renderer SHALL report the current speaker-mute state so the tray label stays accurate. The global hotkey SHALL be unregistered on quit.

#### Scenario: Toggle from the renderer control

- **WHEN** the user clicks the speaker-mute control in the deck or the HUD
- **THEN** speaker mute toggles and the button reflects the new state

#### Scenario: Hotkey toggle from another app

- **WHEN** the user presses the configured mute hotkey while a different application has focus
- **THEN** speaker mute toggles

#### Scenario: Tray item reflects and toggles state

- **WHEN** the user opens the tray menu while the session is running
- **THEN** the item reads "Mute speaker" or "Unmute speaker" according to the current state
- **AND** selecting it toggles speaker mute

#### Scenario: Tray item is disabled while asleep

- **WHEN** the user opens the tray menu while the session is asleep
- **THEN** the speaker-mute item is disabled and cannot be triggered

#### Scenario: Hotkey registration failure degrades gracefully

- **WHEN** the configured mute hotkey cannot be registered (conflict)
- **THEN** a log event records the failure, the app continues normally, and speaker mute remains reachable via the renderer control and tray item
