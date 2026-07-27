## Context

`src/hooks/useWakeWord.ts` runs the openWakeWord pipeline (mel → embedding → classifier) in the renderer while Iris is asleep. Its detection rule today is one line:

```ts
if (score >= DEFAULT_THRESHOLD && now - lastWakeAt > COOLDOWN_MS) { lastWakeAt = now; onWakeRef.current(); }
```

Three properties of the surrounding loop make that rule fire on noise:

1. **No confirmation.** A single frame above `0.15` wakes Iris. The cooldown only suppresses *repeat* fires after a wake has already happened.
2. **Sliding-window max.** `WINDOW_SAMPLES` is 2 s and `PREDICT_INTERVAL_MS` is 200 ms, so any given utterance is scored ~10 times at 10 different alignments and the rule takes the max. Those draws are **not** independent: the classifier consumes 16 embeddings at a stride of 8 mel frames (~10 ms hop), so 200 ms advances the sequence by only ~2.5 embeddings and consecutive evaluations share ~84% of their input. The amplification over a single evaluation is therefore real but modest — nowhere near 10× — while still being a looser test than the model's per-window operating point assumes.
3. **AGC on the capture stream.** `autoGainControl: true` (line 151) normalises a quiet room upward, feeding the model amplified ambient noise and distant speech precisely during the idle stretches where false wakes are reported.

The threshold is also a hardcoded compromise the code documents as fragile, and nothing anywhere records the score, so a false wake leaves no evidence.

Constraints this design works within: the ONNX sessions are cached module-level so re-arming after sleep is instant (must stay true); the wake path must remain byte-identical to the keyboard path once it fires; the repo's only automated checks are `npm run build` (typecheck) and `npm test` (vitest, no Electron/network/model loading); config is env-driven with `IRIS_*` prefixes persisted through `writeUserConfig`.

## Goals / Non-Goals

**Goals:**

- Isolated score spikes stop waking Iris, while a deliberate spoken "Hey Iris" still wakes it on the first attempt.
- The detection decision is unit-testable without loading a model, an `AudioContext`, or Electron.
- Sensitivity is adjustable by the user instead of hardcoded, so a noisy room and a quiet room can both be served by one build.
- A future false wake produces evidence (a recorded score) rather than requiring a fresh investigation.
- An existing install needs no configuration to benefit.

**Non-Goals:**

- Retraining or replacing `hey_iris.onnx`. The model's per-window quality is taken as given; this change fixes how its output is consumed.
- Touching the conversation microphone path (`src/hooks/useAudioPipeline.ts`) or Gemini's greeting behaviour. A wake that fires still behaves exactly as before.
- A VAD/energy pre-gate, speaker verification, or any second model.
- Eliminating false wakes entirely — that is not achievable with a fixed-threshold classifier; the goal is to make them rare enough to stop being a bug.

## Decisions

### D1: Require N consecutive above-threshold frames, not score averaging

**Chosen:** a counter that increments on each above-threshold evaluation and resets to zero on any below-threshold evaluation; the wake fires when the counter reaches `IRIS_WAKE_CONSECUTIVE` (default **2**). The counter also resets after a fire, and the existing `COOLDOWN_MS` post-fire suppression is kept unchanged.

**Scope of what this fixes — stated plainly, because an earlier draft of this design overstated it.** Given the ~84% input overlap between adjacent evaluations (see Context), scores move slowly and smoothly. Two consequences follow, and both matter:

- A true "Hey Iris" stays above threshold for many consecutive evaluations, not a lone frame. So a run requirement of 2 is nowhere near the miss boundary — this part of the design is safe.
- A false positive caused by *actual speech-like audio* (a phonetically similar word, distant conversation, media) also produces a multi-frame plateau. **A run requirement does not stop it.** Only a higher threshold does.

So the run gate is a cheap, safe filter for spikes that do not persist — numerical instability, a transient artifact, a single unlucky alignment — and nothing more. It is not the load-bearing part of this change. The adjustable threshold (D4/D5) is what addresses content-driven false wakes, and the diagnostics (D6) are what tell us which mechanism is actually firing in this user's room. The change ships all three precisely because the split between the two mechanisms is unmeasured.

**Why not a rolling average or median of the last K scores:** with a smooth, plateau-shaped score signal, a K-frame mean and a K-frame run behave similarly on true positives, so averaging buys little; it costs an extra tunable (K plus an averaged threshold that no longer means what the model's threshold means) and makes the SetupPanel's single sensitivity number harder to reason about. A run of N over the same threshold keeps one number with one meaning.

**Why 2 and not 3+:** 2 costs ~200 ms of added latency and rejects non-persistent spikes, which is all a run gate can honestly claim. Raising N further trades latency for very little additional rejection, because the false positives that survive N=2 are plateau-shaped and will survive N=4 as well. The value is configurable so this can be revisited against real data from D6 rather than argued about.

**Why not hysteresis (a high fire threshold plus a low sustain threshold):** two thresholds are two things to tune and to explain in the SetupPanel, for a marginal gain over a single threshold plus a run length.

### D2: Extract the decision into `src/lib/wake-gate.ts`

The hook keeps everything that needs a browser (getUserMedia, `AudioContext`, `ScriptProcessorNode`, ONNX inference). The pure question — *given this score at this time, do we wake?* — moves to a factory in `src/lib/wake-gate.ts` returning an object with a `step(score, now)` method that answers `true` exactly on the frame that should wake, plus a `reset()` for arm/disarm.

The factory's configuration is immutable for the life of a gate instance. When settings change live (D4), the hook constructs a **new** gate rather than mutating the old one — which correctly discards any in-flight consecutive run, since a run counted against the old threshold means nothing under the new one. Keeping the config immutable is what lets `step()` stay a plain function of its inputs and keeps the tests free of setter ordering.

This follows the pattern already established by `src/lib/downsample.ts`, `hand.ts`, and `tasks.ts` — pure logic in `src/lib/*.ts` with a colocated `*.test.ts` — which is what makes the debounce, cooldown, and reset semantics coverable by `npm test` under the test-harness spec's "no runtime prerequisites" rule. The alternative, testing through the hook, would require faking `onnxruntime-web` and Web Audio and would test the mocks more than the logic.

### D3: Reset the run counter when evaluations are not adjacent in time

`predict()` guards on a `busy` flag, so a slow inference (WASM, single-threaded) can cause an evaluation to be skipped entirely. Two above-threshold scores separated by a long stall are not evidence of a sustained detection — they may be two unrelated spikes. The gate therefore treats the run as broken when the gap between consecutive evaluations exceeds a bound (a small multiple of the expected interval) and restarts the count at 1 rather than confirming across the gap.

This is a correctness detail that only shows up under load, and it is the main reason the gate takes `now` as a parameter rather than counting frames blindly.

### D4: `IRIS_WAKE_THRESHOLD`, `IRIS_WAKE_CONSECUTIVE`, `IRIS_WAKE_DEBUG`

Three new env keys, matching the repo's existing `IRIS_*` convention and flowing through the same `ALLOWED_CONFIG_KEYS` / `getFullConfig()` / `writeUserConfig` path as `IRIS_WAKE_WORD`:

| Key | Default | Meaning |
| --- | --- | --- |
| `IRIS_WAKE_THRESHOLD` | `0.15` | Classifier score a frame must clear to count toward a run. Preserves today's value. |
| `IRIS_WAKE_CONSECUTIVE` | `2` | Frames that must clear the threshold in a row before waking. |
| `IRIS_WAKE_DEBUG` | off | Enables score diagnostics (D6). |

Out-of-range or unparseable values fall back to the default rather than failing the listener — a bad `.env` must never leave Iris unable to wake.

**Settings must apply to an already-armed listener, via refs — not via effect dependencies.** The values come from the `fullConfig` snapshot `App.tsx` already holds, and Settings is reachable from `TopBar` while Iris is asleep with no gating, which is exactly when a user chasing false wakes will change them. Two ways to propagate them into `useWakeWord`, and the obvious one is wrong:

- **Adding them to the effect's dependency array** (currently `[enabled]`) re-runs the whole effect on every save: `stream.getTracks().forEach(stop)` followed by a fresh `getUserMedia` and a new `AudioContext`. That drops the microphone mid-listen, discards the 2 s ring buffer, and reintroduces exactly the "gap where a spoken 'Hey Iris' would be missed" that the module-level session cache exists to avoid.
- **Chosen: refs, following the `onWakeRef` / `onErrorRef` pattern already in the file.** The settings are held in a ref updated on every render; when they change, the loop swaps in a freshly-constructed gate (D2) while capture and the ONNX sessions are left untouched. Detection continues without a gap and the change is live immediately.

This also matches how the sibling `IRIS_WAKE_WORD` toggle already behaves — flipping it while asleep takes effect at once, because it flows into `enabled`. A sensitivity change that silently waited for a wake/sleep cycle would be inconsistent with the control sitting directly above it in the same panel.

### D5: SetupPanel exposes one sensitivity control, not two numeric fields

The panel gets a three-way **Strict / Balanced / Sensitive** selector next to the existing wake-word toggle, writing `IRIS_WAKE_THRESHOLD` only. `IRIS_WAKE_CONSECUTIVE` stays env-only. It uses the panel's existing `ThemedSelect` + `setup-field` idiom — the same component the wake-word On/Off control already uses two lines above it — rather than introducing a new segmented-control widget for one setting.

Rationale: the user-facing problem is one-dimensional ("it wakes too easily" / "it doesn't hear me"), and a raw 0–1 float in a settings panel invites values that make the feature useless in either direction. Run length is a stability knob, not a sensitivity knob, and mapping two independent numbers onto one perceived axis would make the UI lie. A `.env` value that does not match a preset is shown as **Custom** and is not silently rewritten to the nearest preset — hand-set config wins until the user actively picks a preset.

**Preset values, and why the default does not move.** The three levels are anchored to the only observations that exist — the ones the code itself recorded (`0.10` caused false wakes, `0.18` missed too much, `0.15` the compromise) — rather than to invented numbers:

| Level | Threshold | Anchored to |
| --- | --- | --- |
| Strict | `0.18` | The upper bound where the code observed misses beginning; combined with the N=2 run gate this is meaningfully tighter than today. |
| Balanced (default) | `0.15` | Today's hardcoded value, unchanged. |
| Sensitive | `0.11` | Just above the `0.10` that was observed to false-wake. |

The shipped default stays **Balanced / 0.15**, deliberately, even though the reported bug is false wakes. Moving the default to Strict would trade a reported bug for an unreported one — the code's own note says `0.18` "missed too much", and that observation predates the run gate, which only tightens things further. Since the sensitivity control ships in this same change, a user who wants Strict is one click away, and no global default has to be guessed on their behalf. If D6's measurements later show the distribution sits elsewhere, moving the default is a one-line follow-up backed by data instead of by argument.

### D6: Diagnostics record scores, never audio

When `IRIS_WAKE_DEBUG` is on, the listener emits two things:

- **Every fire**, with the score that triggered it **and the length of the run that produced it**. The run length is the whole point: it is what distinguishes a spike from a plateau, which is the question task 6.4 exists to settle.
- **Near misses**, at a fixed `threshold × 0.6` floor, rate-limited to one line per second. Fixed fraction rather than a configurable margin — an extra env key purely for debugging is a knob nobody will tune, and the floor only needs to be low enough to show the *shape* of a rising score rather than just its peak.

No new IPC channel, no file, no audio buffer is retained or written anywhere — the privacy property in the current spec ("audio never leaves the machine, and nothing is sent to Gemini/Claude until a wake fires") is preserved verbatim. Default off, so idle logging stays quiet for normal users.

**Diagnostics go to the renderer console, not through `pushLog` — because `pushLog` has no reader.** An earlier draft of this design said to surface scores "through the app's existing log surface", and a later revision proposed widening `useWakeWord`'s `onError` into an `onLog(level, message)` to avoid filing diagnostics at error level. Both were built on a false premise. `App.tsx:77` declares the log state as `const [, setLogs] = useState<LogLine[]>([])` — the value is destructured away, no component takes a `logs` prop, and `LogLine` is imported solely for that annotation. `pushLog` appends to an array nothing renders. Routing diagnostics there would produce a feature that silently does nothing: the user enables the flag, waits hours, and sees no scores.

So diagnostics use `console` with the `[wakeword]` prefix this file already established for exactly this purpose (`console.error("[wakeword] predict failed", …)` and `"[wakeword] init failed"`). That is the real, working diagnostic channel for this module, it needs no signature change, and it is the appropriate destination for an opt-in developer flag.

**The console alone is still not reachable — the flag must open DevTools itself.** Checking one level further: `main.mjs:3153` replaces the application menu with `Iris / editMenu / windowMenu`. There is no `viewMenu` role, which is where Electron's `toggleDevTools` and its `Cmd+Opt+I` accelerator come from, and `openDevTools()` is never called anywhere. So the renderer console is unreachable by menu or accelerator in **both** dev and packaged builds. Shipping diagnostics to a console nobody can open would repeat the same defect one level down.

Therefore `IRIS_WAKE_DEBUG` also opens the window's DevTools (`webContents.openDevTools()`), making the flag self-sufficient: turning it on both produces the scores and gives you somewhere to read them. This is one line in `main.mjs`, gated on the same flag, and leaves the default build's menu untouched.

Consequences worth stating plainly:

- **The `onError` → `onLog` widening is dropped.** It was churn justified by an invisible distinction — an "error" and an "info" written to the same unread array are equally unread.
- **`IRIS_WAKE_DEBUG` is now a main-process concern too**, not purely renderer-side: main reads it to decide whether to open DevTools, the renderer reads it to decide whether to emit. Both already receive it through the existing config path, so no new plumbing is needed.
- **Out of scope, but noted:** because `pushLog` is unread, the wake-word listener's *error* reporting (`onError` → mic permission denied, model fetch failure) is also invisible today, as is every other `pushLog` call in `App.tsx`. Either wiring up a log surface or removing the dead channel is its own change; this one does not silently depend on it.

### D7: AGC off on the listener stream only

`autoGainControl` becomes `false` in the wake-word `getUserMedia` constraints; `echoCancellation` and `noiseSuppression` stay `true`. The conversation mic in `useAudioPipeline.ts` keeps its own constraints untouched — it is a different stream serving a different consumer (Gemini's ASR, which benefits from AGC), and changing it is out of scope.

## Risks / Trade-offs

- **The run gate may fix nothing.** If the user's false wakes are content-driven plateaus rather than transient spikes, `IRIS_WAKE_CONSECUTIVE=2` changes nothing observable and the complaint persists. → This is the single largest risk in the change and the reason D6 is in scope rather than deferred: after shipping, `IRIS_WAKE_DEBUG` produces the score trace that says whether to raise the threshold instead. The change is still net-positive in that case, because the adjustable threshold and the diagnostics both ship with it.
- **Wake latency grows by roughly one inference interval (~200 ms).** → Accepted deliberately: the run-length default is 2, the minimum that rejects a non-persistent spike, and the added delay is small against the boot-and-greet sequence that follows a wake.
- **A borderline-quiet "Hey Iris" that previously scraped exactly one frame over the threshold no longer wakes.** → Expected to be rare rather than common: the input overlap means a genuine detection normally clears the threshold across several consecutive evaluations, so a true positive that peaks for exactly one frame is a marginal case, not the typical one. The Sensitive preset is the lever if it does show up.
- **Presets hide `IRIS_WAKE_CONSECUTIVE` from the UI, so a user hitting false wakes at the Strict preset has no in-app next step.** → Documented in `.env.example`; the diagnostics from D6 give a real score to reason about instead of blind tuning. Promoting it to the UI later is additive.
- **Removing AGC could reduce sensitivity for a genuinely distant speaker.** → That is the intended direction (distant audio is the false-wake source), and the Sensitive preset is the counter-lever if a user actually wants far-field wake.
- **The fix cannot be verified in a unit test end-to-end** — `wake-gate.test.ts` proves the decision logic, but "no more false wakes in my room" is only observable by running it. → The diagnostics in D6 exist precisely so that observation produces a number rather than an anecdote.
- **No change to the false-accept rate of the model itself.** If false wakes persist at the Strict preset, the remaining cause is the model, and the follow-up is retraining — explicitly out of scope here. (Raising the run length is *not* the next step in that case, for the reason given in D1.)

## Migration Plan

No data migration. New keys are absent from every existing `.env`, and each falls back to a default chosen to preserve current behaviour except for the run-length requirement. Rollback is `IRIS_WAKE_CONSECUTIVE=1` plus `IRIS_WAKE_THRESHOLD=0.15`, which reproduces today's exact detection rule without reverting code (AGC and diagnostics aside).

## Open Questions

All three questions raised during review are now settled; they are kept here with their resolutions so the reasoning is not lost at archive time.

- **Preset threshold values, and whether the default should move — settled.** Values anchored to the code's own recorded observations, and the shipped default stays at today's `0.15`; see the preset table in D5 for both the numbers and why moving the default would trade a reported bug for an unreported one. Revisable from D6's data as a one-line follow-up.
- **Near-miss margin — settled.** Fixed at `threshold × 0.6` with a one-line-per-second rate limit, not configurable; see D6. Fires additionally log their run length, which is the measurement task 6.4 actually needs.
- **`onnxruntime-web` version skew — settled as out of scope, tracked separately, and less severe than first stated.** `package.json` declares `"onnxruntime-web": "^1.27.0"` while `useWakeWord.ts` hardcodes the WASM CDN path to `onnxruntime-web@1.27.0`. An earlier draft of this note said the caret "allows the installed package to drift"; that overstated it. `package-lock.json` is committed and pins `1.27.0` exactly, and `CLAUDE.md`'s documented install is `npm ci`, which installs from the lockfile — so no skew is possible on the normal path. The real exposure is a future `npm update` or dependency bump moving the lockfile while the hardcoded URL stays behind. It is a maintenance footgun, not a live bug. Related: the `wake-sleep-voice` requirement's "no runtime CDN fetch" is true of the model assets under `public/wakeword/` but not of the ORT WASM runtime, which is fetched from jsDelivr on first load. Handled by the separate `pin-cdn-paired-dependency-versions` change, which also covers `@mediapipe/tasks-vision` — it has the identical caret-plus-hardcoded-URL pairing.
