## ADDED Requirements

### Requirement: Panel offers the WebGL quality control

The SetupPanel SHALL offer a control for the WebGL quality preference defined by `webgl-quality-mode`, presented as a two-state Off/On row alongside the panel's other display and interaction preferences (interface sounds, wake word, gesture camera), with Off meaning the light path. It SHALL be the only place in the UI where that preference is set, so a user never has to find a second control to stop a second WebGL surface from loading their GPU.

The control SHALL render regardless of pipeline availability, since every WebGL surface it governs exists in chat-only operation. Unlike the panel's `.env`-backed settings, this control SHALL persist locally and take effect immediately on change — it SHALL NOT depend on the panel's Save action, SHALL NOT write to the effective `.env`, and SHALL NOT offer a reconnect or relaunch prompt, because no session state is affected.

The control SHALL carry text making clear what the user is trading: turning it on restores the full visual effects at a materially higher GPU cost, and it is off by default so that a modest machine works without configuration.

#### Scenario: The control appears with the other preferences

- **WHEN** the user opens the SetupPanel
- **THEN** a two-state WebGL quality row is present alongside the interface-sounds and wake-word toggles, showing the current state, defaulting to Off

#### Scenario: The control renders in chat-only mode

- **WHEN** the SetupPanel is opened on an install with no Claude credential
- **THEN** the WebGL quality row still renders, since it governs surfaces that exist without the pipeline

#### Scenario: Changing it needs no Save and no relaunch

- **WHEN** the user toggles the row
- **THEN** the change persists and the WebGL surfaces re-render on the new path immediately, without pressing Save, without a reconnect prompt, and without a relaunch prompt

#### Scenario: The effective .env is untouched

- **WHEN** the user toggles the row and the effective `.env` is inspected
- **THEN** it is unchanged — this preference is not part of the `.env` configuration surface

#### Scenario: The trade-off is stated

- **WHEN** the user reads the row
- **THEN** it communicates that turning it on costs materially more GPU, and that it is off by default
