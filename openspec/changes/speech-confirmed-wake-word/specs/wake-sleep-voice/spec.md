## ADDED Requirements

### Requirement: A wake requires independent speech confirmation

A wake SHALL require two independent agreeing signals: the phrase model's sustained
detection, and confirmation from a **separate** on-device model that human speech
occurred close in time to it. Neither alone SHALL wake the app.

The reason the second signal must be independent is that the phrase classifier is
trained on synthesized speech and scores confidently on non-speech sound. That error
is inside the model, so no threshold applied to its own output can detect it. Raising
the threshold trades away true wakes before it removes the false ones; a second
opinion does not.

The two signals SHALL NOT be required to arrive on the same evaluation. A phrase
detection that arrives without current speech confirmation SHALL be held for a bounded
window and SHALL wake if confirmation arrives within it; it SHALL be discarded when
the window elapses. Equally, speech confirmed shortly *before* the phrase detection
SHALL satisfy the requirement, since a spoken "Hey Iris" produces speech before the
classifier has finished recognising it.

The speech model SHALL run on-device from an asset bundled in the app, on the same
terms as the phrase model — no runtime network fetch, version and asset pinned
alongside the project's other exact identifiers.

**The failure mode SHALL favour waking.** If the speech model is unavailable, fails to
load, or errors, wake SHALL fall back to the phrase signal alone rather than becoming
impossible. An app that cannot wake is a worse defect than one that occasionally wakes
when it should not, and this requirement SHALL NOT be the reason hands-free wake stops
working.

Confirmation SHALL NOT add a perceptible delay to a genuine wake.

#### Scenario: Noise that scores as the phrase does not wake

- **WHEN** the phrase model sustains an above-threshold score but no human speech is
  confirmed within the window
- **THEN** the app does not wake

#### Scenario: A real "Hey Iris" wakes

- **WHEN** the user speaks "Hey Iris" and both the phrase detection and speech
  confirmation occur within the window
- **THEN** the app wakes exactly as it does today, with no added perceptible delay

#### Scenario: Confirmation arriving slightly late still wakes

- **WHEN** the phrase model detects first and speech is confirmed shortly afterwards,
  within the holding window
- **THEN** the app wakes

#### Scenario: Confirmation arriving slightly early still wakes

- **WHEN** speech is confirmed shortly before the phrase model's detection, within the
  window
- **THEN** the app wakes

#### Scenario: A held candidate expires

- **WHEN** the phrase model detects and no speech confirmation arrives before the
  holding window elapses
- **THEN** the app does not wake, and the candidate is discarded rather than waking
  later

#### Scenario: The speech model being unavailable does not prevent waking

- **WHEN** the speech model cannot be loaded or fails at runtime
- **THEN** hands-free wake continues to work on the phrase signal alone

#### Scenario: Diagnostics distinguish the two signals

- **WHEN** wake diagnostics are enabled and a candidate does not wake
- **THEN** the reported detail says which signal was missing, so the phrase model
  never hearing the wake word is distinguishable from it being heard without a voice

## MODIFIED Requirements

### Requirement: On-device wake word while asleep

The renderer SHALL support hands-free wake via an on-device "Hey Iris" wake word pipeline (openWakeWord mel→embedding→classifier through `onnxruntime-web`, model assets bundled under `public/wakeword/` — no runtime CDN fetch), active only while the app is asleep and the wake-word toggle is enabled, and firing the exact same wake path as the keyboard shortcut. The `onnxruntime-web` version and model assets SHALL be pinned alongside the project's other exact identifiers. The same applies to the speech-confirmation model that a wake additionally requires.

A wake SHALL require **sustained** detection: the classifier score must clear the detection threshold on a configurable number of consecutive inference evaluations (default 2) before the wake fires. A single above-threshold evaluation SHALL NOT wake the app. The consecutive count SHALL reset to zero on any evaluation scoring below the threshold, and SHALL NOT carry across a gap in evaluations long enough that the evaluations are no longer adjacent in time. The existing post-wake cooldown SHALL remain in effect unchanged, so a confirmed wake still suppresses immediate re-fires from the same utterance.

Sustained detection is necessary but not sufficient: a wake also requires independent speech confirmation, specified separately.

The decision of whether a given score at a given time constitutes a wake SHALL be implemented as a pure function of score and time, separable from audio capture and model inference, so it is exercisable by the automated test runner without loading a model, an audio context, or Electron. This SHALL extend to the speech-confirmation input: whether a wake fires SHALL remain decidable from scores, confirmation events, and timestamps alone, with no second model loaded in the test.

Hands-free wake SHALL work in a packaged or production build, not only under the development server. Any environment-specific difference in how the listener's runtime assets are located is a defect in this requirement, because the development server is not the environment users run. This covers the speech-confirmation model's assets on the same terms.

#### Scenario: Hands-free wake

- **WHEN** the app is asleep with wake word enabled and the user says "Hey Iris"
- **THEN** the app wakes exactly as if the keyboard wake was pressed (wake pulse, sound cue, session greeting behavior unchanged)

#### Scenario: Hands-free wake in a packaged build

- **WHEN** the app is asleep with wake word enabled in a packaged or production build and the user says "Hey Iris"
- **THEN** the app wakes, with the same behaviour as under the development server

#### Scenario: Isolated score spike does not wake

- **WHEN** exactly one inference evaluation scores above the detection threshold and the next evaluation scores below it
- **THEN** the app does not wake and the consecutive count returns to zero

#### Scenario: Sustained detection completes the phrase condition

- **WHEN** the required number of consecutive evaluations all score at or above the detection threshold
- **THEN** the phrase condition is satisfied on the evaluation that completes the run, and the app wakes on that evaluation provided speech confirmation is also satisfied

#### Scenario: A non-adjacent run does not confirm

- **WHEN** two above-threshold evaluations are separated by a gap far longer than the normal evaluation interval, with no intervening evaluation
- **THEN** the two are not treated as a consecutive run and the app does not wake on the second

#### Scenario: Cooldown after a confirmed wake

- **WHEN** a wake has just fired and further evaluations score above the threshold within the cooldown window
- **THEN** no second wake fires until the cooldown has elapsed

#### Scenario: Disabled toggle

- **WHEN** the wake-word toggle is off (SetupPanel or `IRIS_WAKE_WORD=0`)
- **THEN** no audio is processed for wake-word detection while asleep

#### Scenario: The wake decision stays testable without models

- **WHEN** the automated test runner exercises the wake decision, including its speech-confirmation condition
- **THEN** it does so from scores, confirmation events, and timestamps alone, loading neither model and creating no audio context
