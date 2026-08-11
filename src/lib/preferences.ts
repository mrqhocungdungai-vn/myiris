// The persisted UI preferences, in one place — the keys, and what a stored
// string means for each one.
//
// This follows `webgl-quality.ts`'s split, which is the shape the rest of
// `src/lib` already uses: the **parse** is pure and takes an already-read
// `string | null`, so it is testable with no storage mock at all. The
// **read/write** helpers below wrap it in the one `try/catch` that used to be
// copy-pasted fifteen times across `App.tsx` and `VaultGalaxy.tsx`.
//
// Storage is best-effort by deliberate decision: a browser mode that throws on
// `localStorage` must not take the app's controls down with it. Every failure
// path resolves to the preference's stated default, and a failed write leaves
// the toggle working for the session.

/** Storage keys. Named here so a key is spelled once, not once per call site. */
export const SOUNDS_STORAGE_KEY = "iris.soundsEnabled";
export const CAMERA_STORAGE_KEY = "iris.cameraDeviceId";
export const MIC_STORAGE_KEY = "iris.micDeviceId";
export const HAND_STORAGE_KEY = "iris.handControlEnabled";
// ambient-memory: default OFF, unlike sounds — this is the one preference whose
// safer default is off, not on (design D1).
export const AMBIENT_CAPTURE_STORAGE_KEY = "iris.ambientCaptureEnabled";
// glass-hud-mode: the HUD camera's size. Enlarging is the deliberate act, so
// the standard size is the default and anything absent or unreadable resolves
// to it — the failure mode is "reverts to standard", never "stuck enlarged with
// no way back".
export const HUD_CAMERA_SIZE_STORAGE_KEY = "iris.hudCameraEnlarged";
// listen-mode-hears-system-audio: engaging the mode IS the consent point for
// what Iris hears, so the first engage states that it widens to whatever the
// machine plays and may include other people. Remembered so it is a first-run
// notice rather than a nag.
export const LISTEN_ONLY_CONSENT_STORAGE_KEY = "iris.listenOnlyConsentSeen";
// second-brain-gesture-nav: a developer-only overlay, flipped from devtools
// with `localStorage.setItem(...)`. Deliberately has no Settings UI.
export const GESTURE_DEBUG_STORAGE_KEY = "iris.galaxyGestureDebug";

/**
 * What a stored flag string means.
 *
 * Only the exact strings `"on"` and `"off"` are meaningful. **Anything else —
 * absent, empty, or unrecognized — resolves to `whenAbsent`**, the preference's
 * own stated default, rather than to a shared global default. That is why this
 * takes the default as an argument instead of assuming one: the defaults here
 * genuinely differ and the differences are deliberate (interface sounds default
 * ON; ambient capture, hand control and the enlarged HUD camera default OFF).
 *
 * This preserves the three hand-written rules it replaces exactly:
 * `stored !== "off"` is `parseFlag(stored, true)`, and `stored === "on"` is
 * `parseFlag(stored, false)`.
 */
export function parseFlag(stored: string | null, whenAbsent: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return whenAbsent;
}

/**
 * What a stored free-form choice (a device id) means. An absent or empty value
 * is the same as never having chosen: it resolves to `fallback`, which for both
 * current callers is the System Default device rather than a specific one.
 */
export function parseChoice(stored: string | null, fallback: string): string {
  return stored || fallback;
}

/** Serializes a flag. The inverse of `parseFlag` for the two meaningful values. */
export function flagToStored(value: boolean): string {
  return value ? "on" : "off";
}

/**
 * Reads a flag, resolving to `whenAbsent` if storage is unreadable.
 *
 * Unreadable storage is treated identically to an absent key — deliberately.
 * For `listenOnlyConsentSeen` that means the consent notice is shown *again*
 * rather than silently swallowed: a repeated consent statement is a nuisance, a
 * missing one is not.
 */
export function readFlag(key: string, whenAbsent: boolean): boolean {
  try {
    return parseFlag(window.localStorage.getItem(key), whenAbsent);
  } catch {
    return whenAbsent;
  }
}

/** Reads a free-form choice, resolving to `fallback` if storage is unreadable. */
export function readChoice(key: string, fallback: string): string {
  try {
    return parseChoice(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

/**
 * Persists a preference, best-effort.
 *
 * A failed write is swallowed on purpose: the caller has already updated React
 * state, so the setting still applies for this session and only fails to
 * survive a restart. Throwing here would turn a degraded-but-working toggle
 * into a broken one.
 */
export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort persistence; the setting still applies for this session.
  }
}

/** Persists a flag. Convenience over `writePreference` + `flagToStored`. */
export function writeFlag(key: string, value: boolean): void {
  writePreference(key, flagToStored(value));
}
