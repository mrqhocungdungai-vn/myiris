## Why

The wake word fires on noise. The current gate is one signal thresholded harder:
`src/lib/wake-gate.ts` requires the classifier score to clear a threshold on N
consecutive evaluations, with a cooldown. That reduces false wakes only by making the
phrase model's own spikes clear a taller bar — and the "Hey Iris" classifier is
trained on synthesized speech, so it spikes on non-speech sound with real confidence.
A taller bar costs real wakes before it stops the false ones.

Upstream reached the same conclusion and fixed it differently
(`ASHR12/iris@64b5b11`): pair the phrase score with an **independent** on-device
speech detector, and wake only when both agree there was human speech. A phrase
candidate arriving with no speech detected in the same window is a noise spike, and no
threshold on the phrase model can tell you that — because it is the model that is
wrong.

This is a second source of evidence, not a stricter reading of the first one.

## What Changes

- A wake requires **both** a sustained phrase-model detection (today's rule, unchanged)
  **and** independent confirmation that human speech occurred in the same short window.
- A phrase candidate arriving without speech confirmation is held briefly rather than
  discarded, so speech confirmed a moment later still wakes — the two detectors do not
  have to fire on the same evaluation.
- The speech detector runs **on-device from a bundled model**, like every other model
  Iris runs. No runtime network fetch.
- Wake-word diagnostics report which of the two signals was missing, so a user tuning
  sensitivity can tell "it never heard the phrase" from "it heard the phrase but not a
  voice".

Deliberately **not** changed: the detection threshold defaults, the consecutive-evaluation
rule, and the post-wake cooldown all stay as they are. This adds a condition; it does
not retune the existing one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wake-sleep-voice`: its **On-device wake word while asleep** requirement defines a
  wake as sustained phrase detection alone. Modified to require independent speech
  confirmation as well, and to extend the existing "pure function of score and time"
  testability rule to cover the new input — that rule is what makes this decision
  testable without a model or an audio context, and it must keep holding.
**Not** `renderer-content-security`, despite this change adding a bundled model. Its
**The renderer executes only code shipped inside the app** requirement is already
written generally — it binds "every script and WebAssembly module", explicitly covers
"a `fetch()` of a model file", and its offline scenario already asserts wake-word
detection initialising from locally shipped assets. A new model under that rule is an
instance of it, not a change to it. The bundling obligation is restated in the
`wake-sleep-voice` delta where it is specific to this model.

## Impact

- **Code**: `src/lib/wake-gate.ts` (the decision gains a second input),
  `src/hooks/useWakeWord.ts` (runs the second model, feeds the gate),
  `scripts/vendor-runtime-assets.mjs` (vendors the new model),
  `docs/REFERENCE.md` (the pinned-identifier table).
- **No new npm dependency.** Upstream pulled `@ricky0123/vad-web`, which resolves its
  model and worklet from a CDN by default — blocked outright by our CSP
  (`script-src 'self' 'wasm-unsafe-eval'`, `vite.config.ts:27`). Iris already vendors
  `onnxruntime-web` (`public/runtime/ort/`), already runs three ONNX models in
  `useWakeWord.ts`, and `scripts/vendor-runtime-assets.mjs` already has a
  `vendorModel(label, url, fileName)` + `downloadFile` path used for the gesture and
  face models. Loading a Silero VAD model on the ORT that is already there reuses all
  of it and adds no dependency surface.
- **Tests**: the gate stays a pure function, so the new condition is covered by
  `src/lib/wake-gate.test.ts` with no model or audio context — the existing spec
  already demands exactly this.
- **Risk — the real one is missed wakes, not false ones.** Adding an AND condition can
  only reduce wakes. If the speech detector is stricter than expected, Iris stops
  waking, which is worse than the problem being solved. The tasks require measuring
  true-wake rate, not just false-wake rate, and require the failure mode to favour
  waking when the detector is unavailable.
- **Latency**: confirmation must not add a perceptible delay before the wake fires;
  budgeted and checked in the tasks.
