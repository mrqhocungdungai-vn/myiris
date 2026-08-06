## Context

See proposal.md — Why, for the motivation.

What already exists and shapes the approach:

- `src/lib/wake-gate.ts` is a pure `createWakeGate({threshold, consecutive, cooldownMs, maxGapMs})`
  returning `{step(score, now) => boolean, reset()}`. The living spec *requires* this
  decision to stay a pure function testable without a model or audio context, so the
  new condition has to land inside this shape rather than beside it. `reset()` is
  called on teardown (`useWakeWord.ts:335`) and must clear the new state too.
- `src/hooks/useWakeWord.ts` already drives three ONNX models through a vendored
  `onnxruntime-web` (`public/runtime/ort/`), with `ort.env.wasm.wasmPaths` pointed at
  the vendored fileset. `configureOrt()` is a module-level singleton and
  `createSession(url)` is generic, so a fourth model genuinely reuses both.
- **But the audio contract does not transfer.** The listener is a 2-second ring buffer
  (`WINDOW_SAMPLES = 32000`) re-processed *in full* every 200 ms
  (`PREDICT_INTERVAL_MS = 200`). Every poll re-reads overlapping audio — correct for
  the stateless mel→embedding→classifier chain, and **invalid for Silero VAD**, which
  is a recurrent model requiring contiguous, non-overlapping frames with its state
  tensors threaded call to call. At 512 samples / 16 kHz that is ~31 inferences per
  second against today's 5.
- `scripts/vendor-runtime-assets.mjs` has `copy()` for files out of `node_modules`, and
  `vendorModel(label, url, fileName)` + `downloadFile` for downloaded models. **Its
  destination is hardcoded** to `public/runtime/mediapipe/`, and `public/runtime/` is
  gitignored while the phrase models under `public/wakeword/` are committed. Those are
  two different vendoring patterns, and this change has to pick one deliberately.

## Goals / Non-Goals

**Goals:**

- Add a genuinely independent signal, not a stricter threshold on the existing one.
- Keep the wake decision a pure function, per the existing requirement.
- Add no npm dependency and no new asset-loading mechanism.

**Non-Goals:**

- Retuning `threshold` or `consecutive`. Their current defaults stay; this change is
  additive so it can be evaluated on its own.
- General-purpose voice activity detection for anything other than wake confirmation.
- Replacing the phrase model.

## Decisions

**Silero VAD on the ORT session that is already there — no `@ricky0123/vad-web`.**

Upstream's dependency wraps a Silero ONNX model plus an AudioWorklet, and resolves
both from a CDN by default. Our CSP (`script-src 'self' 'wasm-unsafe-eval'`,
`vite.config.ts:27`) blocks that outright, so adopting it would mean configuring its
asset paths, vendoring its worklet, and owning a dependency whose default behaviour
is one we forbid. Everything it provides that we need — an ONNX runtime, a vendoring
path for the model, a mic tap — already exists in `useWakeWord.ts`. So: vendor
`silero_vad.onnx` through the existing `vendorModel` path and run it on the ORT
already loaded.

*Alternative — take the dependency and configure its paths.* Rejected: more surface,
a forbidden default, and it duplicates an ORT instance for a model we can run on ours.

*Alternative — derive speech from mic energy instead of a model.* Rejected: energy is
not independent of the phrase model's failure mode. Loud non-speech noise is exactly
what produces the false wakes, and it is loud.

**The gate takes confirmation as an input; it does not observe it.**

`useWakeWord` owns running the model and feeding results in. This preserves the
existing testability requirement, and makes every scenario in the delta spec — early
confirmation, late confirmation, expiry — a table row in `wake-gate.test.ts`. The
holding window makes the gate stateful across calls in a way it already is
(consecutive counting, cooldown), so it fits the existing shape.

Three interface details that must be decided here rather than during implementation,
because the obvious choice is wrong in each case:

- **Speech arrives through its own entry point, not as a third argument to `step()`.**
  `step()` is called every 200 ms; the VAD produces a verdict roughly every 32 ms.
  Folding the verdict into `step()` would quantise "speech at time T" down to a 200 ms
  bucket and lose the ordering the symmetric window depends on. A second pure entry
  point — `noteSpeech(now)` — keeps the decision "decidable from scores, confirmation
  events, and timestamps alone", which is what the delta spec actually requires.
  It also leaves `step(score, now)` untouched, so the six existing positional callers
  in `wake-gate.test.ts` keep passing, which the tasks promise.
- **The below-threshold early return has to be restructured.** `wake-gate.ts` returns
  `false` immediately when `score < threshold`. A candidate confirmed by speech *after*
  the phrase run finishes will by construction arrive on below-threshold evaluations —
  the phrase is over by then. So the late-confirmation scenario is unimplementable
  without a fire path that survives that early return, and the cooldown check must be
  applied to that path too, or a held candidate bypasses cooldown.
- **"No speech signal yet" and "speech says no" are different states.** Only the second
  blocks a wake. Collapsing them is how fail-open silently becomes fail-closed.

**Fail open, deliberately — and the current loader defeats it by default.**

If the VAD model fails to load or throws, the gate reverts to phrase-only. This is
stated as a requirement, not left to implementation, because the natural instinct when
adding a safety condition is to fail closed — and failing closed here means an app that
cannot wake at all, which is a worse defect than the one being fixed.

The concrete trap: `getSessions()` loads all three models in **one `Promise.all`**,
caches a single shared promise, and on rejection nulls the cache and rethrows — which
reaches `onInitFailed` and flips the caption to "wake word failed to start". Adding the
VAD to that `Promise.all` makes a VAD load failure fatal to the whole listener, the
exact inverse of this decision. **The VAD load must sit outside `getSessions()`.**

**A degraded VAD needs a surface, because silence already has a specified meaning.**

`wake-sleep-voice` requires that a listener which fails to start says so, on the
reasoning that silence must be distinguishable from a fault. This change creates a new
way to be silent that the existing requirement does not cover: a VAD that loads fine
and simply never confirms. The user-visible state would be "armed, caption says speak
the phrase, nothing happens" — precisely what that requirement exists to forbid,
arriving through a door it does not watch. Diagnostics behind a default-off debug flag
are not sufficient for this case.

**Ordering: run confirmation continuously, not on demand.**

The VAD runs on the same mic stream as the phrase model, continuously, so its verdict
is already available when a phrase candidate appears. Running it only after a
candidate would add its inference latency to every wake, and would make "speech
confirmed shortly before the phrase" — the common case, since speech precedes
recognition — impossible to satisfy.

## Risks / Trade-offs

- **Missed wakes, the failure mode that actually matters** → An AND condition can only
  reduce wakes. Verification must measure true-wake rate, not just false-wake rate;
  `scripts/check-wake-e2e.mjs` already boots a production build against a synthesized
  "Hey Iris" and is the natural place to prove wakes still happen.
- **Added latency before a wake fires** → Mitigated by running the VAD continuously so
  its verdict predates the candidate; budgeted and measured rather than assumed.
- **The Silero model is a new pinned third-party asset** → Vendored through the path
  the gesture and face models already use, and pinned in `docs/REFERENCE.md` as the
  wake requirement demands.
- **Two models on one mic stream raise steady-state CPU while asleep** → This runs
  whenever Iris is asleep, which is most of the time. Going from ~5 to ~31 inferences
  per second is a real step change, and both `ort.env.wasm.numThreads = 1` and the
  `onaudioprocess` callback run on the **main thread** — the thread `main-thread-budget`
  exists to protect. The wake listener only runs while asleep, so there is no live
  24 kHz playback schedule to jitter and the change is defensible; but it needs a
  budget number agreed up front, not an after-the-fact CPU reading.
- **`useWakeWord.ts` is already 344 lines against a 250-450 target** → A frame
  accumulator, state tensors, fail-open wrapping and diagnostics plausibly add
  80-150. Decide the split before writing (a `src/lib/silero-vad.ts` model driver,
  with the hook keeping ownership of the audio) rather than discovering it at review.
- **The e2e wake check uses macOS `say(1)` TTS as its fixture** → This change's whole
  premise is that the phrase model over-fires *because it was trained on synthesized
  speech*. Requiring a synthesized fixture to still pass a VAD gate is not obviously
  safe, and that check is manual-only, so nothing in CI would catch it either way.
  If it starts failing, the fixture is the suspect before the implementation is.
