// The accelerators Iris registers as OS-level global shortcuts, one definition
// each. They are read in two unrelated places — main.mjs registers them (via
// window.mjs, which re-exports these) and getFullConfig() reports them to the
// renderer so the UI can name the key that actually fires — and a default that
// drifted between those two would produce exactly the defect
// wake-sleep-voice's "displayed keys match registered keys" scenario forbids:
// a prompt telling the user to press a key that does nothing.
//
// Electron-free on purpose: user-config.mjs must stay importable without
// Electron, and this is only a read of process.env.
//
// Wake and sleep are modifier-qualified by requirement, not by taste: a global
// registration on a bare letter would swallow that letter everywhere in the
// OS. Alt+Shift keeps the W/S mnemonic while avoiding ⌥W/⌥S, which are the
// ordinary character-entry chords for ∑ and ß.

export function hudHotkey() {
  return process.env.IRIS_HUD_HOTKEY || "Alt+Space";
}

export function listenHotkey() {
  return process.env.IRIS_LISTEN_HOTKEY || "Alt+L";
}

export function wakeHotkey() {
  return process.env.IRIS_WAKE_HOTKEY || "Alt+Shift+W";
}

export function sleepHotkey() {
  return process.env.IRIS_SLEEP_HOTKEY || "Alt+Shift+S";
}
