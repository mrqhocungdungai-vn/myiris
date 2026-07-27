## Why

Iris wakes itself and starts talking without anyone saying "Hey Iris". The wake-word listener fires on the **first** 200 ms inference frame whose score clears a hardcoded `0.15` threshold (`src/hooks/useWakeWord.ts:130`) — no consecutive-frame confirmation, no smoothing. Because the 2-second window slides every 200 ms, every utterance is scored ~10 times at different alignments and the rule effectively takes the **maximum** of those scores rather than testing the model at its intended operating point. Those evaluations are strongly correlated — adjacent ones share roughly 84% of their embedding sequence — so this is not ten independent draws and the amplification is well under 10×, but taking a max over a correlated run is still a materially looser test than the single-window threshold the model was tuned for.

Two further factors push scores upward exactly when the room is quiet: `autoGainControl: true` on the listener's capture stream amplifies ambient noise and distant speech toward full scale, and the threshold is a hardcoded compromise the code itself documents as fragile (`0.10 caused false wakes; 0.18 missed too much`) with no way for a user in a noisier room to adjust it.

The exact split between the two candidate false-wake mechanisms — a transient spike that does not persist, versus a genuinely speech-like score plateau from a phonetically similar utterance — **has not been measured**, because the score is never logged or surfaced anywhere. A false wake leaves no evidence and tuning is guesswork. This change deliberately addresses both mechanisms and ships the instrumentation to tell them apart, rather than assuming one.

Ruled out as causes during investigation: the keyboard and tray/`iris:wake` paths (both require a deliberate action), gesture control (it arms only after a wake), the `Alt+Space` global shortcut (it toggles the HUD, never wakes), and Gemini Live's periodic reconnect (`connectLive` arms the greeting gate only when `isReconnect` is false, so a reconnect never re-greets). The wake-word listener is the only path that can fire unattended.

## What Changes

- **Require sustained detection before waking.** A wake fires only after the classifier score clears the threshold on N consecutive inference frames (default 2, i.e. ~400 ms of agreement) instead of on a single frame. The consecutive counter resets on any frame below threshold, so a spike that does not persist no longer wakes Iris. This removes the "max over a correlated run" behaviour but, because adjacent evaluations overlap heavily, it does **not** by itself stop a false positive driven by speech-like audio content — that is what the adjustable threshold below is for. The existing post-wake cooldown is unchanged.
- **Extract the fire/hold/reset decision into a pure, testable module.** The scoring loop keeps ONNX inference; the "should this score wake Iris?" decision moves to `src/lib/wake-gate.ts` following the repo's existing `src/lib/*.ts` + colocated `*.test.ts` pattern, so the debounce is covered by `npm test` without booting Electron or loading a model.
- **Make sensitivity user-configurable** rather than hardcoded: threshold and required consecutive frames become settings, persisted to the effective `.env` like every other option, readable from the renderer through the existing config IPC, with the current values as defaults so behaviour for an untouched install only improves (fewer false wakes), never regresses into needing setup.
- **Apply a sensitivity change to the listener that is already running.** Settings is reachable while Iris is asleep — which is exactly when someone chasing false wakes will open it — so a change must take effect immediately rather than waiting for a wake/sleep cycle, matching how the wake-word on/off toggle directly above it already behaves. It must do so without tearing down and re-acquiring the microphone, so no listening gap is introduced.
- **Expose a sensitivity control in the SetupPanel**, next to the existing wake-word toggle, so a user in a noisy room can raise the threshold and a user who finds Iris deaf can lower it — without editing `.env` by hand.
- **Turn off `autoGainControl` on the wake-word capture stream**, so ambient noise in a quiet room is no longer amplified into the model's sensitive range. `echoCancellation` and `noiseSuppression` stay on. This affects only the wake-word listener's own `getUserMedia` call — the conversation mic in `useAudioPipeline` is untouched.
- **Add wake-word score diagnostics**, off by default and enabled by a setting, that record scores and near-miss frames so a future false wake can be attributed to a real score rather than guessed at. Enabling the flag also opens DevTools, because as shipped there is no readable destination otherwise: `pushLog`'s state is discarded and rendered by nothing, and the application menu has no View role, so the console cannot be opened by menu or accelerator. Diagnostics never capture or persist audio.

No breaking changes, and no signature changes: every default preserves today's threshold, so an existing install behaves as before except that a score spike which does not persist for two evaluations no longer wakes it.

**What this change does not promise.** If the user's false wakes turn out to be plateau-shaped (speech-like audio scoring high across many consecutive evaluations), the consecutive-frame requirement will not stop them and only a raised threshold will. That split is unmeasured today; the diagnostics shipped here are what settle it, and the follow-up is a threshold adjustment rather than a larger frame count.

## Capabilities

### New Capabilities

_None._ This hardens behaviour that already belongs to `wake-sleep-voice`; adding a second wake-related capability would split one behaviour across two specs.

### Modified Capabilities

- `wake-sleep-voice`: the "On-device wake word while asleep" requirement gains sustained-detection confirmation; new requirements cover user-configurable sensitivity with documented defaults, safe fallback on malformed values, live application of a change to an already-armed listener without re-acquiring the microphone, capture constraints (no AGC on the listener stream), and score diagnostics that never record audio.
- `setup-panel`: the panel's enumerated controls gain a wake-word sensitivity control alongside the existing wake-word toggle.

## Impact

- **Code**: `src/hooks/useWakeWord.ts` (detection loop, capture constraints, live settings via refs, console diagnostics), new `src/lib/wake-gate.ts` + `src/lib/wake-gate.test.ts`, `src/App.tsx` (passes the new settings from `fullConfig` into the hook), `src/components/SetupPanel.tsx` (sensitivity control + `Draft`), `electron/main.mjs` (`ALLOWED_CONFIG_KEYS`, `getFullConfig()`, DevTools on the debug flag), `src/vite-env.d.ts` (config shape).
- **Config**: new `IRIS_*` env keys for threshold, consecutive-frame count, and diagnostics; documented in `.env.example` per the repo's env-driven convention.
- **Docs**: `openspec/specs/wake-sleep-voice/spec.md` and `openspec/specs/setup-panel/spec.md` on archive; `.env.example`.
- **Dependencies**: none added. No change to the `onnxruntime-web` dependency, the model assets under `public/wakeword/`, or any Gemini/Claude path.
- **Out of scope**: retraining or replacing `hey_iris.onnx`; the conversation-mic pipeline in `useAudioPipeline.ts`; and the CDN-paired dependency version skew noted in design.md's Open Questions, which is tracked by the separate `pin-cdn-paired-dependency-versions` change.
