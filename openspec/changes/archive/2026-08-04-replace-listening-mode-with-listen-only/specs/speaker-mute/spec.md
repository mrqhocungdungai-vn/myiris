## REMOVED Requirements

This capability is renamed, not deleted. Every behavior below is re-established under `listen-only-mode`, which keeps the same suppression mechanism — stop what is playing, drop what arrives, never touch the session — and adds what the rename is for: a headphone identity, main-process ownership, a silent-reply presentation, and the HUD transcript reveal. The name `speaker-mute` described an output gate; the feature is now the app's listening affordance, and the living spec should say so.

The shared migration for every requirement here: read `listen-only-mode`. No behavior is lost. Two things change for a user: the control is a headphone icon rather than a speaker icon, and the global hotkey is `IRIS_LISTEN_HOTKEY` (default `Alt+L`) rather than `IRIS_MUTE_HOTKEY` (`Alt+M`), which is removed.

### Requirement: Speaker mute silences and suppresses Gemini audio output

**Reason**: Renamed into `listen-only-mode`'s suppression requirement, which restates this behavior verbatim in substance and adds the guarantees the rename makes load-bearing: that neither transition reconnects the session, changes the response modality or tool set, or alters the conversation's context, and that Iris keeps taking turns normally in text.
**Migration**: None for behavior. The renderer control is now a headphone icon; the underlying effect on audio is unchanged.

### Requirement: Speaker mute is ephemeral per session

**Reason**: Renamed into `listen-only-mode`'s ephemerality requirement with identical rules — reset to disengaged on session end whether by user stop or server teardown, a no-op while asleep, and never persisted to configuration.
**Migration**: None. A fresh launch still starts with Iris audible.

### Requirement: Speaker mute is reachable from three control surfaces

**Reason**: Renamed into `listen-only-mode`'s control-surfaces requirement. The three surfaces persist, with three differences: the renderer control is a headphone icon carrying a struck-through disengaged variant, the hotkey is `IRIS_LISTEN_HOTKEY` (default `Alt+L`), and the main process — not the renderer — holds the authoritative state, so the tray label no longer depends on the renderer reporting back.
**Migration**: **BREAKING** — remove `IRIS_MUTE_HOTKEY` from any `.env`; it is no longer read. Set `IRIS_LISTEN_HOTKEY` instead if the default `Alt+L` is unwanted. The retired listening mode's separate tray item and ear-icon control are gone, so exactly one control per surface remains.
