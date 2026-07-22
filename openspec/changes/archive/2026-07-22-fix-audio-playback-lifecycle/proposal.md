## Why

Two defects in the Gemini audio playback path (`src/hooks/useAudioPipeline.ts`) — the last renderer items before Wave 2.

**Item 7 — a barge-in can leak a chunk that plays after the interruption.** `playGeminiAudio` (`:145-181`) has an `await context.resume()` (`:153`) before it computes `startAt` from `playbackTimeRef` and calls `source.start(startAt)` (`:177-178`). Barge-in fires `onAudioInterrupt → flushPlayback()` (`App.tsx:288`), which stops all live sources and resets `playbackTimeRef` (`:131-143`). If the interrupt lands **during** the `await`, the in-flight chunk resumes afterward, schedules itself against the (now stale) timeline, and plays — so Iris speaks a fragment *after* the user has already cut it off. The window is any `await` between entry and `source.start`.

**Item 8 — the output `AudioContext` is never closed.** `stop()` (`:195-200`) closes the input context (via `stopCapture`) and flushes playback, but leaves `outputContextRef.current` open for the life of the process, holding the audio output device. `playGeminiAudio` reuses that one context (`:151`), so it is never released across stop/start cycles.

Out of scope (moves to Wave 2): the `handleSidecarEvent` stale-closure comment (the last renderer table row) is a documentation nicety and rides with a later change.

## What Changes

Two commits, one per item (independent, unified as "playback stops cleanly — an interruption or a stop cancels in-flight audio and releases the device").

**Commit 1 — Item 7: a flush generation guard cancels in-flight chunks.**
- Add a `flushEpochRef` counter that `flushPlayback` increments on every flush. `playGeminiAudio` captures the epoch at entry and, after all `await`s and immediately before `source.start`, bails out if the epoch changed — a flush happened while this chunk was being decoded/scheduled, so it must not play. This is a cancellation token: it covers the `await context.resume()` window and any future await, and it also protects a `stop()` mid-playback (since `stop` calls `flushPlayback`).
- Result: after any barge-in/flush, no chunk that was in flight during the flush is started; only chunks that begin after the flush completes play.

**Commit 2 — Item 8: release the output context on stop.**
- In `stop()`, after `flushPlayback()`, close `outputContextRef.current`, null it and `outputAnalyserRef`, and reset `playbackTimeRef`. The audio output device is released when the session stops.
- Recreation already exists on the play path: `playGeminiAudio` does `outputContextRef.current ?? new AudioContext()` (`:151`) and rebuilds the analyser when its context no longer matches (`:162-168`), so the next playback after a later `start()` transparently spins up a fresh context.

## Capabilities

### New Capabilities

- `audio-playback`: a new capability for the Gemini voice **playback** subsystem, which has no spec home today (the 16 kHz-send / 24 kHz-receive formats are pinned in CLAUDE.md, not OpenSpec; `main-thread-budget` covers only capture threading). Two requirements: (a) an interruption/barge-in cancels all playing and in-flight-scheduling audio so nothing plays after the user interrupts; (b) stopping the audio session releases the output `AudioContext`, and a later playback transparently recreates it. These are observable correctness properties the current code violates.

### Modified Capabilities

None.

## Impact

- `src/hooks/useAudioPipeline.ts` — add `flushEpochRef`; `flushPlayback` increments it; `playGeminiAudio` captures it at entry and guards before `source.start`; `stop()` closes/nulls the output context + analyser and resets `playbackTimeRef`.
- `audio-playback` living spec — new capability, two ADDED requirements.
- No new dependency, no data migration, no IPC-surface change. The 24 kHz receive/decoding format is unchanged.
