## Why

Iris ships two features that both mean "make Iris quiet", built at opposite ends of the app and overlapping badly. Speaker mute is a renderer-side output gate: it drops Gemini's audio chunks after they arrive, so Iris still takes her turn, still replies, and her reply still lands in the transcript as text — costing nothing, interrupting nothing. Listening mode is a main-process session reconfiguration: it reaches the same silence by tearing down the Gemini Live socket and reconnecting with a different config profile (empty tool set, automatic activity detection disabled), and it pays that cost **three times over** — on enter, on exit, and on every chunk rotation (`IRIS_LISTEN_CHUNK_MS`, default 8 minutes). Each transition is a visible seam in a conversation that is supposed to feel continuous.

The verdict from use is that the reconnect is not worth what it buys. The one thing listening mode does that speaker mute cannot — keep Iris from interjecting during a long monologue — is worth less than the disruption of switching in and out of it. So we collapse the two into one feature, keep the mechanism that never reconnects, and give it the name, the icon and the hotkey of the one being retired.

## What Changes

- **Listening mode is removed entirely.** **BREAKING** — no chunk rotation, no boundary turns, no exit synthesis, no per-mode Gemini config, no listening system instruction. `electron/listen-mode.mjs` and `electron/listen-boundary.mjs` are deleted, `buildLiveConfig` returns to a single config with no `mode` parameter, and `IRIS_LISTEN_CHUNK_MS` is gone.
- **Speaker mute is promoted and renamed to listen-only mode**, presented as a headphone toggle: Iris hears you, replies in text, and emits no sound. The suppression mechanism is unchanged — `responseModalities` stays `["AUDIO"]` and the renderer keeps discarding chunks — so engaging or leaving the mode **never reconnects the session**.
- **The retired feature's control identity transfers to it.** The icon becomes `Headphones` / `HeadphoneOff`, and the global hotkey becomes `IRIS_LISTEN_HOTKEY` (default `Alt+L`). **BREAKING** — `IRIS_MUTE_HOTKEY` (`Alt+M`) is removed, and the two tray items collapse into one.
- **Authority for the mode moves to the main process.** Main holds the state; all three control surfaces route through it; the renderer executes the audio drop but is no longer the source of truth. This is what makes main-side behavior that depends on the mode trustworthy.
- **A silent reply now reads as a silent reply.** Today main emits `audio_state: "speaking"` per audio chunk regardless of mute, so the orb burns warm at full energy and the caption reads `"Speaking…"` while nothing is audible. While listen-only mode is engaged, main emits a distinct state instead: the orb takes a cool cyan-blue palette at the same full energy, and the caption shows the reply text rather than a speaking label.
- **The HUD opens its transcript when the mode is engaged.** The HUD's Comms panel is collapsed by default and its `commsOpen` flag is component-local, so nothing can open it — meaning "replies in text" is currently unreadable in the HUD. Engaging the mode opens Comms; leaving it restores the prior state.
- **Announcements go back to plain offline buffering.** Listening mode had to withhold them because injected text bypasses activity detection and would interrupt the monologue or be discarded. Listen-only mode keeps activity detection on and turn-taking normal, so announcements deliver immediately and arrive as text — removing both the suppression gate and the risk of the 20-entry drop-oldest buffer silently losing a run-completion notice.
- **Stale living-spec references are reconciled**, so no spec outlives the code it describes.

## Capabilities

### New Capabilities
- `listen-only-mode`: The headphone toggle — Iris hears the user and replies in text with no audio output, without reconnecting the Gemini session. Covers the suppression mechanism, main-process ownership, the three control surfaces, ephemerality, the silent-reply presentation, and the HUD transcript behavior. Supersedes `speaker-mute`.

### Modified Capabilities
- `listening-mode`: **Removed** — every requirement is retired with the feature. The capability folder leaves the living spec.
- `speaker-mute`: **Removed** — every requirement is retired, re-established under `listen-only-mode` with the renamed hotkey, the headphone icon, main-process ownership, and the silent-reply presentation. This is a rename, not a deletion of behavior.
- `session-announcements`: The listening-mode deliverability rule is removed; a connected session is once again always deliverable, and buffering is for an offline session only.
- `orb-expressions`: The state repertoire App drives gains a silent-reply state, distinct from `speaking`, for a turn that produces text without audio.
- `main-process-structure`: The preserved-behavior scenarios stop naming the listening-mode spec and its rotation in the smoke path, both of which cease to exist.

## Impact

**Deleted:** `electron/listen-mode.mjs`, `electron/listen-boundary.mjs` and their tests.

**Main process:** `live-config.mjs` (drop the `mode` parameter and the listen profile), `live-messages.mjs` (drop boundary suppression, the `goAway` rotation branch — the ordinary reconnect already covers it — and the segment accumulator; gate the `speaking` state on the new mode), `gemini-prompts.mjs` (drop the listening system instruction, entry-confirmation and exit-synthesis prompts), `announcements.mjs` (drop the `isListenModeSuppressing` dependency), `live-session.mjs` (the mirrored flag becomes the owned state), `window.mjs` (one tray item, renamed hotkey accessor), `main.mjs` (one hotkey registration), `ipc.mjs`, `wiring.mjs`, `wiring-live.mjs`.

**Renderer:** `useAudioPipeline.ts` (the drop path stays; ownership of the flag moves out), `App.tsx` (state plumbing, `reactorState` memo, `caption` memo, HUD Comms override), `HudShell.tsx` and `CenterStage.tsx` (two-button cluster, headphone icons, `commsOpen` lifted), `ReactorCore.tsx` (new palette and energy entry), `types.ts`, `vite-env.d.ts`.

**Config:** `.env.example` loses `IRIS_MUTE_HOTKEY` and `IRIS_LISTEN_CHUNK_MS`; `IRIS_LISTEN_HOTKEY` stays and changes meaning. No persisted config is touched — the mode is deliberately never persisted.

**Docs:** `CLAUDE.md`'s router row for listening mode, `docs/ARCHITECTURE.md`'s listening-mode section, and `openspec/specs/` as listed above.

**Accepted loss:** Iris will interject at pauses during a long monologue, silently and in text. There is no cheap way to keep the old behavior — activity detection can only be configured when a session is established, which is a reconnect by definition, and the reconnect is the thing being removed.
