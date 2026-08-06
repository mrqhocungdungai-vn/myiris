// Chromium command-line switches Iris appends before app.whenReady, as pure
// decisions (listen-mode-hears-system-audio D1). Electron-free on purpose:
// main.mjs owns the one call to `app.commandLine.appendSwitch`, and the
// decision of whether to make it is testable here without booting Electron.

// The Chromium feature that provides macOS system-audio loopback capture
// (Core Audio taps, macOS 14.2+). `getDisplayMedia` still resolves without it
// and still hands back a live track — every sample is just bit-exact zero, and
// the track later ends. That is measured, not assumed: see design.md's [M]
// findings. So the feature being default-on today is not a reason to leave it
// implicit — a future Chromium that flips the default would break system audio
// INVISIBLY, and naming it here at least keeps the dependency written down and
// the failure identical every time.
export const LOOPBACK_AUDIO_FEATURE = "MacCatapLoopbackAudioForScreenShare";

/**
 * The switch to append for system-audio loopback, or `null` when the escape
 * hatch (`IRIS_SYSTEM_AUDIO=0`) is set — that path must leave Chromium
 * configured exactly as it was before this feature existed.
 *
 * @param {{ systemAudioEnabled: boolean }} input
 * @returns {{ name: string, value: string } | null}
 */
export function loopbackAudioSwitch({ systemAudioEnabled }) {
  if (!systemAudioEnabled) return null;
  return { name: "enable-features", value: LOOPBACK_AUDIO_FEATURE };
}
