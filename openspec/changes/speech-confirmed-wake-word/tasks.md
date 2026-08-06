## 1. Decide the model and how it ships

- [x] 1.1 Choose Silero VAD **v4 or v5** and record it. They differ in input signature —
      v5 takes `input` [1,512] + `state` [2,1,128] + `sr`; v4 takes `input` + `sr` +
      separate `h`/`c` [2,1,64]. Every later task depends on which
      → **v5, tag `v5.1.2`.** Graph signature read off the downloaded file rather than
      assumed: `input: float32[?,?]`, `state: float32[2,?,128]`, `sr: int64[]` →
      `output: float32[?,1]`, `stateN`. One state tensor, not v4's `h`/`c` pair
- [x] 1.2 Name the download URL as a module constant, following `GESTURE_MODEL_URL` /
      `FACE_MODEL_URL` in `scripts/vendor-runtime-assets.mjs`
      → `SILERO_VAD_MODEL_URL`, pinned to the `v5.1.2` tag rather than `master`
- [x] 1.3 Decide the vendoring pattern deliberately — the repo has two: `public/wakeword/`
      is **committed** to git, `public/runtime/` is **gitignored** and populated by the
      script. The phrase models use the first; `vendorModel` writes only to the second
      → **The script pattern** (`public/runtime/wakeword/`, gitignored). The phrase
      models are committed only because they come from a private training run with no
      URL to fetch them from; Silero has a stable pinned URL, so the gesture/face
      precedent applies and 2.2 MB stays out of git. Placed under `runtime/wakeword/`,
      not `runtime/mediapipe/` — it is not a MediaPipe asset
- [x] 1.4 If reusing `vendorModel`, give it a destination parameter — it currently
      hardcodes `public/runtime/mediapipe/`, so it cannot place a file next to the
      phrase models as-is
      → `vendorModel(label, url, destDir, fileName)`; the two MediaPipe callers pass
      `"mediapipe"` explicitly
- [x] 1.5 Pin model source and version in `docs/REFERENCE.md`'s identifier table
      → plus a footgun entry: the v4/v5 signature split is why the URL carries a tag,
      and skip-if-present means a swap would only surface on a cold cache
- [x] 1.6 Confirm it reaches a packaged build. Expected to be already covered —
      `build.files` includes `dist/**`, Vite copies `public/` into `dist/`, and
      `npm run build` runs the vendoring script before `vite build` — so record *why*
      it is covered rather than leaving this as an open verification
      → Covered, and for the same three reasons, verified in this repo: `package.json`
      `build.files` lists `dist/**`; `npm run build` is
      `node scripts/vendor-runtime-assets.mjs && … && vite build`, so the download
      precedes the copy; and Vite copies `public/` verbatim into `dist/`. Nothing in
      `build.files` enumerates individual runtime files, so a new one under
      `public/runtime/` needs no packaging change — the same reason
      `gesture_recognizer.task` needed none. The `dist/` copy is checked for real
      under 5.1
- [x] 1.7 Confirm it loads with the network disabled
      → It is a `fetch()` of a `file://`/dev-server path under the app's own origin,
      like the three phrase models; no request leaves the machine. Asserted by the
      CSP (`connect-src` has no third-party origin) and by
      `renderer-content-security`'s offline scenario, which already covers wake-word
      assets loading from locally shipped files. Manual offline confirmation is
      folded into 5.7's degraded-load check

## 2. The decision, as pure logic

- [x] 2.1 Add a `noteSpeech(now)` entry point to `createWakeGate` rather than a third
      argument to `step()`. `step()` runs every 200 ms while the VAD verdicts arrive
      every ~32 ms; folding them together quantises the timestamp and loses the
      ordering the symmetric window needs. It also keeps `step(score, now)` positional,
      so the six existing callers in `wake-gate.test.ts` keep passing
- [x] 2.2 Implement the symmetric window: confirmation shortly **before** the phrase
      detection satisfies it just as confirmation shortly after does. Speech precedes
      recognition, so the early case is the common one
      → `Math.abs(lastSpeechAt - candidateAt) <= speechWindowMs`, one comparison for
      both directions; `speechWindowMs` is 1500 (see 3.x for where the number comes from)
- [x] 2.3 Restructure the below-threshold early return so a held candidate can still
      fire. A candidate confirmed after the phrase run ends necessarily arrives on a
      below-threshold evaluation, where `step()` currently returns immediately —
      without this, the late-confirmation scenario cannot work at all
      → the below-threshold branch now only zeroes the run and falls through to the
      single candidate/confirm/cooldown tail
- [x] 2.4 Apply the cooldown check to that late-fire path, or a held candidate bypasses
      cooldown
      → there is exactly one fire path, so it cannot be bypassed; a candidate rejected
      by cooldown is discarded rather than deferred, or it would fire the moment the
      cooldown lapsed — the echo the cooldown exists to suppress
- [x] 2.5 Distinguish "no speech signal available" (model absent or not yet loaded)
      from "speech signal says no". Only the second blocks a wake — collapsing them
      turns fail-open into fail-closed
      → an explicit `setSpeechAvailable(available)`, defaulting to false. Deliberately
      *not* inferred from "`noteSpeech` has never been called": a working detector in a
      silent room looks identical that way, which would fail open exactly when the
      feature is supposed to be blocking
- [x] 2.6 Extend `reset()` to clear the held candidate and last-speech timestamp, and
      add a test case for it — `reset()` runs on teardown (`useWakeWord.ts:335`)
      → both cleared; `speechAvailable` deliberately is not, since whether a detector
      exists is not part of the decision state being torn down. The test asserts that
      too (a reset gate holds rather than falling open)
- [x] 2.7 Extend `src/lib/wake-gate.test.ts` with one case per delta-spec scenario:
      noise-with-phrase, real wake, late confirmation, early confirmation, candidate
      expiry, model-unavailable. No model, no audio context
      → nine new cases: the six scenarios plus detector-withdrawn-at-runtime,
      cooldown-on-the-late-path, and reset
- [x] 2.8 Confirm all six pre-existing wake-gate tests still pass **unmodified** —
      threshold, consecutive count, gap, and cooldown are not being retuned here
      → 15/15 pass. `git diff` on the file shows one changed line outside the new
      block: `speechWindowMs: 1500` added to the shared `CONFIG` fixture. No `it()`
      body and no assertion touched

## 3. Run the model

- [x] 3.1 Add a frame accumulator driven from the existing `onaudioprocess` callback,
      feeding the VAD **contiguous non-overlapping** frames. This is the substantive
      work in this change: the existing 2-second ring buffer re-processed every 200 ms
      is correct for the stateless phrase chain and invalid for a recurrent model
      → `src/lib/frame-accumulator.ts`, pure and separately tested (6 cases). The
      contiguity property is asserted directly: a ramp pushed through ragged chunk
      sizes must come back out as the same ramp, in 512-sample frames, once
- [x] 3.2 Thread the VAD's state tensors across calls, and reset them when the listener
      re-arms
      → `state` [2,1,128] in, `stateN` out, fed back on the next call
      (`src/lib/silero-vad.ts`). The driver is built per arm, so re-arming starts from
      a zero state by construction; teardown calls `stop()`, which also drops the
      half-filled frame so the next arm cannot splice across the gap
- [x] 3.3 Load the VAD **outside** `getSessions()`'s shared `Promise.all`. Inside it, a
      VAD load failure nulls the shared cache, rethrows, reaches `onInitFailed`, and
      takes down the whole listener — the exact inverse of the fail-open requirement.
      This is the most likely way this gets implemented wrong
      → its own cached promise inside `src/lib/speech-confirmation.ts`, started at
      construction and never awaited by `init()`. The listener arms on the phrase
      models alone; a load failure reaches `onError` (running-but-degraded), never
      `onInitFailed`
- [x] 3.4 Wrap inference so a runtime failure degrades to phrase-only; log once, not
      per evaluation
      → `degrade()` is idempotent: it flips availability off (so the gate stops
      requiring speech), clears the backlog, and reports once
- [x] 3.5 Tap the existing `onaudioprocess` rather than acquiring a second stream — no
      `getUserMedia` change and no dependency-array change, so the spec's no-capture-gap
      rule holds
      → one added line in the existing callback; `getUserMedia`, the constraints and
      the `[enabled, deviceId]` dependency array are untouched
- [x] 3.6 Record the deliberate-relative-path reason at the new model `fetch()` site.
      `renderer-content-security` requires it explicitly, and the existing code carries
      such a comment at `useWakeWord.ts:71-78`
      → at the `getSession()` site in `speech-confirmation.ts`
- [x] 3.7 Split the model driver into `src/lib/silero-vad.ts` if `useWakeWord.ts`
      approaches 450 lines — it is at 344 today
      → it hit 549 inline, so the split was required, and one file was not enough.
      Four modules: `frame-accumulator.ts` (re-chunking, pure),
      `silero-vad.ts` (tensors and recurrent state), `speech-confirmation.ts` (load,
      backlog, degrade — the subsystem the hook actually talks to), and
      `onnx-runtime.ts`, which the VAD loader needed and which the phrase loader was
      holding privately. `useWakeWord.ts` ends at 420, inside the 250-450 target
- [x] 3.8 Decide what happens to the held candidate when sensitivity changes rebuild
      the gate — the spec requires applying a change without interrupting listening
      → the held candidate goes with the old gate, exactly as an in-flight run already
      does (design D2) — it was counted against the previous threshold. The
      last-speech timestamp goes too and is deliberately not restored: verdicts arrive
      every ~32 ms, so it repopulates within a frame if anyone is still speaking.
      Availability **is** re-applied, since it describes whether a detector exists,
      which a sensitivity save has no business revoking — without that the listener
      would silently drop to phrase-only on every save

## 4. Diagnostics and the degraded surface

- [x] 4.1 Extend near-miss diagnostics so a non-wake says which signal was missing:
      phrase-not-heard vs heard-without-voice
      → two distinct debug lines. "phrase heard … but no voice confirmed" for a
      blocked candidate; the existing near-miss line now also says whether a voice
      was present, and distinguishes "no speech signal" (no detector) from "voice
      absent". Both derived from what the hook already tracks, so the decision stays
      the gate's alone (design D6)
- [x] 4.2 Decide and implement what the user sees when the VAD is degraded or is
      persistently blocking wakes. Debug-flag-only is **not** sufficient here: the
      spec already requires that silence be distinguishable from a fault, and this
      change adds a new way to be silent that the existing failure surface does not
      cover — armed, caption says speak the phrase, nothing happens
      → two different surfaces, because they are two different states:
      • **Degraded** (model absent, load failed, inference threw) — wake still works
        on the phrase signal, so this is the running-but-degraded channel: a log
        entry, no caption change. Nothing is silent, so nothing needs explaining.
      • **Persistently blocking** (loaded, agreeing with nothing) — the new way to be
        silent. After 3 phrase detections in a row that speech never confirmed, a new
        `onSpeechBlocked` callback fires once per arm and the caption becomes
        *"Heard “Hey Iris” but no voice — press ⌥⇧W to wake"*. It drops the
        invitation to speak, for the same reason the wakeFailed caption does: not
        repeating an instruction that is demonstrably not working for this user.
        Cleared by a wake, by a re-arm, and by the toggle going off. Covered by three
        `wake-caption.test.ts` cases, including its rank against `wakeFailed`
      Deliberately **not** implemented: auto-degrading to phrase-only after N blocked
      candidates. Repeated blocking is what this feature *succeeding* looks like when
      a television is talking; disabling the check at exactly that moment would
      reintroduce the false wakes it exists to stop

## 5. Verify — including that it still wakes

- [x] 5.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
      → all five pass. `npm test`: 1055 tests, 73 files. `npm run build` also confirms
      1.6: `dist/runtime/wakeword/silero_vad.onnx` (2.2 MB) is present after a build,
      alongside `dist/wakeword/`'s three phrase models. `scan:secrets --staged` is a
      no-op with an empty index, so each changed file was additionally scanned with
      `--file`; all clean
- [~] 5.2 Run `node scripts/check-wake-e2e.mjs`. Note its fixture is macOS `say(1)` TTS
      and this change's premise is that the phrase model over-fires on synthesized
      speech — if it fails, suspect the fixture before the implementation, and decide
      then whether the fixture needs to become a real recording
      → **Ran, and fails — but it fails identically on `main` with this change
      stashed**, so it is pre-existing and this change is not implicated. Both runs
      time out at 45 s having printed no `[wakeword]` line at all, not even a
      near-miss.
      The fixture is **not** the suspect, contrary to the task's expectation. Replaying
      `scripts/.wake-e2e-cache/hey-iris.wav` offline through the shipped models:
      • phrase chain peaks at **0.843** (threshold 0.15), with four consecutive
        evaluations above it — the phrase condition is comfortably satisfied
      • Silero **confirms speech at 4.19-4.74 s**, and the phrase run completes at
        4.80 s — a 60 ms gap against a 1500 ms window
      So the new AND condition would not block this fixture, and the design's worry
      that TTS might not read as speech to a VAD does not materialise. The fixture
      does not need to become a real recording.
      What is actually broken is upstream of both models. The listener does arm (the
      `ScriptProcessorNode` deprecation warning in the output comes only from
      `useWakeWord.ts`), `IRIS_WAKE_DEBUG=1` does reach `wakeDebug`, and renderer
      console forwarding does work — yet no evaluation scores even 0.09, while the
      same audio scores 0.84 offline. That points at Chromium's
      `--use-file-for-fake-audio-capture` not delivering the file's content under
      Electron 42. Diagnosing that is its own change; it is not in scope here, and
      nothing in CI depends on it (the check is manual-only)
- [ ] 5.3 Manual: say "Hey Iris" ten times in normal conditions and record how many
      wake, against the same count taken **before** the change. This is the number that
      decides whether it ships — an AND condition can only reduce wakes
      → **Not done: needs a person speaking into a microphone.** This is the number the
      change is judged on and nothing here substitutes for it. Partial evidence only:
      on the one real "Hey Iris" utterance available (the e2e fixture), speech is
      confirmed 60 ms before the phrase run completes, i.e. the new condition adds no
      obstacle to it
- [ ] 5.4 Manual: reproduce a known false-wake source (music, TV, noisy room) and record
      whether it still wakes
      → **Not done: needs a room.** One caveat worth carrying into it, measured while
      pinning the model: Silero scores a 200 Hz harmonic buzz at **0.99**. It rejects
      broadband noise (~0.002) but not everything periodic, and it cannot distinguish a
      television's speech from a person's. Expect this change to remove false wakes
      from non-speech noise, and **not** from a talking TV
- [ ] 5.5 Measure wake latency before and after
      → **Not done: needs a live wake.** By construction the common path adds nothing:
      the VAD runs continuously, so its verdict predates the phrase detection and the
      wake fires on the same evaluation it always did (asserted in
      `wake-gate.test.ts`). Only a candidate confirmed *after* the phrase run pays a
      delay, bounded by the 200 ms evaluation interval
- [x] 5.6 Agree a main-thread budget number **before** measuring, then measure
      steady-state main-thread cost while asleep. Inference goes from ~5/s to ~31/s on
      the thread `main-thread-budget` protects
      → Budget, from what the thread has to do while asleep: no 24 kHz playback
      schedule is running (the listener is armed only while asleep), so the binding
      constraint is the 60 fps orb render loop's 16.7 ms frame. Agreed:
      **≤5% of one core steady-state, and no single synchronous block over 4 ms**
      (a quarter-frame).
      Measured, same wasm backend and `numThreads = 1` as the app, 400 frames after
      warm-up: **mean 1.00 ms/frame, p50 0.98, p95 1.15, max 1.99**. At 31.25 frames/s
      that is **31 ms/s ≈ 3.1% of one core**, and the drain loop awaits between frames
      so the burst of 4 frames per `onaudioprocess` callback never blocks as one unit.
      Inside budget on both numbers.
      Residual: measured in Node against the identical vendored model and runtime, not
      inside Electron's renderer. Worth one confirming reading in-app
- [ ] 5.7 Manual: rename the vendored model to simulate load failure, and confirm
      hands-free wake still works on the phrase signal alone
      → **Not done: needs the app running.** The path is covered in unit tests (a gate
      never told a detector exists wakes on the phrase alone; one whose detector is
      withdrawn mid-run reverts to it) and by construction — the load sits outside
      `getSessions()`, so a 404 reaches `onError`, not `onInitFailed`. But those test
      the gate and not the wiring, so the manual check still stands
- [x] 5.8 Update `docs/ARCHITECTURE.md`'s wake-pipeline description — `docs/REFERENCE.md`
      alone does not cover it
      → the module map had no wake-pipeline entry at all, so this adds one:
      `useWakeWord.ts` plus its five extracted modules, the two-signal rule, the
      incompatible audio contracts, and the fail-open direction
