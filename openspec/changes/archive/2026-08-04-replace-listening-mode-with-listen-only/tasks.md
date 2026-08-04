## 1. Retire listening mode from the main process

- [x] 1.1 Delete `electron/listen-mode.mjs`, `electron/listen-boundary.mjs`, `electron/listen-mode.test.mjs` and `electron/listen-boundary.test.mjs`
- [x] 1.2 `electron/live-config.mjs`: drop the `mode` parameter and the listen profile so `buildLiveConfig` returns one configuration; the surviving config must match today's `converse` output byte-for-byte (same model, voice, `responseModalities: ["AUDIO"]`, transcriptions, compression, and **no** `realtimeInputConfig` key)
- [x] 1.3 `electron/gemini-prompts.mjs`: delete `buildListenSystemInstructionText`, `buildListenEntryConfirmationPrompt` and `buildListenExitSynthesisPrompt`, plus the mode branch that splices the listening instruction
- [x] 1.4 `electron/live-messages.mjs`: remove every `listenMode.*` guard — the `isBoundaryInFlight()` wrappers around tool calls and the transcript/audio block, and the `appendToSegment` accumulator — and delete the `goAway` rotation branch while keeping its log line (design D10)
- [x] 1.5 `electron/announcements.mjs`: drop the `isListenModeSuppressing` dependency and reduce `deliverable` to `getLiveSession()`; delete the paragraph of comment that justified the gate
- [x] 1.6 `electron/wiring.mjs`, `electron/wiring-live.mjs`, `electron/ipc.mjs`, `electron/window.mjs`, `electron/main.mjs`: remove the listen-mode module wiring, its accessors, its `Start/End listening mode` tray item, its hotkey registration, and every reference to `IRIS_LISTEN_CHUNK_MS`
- [x] 1.7 Run the four gates (`npm run build`, `npm test`, `npm run lint`, `npm run scan:secrets`); expect only the deliberately-stale tests from group 6 to fail, and note which

## 2. Give the main process ownership of listen-only mode

- [x] 2.1 `electron/live-session.mjs`: turn the `speakerMuted` mirror into the owned listen-only state with a main-side toggle, and reset it to disengaged on every transition to not-running (explicit stop **and** server-initiated teardown), not only on stop
- [x] 2.2 `electron/ipc.mjs` + `electron/preload.cjs`: rename the surviving bridge to `listen-only:toggle-request` / `listen-only:query` / `listen-only:state`, keeping its one-way shape (state is pushed by main, never asserted by the renderer); delete `iris:mute-toggle`, `iris:speaker-mute-state`, `onMuteToggle` and `reportSpeakerMute`
- [x] 2.3 Make the toggle a no-op while the session is asleep, so a wake always starts audible
- [x] 2.4 `electron/window.mjs`: collapse the two tray items into one whose label reflects the current state and which is disabled while asleep; replace `muteHotkey()` with the `IRIS_LISTEN_HOTKEY` accessor (default `Alt+L`) and delete `IRIS_MUTE_HOTKEY`
- [x] 2.5 `electron/main.mjs`: register exactly one hotkey for the mode, routed through main's toggle, unregistered on quit, with the existing graceful-failure log on a registration conflict
- [x] 2.6 `electron/live-messages.mjs`: gate the per-chunk output state on main's own flag — `audio_state: "replying"` while engaged, `"speaking"` while not — cleared by the same `turnComplete` and `interrupted` paths as today
- [x] 2.7 Run the four gates

## 3. Renderer: one control, suppression driven by main

- [x] 3.1 `src/hooks/useAudioPipeline.ts`: make output suppression an explicit setter fed by the pushed state instead of a renderer-owned toggle, keeping `shouldDropChunk` and the `flushPlayback()` stop on the engaging edge exactly as they behave today
- [x] 3.2 `src/App.tsx`: query the initial state, subscribe to `listen-only:state`, and send toggle requests; delete the `reportSpeakerMute` effect and the old `iris:mute-toggle` handler
- [x] 3.3 `src/components/HudShell.tsx` and `src/components/CenterStage.tsx`: reduce the cluster to microphone + headphone, using `Headphones` / `HeadphoneOff`; remove the `Ear` / `EarOff` control and the `Volume2` / `VolumeX` control along with their props
- [x] 3.4 Update `src/types.ts` and `src/vite-env.d.ts` for the renamed bridge and the new output state

## 4. Renderer: a silent reply reads as silent

- [x] 4.1 `src/components/ReactorCore.tsx`: add the `replying` entry to `PALETTES` (cool cyan-blue, distinct in hue from `listening`, never the warm speaking accent) and to `ORB_ENERGY` at `1`; confirm `ORB_ACCENT` picks it up so both the WebGL and light glow paths track it
- [x] 4.2 `src/App.tsx`: map `"replying"` in the `reactorState` memo
- [x] 4.3 `src/App.tsx`: in the `caption` memo, return no label for `"replying"` so the caption falls through to the transcript text instead of `"Speaking…"`

## 5. Renderer: the HUD reveals its transcript

- [x] 5.1 Lift `commsOpen` out of `HudShell.tsx`'s local state so the mode can open it
- [x] 5.2 Apply the reveal on the transition only: the engaging edge opens the panel and records its prior state, the disengaging edge restores that state, and a manual toggle in between is respected rather than re-forced
- [x] 5.3 Confirm the deck needs no change — `CommsPanel` is already rendered unconditionally

## 6. Tests

- [x] 6.1 Update the main-process tests that referenced listening mode: `wiring.test.mjs`, `wiring-live.test.mjs`, `ipc.test.mjs`, `window.test.mjs`, `live-messages.test.mjs`, `live-session.test.mjs`, `announcements.test.mjs`, `gemini-prompts.test.mjs`
- [x] 6.2 Assert the single surviving Live config has no `realtimeInputConfig` key and keeps `responseModalities: ["AUDIO"]`, and that neither toggling nor untoggling the mode triggers a connect, disconnect or config rebuild
- [x] 6.3 Assert main owns the state: each of the three surfaces resolves to the same value, main's own flag (not a renderer report) decides the emitted output state, and the state resets on both stop and server teardown while a toggle while asleep is a no-op
- [x] 6.4 Assert `audio_state: "replying"` is emitted while engaged and `"speaking"` while not, and that both clear on `turnComplete`
- [x] 6.5 Assert an announcement raised while the mode is engaged is delivered immediately rather than buffered, and that buffering still applies while disconnected with the drop-oldest bound intact
- [x] 6.6 Cover the renderer behaviors that carry requirements: chunks dropped while engaged with no meter/timeline advance, only post-disengage chunks playing, mic independence, the HUD reveal and its manual-override/restore, and interface cues still firing while engaged
- [x] 6.7 Run the four gates green

## 7. Configuration and docs

- [x] 7.1 `.env.example`: delete the `IRIS_MUTE_HOTKEY` and `IRIS_LISTEN_CHUNK_MS` blocks; rewrite the `IRIS_LISTEN_HOTKEY` block to describe the headphone mode (Iris hears you and replies in text, no sound, no reconnect)
- [x] 7.2 `CLAUDE.md`: replace the listening-mode router row with one pointing at `openspec/specs/listen-only-mode/spec.md`, keeping the file a router — no new deep detail
- [x] 7.3 `docs/ARCHITECTURE.md`: replace the listening-mode section with a short listen-only description, and remove the chunked-monologue/boundary prose
- [x] 7.4 Check `docs/REFERENCE.md`, `docs/PIPELINE_GUIDE.md`, `docs/TESTING.md` and `README.md` for listening-mode references and update any that exist

## 8. Living-spec reconciliation — the specs must match the code

- [x] 8.1 Run `npx openspec validate replace-listening-mode-with-listen-only --strict` and fix anything it reports
- [x] 8.2 Sync the deltas into the living spec (`/opsx:archive`, or `/opsx:sync` first if the change is not being archived yet): create `openspec/specs/listen-only-mode/`, delete `openspec/specs/listening-mode/` and `openspec/specs/speaker-mute/`, and apply the modified requirements to `session-announcements`, `orb-expressions` and `main-process-structure`
- [x] 8.3 Confirm `openspec/specs/listen-only-mode/spec.md` has a real `## Purpose` and no `TBD ... Update Purpose after archive` placeholder
- [x] 8.4 Sweep the whole tree for retired identifiers and assert zero hits outside `openspec/changes/archive/`: `listen-mode`, `listenMode`, `listening mode`, `listening-mode`, `IRIS_MUTE_HOTKEY`, `IRIS_LISTEN_CHUNK_MS`, `speaker-mute`, `speakerMuted`, `reportSpeakerMute`, `iris:mute-toggle`, `toggleOutputMute`, `EarOff`
- [x] 8.5 Read `openspec/specs/listen-only-mode/spec.md` against the implementation requirement by requirement and confirm each is actually true of the code — the three control surfaces, main ownership, ephemerality, the silent-reply presentation, the HUD reveal, and cue independence
- [x] 8.6 Confirm no living spec references a capability that no longer exists, and that `openspec/specs/` has no folder without a corresponding implementation
- [x] 8.7 Run the four gates one final time and record the result
