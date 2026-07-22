## 1. Commit 1 — Item 7: flush generation guard (`useAudioPipeline.ts`)

- [x] 1.1 Add `const flushEpochRef = useRef(0)` (design D1)
- [x] 1.2 In `flushPlayback` (`:131-143`), increment `flushEpochRef.current` (alongside stopping sources and resetting `playbackTimeRef`)
- [x] 1.3 In `playGeminiAudio` (`:145`), capture `const epoch = flushEpochRef.current` at entry; immediately before `source.start` (`:177-178`), `if (epoch !== flushEpochRef.current) return;` — do not start and do not advance `playbackTimeRef`. Optionally `source.disconnect()` before returning
- [x] 1.4 Confirm the normal (non-interrupted) path is unchanged: chunks schedule and play on the timeline exactly as before

## 2. Commit 1 — verification (manual; Web Audio is out of the Vitest harness)

- [x] 2.1 Interrupt Iris mid-utterance (barge-in): audio stops immediately with NO trailing fragment after the cut
- [x] 2.2 Rapidly interrupt right as Iris starts speaking (hit the `await context.resume()` window, e.g. after the context was suspended): still no leaked chunk
- [x] 2.3 After an interruption, a new response plays normally on a fresh timeline
- [x] 2.4 `npm run build` passes

## 3. Commit 2 — Item 8: release the output context on stop (`useAudioPipeline.ts`)

- [x] 3.1 In `stop()` (`:195-200`), after `flushPlayback()`: `await outputContextRef.current?.close().catch(() => undefined)`, then `outputContextRef.current = null; outputAnalyserRef.current = null; playbackTimeRef.current = 0` (design D2)
- [x] 3.2 Keep the flush BEFORE the close (stops sources + bumps the epoch so any in-flight `playGeminiAudio` bails); optionally wrap `source.start` in try/catch as a defensive backstop
- [x] 3.3 Confirm recreation works: `playGeminiAudio`'s `?? new AudioContext()` (`:151`) and analyser-context-mismatch rebuild (`:162-168`) already handle a nulled context — no extra recreation code needed

## 4. Commit 2 — verification (manual)

- [x] 4.1 Stop the audio session → the output `AudioContext` is closed (e.g. `outputContextRef` nulled; OS shows the app no longer holding the audio output)
- [x] 4.2 Start again and trigger a response → playback works with a fresh context/analyser
- [x] 4.3 Repeat stop/start a few times → no leaked/accumulating contexts, playback keeps working
- [x] 4.4 `npm run build` passes

## 5. Spec and record

- [x] 5.1 `openspec validate fix-audio-playback-lifecycle` passes
- [x] 5.2 Re-read the `audio-playback` requirements against the landed code: an interruption cancels playing + in-flight chunks (no trailing fragment, timeline not advanced by a cancelled chunk); stopping closes the output context and a later playback recreates it
- [x] 5.3 Two commits on `develop`, one per item (commit 1 = flush epoch guard, commit 2 = close output context on stop). Do not squash. Co-Authored-By trailer
- [x] 5.4 Update the log table in `docs/BUGFIX_PLAN.md`: mark the barge-in-leak and output-context-leak rows done; note item 7 adds a flush-generation guard that cancels chunks in flight during a flush (barge-in or stop) and item 8 closes/nulls the output context on stop (recreated on next playback), recorded under the new `audio-playback` capability. Note the only remaining renderer row is the `handleSidecarEvent` stale-closure comment; then Wave 2 (BUG I.2–I.5)
