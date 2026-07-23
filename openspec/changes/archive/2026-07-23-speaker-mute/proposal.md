## Why

While talking to Iris, the user often needs to silence its voice on the spot — to explain something to another person instead of letting the AI keep talking over them — without ending the session. Today the only mute control disables the microphone (Iris's "ears"); there is no way to silence the speaker (Iris's "mouth"). This change adds a dedicated speaker-mute.

## What Changes

- Add a **speaker mute** that, when engaged, **immediately cuts** the audio Iris is currently speaking (reusing the existing flush/barge-in stop) **and suppresses** all further Gemini audio output until unmuted. The Gemini session keeps running; audio is dropped locally.
- Speaker mute is **independent of the existing microphone mute** — it touches only output. The mic keeps whatever state it had.
- Speaker mute is **ephemeral** — it resets to unmuted when the session stops, and toggling is a **no-op while asleep**, so a wake always starts unmuted (mirroring the mic-mute lifecycle). It is never persisted to config.
- Expose the toggle on **three surfaces**: a renderer control beside the existing mic-mute button in the deck (CenterStage) and the HUD (HudShell), a **tray menu** item, and a **global hotkey** configurable via `IRIS_MUTE_HOTKEY` (default `Alt+M`) that degrades gracefully if registration fails. No new voice/Gemini tool.

## Capabilities

### New Capabilities
- `speaker-mute`: Silencing Gemini's audio output on demand — the cut-and-suppress behavior (independent of the microphone, ephemeral per session) and the three control surfaces (renderer control, tray item, global hotkey).

### Modified Capabilities
<!-- None. The behavior references audio-playback's flush semantics without changing them.
     hud-activation's tray requirement already permits additional menu items ("at minimum")
     and the mute hotkey is a separate hotkey, not a HUD-activation surface — so neither is modified. -->

## Impact

- **`src/hooks/useAudioPipeline.ts`** — add `outputMuted` state + `outputMutedRef` + `toggleOutputMute` (parallel to `muted`/`toggleMute`); extract a pure `shouldDropChunk` helper used by `playGeminiAudio` to flush-and-drop while muted; reset both ref and state in `stop()`.
- **`src/App.tsx`** — pass `outputMuted`/`onToggleOutputMute` into CenterStage and HudShell; subscribe to the `iris:mute-toggle` event (no-op while `!sidecarRunning`); reset mute on the `sidecarRunning` falling edge (covers server-initiated teardown); report mute state up via `iris:speaker-mute-state` so the tray label stays accurate.
- **`src/components/*` (CenterStage) and `src/components/HudShell.tsx`** + styles — render the speaker-mute button beside the mic button (`lucide-react` `Volume2`/`VolumeX`).
- **`electron/main.mjs`** — register the `IRIS_MUTE_HOTKEY` global shortcut (default `Alt+M`) in the same block as the HUD hotkey, relying on the existing `will-quit → globalShortcut.unregisterAll()`; the hotkey and tray item only `emitToRenderer("iris:mute-toggle")` (they must NOT call `updateTrayMenu()` — main is not the source of truth); add a module-level `speakerMuted` mirror updated by the `iris:speaker-mute-state` handler, which drives the tray label.
- **`electron/preload.cjs`** — expose `onMuteToggle(cb)` (subscription with teardown, mirroring `onWakeRequest`) and `reportSpeakerMute(muted)` (`iris:speaker-mute-state`).
- **`.env.example`** + **README** (hotkey / "Known footguns") — document `IRIS_MUTE_HOTKEY` (default `Alt+M`) and its `Alt+Space` conflict caveat.
- No new dependencies. `audio-playback`, `hud-activation`, and mic-mute behavior are untouched.
