## MODIFIED Requirements

### Requirement: Device permissions are granted only to the app's own content

Microphone, camera, and system-audio capture permission SHALL be granted only to the application's own content, identified by the requesting content's origin, and SHALL be denied otherwise. The permission decision SHALL NOT ignore which content is asking.

The origin rule for system-audio capture SHALL resolve identically in development and packaged builds, on the same terms the app's other origin checks already hold — a capture that works from a dev server and is refused from a `file://` document would leave the feature broken only where it ships.

System-audio capture SHALL be granted more narrowly still: it SHALL be granted for audio only, never for screen or window video, and only while listen-only mode is engaged. That mode state SHALL be read from where the main process owns it, never from a value the renderer supplies, so that the answer does not depend on the process asking the question.

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

#### Scenario: System audio is unreachable outside the mode

- **WHEN** the app's own document requests system-audio capture while listen-only mode is not engaged
- **THEN** the request is denied

#### Scenario: The mode state is read from its owner

- **WHEN** a system-audio capture request is decided
- **THEN** the mode state consulted is the main process's own, not one reported by the renderer
