## 1. Wake gate (pure logic, test-first)

- [ ] 1.1 Write `src/lib/wake-gate.test.ts` covering the spec scenarios before any implementation: a lone above-threshold evaluation does not fire; a run of N consecutive above-threshold evaluations fires exactly once on the completing evaluation; a below-threshold evaluation resets the run to zero; two above-threshold evaluations separated by a gap far larger than the evaluation interval do not confirm; above-threshold evaluations inside the cooldown after a fire do not re-fire; `reset()` clears both the run and the cooldown state
- [ ] 1.2 Implement `src/lib/wake-gate.ts` as a factory taking `{ threshold, consecutive, cooldownMs, maxGapMs }` and returning `{ step(score, now): boolean, reset(): void }` — pure, no imports from `onnxruntime-web`, React, or any browser global (design D1, D2, D3)
- [ ] 1.3 Confirm `npm test` passes and that the new test file runs without loading a model, an `AudioContext`, or Electron (test-harness spec)

## 2. Configuration plumbing

- [ ] 2.1 Add `IRIS_WAKE_THRESHOLD`, `IRIS_WAKE_CONSECUTIVE`, and `IRIS_WAKE_DEBUG` to `ALLOWED_CONFIG_KEYS` in `electron/main.mjs`
- [ ] 2.2 Expose them from `getFullConfig()` as `wakeThreshold` / `wakeConsecutive` / `wakeDebug` with the defaults from design D4 (`0.15`, `2`, off), parsing through a shared helper that falls back to the default on a missing, non-numeric, or out-of-range value rather than throwing (spec: "Malformed value falls back")
- [ ] 2.3 Extend the renderer config type in `src/vite-env.d.ts` with the three new fields
- [ ] 2.4 Document all three keys with their defaults and meaning in `.env.example`, including the rollback note (`IRIS_WAKE_CONSECUTIVE=1` reproduces the pre-change detection rule)

## 3. Detection loop

- [ ] 3.1 Change `useWakeWord`'s signature to accept the sensitivity settings, and have `src/App.tsx` pass them from the `fullConfig` snapshot it already holds
- [ ] 3.2 Propagate those settings through a ref updated on every render (the `onWakeRef`/`onErrorRef` pattern already in the file) — **not** by adding them to the effect's dependency array, which would tear down and re-acquire the microphone on every save (design D4). Verify by changing sensitivity from Settings **while Iris is asleep** and confirming the armed listener picks it up with no mic re-acquire and no gap
- [ ] 3.3 Replace the inline `score >= DEFAULT_THRESHOLD && now - lastWakeAt > COOLDOWN_MS` check in `src/hooks/useWakeWord.ts` with a `wake-gate` instance created per arm and `reset()` on disarm; delete the now-unused local threshold/cooldown state so there is exactly one place the rule lives
- [ ] 3.4 Set `autoGainControl: false` in the wake-word `getUserMedia` constraints, leaving `echoCancellation` and `noiseSuppression` at `true`, and confirm `src/hooks/useAudioPipeline.ts` constraints are untouched (design D7)
- [ ] 3.5 Verify the module-level ONNX session cache is still reused across arm/disarm cycles — re-arming after sleep must stay instant

## 4. Diagnostics

- [ ] 4.1 Emit diagnostics to `console` with the `[wakeword]` prefix already used at `useWakeWord.ts:136` and `:183` — **do not** route them through `pushLog`, whose state is discarded at `App.tsx:77` and rendered by nothing (design D6). Leave the `onError` callback signature unchanged
- [ ] 4.2 When `wakeDebug` is on, log each fired wake with its score **and the length of the run that produced it**, and log near-miss scores at a fixed `threshold × 0.6` floor rate-limited to one line per second (design D6 — the run length is what task 6.4 needs to tell a spike from a plateau)
- [ ] 4.3 In `electron/main.mjs`, open the window's DevTools when `IRIS_WAKE_DEBUG` is on — without it the console is unreachable, since `main.mjs:3153` builds the menu from `Iris / editMenu / windowMenu` with no `viewMenu` role and nothing calls `openDevTools()`. Verify by running a **packaged** build with the flag set, not just `npm run dev`
- [ ] 4.4 Verify diagnostics are silent when off: no per-evaluation log output while idle, and DevTools does not open
- [ ] 4.5 Verify no audio is written to disk, retained beyond the detection window, or transmitted anywhere with diagnostics on

## 5. SetupPanel sensitivity control

- [ ] 5.1 Add a three-way selector beside the existing wake-word toggle in `src/components/SetupPanel.tsx` — Strict `0.18` / Balanced `0.15` / Sensitive `0.11` (design D5) — writing `IRIS_WAKE_THRESHOLD` only, built from the panel's existing `ThemedSelect` inside a `setup-field` label and adding the key to `Draft`, matching the wake-word On/Off control directly above it. Balanced remains the shipped default
- [ ] 5.2 Render a "Custom" state when the effective threshold matches no preset, and ensure a plain panel save does not rewrite a hand-edited value to the nearest preset — only an explicit selection changes it
- [ ] 5.3 Disable or visibly inert the control while the wake-word toggle is off, and confirm it renders regardless of pipeline availability
- [ ] 5.4 Confirm saving sensitivity shows no reconnect or restart prompt, unlike the Google Search toggle

## 6. Verification and spec sync

- [ ] 6.1 Run `npm run build` (typecheck + build) and `npm test`; both must pass
- [ ] 6.2 Manually verify the wake path end to end: say "Hey Iris" and confirm it still wakes on the first attempt at the Balanced default, with the wake pulse, sound cue, and greeting unchanged
- [ ] 6.3 Run with `IRIS_WAKE_DEBUG` on and Iris asleep for an extended idle stretch, long enough to capture at least one false wake if one still occurs; record the score trace around it
- [ ] 6.4 From that trace, settle the open question the design flags as its largest risk: was the false wake a **non-persistent spike** (one or two frames, now blocked by the run gate) or a **plateau** (several consecutive frames above threshold, which the run gate cannot stop)? If plateaus dominate, the follow-up is raising the default threshold or the preset values — not raising `IRIS_WAKE_CONSECUTIVE` — and that conclusion belongs in a follow-up change, recorded here either way
- [ ] 6.5 Update `CLAUDE.md`'s conventions section with the three new `IRIS_*` keys alongside the existing PO-specific ones
- [ ] 6.6 Archive the change so `openspec/specs/wake-sleep-voice/` and `openspec/specs/setup-panel/` absorb the deltas
