# main-thread-budget

## Purpose

Keeps the renderer's main/UI thread free of avoidable per-frame work — heap allocation in the steady-state orb render loop and microphone downsampling — so garbage-collection pauses and audio-processing callbacks don't jitter the 24 kHz Gemini audio playback schedule or stall UI responsiveness.

## Requirements

### Requirement: The orb render loop performs no per-frame heap allocation

The orb's `useFrame` render callback SHALL NOT allocate objects (colors, vectors, arrays, closures) on the per-frame hot path. Values that change only with the orb's expressive state (its palette) SHALL be parsed once and reused, and per-frame writes to materials and transforms SHALL mutate existing objects in place (e.g. copy/set into an existing `THREE.Color` or `Vector3`) rather than constructing new ones. This keeps garbage-collection pauses — which land on the main thread and jitter the 24 kHz audio schedule — out of the steady-state render loop. The rendered result (orb colors, glow, motion) SHALL be identical to before.

#### Scenario: Steady-state frames allocate nothing

- **WHEN** the orb render loop runs at steady state (fixed expressive state, no state transition)
- **THEN** each frame allocates no new `THREE.Color`, `THREE.Vector3`, or other per-frame objects — material colors and transforms are written in place from pre-parsed, reused values

#### Scenario: Visual output is unchanged

- **WHEN** the orb is in any expressive state (idle / online / listening / speaking / working)
- **THEN** its colors, emissive glow, and animation are visually identical to the pre-optimization behavior

### Requirement: Microphone capture and downsampling do not run on the main thread

The renderer SHALL perform microphone capture and its downsampling to the 16 kHz send format off the main/UI thread, using an `AudioWorklet` running on the audio rendering thread rather than a `ScriptProcessorNode` whose callback runs on the main thread. The 16 kHz mono PCM stream delivered to the voice layer (`window.iris.sendAudioChunk`) SHALL be unchanged. The passive input-level meter tap MAY remain on the audio graph and SHALL keep driving the reactive HUD as before.

#### Scenario: Capture downsampling runs off the main thread

- **WHEN** the microphone is capturing
- **THEN** the per-audio-frame downsampling runs inside an `AudioWorklet` (audio thread), and the main thread only receives finished 16 kHz PCM chunks to forward — it does not run a `ScriptProcessorNode` `onaudioprocess` callback

#### Scenario: Send format is preserved

- **WHEN** audio is captured and forwarded to the voice layer
- **THEN** the chunks are 16 kHz mono PCM, byte-for-byte equivalent to the previous `ScriptProcessorNode` path

#### Scenario: Capture lifecycle is clean

- **WHEN** capture stops
- **THEN** the worklet node and its input context are disconnected and closed, leaving no live audio node or open input `AudioContext`

### Requirement: The renderer does not block its main thread on synchronous modal dialogs

The renderer SHALL NOT use blocking synchronous dialogs (`window.confirm`, `window.alert`, `window.prompt`) for in-app interactions. Such dialogs halt the entire renderer event loop until dismissed — freezing the orb render loop, stalling the 24 kHz audio playback schedule, and pausing gesture tracking. Confirmations such as the DEV soft-gate SHALL be presented as a non-blocking in-app modal that preserves the same confirm/cancel semantics: proceeding continues the guarded action, cancelling aborts it.

#### Scenario: The DEV soft-gate confirmation does not freeze the app

- **WHEN** the DEV soft-gate confirmation is shown (a role switch without the prior handoff)
- **THEN** it is a non-blocking in-app modal, and while it is open the orb keeps rendering, audio keeps playing, and gesture tracking keeps running
- **AND** confirming proceeds with the role switch and cancelling aborts it, exactly as the previous blocking confirm did

#### Scenario: No synchronous blocking dialogs remain

- **WHEN** the renderer needs a user confirmation or alert
- **THEN** it uses a non-blocking in-app surface, not `window.confirm` / `window.alert` / `window.prompt`
