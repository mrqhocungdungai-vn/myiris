## 1. Decide the model and how it ships

- [ ] 1.1 Choose Silero VAD **v4 or v5** and record it. They differ in input signature —
      v5 takes `input` [1,512] + `state` [2,1,128] + `sr`; v4 takes `input` + `sr` +
      separate `h`/`c` [2,1,64]. Every later task depends on which
- [ ] 1.2 Name the download URL as a module constant, following `GESTURE_MODEL_URL` /
      `FACE_MODEL_URL` in `scripts/vendor-runtime-assets.mjs`
- [ ] 1.3 Decide the vendoring pattern deliberately — the repo has two: `public/wakeword/`
      is **committed** to git, `public/runtime/` is **gitignored** and populated by the
      script. The phrase models use the first; `vendorModel` writes only to the second
- [ ] 1.4 If reusing `vendorModel`, give it a destination parameter — it currently
      hardcodes `public/runtime/mediapipe/`, so it cannot place a file next to the
      phrase models as-is
- [ ] 1.5 Pin model source and version in `docs/REFERENCE.md`'s identifier table
- [ ] 1.6 Confirm it reaches a packaged build. Expected to be already covered —
      `build.files` includes `dist/**`, Vite copies `public/` into `dist/`, and
      `npm run build` runs the vendoring script before `vite build` — so record *why*
      it is covered rather than leaving this as an open verification
- [ ] 1.7 Confirm it loads with the network disabled

## 2. The decision, as pure logic

- [ ] 2.1 Add a `noteSpeech(now)` entry point to `createWakeGate` rather than a third
      argument to `step()`. `step()` runs every 200 ms while the VAD verdicts arrive
      every ~32 ms; folding them together quantises the timestamp and loses the
      ordering the symmetric window needs. It also keeps `step(score, now)` positional,
      so the six existing callers in `wake-gate.test.ts` keep passing
- [ ] 2.2 Implement the symmetric window: confirmation shortly **before** the phrase
      detection satisfies it just as confirmation shortly after does. Speech precedes
      recognition, so the early case is the common one
- [ ] 2.3 Restructure the below-threshold early return so a held candidate can still
      fire. A candidate confirmed after the phrase run ends necessarily arrives on a
      below-threshold evaluation, where `step()` currently returns immediately —
      without this, the late-confirmation scenario cannot work at all
- [ ] 2.4 Apply the cooldown check to that late-fire path, or a held candidate bypasses
      cooldown
- [ ] 2.5 Distinguish "no speech signal available" (model absent or not yet loaded)
      from "speech signal says no". Only the second blocks a wake — collapsing them
      turns fail-open into fail-closed
- [ ] 2.6 Extend `reset()` to clear the held candidate and last-speech timestamp, and
      add a test case for it — `reset()` runs on teardown (`useWakeWord.ts:335`)
- [ ] 2.7 Extend `src/lib/wake-gate.test.ts` with one case per delta-spec scenario:
      noise-with-phrase, real wake, late confirmation, early confirmation, candidate
      expiry, model-unavailable. No model, no audio context
- [ ] 2.8 Confirm all six pre-existing wake-gate tests still pass **unmodified** —
      threshold, consecutive count, gap, and cooldown are not being retuned here

## 3. Run the model

- [ ] 3.1 Add a frame accumulator driven from the existing `onaudioprocess` callback,
      feeding the VAD **contiguous non-overlapping** frames. This is the substantive
      work in this change: the existing 2-second ring buffer re-processed every 200 ms
      is correct for the stateless phrase chain and invalid for a recurrent model
- [ ] 3.2 Thread the VAD's state tensors across calls, and reset them when the listener
      re-arms
- [ ] 3.3 Load the VAD **outside** `getSessions()`'s shared `Promise.all`. Inside it, a
      VAD load failure nulls the shared cache, rethrows, reaches `onInitFailed`, and
      takes down the whole listener — the exact inverse of the fail-open requirement.
      This is the most likely way this gets implemented wrong
- [ ] 3.4 Wrap inference so a runtime failure degrades to phrase-only; log once, not
      per evaluation
- [ ] 3.5 Tap the existing `onaudioprocess` rather than acquiring a second stream — no
      `getUserMedia` change and no dependency-array change, so the spec's no-capture-gap
      rule holds
- [ ] 3.6 Record the deliberate-relative-path reason at the new model `fetch()` site.
      `renderer-content-security` requires it explicitly, and the existing code carries
      such a comment at `useWakeWord.ts:71-78`
- [ ] 3.7 Split the model driver into `src/lib/silero-vad.ts` if `useWakeWord.ts`
      approaches 450 lines — it is at 344 today
- [ ] 3.8 Decide what happens to the held candidate when sensitivity changes rebuild
      the gate — the spec requires applying a change without interrupting listening

## 4. Diagnostics and the degraded surface

- [ ] 4.1 Extend near-miss diagnostics so a non-wake says which signal was missing:
      phrase-not-heard vs heard-without-voice
- [ ] 4.2 Decide and implement what the user sees when the VAD is degraded or is
      persistently blocking wakes. Debug-flag-only is **not** sufficient here: the
      spec already requires that silence be distinguishable from a fault, and this
      change adds a new way to be silent that the existing failure surface does not
      cover — armed, caption says speak the phrase, nothing happens

## 5. Verify — including that it still wakes

- [ ] 5.1 Run the five gates: `npm run build`, `npm test`, `npm run lint`,
      `npm run scan:secrets`, `npm run spec:check`
- [ ] 5.2 Run `node scripts/check-wake-e2e.mjs`. Note its fixture is macOS `say(1)` TTS
      and this change's premise is that the phrase model over-fires on synthesized
      speech — if it fails, suspect the fixture before the implementation, and decide
      then whether the fixture needs to become a real recording
- [ ] 5.3 Manual: say "Hey Iris" ten times in normal conditions and record how many
      wake, against the same count taken **before** the change. This is the number that
      decides whether it ships — an AND condition can only reduce wakes
- [ ] 5.4 Manual: reproduce a known false-wake source (music, TV, noisy room) and record
      whether it still wakes
- [ ] 5.5 Measure wake latency before and after
- [ ] 5.6 Agree a main-thread budget number **before** measuring, then measure
      steady-state main-thread cost while asleep. Inference goes from ~5/s to ~31/s on
      the thread `main-thread-budget` protects
- [ ] 5.7 Manual: rename the vendored model to simulate load failure, and confirm
      hands-free wake still works on the phrase signal alone
- [ ] 5.8 Update `docs/ARCHITECTURE.md`'s wake-pipeline description — `docs/REFERENCE.md`
      alone does not cover it
