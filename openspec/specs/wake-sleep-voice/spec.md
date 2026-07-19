## Purpose

Hands-free wake and voice-commanded sleep for the app's asleep/awake lifecycle: an on-device wake-word pipeline that mirrors the keyboard wake shortcut, a Gemini `go_to_sleep` tool that mirrors the keyboard sleep path, and a boot-done handshake so Gemini never talks over the boot animation.

## Requirements

### Requirement: On-device wake word while asleep

The renderer SHALL support hands-free wake via an on-device "Hey Iris" wake word pipeline (openWakeWord mel→embedding→classifier through `onnxruntime-web`, model assets bundled under `public/wakeword/` — no runtime CDN fetch), active only while the app is asleep and the wake-word toggle is enabled, and firing the exact same wake path as the keyboard shortcut. The `onnxruntime-web` version and model assets SHALL be pinned alongside the project's other exact identifiers.

#### Scenario: Hands-free wake

- **WHEN** the app is asleep with wake word enabled and the user says "Hey Iris"
- **THEN** the app wakes exactly as if the keyboard wake was pressed (wake pulse, sound cue, session greeting behavior unchanged)

#### Scenario: Disabled toggle

- **WHEN** the wake-word toggle is off (SetupPanel or `IRIS_WAKE_WORD=0`)
- **THEN** no audio is processed for wake-word detection while asleep

### Requirement: Voice-commanded sleep

Gemini SHALL have a `go_to_sleep` tool: on invocation it acknowledges immediately, Gemini speaks a goodbye, and the main process emits `iris:sleep` after a configurable delay (`IRIS_SLEEP_DELAY_MS`, default ~3000 ms); the renderer then sleeps identically to the keyboard sleep path.

#### Scenario: Sleep by voice

- **WHEN** the user tells Iris to go to sleep
- **THEN** Iris says goodbye and the app enters sleep after the delay, with wake word (if enabled) re-armed

### Requirement: Boot-done handshake

The renderer SHALL notify the main process via `iris:boot-done` when the boot animation completes, and the main process SHALL defer the Gemini session greeting until then; wake-word arming SHALL also respect boot completion.

#### Scenario: No talking over boot

- **WHEN** the app starts and the boot animation is still playing
- **THEN** Gemini's opening line is not spoken until the renderer reports boot-done
