## ADDED Requirements

### Requirement: An interruption cancels all in-flight and playing audio

When playback is interrupted (barge-in / flush), the renderer SHALL stop every currently-playing audio source AND SHALL prevent any chunk that was mid-decode or mid-scheduling at the moment of the interruption from being started afterward. No audio scheduled before the interruption SHALL play once the interruption has occurred; only chunks that begin processing after the flush completes SHALL play. This holds regardless of `await` points in the play path (e.g. resuming a suspended `AudioContext`).

#### Scenario: Barge-in stops audio already playing

- **WHEN** the user interrupts while Iris is speaking
- **THEN** all currently-playing audio sources stop immediately

#### Scenario: Barge-in cancels a chunk that was being scheduled

- **WHEN** an interruption arrives while a chunk is between entry and `source.start` (e.g. during an `await context.resume()`)
- **THEN** that chunk is not started and does not play after the interruption
- **AND** the playback timeline is not advanced by the cancelled chunk

#### Scenario: Playback resumes normally after the interruption

- **WHEN** new audio chunks arrive after the flush has completed
- **THEN** they play normally on a fresh timeline

### Requirement: Stopping the session releases the output audio device

When the audio session stops, the renderer SHALL close the output `AudioContext`, discard the associated analyser, and reset the playback timeline, releasing the output audio device rather than holding it for the life of the process. A subsequent playback after a later start SHALL transparently recreate the output context and analyser.

#### Scenario: Stop closes the output context

- **WHEN** the audio session stops
- **THEN** the output `AudioContext` is closed and the playback state (analyser, timeline) is cleared, releasing the output device

#### Scenario: Playback works again after a restart

- **WHEN** audio chunks arrive after the session has been stopped and started again
- **THEN** a fresh output context and analyser are created and playback works normally
