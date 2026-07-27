## Purpose

Hands-free wake and voice-commanded sleep for the app's asleep/awake lifecycle: an on-device wake-word pipeline that mirrors the keyboard wake shortcut, a Gemini `go_to_sleep` tool that mirrors the keyboard sleep path, and a boot-done handshake so Gemini never talks over the boot animation.

## Requirements

### Requirement: On-device wake word while asleep

The renderer SHALL support hands-free wake via an on-device "Hey Iris" wake word pipeline (openWakeWord mel→embedding→classifier through `onnxruntime-web`, model assets bundled under `public/wakeword/` — no runtime CDN fetch), active only while the app is asleep and the wake-word toggle is enabled, and firing the exact same wake path as the keyboard shortcut. The `onnxruntime-web` version and model assets SHALL be pinned alongside the project's other exact identifiers.

A wake SHALL require **sustained** detection: the classifier score must clear the detection threshold on a configurable number of consecutive inference evaluations (default 2) before the wake fires. A single above-threshold evaluation SHALL NOT wake the app. The consecutive count SHALL reset to zero on any evaluation scoring below the threshold, and SHALL NOT carry across a gap in evaluations long enough that the evaluations are no longer adjacent in time. The existing post-wake cooldown SHALL remain in effect unchanged, so a confirmed wake still suppresses immediate re-fires from the same utterance.

The decision of whether a given score at a given time constitutes a wake SHALL be implemented as a pure function of score and time, separable from audio capture and model inference, so it is exercisable by the automated test runner without loading a model, an audio context, or Electron.

#### Scenario: Hands-free wake

- **WHEN** the app is asleep with wake word enabled and the user says "Hey Iris"
- **THEN** the app wakes exactly as if the keyboard wake was pressed (wake pulse, sound cue, session greeting behavior unchanged)

#### Scenario: Isolated score spike does not wake

- **WHEN** exactly one inference evaluation scores above the detection threshold and the next evaluation scores below it
- **THEN** the app does not wake and the consecutive count returns to zero

#### Scenario: Sustained detection wakes

- **WHEN** the required number of consecutive evaluations all score at or above the detection threshold
- **THEN** the app wakes on the evaluation that completes the run

#### Scenario: A non-adjacent run does not confirm

- **WHEN** two above-threshold evaluations are separated by a gap far longer than the normal evaluation interval, with no intervening evaluation
- **THEN** the two are not treated as a consecutive run and the app does not wake on the second

#### Scenario: Cooldown after a confirmed wake

- **WHEN** a wake has just fired and further evaluations score above the threshold within the cooldown window
- **THEN** no second wake fires until the cooldown has elapsed

#### Scenario: Disabled toggle

- **WHEN** the wake-word toggle is off (SetupPanel or `IRIS_WAKE_WORD=0`)
- **THEN** no audio is processed for wake-word detection while asleep

### Requirement: Wake-word sensitivity is user-configurable

The detection threshold and the number of consecutive above-threshold evaluations required to wake SHALL be configurable through the app's existing env-driven configuration (`IRIS_*` keys persisted to the effective `.env`), not hardcoded. Defaults SHALL be chosen so that an installation with no such configuration continues to wake on a spoken "Hey Iris" without any setup.

A value that is missing, unparseable, or outside a sane range SHALL fall back to its default rather than disabling detection or throwing — a malformed configuration file SHALL NOT leave the app unable to wake.

A configuration change SHALL take effect without requiring an app restart **and without requiring a wake/sleep cycle** — including when the change is made while the app is asleep and the listener is already armed, which is precisely when a user troubleshooting false wakes will make it. Applying a changed value SHALL NOT tear down and re-acquire the listener's microphone stream, so the "re-arming after sleep is instant" property is preserved and no capture gap is introduced during which a spoken "Hey Iris" would be missed.

#### Scenario: Change while asleep applies to the armed listener

- **WHEN** the app is asleep with the wake word armed and the user changes wake-word sensitivity and saves
- **THEN** the already-armed listener uses the new value from that point on, without the user first waking and re-sleeping the app

#### Scenario: Applying a change does not interrupt listening

- **WHEN** a wake-word sensitivity value changes while the listener is armed
- **THEN** the microphone stream is not torn down and re-acquired, and detection continues without a gap

#### Scenario: Unconfigured install still wakes

- **WHEN** no wake-word sensitivity keys are present in the effective `.env`
- **THEN** detection runs with the documented defaults and a spoken "Hey Iris" wakes the app

#### Scenario: Malformed value falls back

- **WHEN** a wake-word sensitivity key holds a non-numeric or out-of-range value
- **THEN** the corresponding default is used, detection still runs, and the app can still wake

#### Scenario: Change while awake applies on the next arm

- **WHEN** the user changes wake-word sensitivity while the app is awake (no listener armed), then puts Iris to sleep
- **THEN** the newly armed listener uses the new value without an app restart

### Requirement: Wake-word capture avoids automatic gain

The wake-word listener's audio capture SHALL request that automatic gain control be disabled, so ambient noise in a quiet room is not amplified toward the model's sensitive range. Echo cancellation and noise suppression SHALL remain enabled for that capture.

This constraint SHALL apply only to the wake-word listener's own capture stream; the conversation microphone's capture constraints SHALL be unchanged.

#### Scenario: Listener capture constraints

- **WHEN** the wake-word listener acquires its microphone stream
- **THEN** it requests automatic gain control off, with echo cancellation and noise suppression on

#### Scenario: Conversation mic unaffected

- **WHEN** the app wakes and the conversation microphone is acquired
- **THEN** its capture constraints are unchanged by this requirement

### Requirement: Wake-word score diagnostics without recording audio

The app SHALL provide an opt-in diagnostic mode, off by default and enabled by configuration, that emits wake-word classifier scores — the score of each fired wake, and near-miss scores below the threshold at a rate limit — so a reported false wake can be attributed to an observed score.

Enabling the diagnostic mode SHALL make its output readable by the person who enabled it, without requiring them to modify the app first. It is not sufficient to emit scores to a destination the running build offers no way to open: the renderer's `pushLog` state is discarded and rendered by no component, and the application menu ships without a View role, so neither is readable on its own. The mode SHALL therefore also provide access to wherever it writes.

Diagnostics SHALL NOT capture, retain, or write audio anywhere, and SHALL NOT send any audio or score off the machine. The existing guarantee that nothing is sent to Gemini or Claude until a wake fires SHALL remain true with diagnostics enabled.

When diagnostics are off, the listener SHALL NOT emit per-evaluation log output.

#### Scenario: Diagnostics off by default

- **WHEN** the app runs with no diagnostics configuration
- **THEN** the wake-word listener produces no per-evaluation log output while idle

#### Scenario: A fired wake is attributable

- **WHEN** diagnostics are enabled and a wake fires
- **THEN** the score that triggered it is emitted on a channel an operator can actually read

#### Scenario: Enabling diagnostics makes them readable

- **WHEN** a user enables the diagnostic mode on a build as shipped and reproduces a false wake
- **THEN** they can read the emitted scores without editing code, adding a UI surface, or rebuilding the app

#### Scenario: No audio is retained

- **WHEN** diagnostics are enabled and the listener processes audio
- **THEN** no audio is written to disk, retained beyond the detection window, or transmitted off the machine

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
