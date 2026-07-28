## Why

When the user thinks out loud — presenting a plan, reasoning through a problem, talking to
themselves for ten or twenty minutes — Iris interrupts. Gemini's server-side voice activity
detection commits a turn every time the user pauses, so Iris answers into gaps that were not
invitations, breaking the user's train of thought precisely when it is most fragile.

Neither existing control fixes this. Muting the speaker only hides Iris's replies: Gemini still
takes turns, still burns tokens, and its unheard utterances still enter the conversation history.
Muting the microphone stops the interruptions by making Iris deaf, which defeats the point. What
is missing is a state where Iris hears everything and understands it, but cannot speak until the
user permits it.

## What Changes

- New **listening mode**: a toggle, peer in shape to speaker mute, that puts the Gemini Live
  session into a listen-only configuration where Iris accumulates everything it hears and is
  structurally incapable of taking a turn the user did not ask for.
- Iris's silence while listening is a property of the session configuration, not an instruction in
  a prompt. With automatic activity detection disabled and no activity closed, no turn can
  complete. This was measured, not inferred.
- Because the Live connection only lasts about ten minutes — shorter than the monologues this mode
  exists for — a listening session is **chunked**: it rotates on its own interval with margin below
  that lifetime (`IRIS_LISTEN_CHUNK_MS`), and immediately if the server signals a disconnect. Each
  rotation commits the chunk and starts a new one. Rotations are inaudible and invisible: the model
  turn a rotation forces is suppressed rather than played.
- Every boundary must capture a resumption handle **before** disconnecting. The server issues no
  checkpoint while an activity is open, so disconnecting at turn completion loses everything while
  looking like it worked. Measured both ways.
- Each chunk's input transcription is kept in process memory as the recovery path for material the
  model's context may not have — never written to disk or to the notes vault, discarded once the closing
  synthesis has been delivered.
- Turning the mode off performs a final boundary (suppressed like any other), reconnects into normal
  conversation, and **then** drives the turn in which Iris speaks its synthesis. Asking for the
  synthesis at the boundary would get the one-word acknowledgement a rotation gets, since the listening
  instruction is still in force there.
- Three control surfaces mirroring speaker mute: a renderer control beside the existing microphone
  and speaker mute buttons in both the deck and the HUD, a tray item, and a global hotkey
  (`IRIS_LISTEN_HOTKEY`). The renderer control is a human-ear icon, crossed out when the mode is off.
- Listening mode is ephemeral per session: it resets whenever the session ends, and is never
  persisted, so a wake and a fresh launch both start in normal conversation. An **unexpected**
  disconnect — the machine slept, the network dropped — also ends the mode, rather than leaving the ear
  icon lit over a session that has silently stopped listening. That is what makes power-management APIs
  unnecessary.
- The main process is the sole owner of the mode's state: the tray item and hotkey act on it directly
  rather than dispatching to the renderer (so they still work with the window closed), and the renderer
  displays pushed state and can query it, but never reports it back.
- Announcements raised while the mode is engaged are buffered rather than injected into the listening
  session, since injecting them would either interrupt the monologue or be silently discarded.

Not breaking. Normal conversation is untouched: the existing Live configuration is used verbatim
whenever listening mode is off.

## Capabilities

### New Capabilities
- `listening-mode`: Iris listens and accumulates context while remaining structurally silent, until
  the user closes the mode and thereby permits it to speak; plus chunk rotation and its boundary
  ordering, the in-memory segment record, the mode's control surfaces, its ephemerality, and the
  deliberate reconnects that a configuration change and a rotation require.

### Modified Capabilities
- `session-announcements`: its delivery rule currently branches on whether a voice session is
  connected. A session that is connected but in listening mode must now be treated as not
  deliverable — buffered, not sent — and the buffer must not be flushed by a listening-mode connect
  or a rotation reconnect. Without this, every announcement becomes either an interruption of the
  monologue or a silently lost message.

`speaker-mute` is a shape to imitate, not a behavior to change: microphone mute and speaker mute keep
working exactly as specified, and no requirement of theirs is altered.

## Impact

- **`electron/main.mjs`** — the session lifecycle gains the enter/exit/rotation sequences, a
  deliberate-transition reconnect path distinct from the failure-reconnect path (which discards the
  resumption handle after repeated attempts), suppression of rotation-boundary output, the segment
  record, the announcement deferral in `notifyIris` and the drain guard, plus a tray item and a global
  shortcut alongside the ones already registered there.
- **A new `electron/live-config.mjs`** — `buildLiveConfig()` closes over module state and lives in a
  file that imports Electron, so it cannot be exercised in tests as-is. The configuration builder moves
  to its own module taking its inputs as parameters, gaining a mode branch that supplies
  `realtimeInputConfig` for listening and nothing at all for conversation.
- **`electron/preload.cjs`** — a narrow bridge: a toggle request, a one-way state push, and a query for
  boot/reload. No report-back channel, so the renderer cannot overwrite state main owns.
- **`src/App.tsx`, `src/components/HudShell.tsx`**, and the deck's control cluster — the ear control
  and its state.
- **`.env.example`** — `IRIS_LISTEN_HOTKEY`, `IRIS_LISTEN_CHUNK_MS`.
- No change to `src/hooks/useAudioPipeline.ts`. Microphone capture and streaming are untouched;
  listening mode changes only what the server does with the audio it already receives.
- No new orb state, and no change to `orb-expressions`: `audio_state` already resolves to
  `"listening"` for the duration, so the ear control is the only new visual feedback.
- No new dependency. The mechanism is `@google/genai`'s existing `realtimeInputConfig`,
  `activityStart`/`activityEnd`, and `sessionResumption`.

### Known limitation: never validated outside development

Everything in this change has only ever been exercised through `npm start`, `npm run dev`, and
throwaway spike scripts run against the live API from a terminal. The app has not been packaged,
installed onto a machine, and run over days.

The unknowns that are genuinely specific to this feature: stability across many rotations in a long
real session, the quota draw of continuous listening (a ceiling was hit once while spiking, and whether
that is the account's tier or the mode's own consumption is unresolved), and the grace period the
server's disconnect signal leaves — which the design deliberately does not depend on.

Three risks that would ordinarily belong in a caveat like this were checked and do **not** apply:
`openspec/` is not bundled into the app (`package.json`'s `files` is an explicit allowlist), the tray
and global shortcut need no entitlement or permission grant so signing does not affect them, and PATH
matters only to the `claude` probe this mode never touches. The real packaging hazard is pre-existing
and app-wide rather than this change's: there is no signing configuration yet, and when one is added,
notarization will need a hardened-runtime entitlement for microphone input that electron-builder's
default template omits. `design.md`'s risk list carries the detail.

This is recorded as a limitation to return to when the app is genuinely installed and used long-term,
not as work to do now.
