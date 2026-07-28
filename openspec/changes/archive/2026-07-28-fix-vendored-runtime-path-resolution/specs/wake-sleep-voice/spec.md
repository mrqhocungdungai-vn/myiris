## MODIFIED Requirements

### Requirement: On-device wake word while asleep

The renderer SHALL support hands-free wake via an on-device "Hey Iris" wake word pipeline (openWakeWord mel→embedding→classifier through `onnxruntime-web`, model assets bundled under `public/wakeword/` — no runtime CDN fetch), active only while the app is asleep and the wake-word toggle is enabled, and firing the exact same wake path as the keyboard shortcut. The `onnxruntime-web` version and model assets SHALL be pinned alongside the project's other exact identifiers.

A wake SHALL require **sustained** detection: the classifier score must clear the detection threshold on a configurable number of consecutive inference evaluations (default 2) before the wake fires. A single above-threshold evaluation SHALL NOT wake the app. The consecutive count SHALL reset to zero on any evaluation scoring below the threshold, and SHALL NOT carry across a gap in evaluations long enough that the evaluations are no longer adjacent in time. The existing post-wake cooldown SHALL remain in effect unchanged, so a confirmed wake still suppresses immediate re-fires from the same utterance.

The decision of whether a given score at a given time constitutes a wake SHALL be implemented as a pure function of score and time, separable from audio capture and model inference, so it is exercisable by the automated test runner without loading a model, an audio context, or Electron.

Hands-free wake SHALL work in a packaged or production build, not only under the development server. Any environment-specific difference in how the listener's runtime assets are located is a defect in this requirement, because the development server is not the environment users run.

#### Scenario: Hands-free wake

- **WHEN** the app is asleep with wake word enabled and the user says "Hey Iris"
- **THEN** the app wakes exactly as if the keyboard wake was pressed (wake pulse, sound cue, session greeting behavior unchanged)

#### Scenario: Hands-free wake in a packaged build

- **WHEN** the app is asleep with wake word enabled in a packaged or production build and the user says "Hey Iris"
- **THEN** the app wakes, with the same behaviour as under the development server

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

## ADDED Requirements

### Requirement: A wake-word listener that fails to start says so

When the wake-word listener cannot initialize — its runtime or model assets fail to load, or microphone access is refused — the failure SHALL be surfaced to the user through the app's own interface. The user SHALL be able to distinguish "armed and listening" from "failed to start" without opening a developer console, editing configuration, or rebuilding the app.

It is NOT sufficient to report the failure to a destination the running build offers no way to read: the renderer's `pushLog` state is discarded at its declaration and rendered by no component, so a message routed there is indistinguishable from no message at all.

The app SHALL NOT present an enabled wake-word control together with an instruction to speak the wake phrase while the listener is in a failed state, because that instruction is false and the resulting silence is indistinguishable from poor detection sensitivity — which misdirects the user toward tuning sensitivity for a fault that no sensitivity value can fix.

Only a failure that leaves the listener **not running** SHALL be surfaced this way. A recoverable condition that the listener handles and continues past — notably a selected microphone being unavailable, which falls back to the system default device and then arms normally — SHALL NOT be presented as a failure to start, because the listener is in fact listening. A single error channel carrying both meanings is not sufficient to satisfy this requirement.

Keyboard wake SHALL remain available and SHALL continue to be offered while the listener is in a failed state, since it does not depend on the listener.

The failure indication SHALL clear when the listener subsequently initializes successfully, so a transient failure does not leave a permanent warning. This requires the listener to signal success, not merely the absence of a recent error: clearing on a re-arm *attempt* shows the indication again as soon as the attempt fails, which is a flicker rather than a recovery.

Where the app presents the wake instruction in more than one surface, every one of them SHALL reflect the failed state. A false instruction is no less false in a secondary surface.

#### Scenario: Initialization failure is visible

- **WHEN** the wake-word listener fails to initialize and the user looks at the app
- **THEN** the failure is apparent from the interface, without opening a developer console

#### Scenario: No false instruction while failed

- **WHEN** the wake-word listener is in a failed state
- **THEN** the app does not tell the user that speaking the wake phrase will wake it

#### Scenario: Keyboard wake still offered

- **WHEN** the wake-word listener is in a failed state
- **THEN** the keyboard wake path still works and is still presented to the user

#### Scenario: A successful arm shows no error

- **WHEN** the wake-word listener initializes successfully
- **THEN** no failure indication is shown

#### Scenario: A recovered microphone fallback is not a failure

- **WHEN** the user's selected microphone is unavailable, the listener falls back to the system default device and arms successfully
- **THEN** no failure indication is shown, because the listener is running

#### Scenario: Every wake-instruction surface reflects the failure

- **WHEN** the listener is in a failed state and the app shows its wake instruction in more than one place
- **THEN** none of those places tells the user that speaking the wake phrase will wake it

#### Scenario: Recovery clears the indication

- **WHEN** a listener that previously failed to initialize later arms successfully
- **THEN** the failure indication is cleared rather than persisting
