## ADDED Requirements

### Requirement: The renderer does not block its main thread on synchronous modal dialogs

The renderer SHALL NOT use blocking synchronous dialogs (`window.confirm`, `window.alert`, `window.prompt`) for in-app interactions. Such dialogs halt the entire renderer event loop until dismissed — freezing the orb render loop, stalling the 24 kHz audio playback schedule, and pausing gesture tracking. Confirmations such as the DEV soft-gate SHALL be presented as a non-blocking in-app modal that preserves the same confirm/cancel semantics: proceeding continues the guarded action, cancelling aborts it.

#### Scenario: The DEV soft-gate confirmation does not freeze the app

- **WHEN** the DEV soft-gate confirmation is shown (a role switch without the prior handoff)
- **THEN** it is a non-blocking in-app modal, and while it is open the orb keeps rendering, audio keeps playing, and gesture tracking keeps running
- **AND** confirming proceeds with the role switch and cancelling aborts it, exactly as the previous blocking confirm did

#### Scenario: No synchronous blocking dialogs remain

- **WHEN** the renderer needs a user confirmation or alert
- **THEN** it uses a non-blocking in-app surface, not `window.confirm` / `window.alert` / `window.prompt`
