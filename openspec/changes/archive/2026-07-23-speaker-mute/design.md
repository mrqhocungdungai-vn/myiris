## Context

The renderer's audio graph lives in `src/hooks/useAudioPipeline.ts`. Gemini output is decoded chunk-by-chunk in `playGeminiAudio`, scheduled through `AudioBufferSourceNode → analyser → destination`, with `flushPlayback()` already stopping in-flight sources for barge-in (see the `audio-playback` living spec). The only existing "mute" (`muted`/`toggleMute`) disables the **input** MediaStream track — it is a microphone control, not a speaker control. Control surfaces already exist for the mic button (deck `CenterStage`, HUD `HudShell`) and for HUD activation (`electron/main.mjs`: `globalShortcut` with `IRIS_HUD_HOTKEY`, the tray menu, `preload.cjs` channels). This change adds a parallel, independent speaker mute using the same patterns.

## Goals / Non-Goals

**Goals:**
- Silence Iris's voice on demand — cut the current utterance and suppress further output — without ending the session or touching the mic.
- Reach the toggle from the deck, the HUD, a tray item, and a global hotkey (`IRIS_MUTE_HOTKEY`, default `Alt+M`).
- Keep the state ephemeral (reset on stop/wake), mirroring the mic-mute lifecycle.

**Non-Goals:**
- Telling the Gemini server to stop generating (it keeps producing audio we drop; the token cost is accepted — Q1).
- Any voice/Gemini tool for muting.
- Persisting the mute state to config.
- Modifying `audio-playback` or `hud-activation` requirements (only referenced/extended within their existing allowances).

## Decisions

### D1 — New capability `speaker-mute`, not a modification of `audio-playback`/`hud-activation`
The feature is a cohesive user-facing capability, so it gets its own spec. It *references* `audio-playback`'s flush semantics but does not change them. `hud-activation`'s tray requirement says the menu offers items "at minimum," so adding a mute item needs no MODIFY; and the mute hotkey is a distinct hotkey, not a HUD-activation surface. Keeping it in one new spec avoids scattering the feature across three specs.
_Alternative:_ ADD requirements into `audio-playback` + MODIFY `hud-activation` tray/hotkey — rejected as harder to read and unnecessary.

### D2 — Cut-and-suppress via flush + a guard in `playGeminiAudio`
Add `outputMuted` state AND `outputMutedRef` — a `useRef`, not state, because the async play path must read the current value without a stale closure. `toggleOutputMute` sets both, and **when engaging MUST call the existing `flushPlayback()`** — not merely set the ref. Two layers then cover all timing:
- The top-of-function early-return on `outputMutedRef.current` in `playGeminiAudio` drops chunks that arrive already-muted, before creating buffers, touching the analyser, or advancing `playbackTimeRef`.
- A chunk already past that guard and sitting on an `await` (e.g. `await context.resume()`) when mute engages is caught by the **existing epoch guard** (`flushEpochRef`): `flushPlayback()` bumps the epoch, so the post-await check disconnects the in-flight source. This is why setting the ref alone is insufficient — the flush is load-bearing for the await-race.

Result: silent = no orb output wave, no timeline drift, and unmuting resumes cleanly on a fresh timeline (the flush already resets `playbackTimeRef` to `currentTime`).
_Alternative:_ a `GainNode` at gain 0 — rejected: model audio would still stream through the graph, advance the timeline, and drive the meter, contradicting Q1's "cut current + block future."

The **drop decision** — `shouldDropChunk({ muted, chunkEpoch, currentEpoch })` — is extracted into a small **pure exported function** in `useAudioPipeline.ts` and used at **both** guard points so the tested logic is the production logic:
- Top of `playGeminiAudio` (right after `const epoch = flushEpochRef.current`): here `chunkEpoch === currentEpoch` trivially, so this call is effectively the pure mute check that drops already-muted chunks before any buffer/analyser/timeline side effect.
- The **existing post-`await` guard** (currently `if (epoch !== flushEpochRef.current)`, ~line 180): route it through the **same** helper — `shouldDropChunk({ muted: outputMutedRef.current, chunkEpoch: epoch, currentEpoch: flushEpochRef.current })` — so the epoch inputs are live (a mute engaged during the `await` bumped the epoch via `flushPlayback`) and the "stale epoch ⇒ drop" test reflects a path production actually runs. On drop it `source.disconnect()`s and returns.

The async Web-Audio body of `playGeminiAudio` itself is not unit-testable in the node harness; only the pure helper is (see D6).

### D2a — `outputMuted` state + `outputMutedRef` both reset
`toggleOutputMute(next?)` sets **both** `outputMutedRef.current` and `setOutputMuted(...)` inline (not via an effect) so the async play path reads a fresh ref immediately; called with no arg it flips, called with an explicit boolean it forces that value (the D3 falling-edge reset is its `false` caller). Any reset of speaker mute must clear **both** the ref and the state; clearing only the state would leave the ref `true` and — since the toggle is gated while asleep (D3) — silently drop every chunk on the next session.

### D3 — Ephemeral: reset on the `sidecarRunning` falling edge, toggle gated while asleep
The reset must fire on **every** way a session ends, not just the imperative `audio.stop()`. A server-initiated teardown — reconnect attempts exhausted (`scheduleReconnect`) or `onclose`/`userStopped` in `main.mjs` — emits `sidecar_status {running:false}` and the renderer only does `setSidecarRunning(false)`; `audio.stop()` is **not** called, so a reset placed solely in the hook's `stop()` would be skipped and the next manual wake would drop every chunk. Therefore the reset lives on the **falling edge of `sidecarRunning`** in `App.tsx` (the existing `prevRunningRef` wake/sleep-edge effect, ~lines 209–220): on a true→false transition, call `audio.toggleOutputMute(false)`. This is safe against transient reconnects because `scheduleReconnect` keeps `running:true` until attempts are exhausted, so the reset only fires on genuine session-end. The hook's `stop()` also clears both ref+state (harmless belt-and-suspenders for direct hook use).

The `iris:mute-toggle` handler in `App.tsx` is additionally a **no-op when `!sidecarRunning`** — you cannot mute while asleep, so a wake always starts unmuted. Never written to `.env`. Matches the mic-mute lifecycle and avoids the "silently muted tomorrow" confusion (Q4). (Mic-mute has the same latent server-teardown gap today; fixing it is out of scope, but the falling-edge is the more correct home for both.)
_Alternative:_ reset only inside the hook's `stop()` — rejected: misses server-initiated teardown (finding above). _Alternative:_ reset inside `start()` — rejected: allows a transient muted state / stale "Unmute" tray label while asleep before the wake clears it.

### D4 — Main owns the hotkey + tray; renderer owns the truth
`main.mjs` registers `IRIS_MUTE_HOTKEY` (default `Alt+M`) with `globalShortcut` in the **same `app.whenReady` block as the HUD hotkey**, degrading gracefully on registration failure exactly like it. It relies on the **existing** `app.on("will-quit", () => globalShortcut.unregisterAll())` — no new quit handler is added.

Both the hotkey and the tray item **only** `emitToRenderer("iris:mute-toggle", {})` — they must NOT mutate audio (the graph lives in the renderer) and must NOT call `updateTrayMenu()` in the callback (unlike the HUD hotkey, main is not the source of truth here, so calling it would render a stale label before the state round-trips).

The IPC contract is fixed:
- Main → renderer: `iris:mute-toggle` (fire-and-forget). Preload exposes `onMuteToggle(cb)` returning a teardown, mirroring `onWakeRequest`/`onHudMode`.
- Renderer → main: `iris:speaker-mute-state` carrying a boolean. Preload exposes `reportSpeakerMute(muted)` (`ipcRenderer.send`). Main holds a module-level `speakerMuted` var **defaulting to `false`**; `ipcMain.on("iris:speaker-mute-state", (_e, muted) => { speakerMuted = Boolean(muted); updateTrayMenu(); })`; `updateTrayMenu()` labels the item from `speakerMuted` and **disables it while `!liveStatus.running`** (consistent with the deck/HUD buttons, which render only while awake, so the tray click is never a silent dead no-op).

Renderer wiring (avoids stale-closure and async-state traps):
- The `iris:mute-toggle` subscription lives in a `useEffect` with `sidecarRunning` in its dep array (re-subscribing like `onWakeRequest`, NOT like the `[hasBridge]`-only `onAudioChunk` which would freeze `sidecarRunning=false`). The handler no-ops when `!sidecarRunning`, else calls `audio.toggleOutputMute`.
- Reporting up is a **single `useEffect` keyed on `audio.outputMuted`** that calls `reportSpeakerMute(audio.outputMuted)`. This fires on mount (seeding the tray with `false` — matching the module default and the pre-mount `updateTrayMenu()` in `whenReady`), on every toggle, and on the `stop()` reset — with no manual mirroring at App's own `stop()` and no reliance on a synchronous post-toggle value. Requires the hook to return `outputMuted`.

_Alternative:_ main tracks mute state authoritatively — rejected: the renderer already owns all audio state; duplicating authority invites drift. _Alternative:_ report imperatively inside the toggle handler — rejected: `setOutputMuted` is async so there's no fresh value to send, and the stop reset happens inside the hook; the effect-on-`outputMuted` handles all three transitions uniformly.

### D5 — No new packaged assets
The renderer buttons reuse `lucide-react` icons already bundled; the tray change is a single menu entry, not a new template image. So `hud-activation`'s "packaged build carries tray assets" requirement is unaffected and no electron-builder `files` change is needed.

### D6 — Test via a pure drop-decision seam (node harness reality)
`vitest.config.mjs` runs `environment: "node"` — no jsdom, no `renderHook`, no Web Audio; every existing `src/lib/*.test.ts` is a pure function, and the `test-harness` change established the seam pattern (the po-session query seam). `playGeminiAudio` can't be exercised directly (mount runs `requestAnimationFrame`; the body calls `window.atob`/`new AudioContext()`; the asserted refs aren't returned). So the test targets the pure `shouldDropChunk` helper — which, per D2, is the **actual** decision used at both call sites (including the live-epoch post-await guard), so the test exercises production logic, not a dead path. Assert: `muted:true` ⇒ drop; `chunkEpoch !== currentEpoch` ⇒ drop; `muted:false` and equal epochs ⇒ play. Meter/timeline non-effects (the top-of-function placement before buffer/analyser/`playbackTimeRef`) remain a manual check — the node harness can't observe them.

## Risks / Trade-offs

- **Wasted Gemini output while muted** → Accepted per Q1; the session stays warm and unmuting is instant. A future enhancement could send a server interrupt, but that is out of scope.
- **Tray label lag if the renderer state report races the menu open** → Mitigation: report on every toggle and on wake/stop reset; the label is cosmetic and self-corrects on the next `updateTrayMenu()`.
- **`Alt+M` hotkey conflict with another app** → Mitigation: graceful registration failure (log + continue), and the env override `IRIS_MUTE_HOTKEY` lets the user pick another combo; the control remains reachable via UI and tray.
- **Confusion between two mute buttons (mic vs speaker)** → Mitigation: distinct icons (microphone-off vs speaker-off) placed side by side, matching the existing mic-mute affordance.

## Migration Plan

Additive, no data migration. Rollback is removal of the new state/handlers; unsetting `IRIS_MUTE_HOTKEY` (or leaving it default) has no effect on existing behavior. Mic mute, `audio-playback` flush, and HUD activation are untouched.
