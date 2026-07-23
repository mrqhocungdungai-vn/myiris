## 1. Renderer audio: speaker-mute behavior

- [x] 1.1 In `src/hooks/useAudioPipeline.ts`, add `outputMuted` state + `outputMutedRef` (a `useRef`); `toggleOutputMute(next?)` sets **both inline** (no-arg flips; explicit boolean forces — the task 3.4 falling-edge reset is its `false` caller) and, on **engage**, MUST call the existing `flushPlayback()` (not just set the ref) so the epoch guard cancels any chunk mid-`await`.
- [x] 1.2 Extract the play/drop decision into a pure exported helper `shouldDropChunk({ muted, chunkEpoch, currentEpoch })` and use it at **both** guard points in `playGeminiAudio`: (a) top-of-function early-return before buffer creation / analyser connect / `playbackTimeRef` advance (there `chunkEpoch === currentEpoch`, so it's the pure mute check); (b) replace the existing post-`await` guard (`if (epoch !== flushEpochRef.current)`, ~line 180) with `shouldDropChunk({ muted: outputMutedRef.current, chunkEpoch: epoch, currentEpoch: flushEpochRef.current })` → `source.disconnect()`; return — so epoch inputs are live and the tested path runs in production.
- [x] 1.3 In the hook's `stop()`, reset **both** `outputMutedRef.current = false` AND `setOutputMuted(false)` (alongside the existing `setMuted(false)`). Return `outputMuted`/`toggleOutputMute` from the hook. The **primary** reset is on the `sidecarRunning` falling edge (task 3.4c) — the hook `stop()` reset is a belt-and-suspenders backstop; do not add a reset in `start()`.

## 2. Control surfaces: deck + HUD button

- [x] 2.1 Thread `outputMuted`/`onToggleOutputMute` from `App.tsx` into `CenterStage` and `HudShell` (parallel to `muted`/`onToggleMute`), inside the existing awake-only transport blocks.
- [x] 2.2 Render a speaker-mute button beside the mic button in both, using `lucide-react` `Volume2` (on) / `VolumeX` (muted) with `title="Mute speaker"`/`"Unmute speaker"` as the accessible name (matching how the mic button uses `title`); add muted styling in the deck CSS + `hud.css`.

## 3. Control surfaces: tray + global hotkey (main process)

- [x] 3.1 In `electron/main.mjs`, add a `muteHotkey()` helper (`process.env.IRIS_MUTE_HOTKEY || "Alt+M"`, mirroring `hudHotkey()`) and register it via `globalShortcut` in the **same `app.whenReady` block as the HUD hotkey** (after `createTray()`); log + continue on registration failure; rely on the **existing** `will-quit → globalShortcut.unregisterAll()` (do NOT add a new quit handler). The callback ONLY does `emitToRenderer("iris:mute-toggle", {})` — no audio mutation, no `updateTrayMenu()`.
- [x] 3.2 Add module-level `let speakerMuted = false`. In `updateTrayMenu()` add a "Mute speaker / Unmute speaker" item whose label reads from `speakerMuted` and whose `enabled` is `liveStatus.running` (disabled while asleep); its `click` only `emitToRenderer("iris:mute-toggle", {})`.
- [x] 3.3 Add `ipcMain.on("iris:speaker-mute-state", (_e, muted) => { speakerMuted = Boolean(muted); updateTrayMenu(); })`. In `electron/preload.cjs` expose `onMuteToggle(cb)` (subscription returning a teardown, mirroring `onWakeRequest`) and `reportSpeakerMute(muted)` (`ipcRenderer.send("iris:speaker-mute-state", …)`).
- [x] 3.4 In `App.tsx`, mirroring the existing `onWakeRequest` effect (guard `if (!hasBridge) return;`, return the teardown): (a) subscribe to `iris:mute-toggle` in a `useEffect` with deps `[hasBridge, sidecarRunning]` (re-subscribes so the closure is fresh) — handler no-ops when `!sidecarRunning`, else calls `audio.toggleOutputMute()`; return the `onMuteToggle` teardown; (b) add a single `useEffect` (guarded on `hasBridge`) keyed on `audio.outputMuted` that calls `window.iris.reportSpeakerMute(audio.outputMuted)` (fires on mount → seeds tray `false`, on every toggle, and on the reset); (c) in the existing `prevRunningRef` wake/sleep-edge effect, on the `sidecarRunning` true→false transition call `audio.toggleOutputMute(false)` so a server-initiated teardown (where `audio.stop()` never runs) still clears speaker mute.

## 4. Config + docs

- [x] 4.1 Document `IRIS_MUTE_HOTKEY` (default `Alt+M`) in `.env.example`, and add it (with the `Alt+Space` conflict caveat) to the README hotkey/"Known footguns" section next to `IRIS_HUD_HOTKEY`.

## 5. Verify

- [x] 5.1 Add a Vitest unit test for the pure `shouldDropChunk` helper (`environment: "node"`, per `test-harness`): `muted:true` ⇒ drop; `chunkEpoch !== currentEpoch` ⇒ drop; `muted:false` + equal epochs ⇒ play. The helper is the real decision used at both call sites (task 1.2), so this covers production logic. (Do NOT attempt to render the hook or `playGeminiAudio` — the node harness has no Web Audio/jsdom.)
- [x] 5.2 `npm run build` (tsc --noEmit + vite build) and `npm test` pass.
- [x] 5.3 Manual: while Iris is speaking, engage mute via each surface (deck, HUD, tray, hotkey) → audio cuts immediately, orb output wave stops, session stays alive, mic state unchanged; unmute → new audio plays; while asleep the buttons are hidden and the tray item is disabled; stop/wake → starts unmuted; a server-initiated teardown (kill the sidecar / exhaust reconnect) while muted → next manual wake starts unmuted; tray label tracks state.
- [x] 5.4 `openspec validate speaker-mute` passes.
