<!--
ORDERING DEPENDENCY — read before archiving.

This change and `harden-wake-word-detection` both MODIFY the same requirement
("On-device wake word while asleep"). The MODIFIED block below is written against
that requirement AS IT WILL READ AFTER `harden-wake-word-detection` archives —
it already contains that change's sustained-detection and pure-function paragraphs.

Therefore: archive `harden-wake-word-detection` FIRST, then this change.

If this change archives first, its block would revert the sustained-detection
requirement, and the harden change's own MODIFIED block would then be applied on
top — so nothing is lost, but the intermediate living spec would be wrong. If the
harden change is abandoned or materially reworked, rebase the block below onto
whatever `openspec/specs/wake-sleep-voice/spec.md` actually says at that point.

Only the first paragraph differs from the harden change's version.
-->

## MODIFIED Requirements

### Requirement: On-device wake word while asleep

The renderer SHALL support hands-free wake via an on-device "Hey Iris" wake word pipeline (openWakeWord mel→embedding→classifier through `onnxruntime-web`), active only while the app is asleep and the wake-word toggle is enabled, and firing the exact same wake path as the keyboard shortcut. The three model assets SHALL be bundled under `public/wakeword/` and SHALL NOT be fetched at runtime; the `onnxruntime-web` WASM runtime, by contrast, IS fetched from a CDN on first load, so the first wake-word arm on a machine that has not cached it requires network access. Any dependency that is referenced both as an installed package and by a hardcoded CDN URL embedding its version — `onnxruntime-web` here, `@mediapipe/tasks-vision` for gesture control — SHALL be declared at an exact version, and the agreement between the declared version and the version embedded in the URL SHALL be enforced by an automated check rather than by a comment.

A wake SHALL require **sustained** detection: the classifier score must clear the detection threshold on a configurable number of consecutive inference evaluations (default 2) before the wake fires. A single above-threshold evaluation SHALL NOT wake the app. The consecutive count SHALL reset to zero on any evaluation scoring below the threshold, and SHALL NOT carry across a gap in evaluations long enough that the evaluations are no longer adjacent in time. The existing post-wake cooldown SHALL remain in effect unchanged, so a confirmed wake still suppresses immediate re-fires from the same utterance.

The decision of whether a given score at a given time constitutes a wake SHALL be implemented as a pure function of score and time, separable from audio capture and model inference, so it is exercisable by the automated test runner without loading a model, an audio context, or Electron.

#### Scenario: Hands-free wake

- **WHEN** the app is asleep with wake word enabled and the user says "Hey Iris"
- **THEN** the app wakes exactly as if the keyboard wake was pressed (wake pulse, sound cue, session greeting behavior unchanged)

#### Scenario: Version skew is caught automatically

- **WHEN** a dependency's declared version no longer matches the version embedded in the CDN URL that names it
- **THEN** the automated test run fails and identifies the mismatched pair, rather than the divergence surviving to break gesture control or wake word at runtime

#### Scenario: Versions agree

- **WHEN** every CDN-paired dependency's declared version matches the version in its URL
- **THEN** the check passes and reports nothing

#### Scenario: Model assets are not fetched at runtime

- **WHEN** the wake-word listener arms
- **THEN** the mel, embedding, and classifier models are loaded from the bundled `public/wakeword/` assets rather than from any network location

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
