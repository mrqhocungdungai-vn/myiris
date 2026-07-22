## Context

Gemini audio arrives as base64 PCM chunks over IPC. `onAudioChunk → playGeminiAudio(chunk)` (`App.tsx:287`) decodes each into an `AudioBuffer` and schedules it on a shared timeline (`playbackTimeRef`), pushing the `AudioBufferSourceNode` onto `playbackSourcesRef` (`useAudioPipeline.ts:145-181`). `onAudioInterrupt → flushPlayback()` (`App.tsx:288`) is barge-in: it stops every source and sets `playbackTimeRef = context.currentTime` (`:131-143`).

`playGeminiAudio` is `async` and has an `await context.resume()` when the context is suspended (`:153`), then reads `playbackTimeRef` and calls `source.start(startAt)` (`:177-178`). Nothing ties a given `playGeminiAudio` invocation to the flush that may occur during its await, so a chunk decoded before a barge-in can still start after it. `stop()` (`:195-200`) closes the input context and flushes, but never touches `outputContextRef`, which is created once (`:151`) and reused forever.

## Goals / Non-Goals

**Goals:**

- After any flush (barge-in or stop), no chunk that was in flight during the flush plays.
- Stopping the session closes/releases the output `AudioContext`; a later playback recreates it transparently.
- No change to decoding, the 24 kHz receive format, timeline scheduling, or the output-level meter behavior in the normal (non-interrupted) path.

**Non-Goals:**

- Reworking the scheduling/timeline model or crossfade behavior.
- The `handleSidecarEvent` stale-closure comment (rides with a later change).
- Capture-path changes (already handled in `main-thread-budget`).

## Decisions

### D1 — A flush generation counter cancels in-flight chunks

**Chosen:** add `const flushEpochRef = useRef(0)`. `flushPlayback` does `flushEpochRef.current++` (in addition to stopping sources and resetting the timeline). `playGeminiAudio` captures `const epoch = flushEpochRef.current` at entry, and immediately before scheduling (`:177`) checks `if (epoch !== flushEpochRef.current) return;` — a flush occurred during this call's async work, so the chunk is abandoned without `source.start` and without advancing `playbackTimeRef`.

This is a cancellation token, robust to any number of `await`s: it covers the `await context.resume()` window today and any await added later. It also covers `stop()` mid-playback for free, because `stop()` calls `flushPlayback()` (so the epoch bumps). The created-but-unstarted `source` is simply dropped (never started, GC'd); optionally `source.disconnect()` before returning for tidiness.

*Considered:* an `isFlushing` boolean flag. Rejected — a boolean cannot distinguish "a flush happened during my await" from "a flush is happening right now for a later chunk"; a monotonically increasing epoch captured per call is unambiguous and needs no reset.

*Considered:* moving the `await context.resume()` to the top before any timeline read (it already is) or removing the await. Rejected — the context genuinely may be suspended and must resume; the fix is to make scheduling flush-aware, not to remove the await.

### D2 — `stop()` closes and nulls the output context

**Chosen:** in `stop()`, after `flushPlayback()`, `await outputContextRef.current?.close().catch(() => undefined)`, then `outputContextRef.current = null; outputAnalyserRef.current = null; playbackTimeRef.current = 0`. Recreation is already handled: `playGeminiAudio` uses `outputContextRef.current ?? new AudioContext()` (`:151`) and rebuilds the analyser when `analyser.context !== context` (`:162-168`). So closing on stop is safe — the next play after a later `start()` spins up a fresh context and analyser with no extra code.

Ordering: `flushPlayback()` first (stops sources, bumps the epoch so any in-flight `playGeminiAudio` bails per D1), then close — so no source is started against a closing context. Defensively, `source.start(startAt)` can be wrapped in try/catch (an `InvalidStateError` on a closing context becomes a no-op) since the epoch guard already prevents the normal case.

## Risks / Trade-offs

**A legitimately-queued chunk is dropped by the epoch guard** → only chunks whose async work *straddled* a flush are dropped; that is exactly the desired barge-in behavior. Chunks arriving cleanly after the flush capture the new epoch and play.

**Closing the output context adds latency to the next first chunk** → creating an `AudioContext` and analyser is cheap and happens once per session start, before the first chunk schedules; imperceptible.

**A chunk arrives between `stop()`'s flush and close** → the epoch guard (bumped by the flush) aborts it; the defensive try/catch around `source.start` covers the residual race if `playGeminiAudio` somehow passes the guard as the context closes.

**No automated coverage** → Web Audio + IPC are out of the Vitest harness (Wave 0.0 D5). The scheduling/epoch logic is embedded in the hook against live `AudioContext`; if a pure timeline/epoch helper is later extracted it can carry a unit test, but this change verifies manually: interrupt mid-utterance and confirm no trailing fragment; stop and confirm the output device releases; restart and confirm playback resumes.
