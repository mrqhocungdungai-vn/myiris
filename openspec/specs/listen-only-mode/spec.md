## Purpose

Listen-only mode is the headphone toggle: Iris keeps hearing the user and keeps replying, but her reply arrives as text on screen instead of as sound. It exists so the user can silence Iris without disturbing the conversation — the mode is reached and left without ever reconnecting the voice session, which is what distinguishes it from the retired listening mode it replaces.

## Requirements

### Requirement: Listen-only mode suppresses Gemini audio output without reconnecting

Listen-only mode SHALL silence Gemini's voice output independently of the microphone. While the mode is engaged, the app SHALL immediately stop every currently-playing audio source when the mode is entered (reusing the existing barge-in/flush stop) AND SHALL suppress all subsequently-arriving Gemini audio chunks — dropping them without scheduling playback, without driving the output level meter, and without advancing the playback timeline — until the mode is disengaged. When the mode is disengaged, only chunks that arrive after that point SHALL play, on a normal timeline.

Entering or leaving the mode SHALL NOT disconnect, reconnect, or reconfigure the Gemini Live session, SHALL NOT change the requested response modality, SHALL NOT change the session's tool set, and SHALL NOT change the microphone's mute state or what audio Iris receives. The session's audio response modality SHALL remain in force throughout, so Iris's reply still reaches the user as transcribed text through the ordinary transcript path and the conversation's context is unaffected by the mode.

Because activity detection stays enabled, Iris SHALL continue to take turns normally while the mode is engaged — including interjecting after a pause — silently and in text. Tool calls, run delegation, and barge-in SHALL behave exactly as they do with the mode off.

#### Scenario: Engaging the mode cuts audio already playing

- **WHEN** the user engages listen-only mode while Iris is speaking
- **THEN** all currently-playing audio sources stop immediately
- **AND** the Gemini session, its response modality, its tool set and the microphone state are all unchanged

#### Scenario: Engaged mode drops incoming audio silently

- **WHEN** new Gemini audio chunks arrive while listen-only mode is engaged
- **THEN** they are not scheduled for playback and produce no sound
- **AND** the output level meter is not fed and the playback timeline is not advanced

#### Scenario: The reply still arrives as text

- **WHEN** Iris completes a reply turn while listen-only mode is engaged
- **THEN** her reply appears in the transcript as text, exactly as it would with the mode off
- **AND** the turn is part of the conversation's context

#### Scenario: No reconnect on either transition

- **WHEN** the user engages listen-only mode and later disengages it
- **THEN** the Gemini Live session is neither disconnected nor reconnected at either transition
- **AND** no session configuration is rebuilt

#### Scenario: Disengaging resumes only new audio

- **WHEN** the user disengages listen-only mode
- **THEN** Gemini audio chunks that arrive afterward play normally
- **AND** no audio that arrived while the mode was engaged is played back

#### Scenario: The mode is independent of the microphone

- **WHEN** the user toggles listen-only mode
- **THEN** the microphone mute state is unchanged
- **AND** toggling the microphone mute leaves the listen-only mode state unchanged

#### Scenario: Iris still takes turns while engaged

- **WHEN** the user pauses mid-thought while listen-only mode is engaged
- **THEN** Iris may take a turn as she normally would, and it appears as text with no sound
- **AND** tool calls and run delegation from that turn proceed normally

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

Listen-only mode SHALL reset to disengaged whenever the session ends — whether by explicit user stop or by a server-initiated teardown (e.g. reconnect attempts exhausted) — so it resets on the transition to not-running, not only on an explicit stop call. Toggling the mode SHALL be a no-op while the session is asleep (not running), so a wake always starts with Iris audible. The mode SHALL NOT be persisted to configuration; a fresh app launch always starts with Iris audible.

#### Scenario: A session ending clears the mode

- **WHEN** the session ends while listen-only mode is engaged (user stop or server-initiated teardown)
- **THEN** the mode is reset to disengaged
- **AND** the next wake starts with Iris audible

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

### Requirement: A silent reply is presented as silent, not as speech

While listen-only mode is engaged, the app SHALL NOT report Iris's reply turn as audible speech. It SHALL report a distinct output state for a reply that produces text without sound, and the UI SHALL present that state as visually distinct from both audible speech and waiting-to-listen: the orb SHALL take a cool accent from the app's existing cool family — separate in hue from the listening state and never the warm accent reserved for audible speech — at the same full energy audible speech uses, because the turn is equally active. The caption SHALL show the reply's text rather than a speaking label.

The state SHALL clear at the end of the turn exactly as the audible speaking state does.

#### Scenario: The orb does not read as speaking

- **WHEN** Iris produces a reply turn while listen-only mode is engaged
- **THEN** the orb shows the silent-reply state, not the audible-speaking state
- **AND** its accent is a cool hue distinct from the listening state, at full energy

#### Scenario: The caption shows text, not a speaking label

- **WHEN** Iris produces a reply turn while listen-only mode is engaged
- **THEN** the caption shows the reply's text rather than a label announcing that Iris is speaking

#### Scenario: Audible speech is unaffected

- **WHEN** Iris produces a reply turn while listen-only mode is disengaged
- **THEN** the orb shows the audible-speaking state with its warm accent, and the caption behaves exactly as before this change

#### Scenario: The silent-reply state clears with the turn

- **WHEN** a reply turn completes while listen-only mode is engaged
- **THEN** the silent-reply state clears on the same signal that clears the audible-speaking state

### Requirement: The HUD reveals its transcript while the mode is engaged

Because listen-only mode moves Iris's reply from sound to text, the surface that displays that text SHALL be visible without further user action. In HUD mode the transcript panel is collapsed by default; engaging listen-only mode SHALL open it, and disengaging the mode SHALL restore whatever open/closed state the user had before the mode was engaged. The user SHALL remain able to collapse or open the panel by hand while the mode is engaged, and a manual change SHALL be respected rather than immediately re-forced.

The deck's transcript is always visible and SHALL require no change.

#### Scenario: Engaging the mode opens the HUD transcript

- **WHEN** the user engages listen-only mode in HUD mode while the transcript panel is collapsed
- **THEN** the transcript panel opens, so Iris's text replies are readable without further action

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
