## MODIFIED Requirements

### Requirement: Device permissions are granted only to the app's own content

Microphone, camera, and system-audio capture permission SHALL be granted only to the application's own content, identified by the requesting content's origin, and SHALL be denied otherwise. The permission decision SHALL NOT ignore which content is asking.

The origin rule for system-audio capture SHALL resolve identically in development and packaged builds, on the same terms the app's other origin checks already hold — a capture that works from a dev server and is refused from a `file://` document would leave the feature broken only where it ships.

System-audio capture SHALL be granted more narrowly still. It SHALL be granted for audio only, never for screen or window video, and SHALL require the system-audio configuration to be enabled AND one of two further conditions to hold — listen-only mode is engaged, or a user-initiated capture self-test is armed. The configuration gate SHALL remain a precondition of both: disabling system audio SHALL leave no reachable capture surface whatsoever, exactly as `listen-only-mode` requires of its escape hatch, so a user who turned this off never triggers a system recording indicator by any route including the self-test. Every condition SHALL be read from where the main process owns it, never from a value the renderer supplies. Every other request SHALL be denied.

The self-test exists because no reported permission state predicts whether this capture works, so the only way to tell a user whether Iris will hear their machine is to try it before the meeting rather than after (see `setup-panel`). It is a second door into the same capture, and it is admitted on the terms that made the original rule worth having rather than as an exception to them.

The self-test SHALL arm exactly one grant. The main process SHALL consume that arming when it grants a request, so a second request before the test is re-armed SHALL be denied. A predicate that stays true for an interval would grant every request made inside it, which is not what "one test" means: a renderer that is faulty or under someone else's control could hold several concurrent captures while every individual grant still looked correct.

The arming SHALL also expire on the main process's own deadline, so an armed grant that is never used does not persist. Re-arming while an arming is already live SHALL NOT extend that deadline.

The main process SHALL arm the self-test itself, SHALL disarm on its own deadline whether or not anything asks it to, and SHALL disarm when the window that armed it goes away. A renderer SHALL NOT be able to keep an arming alive. The grant SHALL be given only to the frame that armed the test, not to any frame that happens to ask while an arming is live.

What is bounded here is the interval in which a grant can be OBTAINED. A stream already handed out is ended by the renderer stopping its tracks, or by the browser engine tearing down the frame that holds it — the main process cannot revoke it. This limit SHALL be stated rather than implied, because a rule that claimed to end an existing capture would be claiming an enforcement that does not exist.

The app SHALL additionally refuse a self-test grant for any request that asks for video, rather than silently answering with audio only, so that "never video" is an observable refusal instead of a coincidence of what was asked for.

#### Scenario: The app's own content keeps microphone and camera
- **WHEN** the app's own document requests microphone or camera access
- **THEN** the request is granted exactly as before this change

#### Scenario: Foreign content is refused the microphone
- **WHEN** content that is not the app's own document requests microphone or camera access
- **THEN** the request is denied

#### Scenario: Foreign content is refused system audio
- **WHEN** content that is not the app's own document requests system-audio capture
- **THEN** the request is denied

#### Scenario: The origin rule holds in a packaged build
- **WHEN** the app's own document requests system-audio capture from a packaged build
- **THEN** it is recognised as the app's own content and granted, exactly as it is in development

#### Scenario: System-audio capture is audio-only
- **WHEN** the app's own document is granted system-audio capture
- **THEN** the granted stream carries audio only, and no screen or window video is requested or provided

#### Scenario: The self-test is audio-only too
- **WHEN** system-audio capture is granted for a running self-test
- **THEN** the granted stream carries audio only, on the same terms as the mode's own capture

#### Scenario: System audio is unreachable outside the mode
- **WHEN** the app's own document requests system-audio capture while listen-only mode is not engaged and no self-test is armed
- **THEN** the request is denied

Note: this scenario's condition is what this change narrowed. It previously
read "while listen-only mode is not engaged" alone, which is no longer the
whole rule — the self-test is a second door, and the denial now requires
neither condition to hold rather than just the mode being off.

#### Scenario: The escape hatch outranks the self-test
- **WHEN** system audio is disabled by configuration and a self-test is armed
- **THEN** the request is denied, because the configuration gate is a precondition of every route to this capture

#### Scenario: The escape hatch outranks the mode
- **WHEN** system audio is disabled by configuration and listen-only mode is engaged
- **THEN** the request is denied, exactly as before this change

#### Scenario: The mode state is read from its owner
- **WHEN** a system-audio capture request is decided
- **THEN** the mode state consulted is the main process's own, not one reported by the renderer

#### Scenario: Every condition is read from its owner
- **WHEN** a system-audio capture request is decided
- **THEN** the configuration, the mode state and the self-test arming consulted are the main process's own, not ones reported by the renderer

#### Scenario: An arming grants once, not for an interval
- **WHEN** a self-test is armed and system-audio capture is requested twice before it is re-armed
- **THEN** the first request is granted and the second is denied

#### Scenario: An unused arming expires
- **WHEN** a self-test is armed and nothing requests capture before the main process's deadline
- **THEN** the arming expires and system-audio capture is unreachable again

#### Scenario: Re-arming does not extend the deadline
- **WHEN** a self-test is armed repeatedly while an arming is already live
- **THEN** the deadline stays the one set by the first arming rather than being pushed out

#### Scenario: A renderer cannot keep an arming alive
- **WHEN** the renderer that armed a self-test goes away, reloads, or simply stops asking
- **THEN** the arming is dropped and system-audio capture is unreachable again

#### Scenario: Only the frame that armed the test is granted
- **WHEN** a frame other than the one that armed the self-test requests system-audio capture while the arming is live
- **THEN** the request is denied

#### Scenario: A self-test request that asks for video is refused
- **WHEN** a self-test request asks for screen or window video
- **THEN** it is refused outright rather than answered with an audio-only stream

#### Scenario: An already-granted stream is ended by its holder, not by main
- **WHEN** a self-test stream has been granted and the arming then expires
- **THEN** no further grant is possible, and the existing stream ends when its holder stops it or when the frame holding it is torn down
