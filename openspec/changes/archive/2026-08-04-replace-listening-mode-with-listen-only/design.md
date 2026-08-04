## Context

See proposal.md — Why. The design-relevant current state:

- **Two silences, two layers.** Speaker mute lives in `src/hooks/useAudioPipeline.ts`: `shouldDropChunk` (`:20-30`) discards Gemini audio in `playGeminiAudio` (`:236`, `:270`), and `toggleOutputMute` (`:294-299`) flushes what is playing. Listening mode lives in `electron/listen-mode.mjs` + `electron/listen-boundary.mjs`: it closes the socket and calls `connectLive({ isReconnect: true, mode: "listen" })` on enter, on exit, and on every rotation.
- **The two features own their state on opposite sides.** Listening mode is main-owned with a deliberately one-way bridge: `listen-mode:toggle-request` and `listen-mode:query` inbound, `listen-mode:state` pushed outbound (`electron/ipc.mjs:102-107`, `electron/preload.cjs:65-73`). Speaker mute is the mirror image and the weaker shape — the renderer decides, and reports up via `iris:speaker-mute-state` purely so the tray label stays right (`electron/live-session.mjs:68-70`, `electron/ipc.mjs:183-185`), while `iris:mute-toggle` pushes a *command* rather than a state.
- **Output state is emitted per audio chunk, blind to mute.** `electron/live-messages.mjs:135-136` emits `live:audio` and `audio_state: "speaking"` together for each inline audio part, then flips to `"listening"` at `turnComplete` (`:142`).
- **Reply text is turn-granular, not streamed.** `renderer-bridge.mjs` accumulates into `modelTranscriptBuffer` and only `flushTranscripts()` emits a `transcript` event — at `turnComplete`, on `interrupted`, and on session stop. Nothing emits partial reply text.
- **The HUD's transcript cannot be opened from outside.** `commsOpen` is component-local `useState` in `HudShell.tsx:225`, collapsed by default.

## Goals / Non-Goals

**Goals:**

- One feature, one control, one name, with the surviving mechanism being the one that never reconnects.
- Move mode authority to main so main-side behavior stops depending on renderer-reported state.
- Make a silent reply legible: visibly distinct, and readable as text on whichever surface is active.
- Leave the living spec with no reference to a capability that no longer exists.

**Non-Goals:**

- Preserving monologue protection in any form (see proposal.md — Accepted loss).
- Streaming partial reply text. The turn-granular flush stays as-is; see Risks.
- Touching the microphone control, `audio-playback`'s barge-in semantics, or the interface-cue preference.
- Moving audio suppression itself into main. The renderer keeps executing the drop; only the decision moves.

## Decisions

### D1: Delete listening mode outright rather than re-implementing its intent

Rejected: keeping both features (the overlap is the complaint), and keeping the ear control as an entry point over a non-reconnecting implementation. The second is not buildable: what made listening mode structurally silent was `realtimeInputConfig.automaticActivityDetection.disabled`, and `realtimeInputConfig` is part of the session setup — a Live session cannot be reconfigured in place. Any "listening mode without a reconnect" is a contradiction, so the honest choice is to drop the behavior and say so.

### D2: Keep `responseModalities: ["AUDIO"]` and discard audio at the output

Rejected: switching to `["TEXT"]` while engaged. It is the technically tidier answer — real text instead of a speech transcription, and no wasted audio tokens — but modality is fixed at session setup, so every toggle would reconnect. That reintroduces exactly the seam being removed. We pay for synthesized audio nobody hears, deliberately, and `live-config.mjs` loses its `mode` parameter and returns to a single config.

A consequence worth naming: the text the user reads is `outputAudioTranscription`, i.e. a transcription of speech. It will read as spoken language, not as written prose. That is acceptable and is why D8 declines to tell the model otherwise.

### D3: Main owns the state; adopt the retired feature's IPC bridge, retire speaker-mute's

Main holds the flag. All three surfaces funnel into one main-side toggle, which pushes the resolved state to the renderer; the renderer sets its suppression flag from what it receives and never asserts it.

The channel shape to keep is listening mode's, because it is already the correct one — a toggle *request* in, a *state* push out, plus a query for initial sync. Renamed to the new capability: `listen-only:toggle-request`, `listen-only:query`, `listen-only:state`. Speaker mute's pair is deleted: `iris:mute-toggle` (a command push, now redundant) and `iris:speaker-mute-state` (an upward mirror, now backwards). `live-session.mjs`'s `speakerMuted` mirror becomes the owned state, so the tray label reads main's own truth.

On the renderer side this is a small change, not a rewrite: `toggleOutputMute` already accepts an explicit value (`App.tsx:349` calls `toggleOutputMute(false)`), so it becomes a setter driven by the pushed state, and `flushPlayback()` still fires on the engaging edge.

Rejected: leaving the renderer authoritative and having main read the mirror. Main now decides which output state to emit per reply turn (D6); deriving that from a value the renderer reported means a slow or crashed renderer makes main lie. The retired spec already held this principle — its suppression was main-side precisely so it would not depend on the renderer — and it would be a regression to drop it while inheriting the feature's role.

### D4: Inherit the retired feature's hotkey name, drop speaker mute's

`IRIS_LISTEN_HOTKEY` (default `Alt+L`) survives and now toggles listen-only mode; `IRIS_MUTE_HOTKEY` (`Alt+M`) is removed along with `IRIS_LISTEN_CHUNK_MS`. Rejected: keeping `IRIS_MUTE_HOTKEY` to avoid breaking a configured `.env`. Both names are user-visible config, one of them has to go, and the surviving concept is "listen" — keeping the mute name would leave the env var arguing with the icon, the tray label and the capability name. The break is one line in `.env`, documented in the `speaker-mute` removal delta.

### D5: Two-icon idiom, matching the microphone control

`Headphones` / `HeadphoneOff` from the icon set already in use, following how `Mic` / `MicOff` distinguishes its states, rather than one fixed icon with a highlight. The cluster drops from three buttons to two in both `HudShell.tsx` and `CenterStage.tsx`; the `Ear` / `EarOff` pair goes with the feature.

### D6: A new `replying` output state, emitted by main

`live-messages.mjs` gates its per-chunk emission on the owned flag: `audio_state: "speaking"` when disengaged, `audio_state: "replying"` when engaged, cleared by the same `turnComplete` path. The renderer threads it through the existing chain — the `reactorState` memo (`App.tsx:711-718`), a `PALETTES` entry and an `ORB_ENERGY` entry in `ReactorCore.tsx` (cool cyan-blue accent, energy `1`), and the `caption` memo (`App.tsx:1473-1483`), where `"replying"` returns no label so the caption falls through to the transcript text instead of reading `"Speaking…"`.

Rejected: reusing `working` or `listening` for the silent reply. `working` means a Claude run is in flight — a genuinely different thing the user acts on differently — and `listening` means Iris is waiting rather than answering. Rejected also: leaving `"speaking"` in place. It is a false statement to the user at the exact moment we have asked them to read instead of listen.

### D7: Lift `commsOpen` with a mode-driven override that a manual change wins

`commsOpen` moves from `HudShell`-local state to a value the HUD receives, so engaging the mode can open it. The override applies on the transition, not continuously: the engaging edge opens the panel and records what it was, the disengaging edge restores that, and a manual toggle in between is respected rather than re-forced on the next render. Rejected: always-open Comms in the HUD (it defeats the point of a glanceable overlay in the common case, when the user is listening with their ears) and leaving it collapsed (the mode's whole output would be unreadable in the HUD).

### D8: Do not tell the model the mode is engaged

No system-instruction fragment, no `SYSTEM_EVENT_*` on toggle. Three reasons: the user's ask is that replies come back "as normal"; the text is a speech transcription (D2), so asking for written structure would produce a strange transcription; and injecting on toggle would provoke a turn, turning a silent toggle into a conversational event. `gemini-prompts.mjs` therefore loses the listening system instruction, the entry-confirmation prompt and the exit-synthesis prompt with nothing replacing them.

### D9: Announcements return to plain offline buffering

`isListenModeSuppressing` is deleted from `announcements.mjs`; `deliverable` becomes `getLiveSession()` alone. The suppression existed because injected text bypasses activity detection, which only mattered while the listen config had activity detection off. With it on, an announcement is an ordinary injection that lands as text.

This also removes a latent bug rather than merely simplifying: the buffer is capped at 20 with drop-oldest, and `drainPendingAnnouncements` only runs after a connect (`live-session.mjs:282`). A non-reconnecting mode has no connect to drain on, so keeping suppression would have required a new drain trigger *and* would still silently discard run-completion notices past the cap.

### D10: Drop the `goAway` rotation branch, keep the log

`live-messages.mjs:76-88` only rotates when listening mode is engaged and idle; its own comment records that otherwise "onclose fires shortly after and the ordinary reconnect handles it". The branch goes, the log line stays. No new handling is needed.

### D11: Interface cues stay independent

`orb-expressions`' synthesized cues keep their own persisted preference. Coupling an ephemeral per-session mode to a persisted preference would require shadowing and restoring it, and would make "what is the cue setting after I toggle the headphone off" a question with no obvious answer. Asserted as a requirement on `listen-only-mode` so it is tested rather than assumed.

### D12: New capability name `listen-only-mode`, not a reuse of `listening-mode`

Rejected: reusing the freed `listening-mode` name (a reader grepping `openspec/changes/archive/2026-07-28-add-listening-mode/` would find a same-named spec describing a reconnect-based mechanism — actively misleading), and keeping `speaker-mute` (the name would describe an output gate when the thing is now the app's listening affordance). The rename is expressed as a `REMOVED` delta on `speaker-mute` whose reasons state plainly that behavior is re-established, not dropped.

### D13: Reconcile every cross-referencing spec in the same change

`session-announcements` and `main-process-structure` both name listening mode. They are modified here, not left to drift: a living spec that references a deleted capability is false, and CLAUDE.md makes the living spec the source of truth. `main-process-structure`'s two mentions sit inside a historical requirement about a past reorganization, so the edit is minimal — retarget the names and add one clause noting that a retired capability drops out of the checks rather than falsifying them — instead of rewriting the record of that change.

## Risks / Trade-offs

- **Iris will now interject during long monologues, silently.** → Accepted, not mitigated; it is the price of never reconnecting, and it is stated in the proposal and in the removal delta's migration. If it proves intolerable, the recovery is a new change, not a revert of this one.
- **The caption lags by one turn during a silent reply.** Reply text flushes only at `turnComplete`, so mid-turn the caption shows the previous line rather than the text being generated. → The auto-opened Comms panel (D7) is the real read surface on both HUD and deck; the caption is a glanceable extra. Streaming partial transcript text is a separate change with its own cost, deliberately out of scope.
- **Audio tokens are spent on speech nobody hears.** → Accepted per D2, and unchanged from today's speaker-mute behavior, so it is not a regression. `["TEXT"]` remains available later if the cost ever justifies a reconnect.
- **Moving ownership to main touches five wiring modules at once** (`ipc`, `wiring`, `wiring-live`, `live-session`, `window`), with `main.mjs` as composition root. → `electron/sdk-options.test.mjs` and the existing wiring tests pin these shapes; the injected-accessor pattern means each move is mechanical. Run the four gates after the ownership move and before the UI work, so a wiring break is not diagnosed through a React symptom.
- **Deleting a 512-line spec and two modules can silently take working behavior with it.** → The removal delta enumerates all seventeen requirements with an explicit reason each, so anything still wanted has to be argued for by name rather than lost by omission. The `listening-mode` tests are deleted with their modules; every other affected test is updated, not removed.
- **A stale reference is easy to leave behind** across `CLAUDE.md`, `docs/ARCHITECTURE.md`, `.env.example`, and four specs. → A dedicated final task greps the tree for the retired identifiers and asserts nothing remains, run after implementation rather than alongside it.

## Migration Plan

No data or persisted-config migration: the mode is deliberately never persisted, and no `~/.iris` file records either feature.

**User-facing:** remove `IRIS_MUTE_HOTKEY` and `IRIS_LISTEN_CHUNK_MS` from any local `.env` (both are simply ignored if left). `IRIS_LISTEN_HOTKEY` keeps its name and its `Alt+L` default and now toggles listen-only mode.

**Rollback:** revert the change's commits. Nothing outside the repo changes, so there is no state to unwind — and reverting restores listening mode along with its reconnects.

**Order:** main-process ownership and the listening-mode deletion first (with gates green), then the renderer presentation, then the spec and docs reconciliation last so it describes what actually landed.
